import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { NEIGHBORHOOD_CENTER } from "@/lib/config";
import type { JobStatus, LotSize } from "@/lib/contracts/domain";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/contracts/job-states";
import { invalid, notFound } from "@/lib/errors";
import { publish } from "@/lib/events";
import { nearestNeighborOrder, type LatLng } from "@/lib/geo";
import { overlapMinutes, routeMinutes, suggestAssignments } from "@/lib/matching";
import { roadOrder } from "@/lib/osrm";
import { applyTransition, settleOutcomes, type TransitionOutcome } from "./jobs";
import { ratingSummary } from "./reviews";
import { actorOf, assertRole, type CurrentUser } from "./session";
import { listCleanersAvailable } from "./shifts";

type Tx = Prisma.TransactionClient;

export type BoardJob = {
  id: string;
  address: string;
  lat: number;
  lng: number;
  lotSize: LotSize;
  estMinutes: number;
  requiresBlower: boolean;
  status: JobStatus;
  priceCents: number;
  homeownerName: string;
  createdAt: Date;
  routeOrder: number | null;
  cleanerId: string | null;
};

export type BoardCleaner = {
  id: string;
  name: string;
  start: LatLng;
  startIsHome: boolean;
  capacityMinutes: number;
  usedMinutes: number;
  ownsBlower: boolean;
  rentedBlower: boolean;
  hasBlower: boolean;
  rating: number | null;
  jobs: BoardJob[];
};

const ACTIVE = [...ACTIVE_ASSIGNMENT_STATUSES];

const jobInclude = {
  property: { select: { address: true, lat: true, lng: true, lotSize: true } },
  homeowner: { select: { name: true } },
} satisfies Prisma.JobInclude;

type JobWithProperty = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

function toBoardJob(job: JobWithProperty): BoardJob {
  return {
    id: job.id,
    address: job.property.address,
    lat: job.property.lat,
    lng: job.property.lng,
    lotSize: job.property.lotSize,
    estMinutes: job.estMinutes,
    requiresBlower: job.requiresBlower,
    status: job.status,
    priceCents: job.priceCents,
    homeownerName: job.homeowner.name,
    createdAt: job.createdAt,
    routeOrder: job.routeOrder,
    cleanerId: job.cleanerId,
  };
}

export async function listDispatchWindows(user: CurrentUser) {
  assertRole(user, "CONTROLLER");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const windows = await prisma.serviceWindow.findMany({
    where: { endsAt: { gte: since } },
    orderBy: { startsAt: "asc" },
    take: 40,
  });
  const ids = windows.map((w) => w.id);
  const [requested, assigned] = await Promise.all([
    prisma.job.findMany({
      where: { status: "REQUESTED", windowOptions: { some: { id: { in: ids } } } },
      select: { windowOptions: { where: { id: { in: ids } }, select: { id: true } } },
    }),
    prisma.job.groupBy({
      by: ["assignedWindowId"],
      where: { assignedWindowId: { in: ids }, status: { in: ACTIVE } },
      _count: { _all: true },
    }),
  ]);
  const requestedCount = new Map<string, number>();
  for (const job of requested) for (const w of job.windowOptions) requestedCount.set(w.id, (requestedCount.get(w.id) ?? 0) + 1);
  const assignedCount = new Map(assigned.map((a) => [a.assignedWindowId!, a._count._all]));
  return windows.map((w) => ({ ...w, requestedCount: requestedCount.get(w.id) ?? 0, assignedCount: assignedCount.get(w.id) ?? 0 }));
}

/** Everything the dispatch board shows for one window. */
export async function getDispatchBoard(user: CurrentUser, windowId: string) {
  assertRole(user, "CONTROLLER");
  const window = await prisma.serviceWindow.findUnique({ where: { id: windowId } });
  if (!window) throw notFound("That window no longer exists.");

  const [requested, assigned, shifts, blowerRentals] = await Promise.all([
    prisma.job.findMany({
      where: { status: "REQUESTED", windowOptions: { some: { id: windowId } } },
      include: jobInclude,
      orderBy: { createdAt: "asc" },
    }),
    prisma.job.findMany({
      where: { assignedWindowId: windowId, status: { in: ACTIVE } },
      include: jobInclude,
      orderBy: [{ routeOrder: "asc" }, { assignedAt: "asc" }],
    }),
    listCleanersAvailable(user, window),
    prisma.toolRental.findMany({
      where: {
        status: "APPROVED",
        tool: { type: "SNOW_BLOWER" },
        startsAt: { lte: window.startsAt },
        endsAt: { gte: window.endsAt },
      },
      select: { cleanerId: true },
    }),
  ]);

  const capacity = new Map<string, number>();
  for (const s of shifts) {
    capacity.set(s.cleaner.id, overlapMinutes(s.startsAt, s.endsAt, window.startsAt, window.endsAt));
  }
  const cleanerIds = [...new Set([...capacity.keys(), ...assigned.map((j) => j.cleanerId!).filter(Boolean)])];
  const [cleaners, ratings] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: cleanerIds }, deactivatedAt: null, role: "CLEANER" },
      select: { id: true, name: true, homeLat: true, homeLng: true, ownsBlower: true },
      orderBy: { name: "asc" },
    }),
    ratingSummary(cleanerIds),
  ]);
  const renting = new Set(blowerRentals.map((r) => r.cleanerId));

  const boardCleaners: BoardCleaner[] = cleaners.map((c) => {
    const startIsHome = c.homeLat != null && c.homeLng != null;
    const start = startIsHome ? { lat: c.homeLat!, lng: c.homeLng! } : NEIGHBORHOOD_CENTER;
    const jobs = assigned.filter((j) => j.cleanerId === c.id).map(toBoardJob);
    return {
      id: c.id,
      name: c.name,
      start,
      startIsHome,
      capacityMinutes: capacity.get(c.id) ?? 0,
      usedMinutes: routeMinutes(start, jobs.map((j) => ({ jobId: j.id, lat: j.lat, lng: j.lng, estMinutes: j.estMinutes }))),
      ownsBlower: c.ownsBlower,
      rentedBlower: renting.has(c.id),
      hasBlower: c.ownsBlower || renting.has(c.id),
      rating: ratings.get(c.id)?.average ?? null,
      jobs,
    };
  });

  return { window, requested: requested.map(toBoardJob), cleaners: boardCleaners };
}

export type SuggestionView = {
  jobId: string;
  cleanerId: string;
  cleanerName: string;
  address: string;
  distanceKm: number;
  travelMinutes: number;
};

/** Runs the matching heuristic for a window. Nothing is saved until the controller applies it. */
export async function suggestForWindow(user: CurrentUser, windowId: string) {
  const board = await getDispatchBoard(user, windowId);
  const result = suggestAssignments(
    board.requested.map((j) => ({
      id: j.id,
      lat: j.lat,
      lng: j.lng,
      estMinutes: j.estMinutes,
      requiresBlower: j.requiresBlower,
      createdAt: j.createdAt,
    })),
    board.cleaners
      .filter((c) => c.capacityMinutes > 0)
      .map((c) => ({
        id: c.id,
        start: c.start,
        capacityMinutes: c.capacityMinutes,
        hasBlower: c.hasBlower,
        rating: c.rating,
        existing: c.jobs.map((j) => ({ jobId: j.id, lat: j.lat, lng: j.lng, estMinutes: j.estMinutes })),
      })),
  );
  const cleanerName = new Map(board.cleaners.map((c) => [c.id, c.name]));
  const address = new Map(board.requested.map((j) => [j.id, j.address]));
  return {
    suggestions: result.suggestions.map<SuggestionView>((s) => ({
      ...s,
      cleanerName: cleanerName.get(s.cleanerId) ?? "Cleaner",
      address: address.get(s.jobId) ?? "",
    })),
    unassigned: result.unassigned.map((u) => ({ ...u, address: address.get(u.jobId) ?? "" })),
  };
}

/** Assigns one or more jobs in a single transaction and re-orders the affected routes. */
export async function assignJobs(user: CurrentUser, windowId: string, assignments: { jobId: string; cleanerId: string }[]) {
  assertRole(user, "CONTROLLER");
  if (assignments.length === 0) throw invalid("Choose at least one job to assign.");
  if (new Set(assignments.map((a) => a.jobId)).size !== assignments.length) {
    throw invalid("Each job can appear only once in an assignment batch.");
  }

  // Serialize controller assignments for a service window, then re-check capacity
  // using current database state. A stale browser board must not overbook a cleaner.
  const actor = actorOf(user);
  const outcomes = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`snowber-dispatch:${windowId}`}))`;
    const window = await tx.serviceWindow.findUnique({ where: { id: windowId } });
    if (!window) throw notFound("That time slot no longer exists.");
    if (window.endsAt <= new Date()) throw invalid("This time slot has ended.");

    const requested = await tx.job.findMany({
      where: { id: { in: assignments.map((a) => a.jobId) }, status: "REQUESTED", windowOptions: { some: { id: windowId } } },
      include: { property: { select: { lat: true, lng: true, address: true } } },
    });
    const jobById = new Map(requested.map((j) => [j.id, j]));
    if (requested.length !== assignments.length) throw invalid("Some jobs are no longer waiting for this time slot. Refresh the board.");

    const cleanerIds = [...new Set(assignments.map((a) => a.cleanerId))].sort();
    const cleaners = await tx.user.findMany({
      where: { id: { in: cleanerIds }, role: "CLEANER", deactivatedAt: null },
      select: { id: true, name: true, homeLat: true, homeLng: true, ownsBlower: true },
    });
    if (cleaners.length !== cleanerIds.length) throw invalid("One of the selected cleaners is unavailable.");
    const cleanerById = new Map(cleaners.map((c) => [c.id, c]));
    const shifts = await tx.shift.findMany({
      where: { cleanerId: { in: cleanerIds }, startsAt: { lte: window.startsAt }, endsAt: { gte: window.endsAt } },
      select: { cleanerId: true },
    });
    const onShift = new Set(shifts.map((s) => s.cleanerId));
    const rentals = await tx.toolRental.findMany({
      where: { cleanerId: { in: cleanerIds }, status: "APPROVED", tool: { type: "SNOW_BLOWER" }, startsAt: { lte: window.startsAt }, endsAt: { gte: window.endsAt } },
      select: { cleanerId: true },
    });
    const withRental = new Set(rentals.map((r) => r.cleanerId));
    const groups = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const cleaner = cleanerById.get(assignment.cleanerId)!;
      const job = jobById.get(assignment.jobId)!;
      if (!onShift.has(cleaner.id)) throw invalid(`${cleaner.name} has no shift covering this time slot.`);
      if (job.requiresBlower && !cleaner.ownsBlower && !withRental.has(cleaner.id)) {
        throw invalid(`${job.property.address} requires a snow blower; ${cleaner.name} needs an approved rental.`);
      }
      const group = groups.get(cleaner.id) ?? [];
      group.push(assignment);
      groups.set(cleaner.id, group);
    }

    for (const cleanerId of cleanerIds) {
      const cleaner = cleanerById.get(cleanerId)!;
      const existing = await tx.job.findMany({
        where: { cleanerId, assignedWindowId: windowId, status: { in: ACTIVE } },
        include: { property: { select: { lat: true, lng: true } } },
      });
      const stops = [
        ...existing.map((j) => ({ jobId: j.id, lat: j.property.lat, lng: j.property.lng, estMinutes: j.estMinutes })),
        ...(groups.get(cleanerId) ?? []).map((a) => {
          const j = jobById.get(a.jobId)!;
          return { jobId: j.id, lat: j.property.lat, lng: j.property.lng, estMinutes: j.estMinutes };
        }),
      ];
      const start = cleaner.homeLat != null && cleaner.homeLng != null
        ? { lat: cleaner.homeLat, lng: cleaner.homeLng }
        : NEIGHBORHOOD_CENTER;
      const capacityMinutes = overlapMinutes(window.startsAt, window.endsAt, window.startsAt, window.endsAt);
      if (routeMinutes(start, nearestNeighborOrder(start, stops)) > capacityMinutes) {
        throw invalid(`${cleaner.name} does not have enough shift time for these jobs.`);
      }
    }

    const results: TransitionOutcome[] = [];
    for (const assignment of assignments) {
      results.push(await applyTransition(tx, assignment.jobId, "ASSIGNED", actor, {
        assignment: { cleanerId: assignment.cleanerId, windowId },
      }));
    }
    for (const cleanerId of cleanerIds) await reorderRoute(tx, cleanerId, windowId);
    return results;
  });
  await settleOutcomes(outcomes);
  return outcomes.length;
}

export async function unassignJob(user: CurrentUser, jobId: string) {
  assertRole(user, "CONTROLLER");
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { cleanerId: true, assignedWindowId: true } });
  if (!job) throw notFound("That job no longer exists.");
  const outcome = await prisma.$transaction(async (tx) => {
    const result = await applyTransition(tx, jobId, "REQUESTED", actorOf(user));
    if (job.cleanerId && job.assignedWindowId) await reorderRoute(tx, job.cleanerId, job.assignedWindowId);
    return result;
  });
  await settleOutcomes([outcome]);
}

/** Lets the controller move a stop earlier or later in a cleaner's route. */
export async function moveStop(user: CurrentUser, jobId: string, direction: "up" | "down") {
  assertRole(user, "CONTROLLER");
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || !job.cleanerId || !job.assignedWindowId || job.status !== "ASSIGNED") {
    throw invalid("Only assigned stops that haven't started can be moved.");
  }
  await prisma.$transaction(async (tx) => {
    const route = await tx.job.findMany({
      where: { cleanerId: job.cleanerId, assignedWindowId: job.assignedWindowId, status: { in: ACTIVE } },
      orderBy: [{ routeOrder: "asc" }, { assignedAt: "asc" }],
      select: { id: true, status: true },
    });
    const index = route.findIndex((r) => r.id === jobId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= route.length || route[swapWith].status !== "ASSIGNED") return;
    [route[index], route[swapWith]] = [route[swapWith], route[index]];
    for (let i = 0; i < route.length; i++) await tx.job.update({ where: { id: route[i].id }, data: { routeOrder: i + 1 } });
  });
  publish({
    type: "dispatch.updated",
    message: "Route order changed",
    audience: { userIds: [job.cleanerId], controllers: true },
  });
}

/**
 * Stops already started or finished keep their place; the remaining assigned stops
 * are ordered by nearest neighbor from where the route currently ends.
 */
export async function reorderRoute(tx: Tx, cleanerId: string, windowId: string) {
  // Sequential on purpose: a transaction uses one connection, which runs one query at a time.
  const cleaner = await tx.user.findUnique({ where: { id: cleanerId }, select: { homeLat: true, homeLng: true } });
  const jobs = await tx.job.findMany({
    where: { cleanerId, assignedWindowId: windowId, status: { in: ACTIVE } },
    include: { property: { select: { lat: true, lng: true } } },
    orderBy: [{ routeOrder: "asc" }, { assignedAt: "asc" }],
  });
  const home = cleaner?.homeLat != null && cleaner.homeLng != null ? { lat: cleaner.homeLat, lng: cleaner.homeLng } : NEIGHBORHOOD_CENTER;
  const fixed = jobs.filter((j) => j.status !== "ASSIGNED");
  const pending = jobs.filter((j) => j.status === "ASSIGNED");
  const start = fixed.length > 0 ? fixed[fixed.length - 1].property : home;
  const ordered = [
    ...fixed,
    ...await roadOrder(
      start,
      pending.map((j) => ({ ...j, lat: j.property.lat, lng: j.property.lng })),
    ),
  ];
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].routeOrder !== i + 1) await tx.job.update({ where: { id: ordered[i].id }, data: { routeOrder: i + 1 } });
  }
}
