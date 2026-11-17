"use server";

import { refresh } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { accountSchema, controllerAccountSchema, firstError, roleChangeSchema, windowSchema } from "@/lib/contracts/schemas";
import { requireRole } from "@/lib/dal/session";
import { ROLE_LABEL } from "@/lib/contracts/domain";
import { createAccount, createControllerAccount, decideDiscount, removeUser, restoreUser, setUserRole } from "@/lib/dal/users";
import { createWindow, setWindowStatus } from "@/lib/dal/windows";

export async function createControllerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const parsed = controllerAccountSchema.safeParse(formToObject(formData));
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const created = await createControllerAccount(user, parsed.data);
    refresh();
    return { ok: true, message: `Controller account created for ${created.email}.` };
  });
}

export async function setRoleAction(userId: string, role: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const parsed = roleChangeSchema.safeParse({ userId, role });
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    await setUserRole(user, parsed.data.userId, parsed.data.role);
    refresh();
    return { ok: true, message: "Role updated." };
  });
}

export async function createAccountAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const parsed = accountSchema.safeParse(formToObject(formData));
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const created = await createAccount(user, parsed.data);
    refresh();
    return { ok: true, message: `${ROLE_LABEL[parsed.data.role]} account created for ${created.email}.` };
  });
}

export async function removeUserAction(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const removed = await removeUser(user, userId);
    refresh();
    return { ok: true, message: `${removed.name} was removed and signed out.` };
  });
}

export async function restoreUserAction(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const restored = await restoreUser(user, userId);
    refresh();
    return { ok: true, message: `${restored.name} can sign in again.` };
  });
}

export async function decideDiscountAction(userId: string, approve: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const target = await decideDiscount(user, userId, approve);
    refresh();
    return { ok: true, message: approve ? `Discount approved for ${target.name}.` : `Discount request from ${target.name} declined.` };
  });
}

// ── Time slots (Member 1) ──

export async function createWindowAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const parsed = windowSchema.safeParse(formToObject(formData));
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    await createWindow(user, parsed.data);
    refresh();
    return { ok: true, message: "Time slot opened. Homeowners can book it now." };
  });
}

export async function setWindowStatusAction(windowId: string, status: "OPEN" | "CLOSED"): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    await setWindowStatus(user, windowId, status);
    refresh();
    return { ok: true, message: status === "OPEN" ? "Time slot reopened." : "Time slot closed to new bookings." };
  });
}
