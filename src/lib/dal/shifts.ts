import "server-only";
import { prisma } from "@/lib/prisma";
import { conflict, invalid, isExclusionViolation, notFound } from "@/lib/errors";
import { publish } from "@/lib/events";
import { assertRole, type CurrentUser } from "./session";

// Shift availability (Member 2): cleaners post when they can work; the controller
// assigns jobs in time slots that fall inside those shifts. Overlapping shifts are
// rejected by the "Shift_no_overlap" exclusion constraint in the database.

const DAY = 24 * 60 * 60 * 1000;
/** How far ahead a cleaner can post availability. */
export const SHIFT_HORIZON_DAYS = 30;

const BUSY_STATUSES = ["ASSIGNED", "IN_PROGRESS"] as const;

const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** Upcoming shifts and the last week's, each with the assigned jobs whose time slot falls in it. */
export async function listMyShifts(user: CurrentUser) {
  assertRole(user, "CLEANER");
  const now = new Date();
  const [shifts, jobs] = await Promise.all([
    prisma.shift.findMany({
      where: { cleanerId: user.id, endsAt: { gte: new Date(now.getTime() - 7 * DAY) } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.job.findMany({
      where: { cleanerId: user.id, status: { in: [...BUSY_STATUSES] }, assignedWindow: { isNot: null } },
      select: { id: true, assignedWindow: { select: { startsAt: true, endsAt: true } } },
    }),
  ]);
  return shifts.map((shift) => ({
    ...shift,
    jobCount: jobs.filter((j) => j.assignedWindow && overlaps(shift, j.assignedWindow)).length,
    isPast: shift.endsAt <= now,
    isActive: shift.startsAt <= now && now < shift.endsAt,
  }));
}

export async function createShift(user: CurrentUser, input: { startsAt: Date; endsAt: Date }) {
  assertRole(user, "CLEANER");
  const now = Date.now();
  if (input.endsAt.getTime() <= now) throw invalid("That shift has already ended.");
  if (input.startsAt.getTime() > now + SHIFT_HORIZON_DAYS * DAY) {
    throw invalid(`You can post shifts up to ${SHIFT_HORIZON_DAYS} days ahead.`);
  }
  try {
    const shift = await prisma.shift.create({ data: { cleanerId: user.id, ...input } });
    publish({ type: "dispatch.updated", message: `${user.name} posted a shift`, audience: { userIds: [], controllers: true } });
    return shift;
  } catch (error) {
    if (isExclusionViolation(error, "Shift_no_overlap")) throw conflict("This overlaps a shift you already posted.");
    throw error;
  }
}

/** Cleaners can remove future shifts that the controller hasn't put jobs in yet. */
export async function deleteShift(user: CurrentUser, shiftId: string) {
  assertRole(user, "CLEANER");
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift || shift.cleanerId !== user.id) throw notFound("We couldn't find that shift.");
  if (shift.startsAt <= new Date()) throw invalid("Shifts that have started can't be removed.");
  const busy = await prisma.job.count({
    where: {
      cleanerId: user.id,
      status: { in: [...BUSY_STATUSES] },
      assignedWindow: { startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } },
    },
  });
  if (busy > 0) throw invalid("You have jobs in this shift. Ask the controller to reassign them first.");
  await prisma.shift.delete({ where: { id: shift.id } });
  publish({ type: "dispatch.updated", audience: { userIds: [], controllers: true } });
}

/** Open time slots in the next week, so cleaners can post shifts that cover them. */
export async function listUpcomingWindowsForCleaner(user: CurrentUser) {
  assertRole(user, "CLEANER");
  const now = new Date();
  return prisma.serviceWindow.findMany({
    where: { status: "OPEN", endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + 7 * DAY) } },
    orderBy: { startsAt: "asc" },
    select: { id: true, label: true, startsAt: true, endsAt: true, _count: { select: { optionJobs: true } } },
  });
}

/**
 * For dispatch (Member 3): active cleaners whose shifts cover the whole time range,
 * with their route start and whether they own a snow blower.
 */
export async function listCleanersAvailable(user: CurrentUser, range: { startsAt: Date; endsAt: Date }) {
  assertRole(user, "CONTROLLER");
  return prisma.shift.findMany({
    where: { startsAt: { lte: range.startsAt }, endsAt: { gte: range.endsAt }, cleaner: { deactivatedAt: null } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      cleaner: { select: { id: true, name: true, homeLat: true, homeLng: true, ownsBlower: true } },
    },
  });
}
