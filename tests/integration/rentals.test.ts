import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { approveRental, cancelRental, listRentalsForController, rejectRental, requestRental, returnRental } from "@/lib/dal/rentals";
import { setToolStatus } from "@/lib/dal/tools";
import { prisma } from "@/lib/prisma";
import { balance, hoursFromNow, makeTool, makeUser, resetDatabase } from "./helpers";

// Tool library and rentals against the real database: the exclusion constraint,
// row locks and the ledger working together (Member 4).

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("reserving tools", () => {
  it("never double-books a tool, even when two approvals race", async () => {
    const controller = await makeUser("CONTROLLER");
    const ava = await makeUser("CLEANER");
    const ben = await makeUser("CLEANER");
    const blower = await makeTool("SNOW_BLOWER", 1500);
    const first = await requestRental(ava, { toolId: blower.id, startsAt: hoursFromNow(2), endsAt: hoursFromNow(6) });
    const second = await requestRental(ben, { toolId: blower.id, startsAt: hoursFromNow(4), endsAt: hoursFromNow(8) });

    // The dashboard already warns about the clash once one is approved; here both go at once.
    const results = await Promise.allSettled([approveRental(controller, first.id), approveRental(controller, second.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(failure.reason.message)).toMatch(/already reserved/);

    expect(await prisma.toolRental.count({ where: { toolId: blower.id, status: "APPROVED" } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: "RENTAL_FEE" } })).toBe(1);
    expect((await balance(ava.id)) + (await balance(ben.id))).toBe(-1500);

    // The loser is flagged as clashing and can only be declined.
    const { requests } = await listRentalsForController(controller);
    expect(requests).toHaveLength(1);
    expect(requests[0].clash).not.toBeNull();
    await rejectRental(controller, requests[0].id);
  });

  it("turns away requests for tools under repair or already reserved", async () => {
    const controller = await makeUser("CONTROLLER");
    const ava = await makeUser("CLEANER");
    const ben = await makeUser("CLEANER");
    const blower = await makeTool("SNOW_BLOWER");
    const spreader = await makeTool("SALT_SPREADER", 500);
    await setToolStatus(controller, spreader.id, "MAINTENANCE");
    await expect(requestRental(ava, { toolId: spreader.id, startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) })).rejects.toThrow(/repair/);

    const reserved = await requestRental(ava, { toolId: blower.id, startsAt: hoursFromNow(1), endsAt: hoursFromNow(5) });
    await expect(requestRental(ava, { toolId: blower.id, startsAt: hoursFromNow(2), endsAt: hoursFromNow(3) })).rejects.toThrow(/already asked/);
    await approveRental(controller, reserved.id);
    await expect(requestRental(ben, { toolId: blower.id, startsAt: hoursFromNow(4), endsAt: hoursFromNow(6) })).rejects.toThrow(/already reserved/);
    // Back to back is fine.
    await requestRental(ben, { toolId: blower.id, startsAt: hoursFromNow(5), endsAt: hoursFromNow(7) });
  });
});

describe("cancelling and returning", () => {
  it("refunds the fee when a reservation is cancelled before pickup", async () => {
    const controller = await makeUser("CONTROLLER");
    const ava = await makeUser("CLEANER");
    const blower = await makeTool("SNOW_BLOWER", 1500);
    const rental = await requestRental(ava, { toolId: blower.id, startsAt: hoursFromNow(3), endsAt: hoursFromNow(6) });
    await approveRental(controller, rental.id);
    expect(await balance(ava.id)).toBe(-1500);

    await cancelRental(ava, rental.id);
    expect(await balance(ava.id)).toBe(0);
    expect((await prisma.toolRental.findUniqueOrThrow({ where: { id: rental.id } })).status).toBe("CANCELLED");
    // A second cancel can't refund twice.
    await expect(cancelRental(ava, rental.id)).rejects.toThrow();
    expect(await balance(ava.id)).toBe(0);
  });

  it("checks a tool in after use, which frees it for the next cleaner", async () => {
    const controller = await makeUser("CONTROLLER");
    const ava = await makeUser("CLEANER");
    const ben = await makeUser("CLEANER");
    const blower = await makeTool("SNOW_BLOWER", 1500);
    const rental = await requestRental(ava, { toolId: blower.id, startsAt: hoursFromNow(-0.2), endsAt: hoursFromNow(3) });
    await approveRental(controller, rental.id);

    // Picked up already: it can't be cancelled, only checked in, and only by the controller.
    await expect(cancelRental(ava, rental.id)).rejects.toThrow(/started/);
    await expect(returnRental(ava, rental.id)).rejects.toThrow();
    await returnRental(controller, rental.id);
    expect(await balance(ava.id)).toBe(-1500);

    const next = await requestRental(ben, { toolId: blower.id, startsAt: hoursFromNow(1), endsAt: hoursFromNow(4) });
    await approveRental(controller, next.id);
    expect((await prisma.toolRental.findUniqueOrThrow({ where: { id: next.id } })).status).toBe("APPROVED");
  });

  it("hides other cleaners' rentals", async () => {
    const ava = await makeUser("CLEANER");
    const ben = await makeUser("CLEANER");
    const blower = await makeTool();
    const rental = await requestRental(ava, { toolId: blower.id, startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) });
    await expect(cancelRental(ben, rental.id)).rejects.toThrow(/couldn't find/);
  });
});

describe("tool status", () => {
  it("keeps reserved tools in service, and retiring a tool declines its pending requests", async () => {
    const controller = await makeUser("CONTROLLER");
    const ava = await makeUser("CLEANER");
    const ben = await makeUser("CLEANER");
    const blower = await makeTool();
    const reserved = await requestRental(ava, { toolId: blower.id, startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) });
    await approveRental(controller, reserved.id);
    const pending = await requestRental(ben, { toolId: blower.id, startsAt: hoursFromNow(5), endsAt: hoursFromNow(7) });

    await expect(setToolStatus(controller, blower.id, "MAINTENANCE")).rejects.toThrow(/reservation/);
    await cancelRental(controller, reserved.id);

    const { rejected } = await setToolStatus(controller, blower.id, "RETIRED");
    expect(rejected.map((r) => r.id)).toEqual([pending.id]);
    expect((await prisma.toolRental.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("REJECTED");
    await expect(requestRental(ben, { toolId: blower.id, startsAt: hoursFromNow(8), endsAt: hoursFromNow(9) })).rejects.toThrow();
  });

  it("won't send a tool for repair while an overdue rental hasn't been checked in", async () => {
    const controller = await makeUser("CONTROLLER");
    const ava = await makeUser("CLEANER");
    const chopper = await makeTool("ICE_CHOPPER", 400);
    const overdue = await prisma.toolRental.create({
      data: { toolId: chopper.id, cleanerId: ava.id, startsAt: hoursFromNow(-6), endsAt: hoursFromNow(-1), status: "APPROVED", feeCents: 400 },
    });
    await expect(setToolStatus(controller, chopper.id, "MAINTENANCE")).rejects.toThrow(/open reservation/);
    await returnRental(controller, overdue.id);
    await setToolStatus(controller, chopper.id, "MAINTENANCE");
  });

  it("won't approve a request while its tool is out for repair", async () => {
    const controller = await makeUser("CONTROLLER");
    const ava = await makeUser("CLEANER");
    const blower = await makeTool();
    const pending = await requestRental(ava, { toolId: blower.id, startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) });
    await setToolStatus(controller, blower.id, "MAINTENANCE");
    await expect(approveRental(controller, pending.id)).rejects.toThrow(/out of service/);
    await setToolStatus(controller, blower.id, "AVAILABLE");
    await approveRental(controller, pending.id);
  });
});
