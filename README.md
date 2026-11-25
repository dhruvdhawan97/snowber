# Snowber — Neighborhood Snow Clearing & Dispatch Platform

> **Course:** ECE1724 — *Special Topics in Software Engineering: Modern Full-Stack Web Development* (University of Toronto)
> **Original Project Proposal:** [PROPOSAL.md](./PROPOSAL.md) · **AI Usage Log:** [ai-session.md](./ai-session.md)

---

## 1. Team Information

| Name | Student Number | Preferred Email | Role / Focus Area |
| --- | --- | --- | --- |
| **Dhruv Dhawan** | `1002348952` | [d.dhawan@mail.utoronto.ca](mailto:d.dhawan@mail.utoronto.ca) | Homeowner Portal, Dynamic Pricing, Stripe Payments & Core Foundation |
| **Fuchun Chai** | `1003052082` | [fuchun.chai@mail.utoronto.ca](mailto:fuchun.chai@mail.utoronto.ca) | Cleaner Portal, S3 Pre-Signed Photo Pipeline, Verification & Earnings |
| **Cheng Zhao** | `1012816954` | [chan.zhao@mail.utoronto.ca](mailto:chan.zhao@mail.utoronto.ca) | Controller Dispatch Board, Matching Heuristic & Leaflet / OSRM Routing |
| **Qin Yang** | `1012711399` | [qin.yang@mail.utoronto.ca](mailto:qin.yang@mail.utoronto.ca) | Tool Library, Concurrency-Safe Rentals, Disputes & Workflow Integrity |

---

## 2. Motivation

Heavy winter snowstorms create an urgent, recurring coordination problem across Canadian residential neighborhoods. Municipal bylaws in cities such as Toronto require homeowners to clear snow and ice from sidewalks and driveways within 12 to 24 hours after a storm ends. For seniors, travellers, and residents living with mobility limitations, meeting that deadline is both a physical hazard and a legal obligation. At the same time, students and local gig workers living in the same neighborhood want flexible storm-day income, yet lack snow blowers, a reliable customer list, or clustered routes that make walking between jobs worthwhile.

Existing options leave a wide gap:

1. **Seasonal Commercial Contracts ($600–$1,500+ per winter):** Priced for full-season retainers, inflexible for occasional storms, and slow to prioritize small residential driveways.
2. **Informal Peer-to-Peer Posts (Nextdoor, Craigslist, neighborhood chats):** Lack standardized pricing, equipment access, route batching, and proof of completion. Cleaners lose half their shift walking across scattered streets, while homeowners risk no-shows or paying before seeing a cleared driveway.

**Snowber** ("Snow Neighbor") closes this gap by combining neighborhood labor, shared equipment lending, and human-in-the-loop central dispatch. Homeowners book by driveway size and acceptable time windows; cleaners post shifts and reserve neighborhood snow blowers or spreaders; a Central Office Controller batches nearby homes into walking routes; and payouts are gated on timestamp-verified **before** and **after** photos.

---

## 3. Objectives

Our goal was to design, build, and test a production-grade, role-based web platform that manages residential snow clearing from storm forecast to verified payout:

1. **Deliver tailored workflows for three stakeholder roles:**
   - **Homeowners (`/homeowner`):** Geocode residential properties, receive transparent server-calculated quotes, pay securely via Stripe Checkout, follow job progress live, inspect side-by-side before/after photos, and confirm or dispute completed work.
   - **Cleaners (`/cleaner`):** Post shift availability, reserve shared snow-clearing equipment, follow a mobile-first step-by-step field UI designed for gloved hands, upload camera photos directly to cloud object storage, track ledger balances, and exchange reviews.
   - **Controllers (`/controller`):** Open storm service windows with surge multipliers, match requested jobs onto available cleaners on an interactive neighborhood map, manage tool check-outs/returns, adjudicate disputes, and audit system health.
2. **Guarantee financial and scheduling integrity under concurrency:** Enforce job and rental lifecycles through pure state machines backed by PostgreSQL exclusion constraints, row locks, advisory locks, compare-and-set updates, and an append-only financial ledger.
3. **Protect privacy and keep binary payloads off the app server:** Upload images straight from the cleaner's browser to private S3-compatible storage via short-lived pre-signed URLs, then strip GPS/EXIF metadata and generate WebP derivatives server-side.
4. **Ensure zero-friction local development and testability:** Wrap external services (S3, Stripe, OpenStreetMap Nominatim, OSRM) behind clean TypeScript interfaces with deterministic local fallbacks so every workflow runs offline and in automated tests.

---

## 4. Technical Stack and Architecture

### 4.1 Technology Choices

| Layer | Technology | Purpose |
| --- | --- | --- |
| **Full-Stack Framework** | Next.js `16.4.5` (App Router) + React `19.3` | Server Components for data loading, Server Actions for mutations, Route Handlers for webhooks/SSE/cron |
| **Language & Validation** | TypeScript `5` (strict) + Zod `4` | End-to-end static typing from Prisma models to UI props, with runtime input validation on every action |
| **Styling & UI** | Tailwind CSS `v4` + `shadcn/ui` (Radix UI) + Lucide | Accessible, responsive desktop dashboards and 360 px mobile cleaner views with light/dark themes |
| **Database & ORM** | PostgreSQL `16` + Prisma `7` (`@prisma/adapter-pg`) | Relational persistence, interactive ACID transactions, GiST time-range exclusion constraints, row/advisory locks |
| **Authentication** | Better Auth `1.7` | Email/password sessions, custom user profile fields, role-based access control, instant session revocation |
| **Cloud Object Storage** | AWS SDK v3 (`@aws-sdk/client-s3`, `s3-request-presigner`) | Pre-signed `PUT` and `GET` URLs against AWS S3, Cloudflare R2, or S3-compatible storage (plus HMAC local driver) |
| **Image Pipeline** | `sharp` + `exif-reader` | EXIF timestamp extraction, auto-orientation, metadata/GPS stripping, and 1600 px / 400 px WebP compression |
| **Payments** | Stripe SDK (`stripe` `v23`) | Stripe Checkout (card, Apple Pay, Google Pay), idempotent webhook + return handling, full/partial refunds |
| **Maps & Geospatial** | Leaflet (`react-leaflet` `v5`), Nominatim, OSRM | Address geocoding, service-zone bounds check, interactive dispatch map, road-network stop ordering |
| **Live Updates** | Server-Sent Events (`/api/events`) | Audience-scoped push notifications refreshing homeowner, cleaner, and controller views without polling |
| **Testing** | Vitest `5` + Playwright | 87 fast unit tests, 17 real-PostgreSQL cross-role integration tests, and 360 px headless browser verification |

### 4.2 Architectural Approach: Unified Next.js Full-Stack

We selected a unified **Next.js App Router** architecture over separate React SPA and Express REST repositories. Supporting three distinct roles across bookings, shifts, dispatch, tool rentals, photos, payments, and disputes requires dozens of mutations and queries. Keeping Server Components, Server Actions (`src/app/actions/`), Route Handlers (`src/app/api/`), and our Data Access Layer (`src/lib/dal/`) inside one TypeScript project eliminated duplicate DTO definitions, client-side fetch boilerplate, and cross-origin session configuration while enforcing `import "server-only"` boundaries so database and secret-key modules can never leak into client bundles.

```
+-----------------------------------------------------------------------------------+
|                        Client Browsers (Desktop & 360 px Mobile)                  |
|   [Homeowner Portal]           [Cleaner Mobile UI]         [Controller Dashboard] |
|    /homeowner/*                  /cleaner/*                  /controller/*        |
+----------+----------------------------+---------------+-----------------+---------+
           |                            |               |                 |
           | RSC / Server Actions       | Direct HTTPS  | SSE Stream      | RSC / Actions
           | & Stripe Redirect          | PUT / GET     | (/api/events)   | & Leaflet Map
           v                            | (Pre-signed)  v                 v
+---------------------------------------+---------------+---------------------------+
|                       Next.js 16 Full-Stack Server (App Router)                   |
|  - Auth & RBAC: Better Auth + requireRole() (pages/actions) + assertRole() (DAL)  |
|  - Pure Domain Contracts: job-states.ts · rental-states.ts · pricing.ts · schemas |
|  - Data Access Layer (src/lib/dal/*): jobs, photos, shifts, dispatch, rentals     |
|  - Route Handlers: /api/stripe/webhook · /api/cron/auto-confirm · /api/health     |
+------------------+------------------------------------+-----------------+---------+
                   |                                    |                 |
   Prisma 7 + pg   |                     AWS SDK v3 /   |                 | HTTPS APIs
   ($transaction)  v                     sharp + EXIF   v                 v
     +-------------------------------+    +-----------------------+   +-------------+
     |      PostgreSQL Database      |    |  Private S3 / R2      |   | Stripe API  |
     | - Users, Properties, Windows  |    |  Object Storage       |   | Nominatim   |
     | - Jobs, Shifts, JobPhotos     |    |  (1600px & 400px WebP)|   | OSRM Engine |
     | - Tools, ToolRentals, Ledger  |    |  [or ./.storage HMAC] |   +-------------+
     | - GiST Exclusion Constraints  |    +-----------------------+
     +-------------------------------+
```

### 4.3 Database & Concurrency Design

All schema definitions live in `prisma/schema.prisma`, augmented by raw SQL constraints in `prisma/migrations/20261106000100_time_range_constraints/migration.sql` for invariants Prisma's declarative syntax cannot express:

- **Core Entities:** `User` (with `HOMEOWNER`, `CLEANER`, `CONTROLLER` roles, cleaner start coordinates, `ownsBlower`, and senior/accessibility discount fields), `Property`, `ServiceWindow`, `Shift`, `Job`, `JobPhoto`, `Review`, `Payment`, `Tool`, `ToolRental`, and an append-only `LedgerEntry` table (`@@unique([jobId, type])`, `@@unique([rentalId, type])`) so a job can never credit a cleaner twice and a rental can never charge twice.
- **Database-Enforced Non-Overlap:** PostgreSQL `btree_gist` exclusion constraints reject overlapping shifts for the same cleaner (`Shift_no_overlap`) and overlapping `APPROVED` rentals for the same tool (`ToolRental_no_overlap`), even when two requests execute simultaneously.
- **Lock-Ordered & Compare-and-Set Transactions:**
  - `applyTransition` (`src/lib/dal/jobs.ts`) is the single entry point for job status updates and finishes with `updateMany({ where: { id, status: priorStatus } })`, preventing lost updates.
  - Assigning a job calls `lockCoveringShift` (`SELECT id FROM "Shift" ... FOR UPDATE`), preventing a cleaner from deleting their shift mid-assignment, and `lockBlowerFor` (`FOR SHARE`), preventing cancellation of an approved snow-blower rental that a large-driveway job relies on.
  - `assignJobs` (`src/lib/dal/dispatch.ts`) serializes batch assignments per window via `pg_advisory_xact_lock` and re-verifies cleaner capacity against live database state.
  - `transitionRental` (`src/lib/dal/rentals.ts`) always locks `Tool` before `ToolRental` to prevent deadlocks against concurrent tool maintenance changes.

### 4.4 Cloud Storage & Verification Pipeline

Storing multi-megabyte smartphone photos in PostgreSQL bloats backups and degrades query performance; streaming them through Next.js wastes server memory. Instead, `src/lib/storage.ts` defines a `StorageDriver` interface with two implementations (`s3` and `local`):

1. **Pre-Signed Upload (`requestPhotoUpload`):** Verifies the caller is the job's assigned cleaner, the job is in the matching state (`ASSIGNED` for `BEFORE`, `IN_PROGRESS` for `AFTER`), and fewer than 3 photos exist for that step. It signs a 5-minute `PUT` URL with `Content-Type` locked into `signableHeaders` and `requestChecksumCalculation: "WHEN_REQUIRED"` for browser compatibility.
2. **Server-Side Finalization (`finalizePhoto`):** After the browser `PUT`s directly to S3 via XHR (with upload progress), the server verifies byte size ($\le 15\text{ MB}$), parses `DateTimeOriginal` / `OffsetTimeOriginal` via `exif-reader`, uses `sharp` to auto-orient, strip all EXIF/GPS metadata, and write `1600 px` display and `400 px` thumbnail WebP objects, deletes the original upload, and records `JobPhoto` idempotently using the object UUID.
3. **Private Viewing (`listJobPhotos`):** The bucket remains private; authorized viewers (`HOMEOWNER` of the job, assigned `CLEANER`, or `CONTROLLER`) receive 15-minute pre-signed `GET` URLs.

---

## 5. Features

### 5.1 Core Platform Capabilities

- **Homeowner Portal (`/homeowner`):** Geocoded property registration with Toronto neighborhood boundary validation; 3-step booking wizard (property $\rightarrow$ multiple acceptable time windows & extras $\rightarrow$ server-computed quote & tip); senior and accessibility 20% discount applications (platform-absorbed so cleaner pay is unaffected); live job timeline; side-by-side before/after photo lightbox; one-click confirmation or dispute filing; and cleaner star ratings.
- **Cleaner Mobile Portal (`/cleaner`):** Shift posting up to 30 days ahead with one-tap open-window presets; equipment rental requests aligned to shifts; glove-friendly 56 px sticky-bar workflow (`Directions` $\rightarrow$ `Take before photo` $\rightarrow$ `Start clearing` $\rightarrow$ `Take after photo` $\rightarrow$ `Mark job done`); append-only earnings summary (80% of pre-discount job price + 100% of tips minus tool rental fees); and bidirectional property/homeowner reviews.
- **Controller Operations Dashboard (`/controller`):** Storm service-window creation with surge multipliers ($0.5\times\text{–}3.0\times$); visual dispatch board with automatic matching suggestions, drag-and-drop assignment, capacity bars, blower eligibility gating, and route reordering; tool inventory lifecycle (`AVAILABLE`, `MAINTENANCE`, `RETIRED`), check-out/check-in, and overdue tracking; dispute adjudication (pay cleaner or refund homeowner); user management/deactivation; and automated workflow integrity checks.

### 5.2 Fulfillment of Course Advanced Feature Categories

To ensure clean evaluation, external APIs are grouped under a single category rather than double-counted:

1. **User Authentication & Role-Based Authorization:** Better Auth session management across `HOMEOWNER`, `CLEANER`, and `CONTROLLER` roles. Every protected page and Server Action enforces `requireRole()`, and every DAL function independently enforces `assertRole()` plus resource-ownership checks (`ensureCanView`). Deactivating a user revokes active sessions immediately while preserving historical jobs and ledger entries.
2. **External API Integrations (Stripe + Geospatial Services):**
   - *Stripe Checkout & Refunds:* Supports card, Apple Pay, and Google Pay in test mode. Jobs are materialized only after payment confirmation (via return page or signed `/api/stripe/webhook`, deduplicated with an advisory lock). Cancellations and assignments into cheaper windows automatically issue full or partial Stripe refunds.
   - *OpenStreetMap Nominatim, Leaflet & OSRM:* Property addresses are geocoded via Nominatim; open requests and color-coded cleaner routes render on a `react-leaflet` map; and `reorderRoute` queries OSRM's `/table/v1/` matrix API (configured with a Toronto pedestrian graph) to sequence stops by walking travel time, gracefully falling back to local Haversine nearest-neighbor ordering if OSRM is unreachable.
3. **File Handling & Server-Side Image Processing:** Direct browser-to-S3 pre-signed `PUT` uploads, server-side `sharp` decoding, orientation normalization, GPS/metadata stripping for worker privacy, dual-resolution WebP transcoding, and automated EXIF capture-time verification that flags photos taken $>12\text{ hours}$ before the window, in the future, or with an `AFTER` timestamp earlier than `BEFORE`.
4. **Real-Time Updates & Scheduled Background Processing:** In-process event bus streaming audience-filtered Server-Sent Events (`/api/events`) that trigger Next.js `router.refresh()` on status, photo, shift, and dispatch updates, paired with a bearer-authenticated cron endpoint (`POST /api/cron/auto-confirm`) that auto-confirms and pays out uncontested `COMPLETED` jobs after 24 hours.

---

## 6. User Guide

After seeding (`npm run db:seed`), sign in at `/sign-in` using password **`snowber-demo`** (or click the one-tap demo buttons when `NEXT_PUBLIC_DEMO_LOGINS="true"`):

| Demo Account | Role | Pre-loaded Scenario |
| --- | --- | --- |
| `grace.home@snowber.test` | Homeowner | Registered properties, active bookings, a completed job awaiting photo confirmation, and an open dispute |
| `henry.home@snowber.test` | Homeowner | Approved 20% senior discount applied automatically at checkout |
| `isla.home@snowber.test` | Homeowner | Pending accessibility discount awaiting controller approval |
| `ava.cleaner@snowber.test` | Cleaner | Assigned tomorrow jobs, posted shifts, an approved snow-blower rental, completed earnings, and 5.0★ reviews |
| `ben.cleaner@snowber.test` | Cleaner | In-progress job with `BEFORE` photo already uploaded |
| `controller@snowber.test` | Controller | Open storm windows, 11 waiting dispatch jobs, tool requests (including a schedule clash & overdue tool), and a dispute |

### 6.1 Homeowner Guide

1. **Add a Property (`/homeowner/properties/new`):** Enter a street address in the Toronto service zone, pick a driveway size preset (*Small — 1-car*, *Medium — 2-car*, or *Large — 3+ car / corner lot*, which automatically marks `requiresBlower`), toggle sidewalk presence, and save.
2. **Apply for a Discount (`/homeowner/discounts`):** Seniors and residents with accessibility needs can request a 20% discount; no medical details are collected. Once approved by a controller, the discount applies automatically to future bookings.
3. **Book Snow Clearing (`/homeowner/book`):**
   - **Step 1 (Property):** Choose a saved property.
   - **Step 2 (Time & extras):** Select one or more acceptable open storm windows, optional sidewalk clearing ($10) or de-icing salt ($8), an optional cleaner tip, and access notes.
   - **Step 3 (Review & Pay):** Inspect the server-calculated quote:
     $$\text{Price} = (\text{Lot Base} + \text{Add-ons}) \times \text{Window Multiplier} \times \text{Timing Factor} - \text{Discount}$$
     If you select multiple windows, you are authorized at the highest-priced window and automatically refunded the difference if assigned to a lower-rate slot. Complete payment via Stripe Checkout (or instant simulated payment in local dev).

![Homeowner Booking Wizard](./docs/screenshots/homeowner-booking.png)

4. **Track Jobs & Verify Before/After Photos (`/homeowner` & `/homeowner/jobs/[id]`):** Watch the status badge advance live (`Requested` $\rightarrow$ `Assigned` $\rightarrow$ `In progress` $\rightarrow$ `Awaiting confirmation`). Open a finished job to inspect timestamped **Before** and **After** photos side by side (click either photo to zoom in the lightbox). Click **Looks good — confirm** to release the cleaner's payout and leave a 1–5★ review, or click **Report a problem** to open a dispute for controller review.

![Homeowner Dashboard](./docs/screenshots/homeowner-dashboard.png)

![Homeowner Before and After Photo Verification](./docs/screenshots/homeowner-verification.png)

### 6.2 Cleaner Guide

1. **Post Shift Availability (`/cleaner/shifts`):** Tap any open storm window preset to pre-fill dates/times (or enter a custom window up to 12 hours long and 30 days ahead) and click **Post shift**. Overlapping shifts are blocked automatically; future shifts without assigned jobs can be removed.
2. **Reserve Equipment (`/cleaner/tools`):** Browse available shovels, snow blowers, and salt spreaders. Tap one of your shifts to fill the rental times and submit a request. Once approved by the controller, you can take large-driveway jobs during that window.
3. **Complete Assigned Jobs on Mobile (`/cleaner/jobs/[id]`):** Open an assigned stop (ordered by `stop 1`, `stop 2`, …) and use the sticky 56 px bottom action bar:
   - Tap **Directions** to open turn-by-turn navigation, then **Take before photo** to launch your phone's rear camera and upload up to 3 before photos.
   - Tap **Start clearing** (enabled only once a `BEFORE` photo exists; notifies the homeowner live).
   - After clearing, tap **Take after photo**, then **Mark job done** and confirm.
4. **Track Earnings & Reviews (`/cleaner/earnings`):** View your net ledger balance, 7-day earnings, payouts awaiting homeowner confirmation, upcoming assigned job value, 30-day ledger entries (job credits and tool rental fees), and homeowner reviews. Once a job is confirmed, leave a review for the property/homeowner on the job page.

| Cleaner Guided Mobile Job Flow (390 px) | Cleaner Earnings & Reviews |
| :---: | :---: |
| ![Cleaner Mobile Job Workflow](./docs/screenshots/cleaner-mobile-job.png) | ![Cleaner Earnings and Reviews](./docs/screenshots/cleaner-earnings.png) |

### 6.3 Controller Guide

1. **Open Storm Time Slots (`/controller/windows`):** Create booking windows (e.g., *Early birds 6–8 a.m.*, $1.5\times$ surge multiplier) and close slots once capacity is reached.
2. **Dispatch Cleaners & Optimize Routes (`/controller/dispatch`):** Select a time slot at the top. Click **Suggest** to run the matching heuristic (which respects shift coverage, remaining minutes, snow-blower availability, walking distance, and cleaner ratings) and **Apply** the batch, or drag individual job cards onto cleaner columns. Reorder unstarted stops with the up/down arrows and verify color-coded routes on the Leaflet map.

![Controller Dispatch Board and Route Map](./docs/screenshots/controller-dispatch.png)

3. **Manage Tool Library (`/controller/tools`):** Add equipment, toggle status between *In service*, *Out for repair*, and *Retired*, approve or decline cleaner rental requests (clashing requests are flagged in red and disabled), and check returned tools back in. Overdue rentals surface at the top with the cleaner's phone link.

![Controller Tool Library](./docs/screenshots/controller-tools.png)

4. **Resolve Disputes & Audit System Health (`/controller/disputes`, `/controller/users`, `/controller`):** Review disputed jobs alongside homeowner/cleaner contact links and EXIF photo verification flags, then either **Pay cleaner** or **Refund homeowner**. Approve discount requests and manage accounts on **Users**, and check the **Overview** page to confirm database connectivity and verify that all workflow integrity checks pass.

---

## 7. Development Guide

### 7.1 Prerequisites & Environment Setup

- **Node.js** `>= 20.19` (Node 22 LTS recommended) and **npm**
- **PostgreSQL** `14+` running locally (e.g., Homebrew `postgresql@16` or Docker)

Clone the repository, install dependencies (`postinstall` automatically generates the typed Prisma client into `src/generated/prisma`), and create `.env`:

```bash
git clone https://github.com/dhruvdhawan97/snowber.git
cd snowber
npm install
cp .env.example .env
```

Configure the required variables in `.env`:

```env
DATABASE_URL="postgresql://snowber:snowber@localhost:5432/snowber"
BETTER_AUTH_SECRET="<output of: openssl rand -base64 32>"
BETTER_AUTH_URL="http://localhost:3000"
STORAGE_DRIVER="local"
GEOCODER="nominatim"
CRON_SECRET="<output of: openssl rand -base64 32>"
```

### 7.2 Database Initialization

Apply all Prisma migrations (including the custom GiST time-range exclusion constraints), verify connectivity, and load the deterministic demo dataset:

```bash
npm run db:deploy    # apply all migrations in prisma/migrations/
npm run db:check     # verify PostgreSQL connection and migration status
npm run db:seed      # reset and seed 25 homeowners, 8 cleaners, 40 properties, shifts, tools, and WebP photos
```

### 7.3 Cloud Storage Configuration (`local` vs `s3`)

- **Local Development (`STORAGE_DRIVER="local"`, default):** Zero cloud credentials required. Files are stored under `./.storage` and served through `/api/storage/[...key]` using expiring HMAC-SHA256 signed `PUT` and `GET` URLs that enforce the exact same contract, byte-size cap, and MIME-type signature check as S3.
- **AWS S3 / Cloudflare R2 / MinIO (`STORAGE_DRIVER="s3"`):** Create a **private** bucket (keep public access blocked) and set in `.env`:
  ```env
  STORAGE_DRIVER="s3"
  S3_REGION="us-east-1"
  S3_BUCKET="snowber-photos"
  S3_ACCESS_KEY_ID="<your-access-key>"
  S3_SECRET_ACCESS_KEY="<your-secret-key>"
  # Leave empty for AWS S3; set https://<account-id>.r2.cloudflarestorage.com for R2
  S3_ENDPOINT=""
  S3_FORCE_PATH_STYLE="false" # set "true" for MinIO / SeaweedFS
  ```
  Because browsers `PUT` photos directly to object storage, add this CORS policy on the bucket:
  ```json
  [
    {
      "AllowedOrigins": ["http://localhost:3000", "https://your-production-domain.example"],
      "AllowedMethods": ["PUT", "GET"],
      "AllowedHeaders": ["Content-Type"],
      "MaxAgeSeconds": 3000
    }
  ]
  ```

### 7.4 Optional External Integrations (Stripe & OSRM)

- **Stripe Checkout (Test Mode):** Leave `STRIPE_SECRET_KEY` blank for simulated payments. To enable real Stripe Checkout (card `4242 4242 4242 4242`, Apple Pay, Google Pay), set `STRIPE_SECRET_KEY="sk_test_..."` and forward webhooks locally with `stripe listen --forward-to localhost:3000/api/stripe/webhook` (`STRIPE_WEBHOOK_SECRET="whsec_..."`).
- **OSRM Walking-Profile Routing:** Dispatch works out of the box using Haversine nearest-neighbor ordering. To enable street-network pedestrian travel-time ordering, extract a Toronto OpenStreetMap `.osm.pbf` with `/opt/foot.lua` in `ghcr.io/project-osrm/osrm-backend`, run `osrm-routed` on port `5001`, and set `OSRM_BASE_URL="http://localhost:5001"` (full Docker commands are preserved in [PROPOSAL.md](./PROPOSAL.md)).

### 7.5 Running Locally & Executing Tests

```bash
npm run dev          # start Next.js development server at http://localhost:3000
npm run typecheck    # generate Next.js route types and run tsc --noEmit
npm run lint         # run ESLint
npm test             # run 87 fast unit tests across 10 Vitest suites
```

To run the **17 cross-role PostgreSQL integration tests** (which test full storm-morning lifecycles, racing rental approvals, shift/blower locks, disputes, and the auto-confirm cron route against a real database), create a dedicated test database whose name contains `test` (enforced by a safety guard so demo/production data is never wiped):

```bash
createdb snowber_test
DATABASE_URL="postgresql://snowber:snowber@localhost:5432/snowber_test" npx prisma migrate deploy
TEST_DATABASE_URL="postgresql://snowber:snowber@localhost:5432/snowber_test" npm run test:integration
```

---

## 8. Deployment Information

- **Live Application URL:** Deployed for the course demonstration (set `BETTER_AUTH_URL` to the deployed HTTPS origin; update the repository's GitHub **About** URL or environment target as applicable).
- **Target Architecture:**
  - **Application Compute:** Node.js container / platform service (e.g., Railway, Render, DigitalOcean App Platform, or Vercel) running `npm run build` followed by `npx prisma migrate deploy && npm start`. Note that Server-Sent Events (`/api/events`) and `sharp` native binaries run cleanly on standard Node.js 22 runtimes.
  - **Managed Database:** Managed PostgreSQL 16 instance with the `btree_gist` extension enabled (applied automatically by our migration).
  - **Cloud Storage:** Private AWS S3 or Cloudflare R2 bucket configured with `STORAGE_DRIVER="s3"` and the CORS policy in Section 7.3.
  - **Health & Scheduled Jobs:** Readiness probes query `GET /api/health` (verifies database latency and applied migrations). A scheduler invokes `POST /api/cron/auto-confirm` with `Authorization: Bearer $CRON_SECRET` every 15 minutes to auto-confirm stale completed jobs.

---

## 9. AI Assistance & Verification (Summary)

Our team used AI coding assistants selectively as an architectural sounding board, debugging partner, and test-case generator, while keeping schema contracts, security boundaries, and verification under human control. Concrete prompts, responses, and evaluations for three representative sessions are documented in **[ai-session.md](./ai-session.md)**.

- **Where AI Meaningfully Contributed:**
  1. *Concurrency & ER Critique ([Session 1](./ai-session.md#session-1-preventing-double-booked-shifts-and-tool-rentals-in-postgresql)):* Early critique of our ER diagram surfaced scheduling race conditions when two controllers approve overlapping snow-blower requests or cleaners post overlapping shifts simultaneously, motivating our `ToolRental` join table and PostgreSQL GiST exclusion constraints.
  2. *Storage Scaffolding & Edge-Case Tests ([Session 2](./ai-session.md#session-2-diagnosing-aws-sdk-v3-pre-signed-put-failures-400-baddigest-and-unsigned-content-type)):* Accelerating the dual-driver storage interface, EXIF timezone conversion helpers, and Vitest unit/integration test cases.
  3. *Dispatch Transaction Locking ([Session 3](./ai-session.md#session-3-closing-the-shift-removal-vs-job-assignment-race-condition)):* Reviewing write-skew edge cases between concurrent shift deletion and job assignment under `READ COMMITTED` isolation, leading to explicit row-level lock ordering.
- **Representative Limitation / Mistake in AI Output ([Session 2](./ai-session.md#session-2-diagnosing-aws-sdk-v3-pre-signed-put-failures-400-baddigest-and-unsigned-content-type)):**
  When implementing direct browser-to-S3 uploads with `@aws-sdk/client-s3` v3, AI-generated presigning code used default `S3Client` settings without `signableHeaders`. In real S3-compatible testing, browser `PUT` requests failed with `400 BadDigest` because AWS SDK v3 automatically embeds an `x-amz-checksum-crc32` parameter calculated for an empty body into presigned URLs, and omitted `content-type` from `SignedHeaders` (allowing mismatched MIME uploads). Inspecting the raw presigned query string and testing against a live S3 gateway exposed both flaws; we fixed them by setting `requestChecksumCalculation: "WHEN_REQUIRED"`, `responseChecksumValidation: "WHEN_REQUIRED"`, and `signableHeaders: new Set(["content-type"])` in `src/lib/storage.ts`. Additional AI errors — such as using `tstzrange` on `TIMESTAMP WITHOUT TIME ZONE` columns and omitting `WHERE (status = 'APPROVED')` ([Session 1](./ai-session.md#session-1-preventing-double-booked-shifts-and-tool-rentals-in-postgresql)), as well as omitting `FOR UPDATE` shift row locks ([Session 3](./ai-session.md#session-3-closing-the-shift-removal-vs-job-assignment-race-condition)) — are documented in [ai-session.md](./ai-session.md).
- **How Correctness Was Verified:**
  1. **Automated Unit Tests (`npm test`):** 87 Vitest assertions covering job and rental state machines, dynamic pricing/refund math, HMAC URL tampering/expiry, EXIF timestamp flagging rules, matching heuristics, and OSRM timeouts/fallbacks.
  2. **Database Integration Tests (`npm run test:integration`):** 17 Vitest tests executing against a real PostgreSQL instance, including `Promise.all` concurrent rental approvals proving `ToolRental_no_overlap` rejects double-booking and end-to-end storm-morning payout assertions.
  3. **Browser & Storage E2E Verification:** Headless Chromium (Playwright) runs at a 360 px mobile viewport against both `STORAGE_DRIVER="local"` and a live S3-compatible container (SeaweedFS), confirming zero console errors, direct cross-origin `PUT` uploads, EXIF flagging, lightbox viewing, and ledger updates.
  4. **Static & Runtime Invariant Checks:** Strict `tsc --noEmit`, ESLint, and `runIntegrityChecks()` on `/controller` auditing ledger-to-status consistency.

---

## 10. Individual Contributions

Each team member owned an end-to-end vertical slice spanning Next.js UI, Server Actions, DAL transactions, Prisma queries, and automated tests, aligning directly with our Git commit and PR history:

- **Dhruv Dhawan (`dhruvdhawan97` — Commit `e20d29d`):**
  Architected the initial Next.js 16 + Prisma 7 project foundation, database schema, and PostgreSQL GiST/CHECK constraint migration (`20261106000100_time_range_constraints`); implemented Better Auth sign-up/sign-in and RBAC helpers, Nominatim property geocoding with Toronto zone validation, the server-side pricing engine (`src/lib/pricing.ts`), the 3-step homeowner booking wizard, Stripe Checkout + webhook + refund handling (`src/lib/payments.ts`), senior/accessibility discount requests and approvals, controller time-slot and user management, SSE live-update infrastructure (`/api/events`), and unit tests for job states, pricing, and geo/time utilities.
- **Fuchun Chai (`fuchunchai` — PRs `#1`, `#2` `ad534f4`, `#3` `57bfb84`, `#8` `98494cb`):**
  Built the dual-driver cloud storage layer (`src/lib/storage.ts` for S3/R2 presigned URLs and `/api/storage/[...key]` for HMAC-signed local storage) and the `sharp` + `exif-reader` photo verification pipeline (`src/lib/photo-rules.ts`, `src/lib/dal/photos.ts`); implemented the mobile-first 5-step cleaner job workflow (`/cleaner/jobs/[id]`), shared `<JobPhotos>` lightbox component on homeowner/cleaner/controller views, cleaner shift availability CRUD (`/cleaner/shifts`) with `FOR UPDATE` shift-coverage locking during assignment (`lockCoveringShift`), cleaner earnings ledger dashboard (`/cleaner/earnings`), cleaner-to-homeowner reviews, unit tests (`photo-rules`, `storage-signing`, `earnings-shifts`), and consolidated project documentation.
- **Cheng Zhao (`chengzhao363` — PRs `#6` `3766383`, `#7` `295e664` & `602f17c`, Commit `adeefad`):**
  Implemented the Controller Dispatch board (`/controller/dispatch`) featuring drag-and-drop and batch job assignment, cleaner capacity tracking, and snow-blower eligibility filtering; built the interactive `react-leaflet` route map (`src/components/map/`), the multi-factor cleaner-to-job matching heuristic (`src/lib/matching.ts`), advisory-locked batch assignment and manual stop reordering (`src/lib/dal/dispatch.ts`), optional OSRM walking-profile road-network route optimization with nearest-neighbor fallback (`src/lib/osrm.ts`), unit and PostgreSQL integration tests (`matching.test.ts`, `osrm.test.ts`, `tests/integration/dispatch.test.ts`), and Docker OSRM setup documentation.
- **Qin Yang (`ProgrammerQin` — PR `#5` `9404192`):**
  Built the Controller Tool Library (`/controller/tools`) and Cleaner Tool Rental portal (`/cleaner/tools`); designed the pure rental state machine (`src/lib/contracts/rental-states.ts`) and deadlock-free lock-ordered rental DAL (`src/lib/dal/rentals.ts`) with automatic ledger fee charges and cancellation refunds; enforced `FOR SHARE` snow-blower coverage locks when assigning large-driveway jobs; implemented controller dispute resolution (`/controller/disputes`), the bearer-protected 24-hour auto-confirm cron endpoint (`/api/cron/auto-confirm`), the runtime workflow integrity checker (`src/lib/dal/integrity.ts`), and the cross-role PostgreSQL integration test suite (`tests/integration/`).

---

## 11. Lessons Learned and Concluding Remarks

1. **Enforce Invariants in the Database, Not Just the UI:** Disabling a button in React never stops two concurrent tabs or webhooks from racing. Combining pure TypeScript state machines (fast to unit-test in milliseconds) with PostgreSQL GiST exclusion constraints, `FOR UPDATE` / `FOR SHARE` row locks, and compare-and-set `updateMany` clauses caught real race conditions across shifts, tool rentals, and Stripe webhook/redirect completion.
2. **Schema-First Contracts Unlock Parallel Teamwork:** Agreeing on `prisma/schema.prisma`, `job-states.ts`, and `transitionJob` in Week 1 let four developers build booking, mobile photo verification, geospatial dispatch, and equipment rentals in parallel branches with minimal merge friction.
3. **Local Fallbacks Multiply Developer Velocity:** Wrapping S3, Stripe, Nominatim, and OSRM behind narrow interfaces with realistic local drivers meant every teammate—and every Vitest run—could exercise the entire storm-day lifecycle offline without sharing cloud keys or hitting rate limits, while still verifying real S3 and Stripe flows before release.
4. **Design for Real-World Context and Privacy:** Thinking about cleaners working outdoors in winter pushed us toward 56 px sticky bottom controls and tolerance for missing camera EXIF (flagging anomalies for human controller review rather than stranding a cleaner in the snow), while stripping GPS metadata via `sharp` protected worker privacy before photos ever reached homeowners.

Snowber demonstrates how modern full-stack TypeScript, relational concurrency primitives, and direct-to-cloud media pipelines can turn an informal neighborhood chore into a reliable, accountable community service.
