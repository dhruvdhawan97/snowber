# AI Interaction Record (`ai-session.md`)

This document provides concrete evidence supporting **Section 9 (AI Assistance & Verification)** of [README.md](./README.md). Below are three representative AI sessions that meaningfully influenced Snowber's database constraints, cloud storage security, and transactional concurrency—illustrating what was useful, where AI output was flawed or incomplete, and how our team verified and corrected each design.

---

## Session 1: Preventing Double-Booked Shifts and Tool Rentals in PostgreSQL

### Prompt

```text
We are designing our Prisma + PostgreSQL schema for Snowber. Cleaners post Shift rows
(cleanerId, startsAt, endsAt), and cleaners also request ToolRental rows (toolId, cleanerId,
startsAt, endsAt, status) that a controller approves. Critique this design for concurrency
bugs: what happens if two controllers click "Approve" on overlapping snow-blower requests at
the exact same millisecond, or a cleaner submits two overlapping shifts? How should we
prevent this in Prisma?
```

### AI Response (Trimmed)

```text
Good catch — checking for overlaps in application code with `prisma.toolRental.findFirst`
followed by `prisma.toolRental.update` has a classic TOCTOU race condition under PostgreSQL's
default READ COMMITTED isolation level. Two concurrent transactions will both see zero
approved overlaps, and both updates will commit.

Recommended fix: use PostgreSQL's `btree_gist` extension and `EXCLUDE USING gist` constraints
in a custom SQL migration, since Prisma's schema DSL only supports `@@unique` on exact column
equality:

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_no_overlap"
  EXCLUDE USING gist ("cleanerId" WITH =, tstzrange("startsAt", "endsAt") WITH &&);

ALTER TABLE "ToolRental"
  ADD CONSTRAINT "ToolRental_no_overlap"
  EXCLUDE USING gist ("toolId" WITH =, tstzrange("startsAt", "endsAt") WITH &&);
```

### What Your Team Did With It

- **What was useful:** Confirming that application-level `findFirst` checks under `READ COMMITTED` cannot stop concurrent double-bookings, and pointing us to PostgreSQL `btree_gist` exclusion constraints (`WITH =` combined with range overlap `WITH &&`) inside a hand-written Prisma migration.
- **What was incorrect and incomplete:**
  1. *Wrong PostgreSQL range function for Prisma:* Prisma's `DateTime` type maps to `TIMESTAMP(3) WITHOUT TIME ZONE` unless `@db.Timestamptz` is specified, so `tstzrange("startsAt", "endsAt")` fails in PostgreSQL with `function tstzrange(timestamp without time zone, timestamp without time zone) does not exist`. It required `tsrange(...)`.
  2. *Missing partial predicate on `ToolRental`:* Applying an unconditional exclusion constraint on `ToolRental` blocked cleaners from even *submitting* overlapping `REQUESTED` rows—and blocked new requests when an older overlapping row was `REJECTED`, `CANCELLED`, or `RETURNED`. Only `APPROVED` reservations should lock out overlapping intervals.
- **How our team verified and modified it:**
  - Wrote `prisma/migrations/20261106000100_time_range_constraints/migration.sql` using `tsrange("startsAt", "endsAt")` and added `WHERE (status = 'APPROVED')` to `ToolRental_no_overlap`, plus `CHECK ("endsAt" > "startsAt")` sanity constraints so empty/inverted ranges cannot bypass GiST checks.
  - Added `isExclusionViolation(error, constraintName)` in `src/lib/errors.ts` (matching PostgreSQL SQLSTATE `23P01`) to return clear user-facing conflict errors, and disabled clashing requests visually on `/controller/tools`.
  - Verified behavior against a real PostgreSQL database in `tests/integration/rentals.test.ts` using `Promise.all([transitionRental(reqA, "APPROVED"), transitionRental(reqB, "APPROVED")])`, asserting that exactly one approval succeeds and the other rejects with `CONFLICT`.

---

## Session 2: Diagnosing AWS SDK v3 Pre-Signed `PUT` Failures (`400 BadDigest`) and Unsigned `Content-Type`

### Prompt

```text
Generate a TypeScript S3 storage driver using `@aws-sdk/client-s3` and
`@aws-sdk/s3-request-presigner` so a cleaner's phone browser can PUT a JPEG/PNG/WebP photo
directly to a private S3 or Cloudflare R2 bucket with a 5-minute presigned URL, and also give
us a local filesystem fallback with the same interface for local development.
```

### AI Response (Trimmed)

```ts
const client = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

export async function presignPut(key: string, contentType: string, expiresIn = 300) {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET!,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn });
}
```

### What Your Team Did With It

- **What was useful:** The unified `StorageDriver` interface (`presignPut`, `presignGet`, `head`, `get`, `put`, `remove`) cleanly decoupled `src/lib/dal/photos.ts` from storage vendors and inspired our HMAC-SHA256 signed local route (`/api/storage/[...key]`) so local development followed the exact same presigned-URL flow as production S3.
- **What was incorrect and insecure:**
  1. *`400 BadDigest` on browser uploads:* Recent versions of `@aws-sdk/client-s3` (`v3.729+`, we use `^3.1163.0`) enable automatic default CRC32 request checksums. When presigning a `PutObjectCommand` with no `Body`, the SDK embeds `x-amz-checksum-crc32=AAAAAA==` (the checksum of an empty 0-byte payload) into the signed URL. When the browser `PUT`s an actual photo, S3/R2/SeaweedFS rejects it with `400 BadDigest`.
  2. *`Content-Type` was not enforced by the S3 signature:* Even though `ContentType` was passed to `PutObjectCommand`, `@aws-sdk/s3-request-presigner` only placed `X-Amz-SignedHeaders=host` in the signature by default—allowing a caller holding a valid URL to `PUT` an arbitrary `Content-Type` (whereas our local HMAC driver strictly rejected mismatched `Content-Type` headers).
  3. *Missing `forcePathStyle`:* Local S3-compatible test servers (MinIO / SeaweedFS) failed DNS resolution on virtual-hosted bucket subdomains without `forcePathStyle`.
- **How our team verified and modified it:**
  - Ran a live S3-compatible server (`chrislusf/seaweedfs` S3 gateway on `localhost:8333`), inspected the raw presigned URL parameters, and updated `createS3Driver()` in `src/lib/storage.ts` with `requestChecksumCalculation: "WHEN_REQUIRED"`, `responseChecksumValidation: "WHEN_REQUIRED"`, `forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"`, and `signableHeaders: new Set(["content-type"])`.
  - Wrote smoke tests verifying that uploading with a mismatched `Content-Type` now returns `403 Forbidden`, added 14 unit tests in `tests/storage-signing.test.ts` for key traversal (`..`), expiry, and `timingSafeEqual` HMAC verification, and ran a full 360 px Playwright end-to-end flow under `STORAGE_DRIVER=s3` confirming zero requests hit `/api/storage`.

---

## Session 3: Closing the Shift-Removal vs. Job-Assignment Race Condition

### Prompt

```text
Our proposal feedback noted: "During implementation, verify that your dispatch transaction
prevents conflicting assignments." Review `applyTransition` in `src/lib/dal/jobs.ts` (case
"ASSIGNED") and `deleteShift` in `src/lib/dal/shifts.ts` — can a job still end up assigned to
a cleaner who has no shift covering the service window?
```

### AI Response (Trimmed)

```text
Yes, there are two gaps right now:

1. `applyTransition` checks that `window` exists and `cleaner.role === "CLEANER"`, and uses a
   compare-and-set `updateMany` on `job.status`, which stops two controllers from assigning
   the same job twice. However, it never queries `tx.shift` to verify the cleaner actually
   has a shift covering `[window.startsAt, window.endsAt]`.
2. In `deleteShift`, `prisma.job.count(...)` and `prisma.shift.delete(...)` run as separate
   queries outside a transaction. Even if you wrap them in `prisma.$transaction`, under READ
   COMMITTED isolation Transaction A (assigning a job) can read the Shift row while
   Transaction B (cleaner deleting the shift) sees `job.count === 0` and deletes the Shift —
   both transactions commit, leaving an ASSIGNED job with no shift!

Fix: take a `SELECT id FROM "Shift" WHERE ... FOR UPDATE` row lock on the covering shift in
both `applyTransition` and `deleteShift`.
```

### What Your Team Did With It

- **What was useful:** Identifying that wrapping `deleteShift` in a plain `READ COMMITTED` transaction without explicit row locking would *still* allow write skew between `tx.job.count` and `tx.job.delete`/`tx.shift.delete`, and showing how locking the shared `Shift` row serializes both operations.
- **What needed adaptation in our codebase:**
  - Prisma 7's `findFirst` API does not expose a native `FOR UPDATE` option, and running concurrent promises over a single interactive transaction client (`Promise.all` on `tx`) triggers a `pg` driver deprecation/concurrency warning because one database connection executes one query at a time.
  - Beyond shift coverage, large-driveway jobs (`requiresBlower: true`) had an analogous race if a cleaner cancelled their `APPROVED` snow-blower rental while a controller assigned them a large lot.
- **How our team verified and modified it:**
  - Implemented `lockCoveringShift(tx, cleanerId, window)` in `src/lib/dal/shifts.ts` sequentially finding the covering shift and issuing ``tx.$queryRaw`SELECT id FROM "Shift" WHERE id = ${shift.id} FOR UPDATE` ``, calling it inside `applyTransition` (`src/lib/dal/jobs.ts`) and acquiring the identical lock inside `deleteShift`.
  - Applied the same lock-ordering discipline in `src/lib/dal/rentals.ts` (`lockBlowerFor` taking `FOR SHARE` during assignment vs. `FOR UPDATE` in `transitionRental` when cancelling), plus `pg_advisory_xact_lock` per window in `assignJobs` (`src/lib/dal/dispatch.ts`) to prevent capacity overbooking across batch assignments.
  - Verified against PostgreSQL in `tests/integration/dispatch.test.ts` and `tests/integration/storm-morning.test.ts` that assigning without a covering shift or without blower coverage fails with `CONFLICT`, and succeeds once coverage exists.

---
