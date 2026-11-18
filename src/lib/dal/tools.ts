import "server-only";
import { prisma } from "@/lib/prisma";
import type { ToolStatus, ToolType } from "@/lib/contracts/domain";
import { RENTAL_HORIZON_DAYS, rentalPhase } from "@/lib/contracts/rental-states";
import { invalid, notFound } from "@/lib/errors";
import { publish } from "@/lib/events";
import { assertRole, type CurrentUser } from "./session";

// Tool library (Member 4): the controller stocks tools and takes them in and out of
// service; cleaners browse what they can rent. Rentals themselves live in ./rentals.ts.

const DAY = 24 * 60 * 60 * 1000;

/** Every tool with its open rentals (requests and approved ones not yet returned), for the controller. */
export async function listToolLibrary(user: CurrentUser) {
  assertRole(user, "CONTROLLER");
  const now = new Date();
  const tools = await prisma.tool.findMany({
    orderBy: [{ status: "asc" }, { type: "asc" }, { name: "asc" }],
    include: {
      rentals: {
        where: { status: { in: ["REQUESTED", "APPROVED"] } },
        orderBy: { startsAt: "asc" },
        select: { id: true, status: true, startsAt: true, endsAt: true, cleaner: { select: { name: true } } },
      },
    },
  });
  return tools.map((tool) => {
    const approved = tool.rentals.filter((r) => r.status === "APPROVED");
    return {
      ...tool,
      current: approved.find((r) => ["OUT", "OVERDUE"].includes(rentalPhase(r, now))) ?? null,
      next: approved.find((r) => rentalPhase(r, now) === "UPCOMING") ?? null,
      pendingCount: tool.rentals.filter((r) => rentalPhase(r, now) === "PENDING").length,
    };
  });
}

/**
 * Tools a cleaner can rent (retired ones are hidden), each with the times it is
 * already reserved. Only the times are shown, never who has it.
 */
export async function listToolsForCleaner(user: CurrentUser) {
  assertRole(user, "CLEANER");
  const now = new Date();
  const [tools, me] = await Promise.all([
    prisma.tool.findMany({
      where: { status: { not: "RETIRED" } },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        feeCents: true,
        status: true,
        notes: true,
        rentals: {
          where: { status: "APPROVED", endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + RENTAL_HORIZON_DAYS * DAY) } },
          orderBy: { startsAt: "asc" },
          select: { startsAt: true, endsAt: true },
        },
      },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { ownsBlower: true } }),
  ]);
  return { tools: tools.map(({ rentals, ...tool }) => ({ ...tool, reserved: rentals })), ownsBlower: me?.ownsBlower ?? false };
}

export async function createTool(user: CurrentUser, input: { name: string; type: ToolType; feeCents: number; notes?: string }) {
  assertRole(user, "CONTROLLER");
  const tool = await prisma.tool.create({ data: input });
  publish({ type: "rental.updated", message: `${tool.name} added to the tool library`, audience: { userIds: [], controllers: true } });
  return tool;
}

/**
 * Takes a tool in or out of service. A tool with approved rentals (upcoming, out or
 * overdue) can't leave service until they are cancelled or checked in. Retiring a tool also rejects
 * its pending requests, so nobody waits on a tool that is gone.
 * The tool row is locked so this can't interleave with an approval of the same tool.
 */
export async function setToolStatus(user: CurrentUser, toolId: string, status: ToolStatus) {
  assertRole(user, "CONTROLLER");
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Tool" WHERE id = ${toolId} FOR UPDATE`;
    if (locked.length === 0) throw notFound("We couldn't find that tool.");
    const tool = await tx.tool.findUniqueOrThrow({ where: { id: toolId } });
    if (tool.status === status) return { tool, rejected: [] as { id: string; cleanerId: string }[] };

    if (status !== "AVAILABLE") {
      // Every approved rental counts: upcoming, checked out, or overdue (ended but never checked in).
      const booked = await tx.toolRental.count({ where: { toolId, status: "APPROVED" } });
      if (booked > 0) {
        throw invalid(
          `${tool.name} has ${booked} open reservation${booked === 1 ? "" : "s"}. Cancel ${booked === 1 ? "it" : "them"} or check the tool in first.`,
        );
      }
    }
    let rejected: { id: string; cleanerId: string }[] = [];
    if (status === "RETIRED") {
      rejected = await tx.toolRental.findMany({ where: { toolId, status: "REQUESTED" }, select: { id: true, cleanerId: true } });
      await tx.toolRental.updateMany({ where: { id: { in: rejected.map((r) => r.id) } }, data: { status: "REJECTED", decidedAt: now } });
    }
    const updated = await tx.tool.update({ where: { id: toolId }, data: { status } });
    return { tool: updated, rejected };
  });

  const label = status === "AVAILABLE" ? "back in service" : status === "MAINTENANCE" ? "out for repair" : "retired";
  publish({
    type: "rental.updated",
    message: `${result.tool.name} is ${label}${result.rejected.length > 0 ? `; ${result.rejected.length} request(s) declined` : ""}`,
    audience: { userIds: [...new Set(result.rejected.map((r) => r.cleanerId))], controllers: true },
  });
  return result;
}
