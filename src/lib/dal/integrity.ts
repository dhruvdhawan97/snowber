import "server-only";
import { prisma } from "@/lib/prisma";
import { AUTO_CONFIRM_HOURS } from "@/lib/config";
import { hasBlowerCoverage } from "@/lib/contracts/rental-states";
import { assertRole, type CurrentUser } from "./session";

// Workflow integrity checks (Member 4). The state machines and database constraints
// should make these impossible, so each one finding something means data was changed
// outside transitionJob / transitionRental (a script, a manual SQL fix, an old bug)
// or a scheduled job isn't running. The controller overview lists whatever is found.

export type IntegrityIssue = {
  key: string;
  severity: "error" | "warning";
  count: number;
  title: string;
  detail: string;
  href?: string;
};

/** Statuses in which a job must have a cleaner and a time slot. */
const ASSIGNED_STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] as const;

export async function runIntegrityChecks(user: CurrentUser): Promise<IntegrityIssue[]> {
  assertRole(user, "CONTROLLER");
  const now = new Date();
  const autoConfirmCutoff = new Date(now.getTime() - AUTO_CONFIRM_HOURS * 60 * 60 * 1000);

  const [unpaid, unrefunded, staleCompleted, unassigned, noBefore, noAfter, overdue, inactiveTools, blowerJobs] = await Promise.all([
    prisma.job.count({ where: { status: "CONFIRMED", cleanerId: { not: null }, ledgerEntries: { none: { type: "EARNING" } } } }),
    prisma.job.count({ where: { status: "CANCELLED", payment: { is: { status: { not: "REFUNDED" } } } } }),
    prisma.job.count({ where: { status: "COMPLETED", completedAt: { lt: autoConfirmCutoff } } }),
    prisma.job.count({ where: { status: { in: [...ASSIGNED_STATUSES] }, OR: [{ cleanerId: null }, { assignedWindowId: null }] } }),
    prisma.job.count({ where: { status: { in: ["IN_PROGRESS", "COMPLETED", "DISPUTED"] }, photos: { none: { kind: "BEFORE" } } } }),
    prisma.job.count({ where: { status: { in: ["COMPLETED", "DISPUTED"] }, photos: { none: { kind: "AFTER" } } } }),
    prisma.toolRental.count({ where: { status: "APPROVED", endsAt: { lt: now } } }),
    prisma.toolRental.count({ where: { status: "APPROVED", tool: { status: { not: "AVAILABLE" } } } }),
    prisma.job.findMany({
      where: { status: { in: ["ASSIGNED", "IN_PROGRESS"] }, requiresBlower: true, cleaner: { ownsBlower: false } },
      select: {
        cleanerId: true,
        assignedWindow: { select: { startsAt: true, endsAt: true } },
      },
    }),
  ]);

  // Large driveways assigned to someone with no blower for that slot.
  const cleanerIds = [...new Set(blowerJobs.map((j) => j.cleanerId).filter((id): id is string => id !== null))];
  const blowerRentals = cleanerIds.length
    ? await prisma.toolRental.findMany({
        where: { cleanerId: { in: cleanerIds }, status: "APPROVED", tool: { type: "SNOW_BLOWER" } },
        select: { cleanerId: true, startsAt: true, endsAt: true },
      })
    : [];
  const noBlower = blowerJobs.filter(
    (j) =>
      j.cleanerId &&
      j.assignedWindow &&
      !hasBlowerCoverage({ ownsBlower: false }, blowerRentals.filter((r) => r.cleanerId === j.cleanerId), j.assignedWindow),
  ).length;

  const issues: IntegrityIssue[] = [
    {
      key: "unpaid-confirmed",
      severity: "error",
      count: unpaid,
      title: "Confirmed jobs with no cleaner payment",
      detail: "Confirmed, but the cleaner's ledger has no earning for them.",
    },
    {
      key: "unrefunded-cancelled",
      severity: "error",
      count: unrefunded,
      title: "Cancelled jobs not fully refunded",
      detail: "The payment still shows money kept for a cancelled job.",
    },
    {
      key: "broken-assignment",
      severity: "error",
      count: unassigned,
      title: "Assigned jobs missing a cleaner or time slot",
      detail: "Usually a cleaner account or time slot was deleted after assignment.",
    },
    {
      key: "missing-photos",
      severity: "error",
      count: noBefore + noAfter,
      title: "Jobs past a photo step without the photo",
      detail: "Started without a before photo, or finished without an after photo.",
    },
    {
      key: "no-blower",
      severity: "error",
      count: noBlower,
      title: "Large driveways assigned without a snow blower",
      detail: "The cleaner doesn't own one and no approved blower rental covers the slot.",
      href: "/controller/tools",
    },
    {
      key: "auto-confirm-late",
      severity: "warning",
      count: staleCompleted,
      title: `Finished jobs waiting more than ${AUTO_CONFIRM_HOURS} hours`,
      detail: "Auto-confirmation hasn't run. Check the scheduled call to /api/cron/auto-confirm.",
    },
    {
      key: "overdue-rentals",
      severity: "warning",
      count: overdue,
      title: "Tools not returned on time",
      detail: "Approved rentals that have ended but weren't checked back in.",
      href: "/controller/tools",
    },
    {
      key: "rentals-on-inactive-tools",
      severity: "warning",
      count: inactiveTools,
      title: "Reservations on tools out of service",
      detail: "A tool under repair or retired still has approved rentals that weren't checked in.",
      href: "/controller/tools",
    },
  ];
  return issues.filter((issue) => issue.count > 0);
}
