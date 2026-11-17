"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { bookingSchema, disputeSchema, firstError, propertySchema } from "@/lib/contracts/schemas";
import { cancelJob, confirmJob, createBooking, disputeJob, previewQuote, requestDiscount } from "@/lib/dal/jobs";
import { createProperty } from "@/lib/dal/properties";
import { requireRole } from "@/lib/dal/session";
import type { Quote } from "@/lib/pricing";

// Server actions are public POST endpoints: each one re-checks the session and
// validates its input with the shared Zod schemas before calling the DAL.

export async function createPropertyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("HOMEOWNER");
    const parsed = propertySchema.safeParse(formToObject(formData));
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const property = await createProperty(user, parsed.data);
    redirect(`/homeowner/book?property=${property.id}`);
  });
}

export async function quoteAction(input: {
  propertyId: string;
  windowIds: string[];
  includeSidewalk: boolean;
  includeSalt: boolean;
}): Promise<ActionResult<Quote>> {
  return runAction(async () => {
    const user = await requireRole("HOMEOWNER");
    const parsed = bookingSchema.pick({ propertyId: true, windowIds: true, includeSidewalk: true, includeSalt: true }).safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    return { ok: true, data: await previewQuote(user, parsed.data) };
  });
}

export async function bookJobAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("HOMEOWNER");
    const parsed = bookingSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const result = await createBooking(user, parsed.data, await appUrl());
    // Stripe: off to the Checkout page. Mock payments: the job already exists.
    redirect(result.kind === "checkout" ? result.url : `/homeowner/jobs/${result.jobId}?booked=1`);
  });
}

/** Public URL of this app, for Stripe's return links. */
async function appUrl(): Promise<string> {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function requestDiscountAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("HOMEOWNER");
    const program = formData.get("program");
    if (program === "NONE") {
      await requestDiscount(user, null);
      refresh();
      return { ok: true, message: "Discount removed." };
    }
    if (program !== "SENIOR" && program !== "ACCESSIBILITY") return { ok: false, error: "Choose a discount program." };
    if (formData.get("attest") !== "on") return { ok: false, error: "Please confirm that you qualify." };
    await requestDiscount(user, program);
    refresh();
    return { ok: true, message: "Thanks! A controller will review your request." };
  });
}

export async function cancelJobAction(jobId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("HOMEOWNER", "CONTROLLER");
    await cancelJob(user, jobId);
    refresh();
    return { ok: true, message: "Job cancelled. Your payment was refunded." };
  });
}

export async function confirmJobAction(jobId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("HOMEOWNER");
    await confirmJob(user, jobId);
    refresh();
    return { ok: true, message: "Thanks! Your cleaner has been paid." };
  });
}

export async function disputeJobAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("HOMEOWNER");
    const parsed = disputeSchema.safeParse(formToObject(formData));
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    await disputeJob(user, parsed.data.jobId, parsed.data.reason);
    refresh();
    return { ok: true, message: "We've sent this to the controller, who will follow up." };
  });
}
