import { describe, expect, it } from "vitest";
import { derivedKeys, exifTimeToUtc, originalKey, parseOriginalKey, photoFlagReason, photoKindFor, photoStepError } from "@/lib/photo-rules";

const HOUR = 60 * 60 * 1000;
const PHOTO_ID = "3f0f4529-d706-410e-82f8-04bf33ca18aa";

describe("object keys", () => {
  it("round-trips an original upload key", () => {
    const key = originalKey("job_1", "BEFORE", PHOTO_ID, "image/jpeg");
    expect(key).toBe(`jobs/job_1/before/${PHOTO_ID}-original.jpg`);
    expect(parseOriginalKey(key)).toEqual({ jobId: "job_1", kind: "BEFORE", photoId: PHOTO_ID });
  });

  it("rejects keys that were not issued by the server", () => {
    expect(parseOriginalKey(`jobs/job_1/before/${PHOTO_ID}.webp`)).toBeNull();
    expect(parseOriginalKey(`jobs/../etc/before/${PHOTO_ID}-original.jpg`)).toBeNull();
    expect(parseOriginalKey(`jobs/job_1/during/${PHOTO_ID}-original.jpg`)).toBeNull();
    expect(parseOriginalKey(`jobs/job_1/after/${PHOTO_ID}-original.gif`)).toBeNull();
  });

  it("refuses unsupported content types", () => {
    expect(() => originalKey("job_1", "AFTER", PHOTO_ID, "image/gif")).toThrow(RangeError);
  });

  it("derives display and thumbnail keys next to each other", () => {
    expect(derivedKeys("job_1", "AFTER", PHOTO_ID)).toEqual({
      displayKey: `jobs/job_1/after/${PHOTO_ID}.webp`,
      thumbKey: `jobs/job_1/after/${PHOTO_ID}-thumb.webp`,
    });
  });
});

describe("which photo fits which step", () => {
  it("allows before photos while assigned and after photos while in progress", () => {
    expect(photoKindFor("ASSIGNED")).toBe("BEFORE");
    expect(photoKindFor("IN_PROGRESS")).toBe("AFTER");
    expect(photoKindFor("COMPLETED")).toBeNull();
    expect(photoKindFor("REQUESTED")).toBeNull();
  });

  it("explains why a photo can't be added", () => {
    expect(photoStepError("ASSIGNED", "BEFORE")).toBeNull();
    expect(photoStepError("ASSIGNED", "AFTER")).toMatch(/Start the job/);
    expect(photoStepError("IN_PROGRESS", "BEFORE")).toMatch(/before you start/);
    expect(photoStepError("COMPLETED", "AFTER")).toMatch(/finished/);
  });
});

describe("EXIF capture time", () => {
  // exif-reader returns "2026:11:18 07:30:00" as if it were UTC.
  const wallClock = new Date(Date.UTC(2026, 10, 18, 7, 30, 0));

  it("uses the offset the camera recorded", () => {
    expect(exifTimeToUtc(wallClock, "-05:00", "Europe/Paris")?.toISOString()).toBe("2026-11-18T12:30:00.000Z");
    expect(exifTimeToUtc(wallClock, "+0100", "America/Toronto")?.toISOString()).toBe("2026-11-18T06:30:00.000Z");
  });

  it("falls back to the app's time zone", () => {
    expect(exifTimeToUtc(wallClock, undefined, "America/Toronto")?.toISOString()).toBe("2026-11-18T12:30:00.000Z");
  });

  it("ignores invalid dates", () => {
    expect(exifTimeToUtc(new Date(Number.NaN), undefined, "America/Toronto")).toBeNull();
  });
});

describe("suspicious photo flags", () => {
  const windowStartsAt = new Date("2026-11-18T12:00:00Z");
  const now = new Date("2026-11-18T13:00:00Z");
  const base = { kind: "BEFORE" as const, windowStartsAt, beforeTakenAt: [], now };

  it("accepts photos taken during the job", () => {
    expect(photoFlagReason({ ...base, takenAt: new Date("2026-11-18T12:10:00Z") })).toBeNull();
  });

  it("does not flag photos without a capture time", () => {
    expect(photoFlagReason({ ...base, takenAt: null })).toBeNull();
  });

  it("flags old photos taken long before the time slot", () => {
    expect(photoFlagReason({ ...base, takenAt: new Date(windowStartsAt.getTime() - 30 * HOUR) })).toMatch(/30 hours before/);
    expect(photoFlagReason({ ...base, takenAt: new Date(windowStartsAt.getTime() - 2 * HOUR) })).toBeNull();
  });

  it("flags capture times in the future", () => {
    expect(photoFlagReason({ ...base, takenAt: new Date(now.getTime() + HOUR) })).toMatch(/future/);
  });

  it("flags after photos taken before the before photo", () => {
    const before = new Date("2026-11-18T12:20:00Z");
    expect(photoFlagReason({ ...base, kind: "AFTER", takenAt: new Date("2026-11-18T12:10:00Z"), beforeTakenAt: [before] })).toMatch(/earlier/);
    expect(photoFlagReason({ ...base, kind: "AFTER", takenAt: new Date("2026-11-18T12:40:00Z"), beforeTakenAt: [before, null] })).toBeNull();
  });
});
