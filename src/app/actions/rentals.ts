"use server";

import { refresh } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { firstError, rentalRequestSchema, toolSchema, toolStatusSchema } from "@/lib/contracts/schemas";
import { approveRental, cancelRental, rejectRental, requestRental, returnRental } from "@/lib/dal/rentals";
import { requireRole } from "@/lib/dal/session";
import { createTool, setToolStatus } from "@/lib/dal/tools";

// Tool library and rentals (Member 4). Each action re-checks the session and
// validates its input; the DAL re-checks the role and ownership again.

// ── Cleaner ──

export async function requestRentalAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CLEANER");
    const parsed = rentalRequestSchema.safeParse(formToObject(formData));
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    await requestRental(user, parsed.data);
    refresh();
    return { ok: true, message: "Request sent. You'll get a notification when the controller decides." };
  });
}

/** Cleaners cancel their own requests or not-yet-started reservations; controllers can cancel any. */
export async function cancelRentalAction(rentalId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CLEANER", "CONTROLLER");
    await cancelRental(user, rentalId);
    refresh();
    return { ok: true, message: "Cancelled. Any rental fee was refunded." };
  });
}

// ── Controller ──

export async function createToolAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const parsed = toolSchema.safeParse(formToObject(formData));
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    // toolSchema turns the dollars typed in the form into cents.
    const { feeDollars: feeCents, ...rest } = parsed.data;
    const tool = await createTool(user, { ...rest, feeCents });
    refresh();
    return { ok: true, message: `${tool.name} added. Cleaners can rent it now.` };
  });
}

export async function setToolStatusAction(toolId: string, status: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const parsed = toolStatusSchema.safeParse({ toolId, status });
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { tool, rejected } = await setToolStatus(user, parsed.data.toolId, parsed.data.status);
    refresh();
    return {
      ok: true,
      message: `${tool.name} updated.${rejected.length > 0 ? ` ${rejected.length} pending request(s) were declined.` : ""}`,
    };
  });
}

export async function approveRentalAction(rentalId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    await approveRental(user, rentalId);
    refresh();
    return { ok: true, message: "Approved. The tool is reserved and the fee was charged." };
  });
}

export async function rejectRentalAction(rentalId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    await rejectRental(user, rentalId);
    refresh();
    return { ok: true, message: "Request declined." };
  });
}

export async function returnRentalAction(rentalId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    await returnRental(user, rentalId);
    refresh();
    return { ok: true, message: "Checked in. The tool can be rented again." };
  });
}
