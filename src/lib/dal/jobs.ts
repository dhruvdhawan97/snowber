import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AUTO_CONFIRM_HOURS } from "@/lib/config";
import { JOB_STATUS_LABEL, type JobStatus } from "@/lib/contracts/domain";
import { checkTransition, type Actor } from "@/lib/contracts/job-states";
import type { BookingInput } from "@/lib/contracts/schemas";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { publish, publishAll, type PendingEvent } from "@/lib/events";
import { firstName, formatMoney, formatWindow } from "@/lib/format";
import { createCheckoutSession, getPaidCheckoutSession, getPaymentProvider, paymentsAreSimulated } from "@/lib/payments";
import { DISCOUNT_LABEL, discountBpsFor, jobEarnings, quoteForWindow, quoteForWindows, type DiscountProgramKey } from "@/lib/pricing";
import { ratingSummary } from "./reviews";
import { actorOf, assertRole, type CurrentUser } from "./session";
import { lockBlowerFor } from "./rentals";
import { lockCoveringShift } from "./shifts";

type Tx = Prisma.TransactionClient;

// ───────────────────────── State machine ─────────────────────────

export type TransitionExtras = {
  assignment?: { cleanerId: string; windowId: string };
  disputeReason?: string;
};

export type TransitionOutcome = {
  event: PendingEvent;
  refund?: { externalId: string | null; amountCents: number };
};

/**
 * The only code that changes a job's status. Runs inside a transaction:
 * validates the transition and its preconditions, writes the status, timestamps,
 * ledger and payment rows, and returns the event to publish after commit.
 * Uses a compare-and-set update so two concurrent requests cannot both win.
 */
export async function applyTransition(
  tx: Tx,
  jobId: string,
  to: JobStatus,
  actor: Actor,
  extras: TransitionExtras = {},
): Promise<TransitionOutcome> {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    include: {
      photos: { select: { kind: true } },
      payment: true,
      property: { select: { lotSize: true, address: true } },
      cleaner: { select: { name: true } },
    },
  });
  if (!job) throw notFound("That job no longer exists.");

  const check = checkTransition(
    {
      status: job.status,
      homeownerId: job.homeownerId,
      cleanerId: job.cleanerId,
      hasBeforePhoto: job.photos.some((p) => p.kind === "BEFORE"),
      hasAfterPhoto: job.photos.some((p) => p.kind === "AFTER"),
    },
    to,
    actor,
  );
  if (!check.ok) throw invalid(check.reason);

  const now = new Date();
  const data: Prisma.JobUncheckedUpdateManyInput = { status: to };
  const audience = new Set<string>([job.homeownerId]);
  if (job.cleanerId) audience.add(job.cleanerId);
  let refund: TransitionOutcome["refund"];
  let message = `${job.property.address}: ${JOB_STATUS_LABEL[to].toLowerCase()}`;

  switch (to) {
    case "ASSIGNED": {
      const assignment = extras.assignment;
      if (!assignment) throw invalid("Missing assignment details.");
      // Sequential on purpose: a transaction uses one connection, which runs one query at a time.
      const window = await tx.serviceWindow.findUnique({ where: { id: assignment.windowId } });
      const cleaner = await tx.user.findUnique({ where: { id: assignment.cleanerId }, select: { role: true, name: true, ownsBlower: true } });
      if (!window) throw notFound("That window no longer exists.");
      if (!cleaner || cleaner.role !== "CLEANER") throw invalid("Jobs can only be assigned to cleaners.");
      await lockCoveringShift(tx, assignment.cleanerId, window);
      // Large lots need a snow blower, owned or rented; a covering rental is locked until commit.
      if (job.requiresBlower) await lockBlowerFor(tx, { id: assignment.cleanerId, name: cleaner.name, ownsBlower: cleaner.ownsBlower }, window);
      Object.assign(data, { cleanerId: assignment.cleanerId, assignedWindowId: window.id, assignedAt: now });
      audience.add(assignment.cleanerId);
      message = `${job.property.address}: assigned to ${firstName(cleaner.name)} for ${formatWindow(window.startsAt, window.endsAt)}`;

      // Homeowners were charged for their most expensive window; refund the difference
      // if the controller picked a cheaper one. Timing is measured from when they booked,
      // and the discount locked in at booking still applies.
      const assigned = quoteForWindow(
        {
          lotSize: job.property.lotSize,
          includeSidewalk: job.includeSidewalk,
          includeSalt: job.includeSalt,
          discountBps: job.discountBps,
        },
        window,
        job.createdAt,
      );
      const assignedPrice = assigned.totalCents;
      if (assignedPrice < job.priceCents && job.payment) {
        const difference = job.priceCents - assignedPrice;
        data.priceCents = assignedPrice;
        data.discountCents = assigned.discountCents;
        await tx.payment.update({
          where: { id: job.payment.id },
          data: { refundedCents: { increment: difference }, status: "PARTIALLY_REFUNDED" },
        });
        refund = { externalId: job.payment.externalId, amountCents: difference };
        message += ` (price lowered by ${formatMoney(difference)})`;
      }
      break;
    }
    case "REQUESTED":
      Object.assign(data, { cleanerId: null, assignedWindowId: null, routeOrder: null, assignedAt: null });
      message = `${job.property.address}: back in the queue`;
      break;
    case "IN_PROGRESS":
      data.startedAt = now;
      message = `${job.property.address}: ${firstName(job.cleaner?.name ?? "Your cleaner")} started`;
      break;
    case "COMPLETED":
      data.completedAt = now;
      message = `${job.property.address}: done — before/after photos are ready`;
      break;
    case "CONFIRMED": {
      if (!job.cleanerId) throw invalid("This job has no cleaner to pay.");
      data.confirmedAt = now;
      const earning = jobEarnings(job);
      await tx.ledgerEntry.create({
        data: {
          cleanerId: job.cleanerId,
          type: "EARNING",
          amountCents: earning,
          jobId: job.id,
          description: `${job.property.address}${job.tipCents > 0 ? ` (incl. ${formatMoney(job.tipCents)} tip)` : ""}`,
        },
      });
      message =
        actor.kind === "system"
          ? `${job.property.address}: auto-confirmed after ${AUTO_CONFIRM_HOURS} hours`
          : job.status === "DISPUTED"
            ? `${job.property.address}: dispute resolved, the cleaner is paid`
            : `${job.property.address}: confirmed`;
      break;
    }
    case "DISPUTED":
      data.disputeReason = extras.disputeReason ?? null;
      message = `${job.property.address}: disputed by the homeowner`;
      break;
    case "CANCELLED": {
      data.cancelledAt = now;
      if (job.payment && job.payment.status !== "REFUNDED") {
        const remaining = job.payment.amountCents - job.payment.refundedCents;
        await tx.payment.update({
          where: { id: job.payment.id },
          data: { refundedCents: job.payment.amountCents, status: "REFUNDED" },
        });
        if (remaining > 0) refund = { externalId: job.payment.externalId, amountCents: remaining };
      }
      message =
        job.status === "DISPUTED"
          ? `${job.property.address}: dispute resolved, the homeowner is refunded`
          : `${job.property.address}: cancelled and refunded`;
      break;
    }
  }

  const result = await tx.job.updateMany({ where: { id: jobId, status: job.status }, data });
  if (result.count !== 1) throw conflict("Someone else just updated this job. Refresh and try again.");

  return {
    event: { type: "job.updated", jobId, status: to, message, audience: { userIds: [...audience], controllers: true } },
    refund,
  };
}

/** Runs refunds and publishes events once the transaction has committed. */
export async function settleOutcomes(outcomes: readonly TransitionOutcome[]): Promise<void> {
  const provider = getPaymentProvider();
  for (const outcome of outcomes) {
    if (!outcome.refund) continue;
    try {
      await provider.refund(outcome.refund);
    } catch (error) {
      console.error("[payments] refund failed; needs a retry", error);
    }
  }
  publishAll(outcomes.map((o) => o.event));
}

export async function transitionJob(jobId: string, to: JobStatus, actor: Actor, extras?: TransitionExtras) {
  const outcome = await prisma.$transaction((tx) => applyTransition(tx, jobId, to, actor, extras));
  await settleOutcomes([outcome]);
  return outcome;
}

// ───────────────────────── Homeowner ─────────────────────────

export async function previewQuote(
  user: CurrentUser,
  input: Pick<BookingInput, "propertyId" | "windowIds" | "includeSidewalk" | "includeSalt">,
) {
  assertRole(user, "HOMEOWNER");
  const property = await prisma.property.findFirst({ where: { id: input.propertyId, ownerId: user.id } });
  if (!property) throw notFound("Choose one of your properties.");
  const windows = await prisma.serviceWindow.findMany({
    where: { id: { in: input.windowIds }, status: "OPEN", startsAt: { gt: new Date() } },
  });
  if (windows.length === 0) throw invalid("Pick at least one open window.");
  return quoteForWindows(
    {
      lotSize: property.lotSize,
      includeSidewalk: property.hasSidewalk && input.includeSidewalk,
      includeSalt: input.includeSalt,
      discountBps: await currentDiscountBps(user.id),
    },
    windows,
    new Date(),
  );
}

/** The homeowner's approved senior / accessibility discount, if any. */
async function currentDiscountBps(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { discountProgram: true, discountStatus: true } });
  return discountBpsFor(u?.discountProgram, u?.discountStatus);
}

export type BookingResult = { kind: "booked"; jobId: string } | { kind: "checkout"; url: string };

/**
 * Prices a booking on the server. With mock payments the job and payment are saved
 * right away. With Stripe the homeowner is sent to Checkout first, and the job is
 * only created once Stripe confirms the payment (finalizeCheckout).
 */
export async function createBooking(user: CurrentUser, input: BookingInput, appUrl: string): Promise<BookingResult> {
  assertRole(user, "HOMEOWNER");
  const property = await prisma.property.findFirst({ where: { id: input.propertyId, ownerId: user.id } });
  if (!property) throw notFound("Choose one of your properties.");

  const windowIds = [...new Set(input.windowIds)];
  const windows = await prisma.serviceWindow.findMany({
    where: { id: { in: windowIds }, status: "OPEN", startsAt: { gt: new Date() } },
  });
  if (windows.length !== windowIds.length) {
    throw invalid("One of those windows has closed or already started. Please pick again.");
  }

  const includeSidewalk = property.hasSidewalk && input.includeSidewalk;
  const bookedAt = new Date();
  const q = quoteForWindows(
    { lotSize: property.lotSize, includeSidewalk, includeSalt: input.includeSalt, discountBps: await currentDiscountBps(user.id) },
    windows,
    bookedAt,
  );

  if (!paymentsAreSimulated()) {
    const url = await createCheckoutSession({
      customerEmail: user.email,
      lines: [
        {
          name: `Snow clearing at ${property.address}`,
          description: q.discountCents > 0 ? `Includes ${formatMoney(q.discountCents)} discount` : undefined,
          amountCents: q.totalCents,
        },
        { name: "Tip for your cleaner", amountCents: input.tipCents },
      ],
      // Everything needed to create the job after payment. Stripe limits each value to 500 characters.
      metadata: {
        userId: user.id,
        propertyId: property.id,
        windowIds: windowIds.join(","),
        includeSidewalk: String(includeSidewalk),
        includeSalt: String(input.includeSalt),
        tipCents: String(input.tipCents),
        priceCents: String(q.totalCents),
        discountBps: String(q.discountBps),
        discountCents: String(q.discountCents),
        bookedAt: bookedAt.toISOString(),
        notes: (input.notes ?? "").slice(0, 500),
      },
      successUrl: `${appUrl}/homeowner/book/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/homeowner/book?property=${property.id}&cancelled=1`,
    });
    return { kind: "checkout", url };
  }

  const totalCharge = q.totalCents + input.tipCents;
  const provider = getPaymentProvider();
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.job.create({
      data: {
        propertyId: property.id,
        homeownerId: user.id,
        includeSidewalk,
        includeSalt: input.includeSalt,
        notes: input.notes,
        priceCents: q.totalCents,
        tipCents: input.tipCents,
        discountBps: q.discountBps,
        discountCents: q.discountCents,
        estMinutes: q.estMinutes,
        requiresBlower: q.requiresBlower,
        windowOptions: { connect: windows.map((w) => ({ id: w.id })) },
      },
    });
    const charge = await provider.charge({
      jobId: created.id,
      amountCents: totalCharge,
      description: `Snow clearing at ${property.address}`,
    });
    await tx.payment.create({
      data: { jobId: created.id, provider: provider.name, externalId: charge.externalId, amountCents: totalCharge },
    });
    return created;
  });

  announceNewJob(job.id, user.id, property.address);
  return { kind: "booked", jobId: job.id };
}

function announceNewJob(jobId: string, homeownerId: string, address: string) {
  publish({
    type: "job.created",
    jobId,
    status: "REQUESTED",
    message: `New request: ${address}`,
    audience: { userIds: [homeownerId], controllers: true },
  });
}

/**
 * Turns a paid Stripe Checkout session into a job. Called from the success page
 * and from the Stripe webhook, so it must be safe to run twice: the second call
 * finds the existing payment and returns the same job.
 * If the windows closed while the homeowner was paying, the payment is refunded.
 */
export async function finalizeCheckout(sessionId: string, expectedUserId?: string): Promise<{ jobId: string }> {
  const session = await getPaidCheckoutSession(sessionId);
  if (!session) throw invalid("We couldn't confirm that payment. If you were charged, contact the controller.");
  const m = session.metadata;
  if (expectedUserId && m.userId !== expectedUserId) throw forbidden();

  const result = await prisma.$transaction(async (tx) => {
    // Serialize concurrent finalizations of the same session (success page + webhook).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${session.id}))`;
    const existing = await tx.payment.findFirst({
      where: { provider: "stripe", externalId: session.paymentIntentId },
      select: { jobId: true },
    });
    if (existing) return { jobId: existing.jobId, created: false as const, address: "" };

    const windowIds = m.windowIds.split(",").filter(Boolean);
    const [property, windows] = await Promise.all([
      tx.property.findFirst({ where: { id: m.propertyId, ownerId: m.userId } }),
      tx.serviceWindow.findMany({ where: { id: { in: windowIds }, status: "OPEN", startsAt: { gt: new Date() } } }),
    ]);
    if (!property || windows.length !== windowIds.length) return null;

    const priceCents = Number(m.priceCents);
    const tipCents = Number(m.tipCents);
    const job = await tx.job.create({
      data: {
        propertyId: property.id,
        homeownerId: m.userId,
        includeSidewalk: m.includeSidewalk === "true",
        includeSalt: m.includeSalt === "true",
        notes: m.notes || null,
        priceCents,
        tipCents,
        discountBps: Number(m.discountBps),
        discountCents: Number(m.discountCents),
        estMinutes: quoteForWindows(
          { lotSize: property.lotSize, includeSidewalk: m.includeSidewalk === "true", includeSalt: m.includeSalt === "true" },
          windows,
          new Date(m.bookedAt),
        ).estMinutes,
        requiresBlower: property.lotSize === "LARGE",
        windowOptions: { connect: windows.map((w) => ({ id: w.id })) },
      },
    });
    await tx.payment.create({
      data: { jobId: job.id, provider: "stripe", externalId: session.paymentIntentId, amountCents: session.amountTotal },
    });
    return { jobId: job.id, created: true as const, address: property.address };
  });

  if (!result) {
    await getPaymentProvider().refund({ externalId: session.paymentIntentId, amountCents: session.amountTotal });
    throw invalid("Those windows closed while you were paying, so we refunded you in full. Please book again.");
  }
  if (result.created) announceNewJob(result.jobId, m.userId, result.address);
  return { jobId: result.jobId };
}

/** Homeowner discount status for the Discounts page. */
export async function getMyDiscount(user: CurrentUser) {
  assertRole(user, "HOMEOWNER");
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { discountProgram: true, discountStatus: true } });
  return {
    program: (u?.discountProgram ?? null) as DiscountProgramKey | null,
    status: u?.discountStatus ?? null,
    label: u?.discountProgram ? DISCOUNT_LABEL[u.discountProgram] : null,
  };
}

/** A homeowner applies for a discount; a controller approves it on the Users page. */
export async function requestDiscount(user: CurrentUser, program: DiscountProgramKey | null) {
  assertRole(user, "HOMEOWNER");
  await prisma.user.update({
    where: { id: user.id },
    data: program ? { discountProgram: program, discountStatus: "PENDING" } : { discountProgram: null, discountStatus: null },
  });
}

export async function listHomeownerJobs(user: CurrentUser) {
  assertRole(user, "HOMEOWNER");
  return prisma.job.findMany({
    where: { homeownerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      property: { select: { address: true, label: true } },
      assignedWindow: true,
      windowOptions: { orderBy: { startsAt: "asc" } },
      cleaner: { select: { name: true } },
    },
  });
}

export async function getHomeownerJob(user: CurrentUser, jobId: string) {
  assertRole(user, "HOMEOWNER");
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      property: true,
      assignedWindow: true,
      windowOptions: { orderBy: { startsAt: "asc" } },
      cleaner: { select: { id: true, name: true } },
      reviews: true,
      payment: true,
    },
  });
  if (!job || job.homeownerId !== user.id) throw notFound("We couldn't find that job.");
  const cleanerRating = job.cleaner ? ((await ratingSummary([job.cleaner.id])).get(job.cleaner.id) ?? null) : null;
  return {
    ...job,
    cleanerRating,
    myReview: job.reviews.find((r) => r.authorId === user.id) ?? null,
  };
}

export async function cancelJob(user: CurrentUser, jobId: string) {
  assertRole(user, "HOMEOWNER", "CONTROLLER");
  return transitionJob(jobId, "CANCELLED", actorOf(user));
}

export async function confirmJob(user: CurrentUser, jobId: string) {
  assertRole(user, "HOMEOWNER", "CONTROLLER");
  return transitionJob(jobId, "CONFIRMED", actorOf(user));
}

export async function disputeJob(user: CurrentUser, jobId: string, reason: string) {
  assertRole(user, "HOMEOWNER");
  return transitionJob(jobId, "DISPUTED", actorOf(user), { disputeReason: reason });
}

/** Confirms jobs the homeowner has not responded to within AUTO_CONFIRM_HOURS. */
export async function autoConfirmStale(): Promise<number> {
  const cutoff = new Date(Date.now() - AUTO_CONFIRM_HOURS * 60 * 60 * 1000);
  const stale = await prisma.job.findMany({
    where: { status: "COMPLETED", completedAt: { lt: cutoff } },
    select: { id: true },
    take: 100,
  });
  let confirmed = 0;
  for (const { id } of stale) {
    try {
      await transitionJob(id, "CONFIRMED", { kind: "system" });
      confirmed++;
    } catch {
      // Another request confirmed or disputed it first; nothing to do.
    }
  }
  return confirmed;
}

// ───────────────────────── Cleaner ─────────────────────────

/**
 * The jobs a controller has assigned to this cleaner (upcoming, plus the last
 * week's finished ones), with the homeowner's booking details and notes.
 */
export async function listCleanerJobs(user: CurrentUser) {
  assertRole(user, "CLEANER");
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return prisma.job.findMany({
    where: {
      cleanerId: user.id,
      OR: [
        { status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
        { status: { in: ["COMPLETED", "CONFIRMED", "DISPUTED"] }, completedAt: { gte: weekAgo } },
      ],
    },
    orderBy: [{ assignedWindow: { startsAt: "asc" } }, { routeOrder: "asc" }],
    select: {
      id: true,
      status: true,
      notes: true,
      includeSidewalk: true,
      includeSalt: true,
      estMinutes: true,
      requiresBlower: true,
      routeOrder: true,
      assignedWindow: { select: { startsAt: true, endsAt: true, label: true } },
      property: { select: { address: true, lotSize: true, notes: true } },
      homeowner: { select: { name: true } },
      photos: { select: { kind: true } },
    },
  });
}

/** One job for its assigned cleaner, with what the job page needs (photos are listed separately). */
export async function getCleanerJob(user: CurrentUser, jobId: string) {
  assertRole(user, "CLEANER");
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      property: true,
      assignedWindow: true,
      homeowner: { select: { id: true, name: true } },
      reviews: true,
      ledgerEntries: { where: { type: "EARNING" }, select: { amountCents: true } },
    },
  });
  if (!job || job.cleanerId !== user.id) throw notFound("We couldn't find that job.");
  const homeownerRating = (await ratingSummary([job.homeownerId])).get(job.homeownerId) ?? null;
  return {
    ...job,
    homeownerRating,
    // Paid amount once confirmed; until then, what confirmation will pay.
    earningsCents: job.ledgerEntries[0]?.amountCents ?? jobEarnings(job),
    myReview: job.reviews.find((r) => r.authorId === user.id) ?? null,
    reviewOfMe: job.reviews.find((r) => r.subjectId === user.id) ?? null,
  };
}

export async function startJob(user: CurrentUser, jobId: string) {
  assertRole(user, "CLEANER");
  return transitionJob(jobId, "IN_PROGRESS", actorOf(user));
}

export async function completeJob(user: CurrentUser, jobId: string) {
  assertRole(user, "CLEANER");
  return transitionJob(jobId, "COMPLETED", actorOf(user));
}

/** Guards used by pages that only need to know whether a job exists for this user. */
export function ensureCanView(user: CurrentUser, job: { homeownerId: string; cleanerId: string | null }) {
  if (user.role === "CONTROLLER") return;
  if (user.role === "HOMEOWNER" && job.homeownerId === user.id) return;
  if (user.role === "CLEANER" && job.cleanerId === user.id) return;
  throw forbidden();
}
