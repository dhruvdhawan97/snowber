"use server";

import { refresh } from "next/cache";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { firstError, photoFinalizeSchema, photoUploadSchema, shiftSchema } from "@/lib/contracts/schemas";
import { completeJob, startJob } from "@/lib/dal/jobs";
import { deletePhoto, finalizePhoto, requestPhotoUpload } from "@/lib/dal/photos";
import { requireRole } from "@/lib/dal/session";
import { createShift, deleteShift } from "@/lib/dal/shifts";

// Cleaner portal (Member 2). Like every server action, each one re-checks the
// session and validates its input before calling the DAL.

export type PhotoUploadTicket = { key: string; url: string; contentType: string };

/** Step 1 of an upload: a presigned URL the phone PUTs the photo to. */
export async function requestPhotoUploadAction(input: unknown): Promise<ActionResult<PhotoUploadTicket>> {
  return runAction(async () => {
    const user = await requireRole("CLEANER");
    const parsed = photoUploadSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    return { ok: true, data: await requestPhotoUpload(user, parsed.data) };
  });
}

/** Step 2 of an upload: process the stored file and record it on the job. */
export async function finalizePhotoAction(input: unknown): Promise<ActionResult<{ flagged: boolean }>> {
  return runAction(async () => {
    const user = await requireRole("CLEANER");
    const parsed = photoFinalizeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const photo = await finalizePhoto(user, parsed.data);
    refresh();
    return {
      ok: true,
      message: photo.flagged ? `Photo saved, but flagged for the controller: ${photo.flagReason}` : "Photo saved.",
      data: { flagged: photo.flagged },
    };
  });
}

export async function deletePhotoAction(photoId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CLEANER");
    await deletePhoto(user, photoId);
    refresh();
    return { ok: true, message: "Photo removed." };
  });
}

export async function startJobAction(jobId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CLEANER");
    await startJob(user, jobId);
    refresh();
    return { ok: true, message: "Job started. The homeowner has been told." };
  });
}

export async function completeJobAction(jobId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CLEANER");
    await completeJob(user, jobId);
    refresh();
    return { ok: true, message: "Nice work! The homeowner will confirm and you'll be paid." };
  });
}

export async function createShiftAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CLEANER");
    const parsed = shiftSchema.safeParse(formToObject(formData));
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    await createShift(user, parsed.data);
    refresh();
    return { ok: true, message: "Shift posted. The controller can now assign you jobs in it." };
  });
}

export async function deleteShiftAction(shiftId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CLEANER");
    await deleteShift(user, shiftId);
    refresh();
    return { ok: true, message: "Shift removed." };
  });
}
