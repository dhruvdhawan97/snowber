import "server-only";
import { prisma } from "@/lib/prisma";
import { summarizeEarnings } from "@/lib/earnings";
import { assertRole, type CurrentUser } from "./session";

// Earnings display (Member 2). Read-only: ledger rows are written by the job state
// machine when a job is confirmed (src/lib/dal/jobs.ts) and by tool rentals.

const DAY = 24 * 60 * 60 * 1000;

export async function getEarnings(user: CurrentUser) {
  assertRole(user, "CLEANER");
  const now = new Date();
  const [balance, entries, unpaidJobs] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where: { cleanerId: user.id }, _sum: { amountCents: true } }),
    prisma.ledgerEntry.findMany({
      where: { cleanerId: user.id, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, amountCents: true, description: true, createdAt: true, jobId: true },
    }),
    prisma.job.findMany({
      where: { cleanerId: user.id, status: { in: ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] } },
      select: { status: true, priceCents: true, discountCents: true, tipCents: true },
    }),
  ]);
  return {
    summary: summarizeEarnings(balance._sum.amountCents ?? 0, entries, unpaidJobs, now),
    entries,
  };
}
