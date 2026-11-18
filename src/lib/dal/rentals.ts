import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { RentalStatus } from "@/lib/contracts/domain";
import {
  checkRentalTransition,
  hasBlowerCoverage,
  rangesOverlap,
  rentalFeeDescription,
  rentalPhase,
  rentalRequestError,
  type TimeRange,
} from "@/lib/contracts/rental-states";
import { conflict, invalid, isExclusionViolation, notFound } from "@/lib/errors";
import { publish, type PendingEvent } from "@/lib/events";
import { firstName, formatRange } from "@/lib/format";
import { assertRole, type CurrentUser } from "./session";

// Tool rentals (Member 4). Cleaners ask for a tool for a time range; the controller
// approves (reserving the tool and charging the fee to the cleaner's ledger), rejects,
// or later checks it back in. `transitionRental` is the only code that changes a
// rental's status. Two approved rentals of one tool can never overlap: the
// "ToolRental_no_overlap" exclusion constraint guarantees it even when approvals race.

type Tx = Prisma.TransactionClient;

const DAY = 24 * 60 * 60 * 1000;
const BUSY_JOB_STATUSES = ["ASSIGNED", "IN_PROGRESS"] as const;

// ───────────────────────── Cleaner ─────────────────────────

export async function requestRental(user: CurrentUser, input: { toolId: string; startsAt: Date; endsAt: Date }) {
  assertRole(user, "CLEANER");
  const error = rentalRequestError(input, new Date());
  if (error) throw invalid(error);

  const tool = await prisma.tool.findUnique({ where: { id: input.toolId } });
  if (!tool || tool.status === "RETIRED") throw notFound("We couldn't find that tool.");
  if (tool.status !== "AVAILABLE") throw invalid(`${tool.name} is out for repair. Pick another tool.`);

  const overlapping = { startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } };
  // Early, friendly checks. The exclusion constraint is the real guarantee, at approval time.
  const taken = await prisma.toolRental.findFirst({ where: { toolId: tool.id, status: "APPROVED", ...overlapping } });
  if (taken) throw conflict(`${tool.name} is already reserved ${formatRange(taken.startsAt, taken.endsAt)}. Pick another time or tool.`);
  const duplicate = await prisma.toolRental.findFirst({
    where: { toolId: tool.id, cleanerId: user.id, status: { in: ["REQUESTED", "APPROVED"] }, ...overlapping },
  });
  if (duplicate) throw conflict(`You already asked for ${tool.name} at that time.`);

  const rental = await prisma.toolRental.create({
    data: { toolId: tool.id, cleanerId: user.id, startsAt: input.startsAt, endsAt: input.endsAt, feeCents: tool.feeCents },
  });
  publish({
    type: "rental.updated",
    message: `${firstName(user.name)} asked for ${tool.name}`,
    // The cleaner already sees the form's confirmation; this tells the controller.
    audience: { userIds: [], controllers: true },
  });
  return rental;
}

/** The cleaner's open rentals plus the last two weeks of closed ones. */
export async function listMyRentals(user: CurrentUser) {
  assertRole(user, "CLEANER");
  const now = new Date();
  const rentals = await prisma.toolRental.findMany({
    where: {
      cleanerId: user.id,
      OR: [{ status: { in: ["REQUESTED", "APPROVED"] } }, { endsAt: { gte: new Date(now.getTime() - 14 * DAY) } }],
    },
    orderBy: { startsAt: "asc" },
    include: { tool: { select: { name: true, type: true, status: true } } },
  });
  const actor = { id: user.id, role: user.role };
  return rentals.map((r) => ({
    ...r,
    phase: rentalPhase(r, now),
    canCancel: checkRentalTransition({ ...r, toolStatus: r.tool.status }, "CANCELLED", actor, now).ok,
  }));
}

// ───────────────────────── Controller ─────────────────────────

/** Requests to decide, approved rentals (reserved, out or overdue), and the last week's history. */
export async function listRentalsForController(user: CurrentUser) {
  assertRole(user, "CONTROLLER");
  const now = new Date();
  const include = {
    tool: { select: { id: true, name: true, type: true, status: true } },
    cleaner: { select: { id: true, name: true, phone: true, ownsBlower: true } },
  } as const;
  const [open, closed] = await Promise.all([
    prisma.toolRental.findMany({ where: { status: { in: ["REQUESTED", "APPROVED"] } }, orderBy: { startsAt: "asc" }, include }),
    prisma.toolRental.findMany({
      where: { status: { in: ["RETURNED", "REJECTED", "CANCELLED"] }, endsAt: { gte: new Date(now.getTime() - 7 * DAY) } },
      orderBy: { endsAt: "desc" },
      take: 30,
      include,
    }),
  ]);
  const actor = { id: user.id, role: user.role };
  const approved = open.filter((r) => r.status === "APPROVED");
  const can = (r: (typeof open)[number], to: RentalStatus) =>
    checkRentalTransition({ ...r, toolStatus: r.tool.status }, to, actor, now).ok;

  const requests = open
    .filter((r) => r.status === "REQUESTED")
    .map((r) => ({
      ...r,
      phase: rentalPhase(r, now),
      // Approving would collide with an existing reservation of the same tool.
      clash: approved.find((a) => a.toolId === r.toolId && rangesOverlap(a, r)) ?? null,
      canApprove: can(r, "APPROVED"),
    }));
  const phaseOrder = { OVERDUE: 0, OUT: 1, UPCOMING: 2 } as Record<string, number>;
  const active = approved
    .map((r) => ({ ...r, phase: rentalPhase(r, now), canReturn: can(r, "RETURNED"), canCancel: can(r, "CANCELLED") }))
    .sort((a, b) => (phaseOrder[a.phase] ?? 3) - (phaseOrder[b.phase] ?? 3) || a.startsAt.getTime() - b.startsAt.getTime());

  return { requests, active, closed };
}

// ───────────────────────── State changes ─────────────────────────

export const approveRental = (user: CurrentUser, rentalId: string) => transitionRental(user, rentalId, "APPROVED");
export const rejectRental = (user: CurrentUser, rentalId: string) => transitionRental(user, rentalId, "REJECTED");
export const cancelRental = (user: CurrentUser, rentalId: string) => transitionRental(user, rentalId, "CANCELLED");
/** Checks a tool back in at the library. */
export const returnRental = (user: CurrentUser, rentalId: string) => transitionRental(user, rentalId, "RETURNED");

/**
 * The only code that changes a rental's status. In one transaction it locks the
 * rows involved, validates the change, writes the status and any ledger rows, then
 * publishes the event after commit.
 *
 * Lock order is always tool → rental (setToolStatus locks the tool first too), so
 * an approval and a tool status change can't deadlock.
 */
export async function transitionRental(user: CurrentUser, rentalId: string, to: RentalStatus) {
  assertRole(user, "CLEANER", "CONTROLLER");
  const now = new Date();
  let event: PendingEvent;
  try {
    event = await prisma.$transaction(async (tx) => {
      const ref = await tx.toolRental.findUnique({ where: { id: rentalId }, select: { toolId: true, cleanerId: true } });
      // Cleaners only ever see their own rentals.
      if (!ref || (user.role === "CLEANER" && ref.cleanerId !== user.id)) throw notFound("We couldn't find that rental.");
      // Approving reserves stock: hold the tool so it can't be taken out of service meanwhile.
      if (to === "APPROVED") await tx.$queryRaw`SELECT id FROM "Tool" WHERE id = ${ref.toolId} FOR UPDATE`;
      // Holds off assignments that rely on this rental (lockBlowerFor takes FOR SHARE).
      await tx.$queryRaw`SELECT id FROM "ToolRental" WHERE id = ${rentalId} FOR UPDATE`;

      const rental = await tx.toolRental.findUniqueOrThrow({
        where: { id: rentalId },
        include: { tool: true, cleaner: { select: { name: true, ownsBlower: true } } },
      });
      const check = checkRentalTransition({ ...rental, toolStatus: rental.tool.status }, to, { id: user.id, role: user.role }, now);
      if (!check.ok) throw invalid(check.reason);

      const description = rentalFeeDescription(rental.tool.name, rental);
      const data: Prisma.ToolRentalUncheckedUpdateManyInput = { status: to };
      let message: string;

      switch (to) {
        case "APPROVED":
          data.decidedAt = now;
          if (rental.feeCents > 0) {
            await tx.ledgerEntry.create({
              data: { cleanerId: rental.cleanerId, type: "RENTAL_FEE", amountCents: -rental.feeCents, rentalId: rental.id, description },
            });
          }
          message = `${rental.tool.name} reserved for ${firstName(rental.cleaner.name)}, ${formatRange(rental.startsAt, rental.endsAt)}`;
          break;
        case "REJECTED":
          data.decidedAt = now;
          message = `${rental.tool.name} request from ${firstName(rental.cleaner.name)} declined`;
          break;
        case "CANCELLED":
          if (rental.status === "APPROVED") {
            await assertNoJobsRelyOn(tx, rental);
            // Refund the fee once (the ledger's unique (rentalId, type) backs this up).
            const fee = await tx.ledgerEntry.findFirst({ where: { rentalId: rental.id, type: "RENTAL_FEE" } });
            if (fee) {
              await tx.ledgerEntry.create({
                data: { cleanerId: rental.cleanerId, type: "ADJUSTMENT", amountCents: -fee.amountCents, rentalId: rental.id, description: `Refund: ${description}` },
              });
            }
          }
          message = `${rental.tool.name} ${rental.status === "APPROVED" ? "reservation" : "request"} cancelled`;
          break;
        case "RETURNED":
          message = `${rental.tool.name} checked back in${rental.endsAt < now ? " (returned late)" : ""}`;
          break;
        default:
          throw invalid("This change is not allowed.");
      }

      // Compare-and-set, like jobs: a concurrent change to the same rental can't both win.
      const result = await tx.toolRental.updateMany({ where: { id: rental.id, status: rental.status }, data });
      if (result.count !== 1) throw conflict("Someone else just updated this rental. Refresh and try again.");

      return { type: "rental.updated", message, audience: { userIds: [rental.cleanerId], controllers: true } } satisfies PendingEvent;
    });
  } catch (error) {
    if (isExclusionViolation(error, "ToolRental_no_overlap")) {
      throw conflict("That tool is already reserved for part of this time. Decline this request or ask for another time.");
    }
    throw error;
  }
  publish(event);
}

/**
 * A cleaner without their own snow blower can't give up a blower rental while a
 * large-lot job assigned to them depends on it (and no other blower rental covers it).
 */
async function assertNoJobsRelyOn(
  tx: Tx,
  rental: { id: string; cleanerId: string; startsAt: Date; endsAt: Date; tool: { type: string }; cleaner: { ownsBlower: boolean } },
) {
  if (rental.tool.type !== "SNOW_BLOWER" || rental.cleaner.ownsBlower) return;
  const jobs = await tx.job.findMany({
    where: {
      cleanerId: rental.cleanerId,
      requiresBlower: true,
      status: { in: [...BUSY_JOB_STATUSES] },
      assignedWindow: { startsAt: { gte: rental.startsAt }, endsAt: { lte: rental.endsAt } },
    },
    select: { assignedWindow: { select: { startsAt: true, endsAt: true } } },
  });
  if (jobs.length === 0) return;
  const others = await tx.toolRental.findMany({
    where: { cleanerId: rental.cleanerId, status: "APPROVED", id: { not: rental.id }, tool: { type: "SNOW_BLOWER" } },
    select: { startsAt: true, endsAt: true },
  });
  const relying = jobs.filter((j) => j.assignedWindow && !hasBlowerCoverage({ ownsBlower: false }, others, j.assignedWindow));
  if (relying.length > 0) {
    throw invalid(
      `${relying.length} large driveway${relying.length === 1 ? "" : "s"} assigned in this time need${relying.length === 1 ? "s" : ""} this snow blower. Ask the controller to reassign ${relying.length === 1 ? "it" : "them"} first.`,
    );
  }
}

// ───────────────────────── Dispatch integration ─────────────────────────

/**
 * Inside an assignment transaction (applyTransition → ASSIGNED): a job that needs a
 * snow blower can only go to a cleaner who owns one or holds an approved blower
 * rental covering the whole time slot. The rental row is share-locked until commit,
 * so the cleaner can't cancel it while the job is being assigned.
 * Returns the locked rental's id, or null when the cleaner owns a blower.
 */
export async function lockBlowerFor(
  tx: Tx,
  cleaner: { id: string; name: string; ownsBlower: boolean },
  slot: TimeRange,
): Promise<string | null> {
  if (cleaner.ownsBlower) return null;
  const candidates = await tx.toolRental.findMany({
    where: { cleanerId: cleaner.id, status: "APPROVED", tool: { type: "SNOW_BLOWER" }, startsAt: { lte: slot.startsAt }, endsAt: { gte: slot.endsAt } },
    select: { id: true },
  });
  for (const candidate of candidates) {
    // Re-checks the status after waiting for the lock, so a just-cancelled rental doesn't count.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "ToolRental" WHERE id = ${candidate.id} AND status = 'APPROVED' FOR SHARE`;
    if (locked.length > 0) return locked[0].id;
  }
  throw conflict(
    `This driveway needs a snow blower. ${firstName(cleaner.name)} doesn't own one and has no approved blower rental covering this time slot.`,
  );
}

/**
 * For dispatch (Member 3): ids of cleaners holding an approved snow-blower rental that
 * covers the whole range. Together with `ownsBlower` from listCleanersAvailable this
 * tells the dispatch board who can take large driveways.
 */
export async function listCleanersWithRentedBlower(user: CurrentUser, range: TimeRange): Promise<Set<string>> {
  assertRole(user, "CONTROLLER");
  const rentals = await prisma.toolRental.findMany({
    where: { status: "APPROVED", tool: { type: "SNOW_BLOWER" }, startsAt: { lte: range.startsAt }, endsAt: { gte: range.endsAt } },
    select: { cleanerId: true },
  });
  return new Set(rentals.map((r) => r.cleanerId));
}
