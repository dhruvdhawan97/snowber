import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as autoConfirm } from "@/app/api/cron/auto-confirm/route";
import { listDisputes, resolveDispute } from "@/lib/dal/disputes";
import { runIntegrityChecks } from "@/lib/dal/integrity";
import { disputeJob } from "@/lib/dal/jobs";
import { prisma } from "@/lib/prisma";
import { hoursFromNow, makeJob, makeTool, makeUser, makeWindow, resetDatabase } from "./helpers";

// Disputes, the 24-hour auto-confirmation endpoint, and workflow checks (Member 4).

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const cronRequest = (authorization?: string) =>
  new Request("http://localhost:3000/api/cron/auto-confirm", { method: "POST", headers: authorization ? { authorization } : {} });

describe("disputes", () => {
  it("refunding the homeowner cancels the job and pays the cleaner nothing", async () => {
    const controller = await makeUser("CONTROLLER");
    const homeowner = await makeUser("HOMEOWNER");
    const cleaner = await makeUser("CLEANER");
    const window = await makeWindow(hoursFromNow(-4), hoursFromNow(-2));
    const job = await makeJob({ homeownerId: homeowner.id, cleanerId: cleaner.id, window, status: "COMPLETED", priceCents: 6000 });

    await disputeJob(homeowner, job.id, "Nobody cleared the sidewalk at all.");
    const { open } = await listDisputes(controller);
    expect(open.map((j) => j.id)).toEqual([job.id]);
    expect(open[0].refundableCents).toBe(6000);

    await resolveDispute(controller, job.id, "REFUND");
    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id }, include: { payment: true } });
    expect(after.status).toBe("CANCELLED");
    expect(after.payment).toMatchObject({ status: "REFUNDED", refundedCents: 6000 });
    expect(await prisma.ledgerEntry.count({ where: { cleanerId: cleaner.id } })).toBe(0);

    // It moves to the resolved list.
    const lists = await listDisputes(controller);
    expect(lists.open).toHaveLength(0);
    expect(lists.resolved.map((j) => j.id)).toEqual([job.id]);
  });
});

describe("auto-confirm endpoint", () => {
  it("needs the cron secret, then confirms and pays jobs nobody answered within 24 hours", async () => {
    const homeowner = await makeUser("HOMEOWNER");
    const cleaner = await makeUser("CLEANER");
    const window = await makeWindow(hoursFromNow(-30), hoursFromNow(-28));
    const stale = await makeJob({ homeownerId: homeowner.id, cleanerId: cleaner.id, window, status: "COMPLETED", completedAt: hoursFromNow(-25) });
    const fresh = await makeJob({ homeownerId: homeowner.id, cleanerId: cleaner.id, window, status: "COMPLETED", completedAt: hoursFromNow(-2) });
    const disputed = await makeJob({ homeownerId: homeowner.id, cleanerId: cleaner.id, window, status: "DISPUTED", completedAt: hoursFromNow(-30) });

    expect((await autoConfirm(cronRequest())).status).toBe(401);
    expect((await autoConfirm(cronRequest("Bearer wrong-secret"))).status).toBe(401);

    const response = await autoConfirm(cronRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, confirmed: 1 });

    const statuses = await prisma.job.findMany({ where: { id: { in: [stale.id, fresh.id, disputed.id] } }, select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map((j) => [j.id, j.status]))).toEqual({
      [stale.id]: "CONFIRMED",
      [fresh.id]: "COMPLETED",
      [disputed.id]: "DISPUTED",
    });
    expect(await prisma.ledgerEntry.count({ where: { jobId: stale.id, type: "EARNING" } })).toBe(1);
  });

  it("stays off without a real secret", async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "replace-me";
    try {
      expect((await autoConfirm(cronRequest("Bearer replace-me"))).status).toBe(503);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });
});

describe("workflow checks", () => {
  it("flag data that was changed outside the state machines", async () => {
    const controller = await makeUser("CONTROLLER");
    const homeowner = await makeUser("HOMEOWNER");
    const cleaner = await makeUser("CLEANER", { ownsBlower: false });
    const window = await makeWindow(hoursFromNow(20), hoursFromNow(22));
    expect(await runIntegrityChecks(controller)).toEqual([]);

    // Confirmed by a direct database edit, so the cleaner was never paid.
    await makeJob({ homeownerId: homeowner.id, cleanerId: cleaner.id, window, status: "CONFIRMED" });
    // A large driveway assigned around the blower rule.
    await makeJob({ homeownerId: homeowner.id, cleanerId: cleaner.id, window, status: "ASSIGNED", lotSize: "LARGE" });
    // A tool that never came back.
    const chopper = await makeTool("ICE_CHOPPER", 400);
    await prisma.toolRental.create({
      data: { toolId: chopper.id, cleanerId: cleaner.id, startsAt: hoursFromNow(-6), endsAt: hoursFromNow(-1), status: "APPROVED", feeCents: 400 },
    });

    const issues = await runIntegrityChecks(controller);
    expect(issues.map((i) => i.key).sort()).toEqual(["no-blower", "overdue-rentals", "unpaid-confirmed"]);
    expect(issues.every((i) => i.count === 1)).toBe(true);
  });
});
