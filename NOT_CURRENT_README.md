# Snowber — Member 1 version (owner booking & payments)

ECE1724 course project · Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · PostgreSQL + Prisma.

## What's in this version

| Area                                                                                                                                                          | Status       | Where                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared: sign-in/sign-up, roles, layout, theme, database schema                                                                                                | Included     | `src/lib/auth.ts`, `src/app/(auth)`, `src/components`, `prisma/`                                                                                                      |
| **Member 1: owner booking & payments** — property registration, size-based pricing, booking wizard, time slots, Stripe Checkout, homeowner reviews, discounts | **Included** | `src/app/homeowner`, `src/app/controller/windows`, `src/lib/pricing.ts`, `src/lib/payments.ts`, `src/lib/dal/jobs.ts`, `src/lib/dal/windows.ts`, `src/app/api/stripe` |
| People management, discount approvals, system status                                                                                                          | Included     | `src/app/controller` (Overview, Time slots, Users)                                                                                                                    |
| **Member 2: cleaner portal** — shifts, route, before/after photos, earnings                                                                                   | **To build** | placeholder at `src/app/cleaner`                                                                                                                                      |
| **Member 3: dispatch & map routing** — assigning cleaners to booked slots, route map                                                                          | **To build** | add pages under `src/app/controller`                                                                                                                                  |
| **Member 4: tools inventory & job-state integrity** — tool library, rentals, disputes, auto-confirm                                                           | **To build** | add pages under `src/app/controller`; rules in `src/lib/contracts/job-states.ts`                                                                                      |

The **database schema already has every table** (shifts, photos, tools, rentals, ledger…), as agreed
in the proposal, so other members can start without changing it.

## Quick start

**Prerequisites:** Node.js 22 LTS and PostgreSQL 14+ (or Docker: `docker compose up -d`).

```bash
cp .env.example .env     # set DATABASE_URL and BETTER_AUTH_SECRET (openssl rand -base64 32)
npm install              # also runs `prisma generate`
npm run db:deploy        # create the tables
npm run db:check         # confirms which database .env points at
npm run db:seed          # demo data (wipes the database first)
npm run dev              # http://localhost:3000
```

### Demo accounts (password `snowber-demo`)

| Account                    | Shows                                                           |
| -------------------------- | --------------------------------------------------------------- |
| `grace.home@snowber.test`  | Homeowner with a job to confirm and a booking for tomorrow      |
| `henry.home@snowber.test`  | Homeowner with an approved senior discount                      |
| `isla.home@snowber.test`   | Homeowner whose accessibility discount waits for approval       |
| `controller@snowber.test`  | Time slots, people management, discount requests, system status |
| `ava.cleaner@snowber.test` | Cleaner portal placeholder                                      |

## Member 1 features

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

### Stripe setup (optional)

1. Create a free Stripe account, copy the test secret key into `STRIPE_SECRET_KEY`.
2. Dashboard → Settings → Payment methods: turn on Apple Pay and Google Pay.
3. For the webhook locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, and copy the `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
4. Test card `4242 4242 4242 4242`. Google Pay appears in Chrome with a saved card; Apple Pay needs the app on an HTTPS domain.

## Scripts

| Command                                           | What it does                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`                                     | Development server                                                                       |
| `npm run build` / `npm start`                     | Production build / server                                                                |
| `npm run typecheck` · `npm run lint` · `npm test` | Checks run by CI on every pull request                                                   |
| `npm run db:migrate`                              | Create a migration after editing `prisma/schema.prisma` (review schema changes together) |
| `npm run db:deploy`                               | Apply migrations                                                                         |
| `npm run db:seed`                                 | Reset and load demo data                                                                 |
| `npm run db:check`                                | Show which database `.env` uses and whether it's ready                                   |

## For Members 2–4: where to plug in

- **Auth:** call `requireRole("CLEANER")` / `requireRole("CONTROLLER")` in pages and actions (`src/lib/dal/session.ts`); DAL functions re-check with `assertRole`.
- **Navigation:** add your links to `NAV` in `src/components/app-shell.tsx`.
- **Job status changes:** go through `transitionJob` / `applyTransition` in `src/lib/dal/jobs.ts`, which validates the state machine, handles refunds and publishes live updates.
- **Payments:** never touch `Payment` rows directly — refunds go through `getPaymentProvider().refund`, and cleaner earnings use `jobEarnings()` from `src/lib/pricing.ts`.
- **Live updates:** `publish()` in `src/lib/events.ts`; the browser listens via `/api/events`.
- **Photos:** the homeowner job page has a "Before & after" card waiting for the photo viewer.
