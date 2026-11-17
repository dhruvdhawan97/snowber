// Before/after photo rules as pure, unit-tested functions: object key layout,
// which photo a cleaner may take at each step, and when a photo looks suspicious.

import { PHOTO_FLAG_HOURS } from "./config";
import type { JobStatus, PhotoKind } from "./contracts/domain";
import { zonedTimeToUtc } from "./time";

export const MAX_PHOTOS_PER_KIND = 3;
/** Presigned upload URLs are valid this long. */
export const UPLOAD_URL_SECONDS = 5 * 60;
/** Presigned view URLs are valid this long. */
export const VIEW_URL_SECONDS = 15 * 60;

export const DISPLAY_MAX_PX = 1600;
export const THUMB_MAX_PX = 400;

/** A stored photo as pages see it, with short-lived view URLs. */
export type JobPhotoView = {
  id: string;
  kind: PhotoKind;
  width: number;
  height: number;
  takenAt: Date | null;
  createdAt: Date;
  flagged: boolean;
  flagReason: string | null;
  displayUrl: string;
  thumbUrl: string;
};

const EXT_BY_TYPE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// jobs/<jobId>/<before|after>/<photoId>-original.<ext>   uploaded by the browser, deleted after processing
// jobs/<jobId>/<before|after>/<photoId>.webp             display size, metadata stripped
// jobs/<jobId>/<before|after>/<photoId>-thumb.webp       thumbnail
const ORIGINAL_KEY = /^jobs\/([A-Za-z0-9_-]{1,64})\/(before|after)\/([A-Za-z0-9_-]{8,64})-original\.(jpg|png|webp)$/;

export function originalKey(jobId: string, kind: PhotoKind, photoId: string, contentType: string): string {
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) throw new RangeError(`Unsupported content type: ${contentType}`);
  return `jobs/${jobId}/${kind.toLowerCase()}/${photoId}-original.${ext}`;
}

export function parseOriginalKey(key: string): { jobId: string; kind: PhotoKind; photoId: string } | null {
  const match = ORIGINAL_KEY.exec(key);
  if (!match) return null;
  return { jobId: match[1], kind: match[2].toUpperCase() as PhotoKind, photoId: match[3] };
}

export function derivedKeys(jobId: string, kind: PhotoKind, photoId: string) {
  const base = `jobs/${jobId}/${kind.toLowerCase()}/${photoId}`;
  return { displayKey: `${base}.webp`, thumbKey: `${base}-thumb.webp` };
}

/** The one photo kind a cleaner may add (or remove) while a job is in `status`. */
export function photoKindFor(status: JobStatus): PhotoKind | null {
  if (status === "ASSIGNED") return "BEFORE";
  if (status === "IN_PROGRESS") return "AFTER";
  return null;
}

export function photoStepError(status: JobStatus, kind: PhotoKind): string | null {
  const allowed = photoKindFor(status);
  if (allowed === kind) return null;
  if (kind === "BEFORE") return "Before photos are taken before you start the job.";
  if (status === "ASSIGNED") return "Start the job before taking after photos.";
  return "Photos can't be changed once the job is finished.";
}

/**
 * EXIF stores the camera's wall-clock time without a zone, and exif-reader returns
 * it as if it were UTC. Use the recorded offset when the camera wrote one
 * (OffsetTimeOriginal, e.g. "-05:00"); otherwise assume the app's time zone.
 */
export function exifTimeToUtc(wallClockAsUtc: Date, offset: string | undefined, timeZone: string): Date | null {
  if (Number.isNaN(wallClockAsUtc.getTime())) return null;
  const match = offset ? /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim()) : null;
  if (match) {
    const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "-" ? -1 : 1);
    return new Date(wallClockAsUtc.getTime() - minutes * 60_000);
  }
  return zonedTimeToUtc(
    {
      year: wallClockAsUtc.getUTCFullYear(),
      month: wallClockAsUtc.getUTCMonth() + 1,
      day: wallClockAsUtc.getUTCDate(),
      hour: wallClockAsUtc.getUTCHours(),
      minute: wallClockAsUtc.getUTCMinutes(),
      second: wallClockAsUtc.getUTCSeconds(),
    },
    timeZone,
  );
}

const HOUR = 60 * 60 * 1000;
/** Allowance for phone clocks that run a little fast. */
const CLOCK_SKEW_MS = 10 * 60 * 1000;

/**
 * Why a photo should be double-checked by the controller, or null. A photo with no
 * capture time is not flagged: many phones and browsers strip EXIF on upload.
 */
export function photoFlagReason(input: {
  kind: PhotoKind;
  takenAt: Date | null;
  windowStartsAt: Date | null;
  /** Capture times of the job's before photos (used to check after photos). */
  beforeTakenAt: readonly (Date | null)[];
  now: Date;
}): string | null {
  const { takenAt } = input;
  if (!takenAt) return null;
  if (takenAt.getTime() > input.now.getTime() + CLOCK_SKEW_MS) return "Capture time is in the future.";
  if (input.windowStartsAt && takenAt.getTime() < input.windowStartsAt.getTime() - PHOTO_FLAG_HOURS * HOUR) {
    const hours = Math.round((input.windowStartsAt.getTime() - takenAt.getTime()) / HOUR);
    return `Taken ${hours} hours before the time slot started.`;
  }
  if (input.kind === "AFTER") {
    const latestBefore = Math.max(...input.beforeTakenAt.map((d) => d?.getTime() ?? -Infinity));
    if (Number.isFinite(latestBefore) && takenAt.getTime() < latestBefore) return "Taken earlier than the before photo.";
  }
  return null;
}
