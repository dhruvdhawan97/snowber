import "server-only";
import { prisma } from "@/lib/prisma";
import { jobEarnings } from "@/lib/pricing";
import { transitionJob } from "./jobs";
import { actorOf, assertRole, type CurrentUser } from "./session";

// Dispute handling (Member 4). A homeowner can dispute a finished job instead of
// confirming it (COMPLETED → DISPUTED). The controller reviews the before/after
// photos and closes it one of two ways, both through the job state machine:
//   • pay the cleaner     DISPUTED → CONFIRMED  (ledger credit, same as a normal confirmation)
//   • refund the homeowner DISPUTED → CANCELLED (full refund of what is left on the payment)

const DAY = 24 * 60 * 60 * 1000;

export type DisputeOutcome = "PAY_CLEANER" | "REFUND";

const contact = { select: { id: true, name: true, email: true, phone: true } } as const;

/** Open disputes (oldest first) and the ones resolved in the last two weeks. */
export async function listDisputes(user: CurrentUser) {
  assertRole(user, "CONTROLLER");
  const include = {
    property: { select: { address: true, lotSize: true } },
    homeowner: contact,
    cleaner: contact,
    assignedWindow: { select: { startsAt: true, endsAt: true } },
    payment: { select: { amountCents: true, refundedCents: true, status: true } },
    photos: { select: { flagged: true } },
  } as const;
  const [open, resolved] = await Promise.all([
    prisma.job.findMany({ where: { status: "DISPUTED" }, orderBy: { updatedAt: "asc" }, include }),
    prisma.job.findMany({
      // disputeReason stays on the job after it is resolved, which is how resolved disputes are found.
      where: { disputeReason: { not: null }, status: { in: ["CONFIRMED", "CANCELLED"] }, updatedAt: { gte: new Date(Date.now() - 14 * DAY) } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include,
    }),
  ]);
  const withMoney = <T extends (typeof open)[number]>(job: T) => ({
    ...job,
    cleanerPayCents: jobEarnings(job),
    refundableCents: job.payment ? job.payment.amountCents - job.payment.refundedCents : 0,
    flaggedPhotos: job.photos.filter((p) => p.flagged).length,
  });
  return { open: open.map(withMoney), resolved: resolved.map(withMoney) };
}

export async function countOpenDisputes(user: CurrentUser): Promise<number> {
  assertRole(user, "CONTROLLER");
  return prisma.job.count({ where: { status: "DISPUTED" } });
}

export async function resolveDispute(user: CurrentUser, jobId: string, outcome: DisputeOutcome) {
  assertRole(user, "CONTROLLER");
  return transitionJob(jobId, outcome === "PAY_CLEANER" ? "CONFIRMED" : "CANCELLED", actorOf(user));
}
