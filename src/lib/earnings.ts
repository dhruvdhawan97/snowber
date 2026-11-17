// Cleaner earnings summary as a pure function. The ledger is the source of truth
// for money already earned (balance = SUM(amountCents)); jobs not yet confirmed
// are shown as estimates using the same jobEarnings() rule the ledger uses.

import { jobEarnings } from "./pricing";

const DAY = 24 * 60 * 60 * 1000;

export type LedgerLine = { type: "EARNING" | "RENTAL_FEE" | "PAYOUT" | "ADJUSTMENT"; amountCents: number; createdAt: Date };
export type UnpaidJob = { status: string; priceCents: number; discountCents: number; tipCents: number };

export type EarningsSummary = {
  balanceCents: number;
  last7DaysCents: number;
  jobsLast7Days: number;
  awaitingCents: number;
  awaitingCount: number;
  upcomingCents: number;
  upcomingCount: number;
};

/**
 * @param balanceCents SUM of the cleaner's whole ledger
 * @param recentLedger ledger lines from at least the last 7 days
 * @param jobs the cleaner's jobs that are not confirmed yet
 */
export function summarizeEarnings(
  balanceCents: number,
  recentLedger: readonly LedgerLine[],
  jobs: readonly UnpaidJob[],
  now: Date,
): EarningsSummary {
  const weekAgo = now.getTime() - 7 * DAY;
  const recentEarnings = recentLedger.filter((l) => l.type === "EARNING" && l.createdAt.getTime() >= weekAgo);
  const awaiting = jobs.filter((j) => j.status === "COMPLETED" || j.status === "DISPUTED");
  const upcoming = jobs.filter((j) => j.status === "ASSIGNED" || j.status === "IN_PROGRESS");
  const sum = (list: readonly UnpaidJob[]) => list.reduce((total, j) => total + jobEarnings(j), 0);
  return {
    balanceCents,
    last7DaysCents: recentEarnings.reduce((total, l) => total + l.amountCents, 0),
    jobsLast7Days: recentEarnings.length,
    awaitingCents: sum(awaiting),
    awaitingCount: awaiting.length,
    upcomingCents: sum(upcoming),
    upcomingCount: upcoming.length,
  };
}
