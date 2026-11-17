import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/contracts/domain";
import { conflict, invalid, isUniqueViolation, notFound } from "@/lib/errors";
import { ratingSummary } from "./reviews";
import { assertRole, type CurrentUser } from "./session";

export async function listUsers(user: CurrentUser) {
  assertRole(user, "CONTROLLER");
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      ownsBlower: true,
      deactivatedAt: true,
      discountProgram: true,
      discountStatus: true,
      _count: { select: { properties: true, jobsAsCleaner: true, jobsAsHomeowner: true } },
    },
  });
  const ratings = await ratingSummary(users.map((u) => u.id));
  return users.map((u) => ({ ...u, rating: ratings.get(u.id) ?? null }));
}

/**
 * Controllers add people directly (any role). The user and its credential account
 * are written directly (the same rows Better Auth's sign-up creates), so the
 * controller's own session is not replaced by the new account.
 */
export async function createAccount(user: CurrentUser, input: { name: string; email: string; password: string; role: Role }) {
  assertRole(user, "CONTROLLER");
  const id = randomUUID();
  const password = await hashPassword(input.password);
  try {
    return await prisma.user.create({
      data: {
        id,
        name: input.name,
        email: input.email,
        emailVerified: false,
        role: input.role,
        accounts: { create: { id: randomUUID(), accountId: id, providerId: "credential", password } },
      },
      select: { id: true, email: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("An account with that email already exists.");
    throw error;
  }
}

export function createControllerAccount(user: CurrentUser, input: { name: string; email: string; password: string }) {
  return createAccount(user, { ...input, role: "CONTROLLER" });
}

/** Jobs that still need this person, by role. They must be finished, cancelled or reassigned first. */
const OPEN_FOR_HOMEOWNER = ["REQUESTED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] as const;
const OPEN_FOR_CLEANER = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] as const;

/**
 * Removes a person: they are signed out everywhere and can't sign in again.
 * Their row is kept (not deleted) so past jobs, reviews and the earnings ledger
 * stay correct. A controller can restore them later.
 */
export async function removeUser(user: CurrentUser, userId: string) {
  assertRole(user, "CONTROLLER");
  if (userId === user.id) throw invalid("You can't remove yourself.");
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, deactivatedAt: true },
  });
  if (!target) throw notFound("We couldn't find that user.");
  if (target.deactivatedAt) return target;

  const [openAsHomeowner, openAsCleaner] = await Promise.all([
    prisma.job.count({ where: { homeownerId: userId, status: { in: [...OPEN_FOR_HOMEOWNER] } } }),
    prisma.job.count({ where: { cleanerId: userId, status: { in: [...OPEN_FOR_CLEANER] } } }),
  ]);
  if (openAsCleaner > 0) {
    throw invalid(`${target.name} still has ${openAsCleaner} open job${openAsCleaner === 1 ? "" : "s"}. Reassign or finish them first.`);
  }
  if (openAsHomeowner > 0) {
    throw invalid(`${target.name} has ${openAsHomeowner} open booking${openAsHomeowner === 1 ? "" : "s"}. Cancel or finish them first.`);
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { deactivatedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId } }),
    // Future shifts would otherwise still show up as available in dispatch.
    prisma.shift.deleteMany({ where: { cleanerId: userId, startsAt: { gt: new Date() } } }),
  ]);
  return target;
}

export async function restoreUser(user: CurrentUser, userId: string) {
  assertRole(user, "CONTROLLER");
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  if (!target) throw notFound("We couldn't find that user.");
  await prisma.user.update({ where: { id: userId }, data: { deactivatedAt: null } });
  return target;
}

/** Approve or decline a homeowner's senior / accessibility discount request. */
export async function decideDiscount(user: CurrentUser, userId: string, approve: boolean) {
  assertRole(user, "CONTROLLER");
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, discountProgram: true } });
  if (!target?.discountProgram) throw notFound("That person hasn't applied for a discount.");
  await prisma.user.update({
    where: { id: userId },
    data: approve ? { discountStatus: "APPROVED" } : { discountProgram: null, discountStatus: null },
  });
  return target;
}

export async function setUserRole(user: CurrentUser, userId: string, role: Role) {
  assertRole(user, "CONTROLLER");
  if (userId === user.id) throw invalid("You can't change your own role.");
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) throw notFound("We couldn't find that user.");
  await prisma.user.update({ where: { id: userId }, data: { role } });
}
