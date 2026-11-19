# Project Proposal: Snowber (Neighborhood Snow Clearing & Dispatch Platform)

> **Running the code?** Jump to [5. Development Guide](#5-development-guide) for setup, demo accounts,
> what each member has built, and where to plug in new features.

## Team Members

| Name | Student Number | Email |
| --- | --- | --- |
| Cheng Zhao | 1012816954 | chan.zhao@mail.utoronto.ca |
| Qin Yang | 1012711399 | qin.yang@mail.utoronto.ca |
| Fuchun Chai | 1003052082 | fuchun.chai@mail.utoronto.ca |
| Dhruv Dhawan | 1002348952 | d.dhawan@mail.utoronto.ca |

## 1. Motivation

### The Problem
In regions experiencing heavy winter snowfall, residential snow removal presents an urgent, recurring logistical challenge. Following a snowstorm, homeowners face strict municipal bylaws requiring sidewalks and driveways to be cleared within a narrow window (often 12 to 24 hours), alongside immediate safety and mobility hazards. Simultaneously, many local residents, students, and gig workers seek flexible seasonal income but lack the heavy equipment, customer base, or route coordination required to operate efficiently.

### Limitations of Existing Approaches
1. **Commercial Landscaping Contracts:** Seasonal retainers ($600–$1,500+) can be costly and inflexible for occasional residential clearing.
2. **Informal Peer-to-Peer Marketplaces:** Craigslist, Nextdoor, and social groups lack structured scheduling, pricing, accountability, and equipment support. Scattered bookings waste travel time, while homeowners risk no-shows and lack proof of completion.

### Stakeholders and Value Proposition
**Snowber** ("Snow Neighbor" / "Snow Uber") combines community labor, centralized dispatch, and equipment rental for three groups:
* **House Owners:** Book by driveway/walkway size and time slot, track progress, and verify completion through before/after photos.
* **Snow Cleaners:** Schedule shifts, rent tools (shovels, snowblowers, spreaders), follow neighborhood routes, and receive payouts.
* **Central Office Controllers (Dispatchers):** Match requests to cleaners, plan routes, manage equipment, and oversee quality.

Snowber improves winter accessibility, especially for seniors and residents with limited mobility, while offering flexible local work.

---

## 2. Objectives, Architecture, and Key Features

### Main Project Objectives and Core Functionality
Build a responsive, role-based web application managing snow-clearing jobs from request to verified payout:

1. **House Owner Portal:** Register geocoded properties and driveway/walkway sizes (Single Car, Double Car, Corner Lot Sidewalk); obtain pricing based on size category and time slot; select time slots, book, track progress, view before/after photos, pay, and review cleaners.
2. **Snow Cleaner Portal:** Post shift availability, reserve rental tools, view assigned routes on a map, upload timestamped before/after photos, track earnings, and review owners/property details.
3. **Central Office Controller Dashboard:** Review requests and available shifts, assign cleaners and grouped routes, manage tool check-out/returns/stock, and resolve disputes.

### Planned Application Architecture

#### Architectural Approach: Next.js Full-Stack
We chose **Next.js (App Router)** over separate React and Express applications to share TypeScript interfaces and Zod validation across three roles, simplify authentication and deployment, and avoid CORS configuration.

#### Main Components and Interactions
* **Presentation Layer:** React, Tailwind CSS, and **shadcn/ui** role-protected views (`/owner`, `/cleaner`, `/controller`); Server Components load dashboard data, and Client Components handle maps, uploads, and calendars.
* **Application / API Layer:** Next.js Route Handlers and Server Actions manage RBAC, pricing, matching, inventory, and external APIs.
* **Data Access Layer:** Prisma ORM + PostgreSQL provide type-safe queries, relational integrity, and atomic assignments.

```
+-----------------------------------------------------------------------+
|                     Client Browser (Mobile / Desktop)                 |
|  [House Owner UI]       [Snow Cleaner UI]       [Controller Dashboard]|
+---------+-----------------------+-------------------------+-----------+
          |                       | (Direct PUT via         |
          | (HTTPS / JSON)        |  Pre-signed URL)        |
          v                       v                         v
+---------------------------------+-------------------------+-----------+
|                 Next.js Full-Stack Server (App Router)                |
|  - Auth & RBAC Middleware       - Server Actions & API Route Handlers |
|  - Pricing & Matching Engine    - S3 Pre-signed URL Generator         |
+---------------------------------+-------------------------+-----------+
                                  |                         |
                 (Prisma Client)  |                         | (AWS SDK)
                                  v                         v
                    +---------------------------+   +-------------------+
                    |   PostgreSQL Database     |   |   Cloud Storage   |
                    | (Users, Jobs, Tools, etc.)|   | (Before/After Img)|
                    +---------------------------+   +-------------------+
```

#### Database Design
**PostgreSQL + Prisma ORM** support concurrent transactions, enums, and location data. Main entities:
* `User`: Credentials, role (`OWNER`, `CLEANER`, `CONTROLLER`), contact details, rating.
* `Property`: Owner, address, coordinates (`lat`, `lng`), `slotSize` (`SMALL`, `MEDIUM`, `LARGE`, `CUSTOM`).
* `ServiceRequest`: Property, owner, time window, price, assigned `CleanerShift`, and status (`PENDING`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `VERIFIED`).
* `CleanerShift`: Cleaner, availability, status, ordered assigned jobs.
* `Tool` / `ToolRental`: Equipment type, condition, stock, and shift-linked check-out/return times.
* `JobPhoto`: Request, `BEFORE`/`AFTER` type, cloud object key/URL, upload time.
* `Review`: Request, reviewer/reviewee, 1–5 rating, comment.

#### Cloud Storage Design
We will use **AWS S3** (or S3-compatible **Cloudflare R2**) to handle all "before" and "after" snow-clearing photos. Storing binary images directly in PostgreSQL degrades query performance and bloats database backups.
* **Workflow:** When a cleaner initiates a photo upload, the Next.js backend validates their active assignment and generates a short-lived (5-minute) **S3 Pre-signed PUT URL** using the AWS SDK, with the content type included in the signature. The client uploads the image file directly from the browser/phone to the S3 bucket.
* **Data Linkage:** Once the upload succeeds, the client invokes a Server Action that reads the EXIF capture time, strips all metadata (including GPS), stores resized WebP copies, and records the object keys, `kind` (`BEFORE` | `AFTER`), capture time, and any verification flag in the `JobPhoto` table linked to the job.
* **Access:** The bucket stays private. Pages receive short-lived pre-signed GET URLs, and only the homeowner, the assigned cleaner, and controllers can obtain them.

#### Important Frontend–Backend Interactions and Data Flows
1. **Booking & Pricing:** Properties store a size category, not an area. For size base $B$ (Single Car \$30, Double Car \$45, Corner Lot \$65), add-ons $a$ (sidewalk, salt), window rate $w$, timing factor $t$ (urgent bookings cost more, early bookings less), and discount $d$ (seniors / accessibility), the server computes:
   $$P = (B + a) \times w \times t - d$$
   Booking creates a `REQUESTED` job.
2. **Dispatch & Tool Reservation:** Controller views pending requests and available shifts, then assigns grouped jobs and equipment. A Prisma `$transaction` schedules requests, saves route order, creates `ToolRental`, and decrements available stock atomically. Conflicting assignments are blocked in the database, not just in the UI:
   * each job update is a compare-and-set on its current status, so two controllers cannot both assign the same job;
   * a job can only be assigned to a cleaner whose shift covers the whole time slot, and that shift row is locked until the transaction commits, so the cleaner cannot remove it mid-assignment;
   * PostgreSQL exclusion constraints reject overlapping shifts for one cleaner and overlapping rentals of one tool.
3. **Verification & Payout:** Jobs require both `BEFORE` and `AFTER` photos before `COMPLETED`; owners/controllers can verify, review, and trigger simulated payouts.

#### Key UI and UX Considerations
* **Cleaner Mobile-First:** High-contrast, glove-friendly touch targets (at least 48×48 px; 56 px for the main actions); guided navigation → before photo → start → after photo → completion.
* **Controller Desktop:** Filterable `shadcn/ui` request/shift table beside a neighborhood map.
* **Owner Booking:** Step-by-step wizard with visual driveway-size presets.

### Incorporation of Required Course Technologies
* **TypeScript:** Strict typing for frontend, API, and Prisma.
* **Next.js & React:** Server and Client Components for dashboards, maps, and uploads.
* **Tailwind CSS & `shadcn/ui`:** Accessible, consistent forms, tables, pickers, and notifications.
* **PostgreSQL:** Relational records for users, jobs, shifts, and inventory.
* **AWS S3 / R2:** Pre-signed verification-photo uploads.

### Advanced Features by Category
Route optimization and Stripe both belong to the same category (external API integration), so we count them as one. The features below are grouped by course category so each counts once:

1. **User Authentication & Authorization:**
   * *Integration:* Better Auth email/password sessions with three roles (`HOMEOWNER`, `CLEANER`, `CONTROLLER`). Every page and Server Action calls `requireRole`, and every data-access function checks the role again (`assertRole`), so a hidden button is never the only protection. Controllers can deactivate accounts, which ends their sessions.
2. **Integration with External APIs:**
   * *Stripe Checkout (test mode):* card, Apple Pay and Google Pay. The job is created only after Stripe confirms payment (success page and webhook, safe to run twice), and cancellations refund through Stripe. The state machine moves money to the cleaner's ledger only after both `BEFORE` and `AFTER` photos exist and the homeowner (or the 24-hour auto-confirm) confirms.
   * *Geospatial dispatch (Leaflet + OSRM):* open jobs appear as pins on a Leaflet map (`react-leaflet`, OpenStreetMap tiles). When the controller assigns several houses to one cleaner, OSRM orders the stops by travel time and the stop order is saved on the jobs (`routeOrder`). OpenStreetMap address lookup is used when homeowners register properties.
3. **File Handling and Processing:**
   * *Integration:* pre-signed direct-to-S3 uploads, then server-side processing with `sharp`: auto-rotate, 1600 px and 400 px WebP copies, all metadata (including GPS) stripped, and the original deleted. The EXIF capture time is checked, and photos taken long before the slot, in the future, or out of order are flagged for the controller.
4. **Real-Time Updates:**
   * *Integration:* job and dispatch events are pushed to the right users over Server-Sent Events (`/api/events`), so homeowners see "started" and "done" without refreshing, and controllers see new shifts and bookings.

### Scope, Tradeoffs, and Feasibility
* **Human-in-the-Loop Dispatch:** A Controller manages matching and equipment instead of fully automated dispatch requiring live GPS, background workers, and pickup coordination. This keeps semester scope manageable.
* **Assumptions:** Properties fall within a bounded service zone; payments use Stripe sandbox/test mode.

---

## 3. Project Plan and Team Responsibilities

### Major Stages of Development
* **Stage 1 (Weeks 1–2):** Set up Next.js, TypeScript, Tailwind, `shadcn/ui`, Prisma/PostgreSQL, S3, and role-based authentication.
* **Stage 2 (Weeks 3–4):** Implement owner bookings, cleaner shifts/tool selection, and controller request/inventory CRUD.
* **Stage 3 (Weeks 5–6):** Add S3 photo uploads, Leaflet + OSRM routing, and Stripe test payments.
* **Stage 4 (Weeks 7–8):** Integrate job states and bidirectional reviews, test across roles, and deploy.

### Delivery Timeline and Deadlines
The **November 26 presentation** must show every core technical requirement in one working application, so the first priority is a single integrated path: **booking → dispatch → cloud photo verification → payout**. Features that don't block that path come after the presentation.

| Dates | Goal | Owner | Status |
| --- | --- | --- | --- |
| Done by Nov 17 | Auth and roles, schema, booking and Stripe, time slots, cleaner shifts, mobile job flow, S3 photo uploads and verification, earnings, reviews | Members 1–2 | Done |
| Nov 18–22 | Dispatch board, matching suggestions, Leaflet map, optional OSRM road-network ordering, dispatch integration tests | Member 3 | Done |
| Nov 18–22 | Tool catalog and rentals, controller dispute handling, snow-blower check at assignment, auto-confirm endpoint, cross-role integration tests | Member 4 | Done |
| Nov 23–24 | **Integration freeze:** run the whole path with seeded data across all four roles; fix blocking bugs only | All | To do |
| Nov 25 | Deploy, rehearse the demo on the deployed app, record a backup video | All | To do |
| **Nov 26** | **Presentation** | All | — |
| Nov 27 – Dec 3 | Optional live OSRM walking-profile server for demos, presentation feedback, polish | Members 3–4, all | To do |
| Dec 4–5 | Final report (with evidence for any measured claims), README and video | All | To do |
| **Dec 6** | **Final deadline** | All | — |

### Team Responsibilities
Four members own distinct full-stack feature areas, share the Prisma schema, and participate in integration/testing:
* **Member 1 (Owner Booking & Payments):** Property registration, size-based pricing, booking/time-slot UI and APIs, Stripe Checkout test flow, and homeowner reviews.
* **Member 2 (Cleaner Workflow & Photo Verification):** Shift availability, mobile job UI, S3 pre-signed uploads, before/after verification flow, earnings display, and cleaner reviews.
* **Member 3 (Dispatch & Geospatial Routing):** Controller request/shift dashboard, cleaner-to-house matching APIs, grouped route assignment, Leaflet + OSRM integration, and map UI.
* **Member 4 (Inventory & Shared Workflow Integrity):** Tool catalog/stock dashboard, rental check-out/return APIs, transaction-safe inventory reservation, job-status validation and dispute handling, plus cross-role integration tests.

Each member implements frontend, backend, and database interactions for their area; all four review shared contracts and test end-to-end workflows.

### Component Integration Strategy
1. **Schema-First Contract:** Agree on `schema.prisma` and shared TypeScript DTOs in Week 1; review schema changes together.
2. **Database Seeding:** Use `prisma/seed.ts` with sample owners, cleaners, shifts, tools, and Toronto locations for independent testing.
3. **CI/CD & Branching:** Merge feature branches through GitHub PRs with `tsc --noEmit` and ESLint checks.

### Dependencies, Coordination Needs, and Risks
* **Data Dependencies:** Dispatch relies on owner requests and cleaner shifts; seed mock data early so Member 3 can work independently.
* **External APIs:** Wrap maps and S3 calls behind services and provide mock fallbacks for routing or CORS issues.

---

## 4. Initial Team Reasoning and AI-Assisted Exploration

### 4.1 Initial Team Reasoning

#### Problem Framing
Our initial idea was a peer-to-peer “Uber for snow shoveling” app: owners post jobs and cleaners claim them. Discussion revealed two problems: students may lack equipment, and independently claimed jobs create inefficient travel. We added a **Central Office Controller** to coordinate tool rentals, shifts, and clustered routes.

#### Initial Technical Hypotheses
1. **Architecture:** We first considered a Vite React SPA with an Express REST API, drawing on prior Express experience.
2. **Image Storage:** We considered Base64 before/after photos in SQLite `TEXT` fields to avoid cloud setup.

#### Open Questions Identified Early
* How can we discourage false or reused completion photos?
* How should standardized snowfall pricing work?
* Can we provide multi-stop routes without costly enterprise APIs?

### 4.2 Exploration and Evaluation

#### Evolving Our Design Through Investigation
Through a combination of team discussions, reviewing course specifications, reading technical documentation, and targeted AI-assisted exploration, we systematically resolved our open questions and refined our architecture:

* **Course Material & Team Discussion (Database & Cloud Storage):** Reviewing the course requirements and PostgreSQL best practices quickly invalidated our initial Base64-in-SQLite hypothesis. Storing multiple high-resolution smartphone photos per job in a database table would severely degrade query performance and violate course requirements for dedicated cloud storage. Reading AWS S3 documentation led us to adopt the **Pre-signed URL pattern**, which keeps large binary payloads off our application server while maintaining strict access control.
* **Architectural Consolidation (Express vs. Next.js):** When mapping out the 15+ endpoints required to support three distinct user roles, we realized maintaining synchronized TypeScript types across separate frontend and backend repositories would create significant friction. Prototyping a small slice in Next.js App Router showed that Server Actions and shared Prisma types removed the separate REST client, request/response DTOs, and duplicated validation we would otherwise maintain. (We will only report a percentage in the final report if we measure it, for example by comparing line counts for the same feature in both designs.)
* **AI-Assisted Exploration (State Machine & Routing Feasibility):** After establishing our core three-role mental model, we used AI as an architectural sounding board in two specific areas:
  1. *Database Edge Cases:* We prompted an AI assistant to critique our initial ER diagram for scheduling conflicts. This highlighted a race condition where two controllers might assign the same snowblower or cleaner shift simultaneously, prompting us to introduce a dedicated `ToolRental` join table and wrap dispatch assignments in Prisma interactive transactions. In the implementation this became exclusion constraints on shifts and rentals, compare-and-set job updates, and a row lock on the covering shift during assignment (see Section 2, Dispatch & Tool Reservation).
  2. *Geospatial API Evaluation:* We used AI to compare Google Maps Routes API, Mapbox Directions API, and Leaflet + OSRM for our Controller routing feature. Based on the comparison of free-tier limits and React library support, we selected **Leaflet (`react-leaflet`) with OpenStreetMap tiles and OSRM waypoint ordering**: it needs no API key or billing account, which makes it the most reliable zero-cost option for student deployment.

---

## 5. Development Guide

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · PostgreSQL + Prisma.

### 5.1 Implementation Status

| Area                                                                                                                                                          | Status       | Where                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared: sign-in/sign-up, roles, layout, theme, database schema                                                                                                | Included     | `src/lib/auth.ts`, `src/app/(auth)`, `src/components`, `prisma/`                                                                                                      |
| **Member 1: owner booking & payments** — property registration, size-based pricing, booking wizard, time slots, Stripe Checkout, homeowner reviews, discounts | **Included** | `src/app/homeowner`, `src/app/controller/windows`, `src/lib/pricing.ts`, `src/lib/payments.ts`, `src/lib/dal/jobs.ts`, `src/lib/dal/windows.ts`, `src/app/api/stripe` |
| People management, discount approvals, system status                                                                                                          | Included     | `src/app/controller` (Overview, Time slots, Users)                                                                                                                    |
| **Member 2: cleaner portal** — shift availability, mobile job flow, S3 presigned photo uploads, before/after verification, earnings, cleaner reviews            | **Included** | `src/app/cleaner`, `src/lib/storage.ts`, `src/lib/photo-rules.ts`, `src/lib/dal/photos.ts`, `src/lib/dal/shifts.ts`, `src/lib/dal/earnings.ts`, `src/app/api/storage` |
| **Member 3: dispatch & map routing** — assigning cleaners to booked slots, matching suggestions, Leaflet map, optional OSRM route order                       | **Included** | `src/app/controller/dispatch`, `src/lib/dal/dispatch.ts`, `src/lib/matching.ts`, `src/lib/osrm.ts`, `src/lib/geo.ts`                                                   |
| **Member 4: tools inventory & job-state integrity** — tool library, rentals, disputes, auto-confirm, workflow checks, integration tests                       | **Included** | `src/app/controller/tools`, `src/app/controller/disputes`, `src/app/cleaner/tools`, `src/lib/contracts/rental-states.ts`, `src/lib/dal/rentals.ts`, `src/lib/dal/tools.ts`, `src/lib/dal/disputes.ts`, `src/lib/dal/integrity.ts`, `src/app/api/cron`, `tests/integration` |

The **database schema already has every table** (shifts, photos, tools, rentals, ledger…), as agreed
in the proposal, so other members can start without changing it. The implemented schema differs in a
few names from Section 2 (for example `Job` instead of `ServiceRequest`, `Shift` instead of
`CleanerShift`, `/homeowner` instead of `/owner`); `prisma/schema.prisma` is the source of truth.

### 5.2 Quick Start

**Prerequisites:** Node.js 22 LTS and PostgreSQL 14+ (or Docker: `docker compose up -d`).

```bash
cp .env.example .env     # set DATABASE_URL and BETTER_AUTH_SECRET (openssl rand -base64 32)
npm install              # also runs `prisma generate`
npm run db:deploy        # create the tables
npm run db:check         # confirms which database .env points at
npm run db:seed          # demo data (wipes the database first)
npm run dev              # http://localhost:3000
```

#### Demo accounts (password `snowber-demo`)

| Account                    | Shows                                                           |
| -------------------------- | --------------------------------------------------------------- |
| `grace.home@snowber.test`  | Homeowner with a job to confirm and a booking for tomorrow      |
| `henry.home@snowber.test`  | Homeowner with an approved senior discount                      |
| `isla.home@snowber.test`   | Homeowner whose accessibility discount waits for approval       |
| `controller@snowber.test`  | Dispatch board, time slots, people, discounts, tool library (requests, a clash, an overdue tool), an open dispute, workflow checks |
| `ava.cleaner@snowber.test` | Cleaner with jobs for tomorrow, shifts, a reserved snow blower, earnings and reviews |
| `ben.cleaner@snowber.test` | Cleaner with a job in progress (before photo taken)             |

### 5.3 Member 1 Features

- **Property registration** — address lookup on OpenStreetMap, a check that the home is inside the Toronto service area, and size presets (single car, double car, corner lot).
- **Time slots** — controllers open booking windows with a price rate and close them when full (`/controller/windows`); homeowners only see open, future slots.
- **Booking wizard** — property → time slots and extras → review and pay, with the price always computed on the server.
- **Homeowner reviews** — after confirming a finished job, the homeowner rates the cleaner (1–5 stars and a comment).
- **Pricing** (`src/lib/pricing.ts`):

  ```
  price = (lot base + add-ons) × window rate × timing factor − discount
  ```

  Lot base $30 / $45 / $65, sidewalk $10, salt $8; window rate set per window (0.5–3×);
  timing: starts within 6 h ×1.5, within 24 h ×1.2, standard ×1.0, booked 3+ days ahead ×0.9;
  senior or accessibility discount 20% (absorbed by the platform, so cleaner pay is unchanged).

- **Payments** — Stripe Checkout in test mode with card, **Apple Pay and Google Pay**. The job is
  created only after Stripe confirms payment (success page + webhook, safe to run twice); cancelling
  refunds through Stripe. Without `STRIPE_SECRET_KEY`, payments are simulated.
- **Discounts** — homeowners apply at `/homeowner/discounts`; controllers approve on the Users page.
  Only the program is stored, never medical details.
- **People** — controllers add homeowners, cleaners or controllers, and remove or restore them.
  Removed people are signed out and can't sign in; their history stays.
- **Database check** — `npm run db:check`, `/api/health`, and a status card on the controller overview.
- **Light/dark theme**, the logo linking home on every page, and layouts checked at 360 px phone width.

#### Stripe setup (optional)

1. Create a free Stripe account, copy the test secret key into `STRIPE_SECRET_KEY`.
2. Dashboard → Settings → Payment methods: turn on Apple Pay and Google Pay.
3. For the webhook locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, and copy the `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
4. Test card `4242 4242 4242 4242`. Google Pay appears in Chrome with a saved card; Apple Pay needs the app on an HTTPS domain.

### 5.4 Member 2 Features

- **Shift availability** (`/cleaner/shifts`) — cleaners post when they can work (up to 12 hours,
  30 days ahead); one tap fills in an open time slot. The database rejects overlapping shifts.
  Shifts with assigned jobs can't be removed. Dispatch reads them with `listCleanersAvailable()`
  in `src/lib/dal/shifts.ts`.
- **Mobile job flow** (`/cleaner/jobs/[id]`) — directions → before photo → start → after photo →
  done, with 56 px buttons in a sticky bar at the bottom of the screen. The server enforces the
  same order through `transitionJob`.
- **Photo uploads** — the phone camera opens directly; the browser PUTs the photo to a 5-minute
  presigned URL, then the server reads the EXIF capture time, strips all metadata (including GPS),
  saves 1600 px and 400 px WebP copies and deletes the original. Up to 3 photos per step.
- **Verification** — photos taken more than 12 hours before the time slot, with a future capture
  time, or an after photo older than the before photo are flagged for the controller. Homeowners
  see the photos side by side on their job page before confirming.
- **Earnings** (`/cleaner/earnings`) — balance from the ledger, the last 7 days, money awaiting
  confirmation and upcoming jobs (same pay rule as the ledger: 80% of the pre-discount price plus tips).
- **Cleaner reviews** — after confirmation the cleaner rates the home and sees the homeowner's
  review; their average rating and recent reviews are on the Earnings page.

#### Photo storage setup

Development needs nothing: `STORAGE_DRIVER="local"` keeps files in `./.storage` and serves them
through `/api/storage/...` with signed, expiring URLs (the same contract as S3 presigned URLs).
For a real bucket, set `STORAGE_DRIVER="s3"` and the `S3_*` variables in `.env`, keep the bucket
private, and add the CORS rule shown in `.env.example` so browsers can PUT to it.

### 5.5 Member 4 Features

- **Tool library** (`/controller/tools`) — the controller adds tools with a fee per rental and moves
  them between *in service*, *out for repair* and *retired*. A tool with reservations that haven't
  finished can't leave service; retiring one declines its pending requests. Overdue tools are listed
  first, with the cleaner's phone number.
- **Rentals** (`/cleaner/tools`) — cleaners ask for a tool for up to 24 hours, up to 30 days ahead;
  one tap fills in one of their shifts. They see when each tool is already reserved (times only,
  never who has it) and can cancel before pickup.
- **Check-out and check-in** — approving a request reserves the tool and charges its fee to the
  cleaner's ledger (`RENTAL_FEE`); cancelling before pickup refunds it (`ADJUSTMENT`), once. After
  pickup the controller checks the tool back in; late returns are noted.
- **Transaction-safe reservation** — `transitionRental` in `src/lib/dal/rentals.ts` is the only code
  that changes a rental, using the pure state machine in `src/lib/contracts/rental-states.ts`. It locks
  the tool, then the rental (always in that order, so it can't deadlock with a status change), writes
  the status with compare-and-set, and the `ToolRental_no_overlap` exclusion constraint makes
  double-booking impossible even when two approvals race. Requests that clash with a reservation are
  marked on the dashboard and can only be declined.
- **Snow blowers at assignment** — large driveways need a blower. Assigning a job with
  `requiresBlower` (through `transitionJob(…, "ASSIGNED")`) now also requires the cleaner to own one
  or hold an approved blower rental covering the whole time slot; that rental is share-locked until
  the assignment commits, and a rental a job depends on can't be cancelled.
- **Disputes** (`/controller/disputes`) — the homeowner's reason, both people's contact details, the
  money involved and the before/after photos with upload flags. The controller pays the cleaner
  (`DISPUTED → CONFIRMED`) or refunds the homeowner (`DISPUTED → CANCELLED`), both through the job
  state machine; resolved disputes stay listed for two weeks.
- **24-hour auto-confirm** — `POST /api/cron/auto-confirm` with `Authorization: Bearer $CRON_SECRET`
  confirms (and pays) finished jobs nobody answered. The same sweep runs when a homeowner or the
  controller opens their overview, so nothing is lost without a scheduler.
- **Workflow checks** — the controller overview lists anything that doesn't add up: confirmed jobs
  with no cleaner payment, cancelled jobs not refunded, jobs past a photo step without the photo,
  large driveways without a blower, overdue tools, late auto-confirmation. It normally says
  "All checks pass".

#### Scheduling auto-confirm

Set `CRON_SECRET` in `.env` (the `replace-me` placeholder is refused), then call the endpoint every
15 minutes from any scheduler, for example a crontab line on the server:

```bash
*/15 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-host>/api/cron/auto-confirm
```

#### Integration tests

`npm test` runs the fast unit tests. `npm run test:integration` drives every role through the real
data-access layer against a throwaway database: a full storm morning (booking → blower rental →
assignment → photos → dispute → payout), racing approvals, refunds, check-in, tool status rules, the
cron endpoint and the workflow checks. The tests wipe the database, so they only run when
`TEST_DATABASE_URL` names a database with "test" in its name:

```bash
createdb snowber_test
DATABASE_URL=postgresql://snowber:snowber@localhost:5432/snowber_test npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://snowber:snowber@localhost:5432/snowber_test npm run test:integration
```

### 5.6 Member 3 Features

- **Dispatch board** (`/controller/dispatch`) — pick a time slot, see requested jobs and cleaners
  whose shifts cover it, assign one job or a batch, unassign, and move stops up or down on a route.
  The Leaflet map shows pins and straight lines between ordered stops.
- **Matching suggestions** (`suggestForWindow` in `src/lib/dal/dispatch.ts`, heuristic in
  `src/lib/matching.ts`) — proposes cleaner → job pairs from capacity, blower coverage, travel time
  and rating. Nothing is saved until the controller applies the batch.
- **Safe batch assignment** (`assignJobs`) — one `prisma.$transaction` with an advisory lock per
  window, so two controllers cannot overbook the same slot from a stale board. Each assignment still
  goes through `applyTransition`, which locks the covering shift and (for large driveways) an
  approved blower rental. Capacity is re-checked against current DB state before commit.
- **Route order** — after assign / unassign, `reorderRoute` keeps finished stops fixed and orders
  the rest. By default it uses nearest-neighbor travel times (`src/lib/geo.ts`). With
  `OSRM_BASE_URL` set it prefers OSRM road-network durations (`src/lib/osrm.ts`) and falls back if
  OSRM is down or slow.
- **Blower-aware UI** — the board greys out cleaners who can't take a large driveway
  (`ownsBlower` or an approved rental covering the slot via `listCleanersWithRentedBlower`).
- **Live updates** — assignments and route changes publish `dispatch.updated` so other controller
  tabs and cleaners refresh without a full reload.
- **Tests** — `tests/matching.test.ts` and `tests/osrm.test.ts` cover heuristics and fallbacks
  without a live OSRM server; `tests/integration/dispatch.test.ts` covers assignment, persistence,
  manual ordering, duplicates and shift requirements (see 5.5 for how to run integration tests).

#### OSRM setup (optional)

The board works without OSRM. For road-network ordering, run a local OSRM server built with a
**walking / foot** profile and set `OSRM_BASE_URL` in `.env` (see `.env.example`, typically
`http://localhost:5001`). The client calls OSRM's `table` API; the URL path uses OSRM's usual
`driving` service name, but the graph you load is what actually defines the profile. The public
OSRM driving demo is not walking routing, and the map never draws OSRM street geometries — only
straight connectors between ordered stops.

### 5.7 Scripts

| Command                                           | What it does                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`                                     | Development server                                                                       |
| `npm run build` / `npm start`                     | Production build / server                                                                |
| `npm run typecheck` · `npm run lint` · `npm test` | Checks run by CI on every pull request                                                   |
| `npm run test:integration`                        | Cross-role tests against `TEST_DATABASE_URL` (see 5.5; includes dispatch)                |
| `npm run db:migrate`                              | Create a migration after editing `prisma/schema.prisma` (review schema changes together) |
| `npm run db:deploy`                               | Apply migrations                                                                         |
| `npm run db:seed`                                 | Reset and load demo data                                                                 |
| `npm run db:check`                                | Show which database `.env` uses and whether it's ready                                   |

### 5.8 Shared Contracts (do not bypass)

Members 1–4 are integrated through these entry points. New pages should call them instead of
writing status or payment rows by hand:

- **Auth:** `requireRole` in pages and actions (`src/lib/dal/session.ts`); DAL functions re-check with `assertRole`.
- **Navigation:** add links to `NAV` in `src/components/app-shell.tsx`.
- **Job status:** `transitionJob` / `applyTransition` in `src/lib/dal/jobs.ts` (state machine, refunds, live events). For several jobs in one window, prefer `assignJobs` / `unassignJob` in `src/lib/dal/dispatch.ts`.
- **Payments:** refunds through `getPaymentProvider().refund`; cleaner pay through `jobEarnings()` in `src/lib/pricing.ts`.
- **Live updates:** `publish()` in `src/lib/events.ts`; the browser listens on `/api/events`.
- **Photos:** `listJobPhotos(user, jobId)` + `<JobPhotos showFlags />` for controllers.
- **Shifts / availability:** `listCleanersAvailable` and `lockCoveringShift` in `src/lib/dal/shifts.ts`.
- **Blowers:** `listCleanersWithRentedBlower` in `src/lib/dal/rentals.ts`; assignment refuses large driveways without coverage.
- **Integration tests:** extend `tests/integration/` with the helpers in `tests/integration/helpers.ts`. Those tests wipe `TEST_DATABASE_URL` — never point them at demo or production data.
