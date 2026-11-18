import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDispute } from "@/lib/dal/disputes";
import { runIntegrityChecks } from "@/lib/dal/integrity";
import { completeJob, createBooking, disputeJob, startJob, transitionJob } from "@/lib/dal/jobs";
import { approveRental, cancelRental, requestRental } from "@/lib/dal/rentals";
import { actorOf } from "@/lib/dal/session";
import { createShift } from "@/lib/dal/shifts";
import { prisma } from "@/lib/prisma";
import { jobEarnings } from "@/lib/pricing";
import { addPhoto, balance, hoursFromNow, makeProperty, makeTool, makeUser, makeWindow, resetDatabase } from "./helpers";

// One storm morning across all roles, through the same DAL functions the pages and
// server actions call: booking (Member 1) → shifts and photos (Member 2) →
// assignment (Member 3's entry point) → tool rental, dispute and payout (Member 4).

beforeAll(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("storm morning, end to end", () => {
  it("books a large driveway, rents a blower so it can be assigned, then settles a dispute", async () => {
    const controller = await makeUser("CONTROLLER");
    const homeowner = await makeUser("HOMEOWNER");
    const cleaner = await makeUser("CLEANER", { name: "Ava Chen", ownsBlower: false });
    const property = await makeProperty(homeowner.id, "LARGE");
    const window = await makeWindow(hoursFromNow(30), hoursFromNow(32));
    const blower = await makeTool("SNOW_BLOWER", 1500, "Snow blower A");

    // Homeowner books and pays (simulated payments).
    const booking = await createBooking(
      homeowner,
      { propertyId: property.id, windowIds: [window.id], includeSidewalk: true, includeSalt: false, tipCents: 500, notes: undefined },
      "http://localhost:3000",
    );
    expect(booking.kind).toBe("booked");
    const jobId = booking.kind === "booked" ? booking.jobId : "";
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).requiresBlower).toBe(true);

    // The cleaner covers the slot with a shift, but has no snow blower yet.
    await createShift(cleaner, { startsAt: hoursFromNow(29), endsAt: hoursFromNow(34) });
    const assign = () =>
      transitionJob(jobId, "ASSIGNED", actorOf(controller), { assignment: { cleanerId: cleaner.id, windowId: window.id } });
    await expect(assign()).rejects.toThrow(/needs a snow blower/);

    // They rent one; only the controller can approve, which charges the fee.
    const rental = await requestRental(cleaner, { toolId: blower.id, startsAt: hoursFromNow(29), endsAt: hoursFromNow(34) });
    await expect(approveRental(cleaner, rental.id)).rejects.toThrow();
    await approveRental(controller, rental.id);
    expect(await balance(cleaner.id)).toBe(-1500);

    // Now the assignment goes through, and the blower can't be cancelled out from under the job.
    await assign();
    await expect(cancelRental(cleaner, rental.id)).rejects.toThrow(/need/);

    // The cleaner's photo-gated job flow.
    await expect(startJob(cleaner, jobId)).rejects.toThrow(/before photo/);
    await addPhoto(jobId, "BEFORE", cleaner.id);
    await startJob(cleaner, jobId);
    await expect(completeJob(cleaner, jobId)).rejects.toThrow(/after photo/);
    await addPhoto(jobId, "AFTER", cleaner.id);
    await completeJob(cleaner, jobId);

    // The homeowner disputes instead of confirming; nobody but the controller can settle it.
    await disputeJob(homeowner, jobId, "The end of the driveway was left icy.");
    await expect(resolveDispute(homeowner, jobId, "REFUND")).rejects.toThrow();
    await expect(transitionJob(jobId, "CONFIRMED", actorOf(homeowner))).rejects.toThrow(/controller/);

    // The controller sides with the cleaner, who is paid exactly once.
    await resolveDispute(controller, jobId, "PAY_CLEANER");
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("CONFIRMED");
    expect(await balance(cleaner.id)).toBe(jobEarnings(job) - 1500);
    await expect(resolveDispute(controller, jobId, "PAY_CLEANER")).rejects.toThrow();
    expect(await prisma.ledgerEntry.count({ where: { jobId, type: "EARNING" } })).toBe(1);

    // Everything went through the state machines, so the workflow checks are clean.
    expect(await runIntegrityChecks(controller)).toEqual([]);
  });

  it("lets a cleaner who owns a blower take large driveways without renting", async () => {
    const controller = await makeUser("CONTROLLER");
    const homeowner = await makeUser("HOMEOWNER");
    const cleaner = await makeUser("CLEANER", { ownsBlower: true });
    const property = await makeProperty(homeowner.id, "LARGE");
    const window = await makeWindow(hoursFromNow(50), hoursFromNow(52));
    const booking = await createBooking(
      homeowner,
      { propertyId: property.id, windowIds: [window.id], includeSidewalk: false, includeSalt: false, tipCents: 0, notes: undefined },
      "http://localhost:3000",
    );
    const jobId = booking.kind === "booked" ? booking.jobId : "";
    await createShift(cleaner, { startsAt: hoursFromNow(49), endsAt: hoursFromNow(53) });
    await transitionJob(jobId, "ASSIGNED", actorOf(controller), { assignment: { cleanerId: cleaner.id, windowId: window.id } });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("ASSIGNED");
  });
});
