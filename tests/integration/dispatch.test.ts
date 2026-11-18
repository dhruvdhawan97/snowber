import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assignJobs, getDispatchBoard, moveStop, unassignJob } from "@/lib/dal/dispatch";
import { createBooking } from "@/lib/dal/jobs";
import { createShift } from "@/lib/dal/shifts";
import { prisma } from "@/lib/prisma";
import { hoursFromNow, makeProperty, makeUser, makeWindow, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function scenario() {
  const controller = await makeUser("CONTROLLER");
  const homeowner = await makeUser("HOMEOWNER");
  const cleaner = await makeUser("CLEANER");
  const window = await makeWindow(hoursFromNow(48), hoursFromNow(51));
  await createShift(cleaner, { startsAt: hoursFromNow(47), endsAt: hoursFromNow(52) });
  const jobIds: string[] = [];
  for (const lot of ["SMALL", "MEDIUM"] as const) {
    const property = await makeProperty(homeowner.id, lot);
    const booking = await createBooking(homeowner, {
      propertyId: property.id, windowIds: [window.id], includeSidewalk: false,
      includeSalt: false, tipCents: 0, notes: undefined,
    }, "http://localhost:3000");
    if (booking.kind !== "booked") throw new Error("Expected simulated payment booking");
    jobIds.push(booking.jobId);
  }
  return { controller, homeowner, cleaner, window, jobIds };
}

describe("controller dispatch against PostgreSQL", () => {
  it("batch assigns, persists order, allows reordering and unassignment", async () => {
    const { controller, cleaner, window, jobIds } = await scenario();
    expect(await assignJobs(controller, window.id, jobIds.map((jobId) => ({ jobId, cleanerId: cleaner.id })))).toBe(2);
    let board = await getDispatchBoard(controller, window.id);
    let jobs = board.cleaners.find((c) => c.id === cleaner.id)?.jobs ?? [];
    expect(jobs.map((job) => job.id).sort()).toEqual([...jobIds].sort());
    expect(jobs.map((job) => job.routeOrder)).toEqual([1, 2]);
    const last = jobs[1].id;
    await moveStop(controller, last, "up");
    board = await getDispatchBoard(controller, window.id);
    jobs = board.cleaners.find((c) => c.id === cleaner.id)?.jobs ?? [];
    expect(jobs[0].id).toBe(last);
    await unassignJob(controller, last);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: last } })).status).toBe("REQUESTED");
  });

  it("rejects duplicate batches and stale attempts to reassign the same job", async () => {
    const { controller, cleaner, window, jobIds } = await scenario();
    const assignment = { jobId: jobIds[0], cleanerId: cleaner.id };
    await expect(assignJobs(controller, window.id, [assignment, assignment])).rejects.toThrow(/once/);
    expect(await assignJobs(controller, window.id, [assignment])).toBe(1);
    await expect(assignJobs(controller, window.id, [assignment])).rejects.toThrow(/no longer waiting/);
    expect(await prisma.job.count({ where: { id: jobIds[0], status: "ASSIGNED" } })).toBe(1);
  });

  it("refuses a cleaner without a covering shift and protects the booking", async () => {
    const { controller, window, jobIds } = await scenario();
    const offShift = await makeUser("CLEANER");
    await expect(assignJobs(controller, window.id, [{ jobId: jobIds[0], cleanerId: offShift.id }])).rejects.toThrow(/no shift/);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobIds[0] } })).status).toBe("REQUESTED");
  });
});
