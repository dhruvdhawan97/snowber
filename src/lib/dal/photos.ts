import "server-only";
import { randomUUID } from "node:crypto";
import exifReader from "exif-reader";
import sharp, { type Metadata } from "sharp";
import { prisma } from "@/lib/prisma";
import { APP_TIMEZONE, MAX_UPLOAD_BYTES } from "@/lib/config";
import type { PhotoKind } from "@/lib/contracts/domain";
import { invalid, notFound } from "@/lib/errors";
import { publish } from "@/lib/events";
import {
  DISPLAY_MAX_PX,
  MAX_PHOTOS_PER_KIND,
  THUMB_MAX_PX,
  UPLOAD_URL_SECONDS,
  VIEW_URL_SECONDS,
  derivedKeys,
  exifTimeToUtc,
  type JobPhotoView,
  originalKey,
  parseOriginalKey,
  photoFlagReason,
  photoStepError,
} from "@/lib/photo-rules";
import { getStorage } from "@/lib/storage";
import { ensureCanView } from "./jobs";
import { assertRole, type CurrentUser } from "./session";

// Before/after photos (Member 2). The browser uploads the original straight to
// storage with a presigned PUT; finalizePhoto then reads the capture time, strips
// all metadata (including GPS), stores display and thumbnail copies, and deletes
// the original. Only object keys are saved; pages get short-lived view URLs.

const KIND_LABEL: Record<PhotoKind, string> = { BEFORE: "Before", AFTER: "After" };

/** The job, if `user` is its assigned cleaner and `kind` can be added at this step. */
async function jobForPhotoStep(user: CurrentUser, jobId: string, kind: PhotoKind) {
  assertRole(user, "CLEANER");
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      cleanerId: true,
      homeownerId: true,
      property: { select: { address: true } },
      assignedWindow: { select: { startsAt: true } },
      photos: { select: { kind: true, takenAt: true } },
    },
  });
  if (!job || job.cleanerId !== user.id) throw notFound("We couldn't find that job.");
  const stepError = photoStepError(job.status, kind);
  if (stepError) throw invalid(stepError);
  return job;
}

export async function requestPhotoUpload(
  user: CurrentUser,
  input: { jobId: string; kind: PhotoKind; contentType: string; size: number },
) {
  const job = await jobForPhotoStep(user, input.jobId, input.kind);
  if (job.photos.filter((p) => p.kind === input.kind).length >= MAX_PHOTOS_PER_KIND) {
    throw invalid(`You can add up to ${MAX_PHOTOS_PER_KIND} ${input.kind.toLowerCase()} photos. Remove one first.`);
  }
  const key = originalKey(job.id, input.kind, randomUUID(), input.contentType);
  const url = await getStorage().presignPut(key, input.contentType, UPLOAD_URL_SECONDS);
  return { key, url, contentType: input.contentType };
}

/** Capture time from EXIF, read before sharp strips the metadata. */
function captureTime(exif: Buffer | undefined): Date | null {
  if (!exif) return null;
  try {
    const tags = exifReader(exif);
    const raw = tags.Photo?.DateTimeOriginal ?? tags.Photo?.DateTimeDigitized ?? tags.Image?.DateTime;
    return raw instanceof Date ? exifTimeToUtc(raw, tags.Photo?.OffsetTimeOriginal, APP_TIMEZONE) : null;
  } catch {
    return null;
  }
}

async function processImage(original: Buffer) {
  let metadata: Metadata;
  try {
    metadata = await sharp(original).metadata();
  } catch {
    throw invalid("That file isn't a photo we can read. Try again with JPEG, PNG or WebP.");
  }
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw invalid("Use a JPEG, PNG or WebP photo.");
  }
  // rotate() applies the EXIF orientation; sharp drops all metadata from the output by default.
  const resize = (max: number, quality: number) =>
    sharp(original)
      .rotate()
      .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
  const [display, thumb] = await Promise.all([resize(DISPLAY_MAX_PX, 80), resize(THUMB_MAX_PX, 70)]);
  return { takenAt: captureTime(metadata.exif), display, thumb };
}

export async function finalizePhoto(user: CurrentUser, input: { jobId: string; kind: PhotoKind; key: string }) {
  const parsed = parseOriginalKey(input.key);
  if (!parsed || parsed.jobId !== input.jobId || parsed.kind !== input.kind) throw invalid("That upload doesn't belong to this job.");

  // A retried request after a successful finalize returns the saved photo.
  const existing = await prisma.jobPhoto.findUnique({ where: { id: parsed.photoId } });
  if (existing) {
    if (existing.jobId !== input.jobId || existing.uploadedById !== user.id) throw invalid("That upload doesn't belong to this job.");
    return existing;
  }

  const job = await jobForPhotoStep(user, input.jobId, input.kind);
  const storage = getStorage();
  const head = await storage.head(input.key);
  if (!head) throw invalid("The upload didn't finish. Please take the photo again.");
  if (head.size > MAX_UPLOAD_BYTES) {
    await storage.remove(input.key);
    throw invalid("Photos must be under 15 MB.");
  }

  let processed: Awaited<ReturnType<typeof processImage>>;
  try {
    processed = await processImage(await storage.get(input.key));
  } catch (error) {
    await storage.remove(input.key).catch(() => {});
    throw error;
  }

  const { displayKey, thumbKey } = derivedKeys(job.id, input.kind, parsed.photoId);
  await Promise.all([
    storage.put(displayKey, processed.display.data, "image/webp"),
    storage.put(thumbKey, processed.thumb.data, "image/webp"),
  ]);
  await storage.remove(input.key).catch((error) => console.error("[photos] could not delete original", error));

  const flagReason = photoFlagReason({
    kind: input.kind,
    takenAt: processed.takenAt,
    windowStartsAt: job.assignedWindow?.startsAt ?? null,
    beforeTakenAt: job.photos.filter((p) => p.kind === "BEFORE").map((p) => p.takenAt),
    now: new Date(),
  });

  const photo = await prisma.jobPhoto.create({
    data: {
      id: parsed.photoId,
      jobId: job.id,
      kind: input.kind,
      displayKey,
      thumbKey,
      width: processed.display.info.width,
      height: processed.display.info.height,
      takenAt: processed.takenAt,
      flagged: flagReason !== null,
      flagReason,
      uploadedById: user.id,
    },
  });

  publish({
    type: "job.updated",
    jobId: job.id,
    message: `${job.property.address}: ${KIND_LABEL[input.kind].toLowerCase()} photo added`,
    audience: { userIds: [job.homeownerId], controllers: true },
  });
  return photo;
}

/** A cleaner removes a photo while that step is still open (e.g. a blurry shot). */
export async function deletePhoto(user: CurrentUser, photoId: string) {
  assertRole(user, "CLEANER");
  const photo = await prisma.jobPhoto.findUnique({
    where: { id: photoId },
    include: { job: { select: { status: true, cleanerId: true } } },
  });
  if (!photo || photo.job.cleanerId !== user.id) throw notFound("We couldn't find that photo.");
  const stepError = photoStepError(photo.job.status, photo.kind);
  if (stepError) throw invalid(stepError);
  await prisma.jobPhoto.delete({ where: { id: photo.id } });
  const storage = getStorage();
  await Promise.all([storage.remove(photo.displayKey), storage.remove(photo.thumbKey)]).catch((error) =>
    console.error("[photos] could not delete objects", error),
  );
}

/** Photos for anyone allowed to see the job, with short-lived view URLs. */
export async function listJobPhotos(user: CurrentUser, jobId: string): Promise<JobPhotoView[]> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { homeownerId: true, cleanerId: true, photos: { orderBy: { createdAt: "asc" } } },
  });
  if (!job) throw notFound("We couldn't find that job.");
  ensureCanView(user, job);
  const storage = getStorage();
  return Promise.all(
    job.photos.map(async (p) => ({
      id: p.id,
      kind: p.kind,
      width: p.width,
      height: p.height,
      takenAt: p.takenAt,
      createdAt: p.createdAt,
      flagged: p.flagged,
      flagReason: p.flagReason,
      displayUrl: await storage.presignGet(p.displayKey, VIEW_URL_SECONDS),
      thumbUrl: await storage.presignGet(p.thumbKey, VIEW_URL_SECONDS),
    })),
  );
}
