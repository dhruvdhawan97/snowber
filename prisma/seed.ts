/**
 * Demo data built around one end-to-end story that can be shown live:
 *
 *   1. Olivia (olivia.home) has a saved home and no bookings. She books a slot and pays.
 *   2. Morgan (controller) opens Dispatch for that slot, clicks Suggest, applies → Ava.
 *   3. Ava (ava.cleaner) opens the stop, adds a BEFORE photo, starts, adds AFTER, marks done.
 *   4. Olivia confirms the photos and leaves a review; Ava's earnings go up.
 *
 * Every other step is also pre-staged, so any screen can be shown without doing the
 * live steps first: Grace has a finished job to confirm, Henry has an approved senior
 * discount, Isla's accessibility request waits for approval, Maya's job is in progress,
 * Jamal has an open dispute, and a small queue of requests waits on tomorrow's slots.
 * Maple Hollow is small (12 homes, 8 cleaners; 4 have no shifts yet) so its screens stay
 * readable, and 8 more cleaners across Toronto cover homeowners who sign up live.
 *
 * All times are relative to when the seed runs, so every pricing tier (Rush, Soon,
 * Standard, Book ahead) is bookable. Re-seed shortly before a demo.
 *
 *   npm run db:seed        (or: npx prisma db seed)
 *
 * Every account's password is "snowber-demo".
 * The seed wipes existing data first; never run it against a production database.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { hashPassword } from "better-auth/crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type JobStatus, type LotSize, type PhotoKind } from "../src/generated/prisma/client";
import { NEIGHBORHOOD_CENTER } from "../src/lib/config";
import { formatMoney } from "../src/lib/format";
import { DISPLAY_MAX_PX, THUMB_MAX_PX, derivedKeys } from "../src/lib/photo-rules";
import { rentalFeeDescription } from "../src/lib/contracts/rental-states";
import { discountBpsFor, jobEarnings, quoteForWindows, type DiscountProgramKey } from "../src/lib/pricing";
import { LOCAL_STORAGE_ROOT, getStorage } from "../src/lib/storage";
import { addCalendarDays, zonedCalendarDate, zonedTimeToUtc } from "../src/lib/time";
import { addTestSlots } from "../scripts/test-slots";


const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "America/Toronto";
const PASSWORD = "snowber-demo";
const HOUR = 60 * 60 * 1000;

// Deterministic pseudo-random numbers so every seed run looks the same.
let state = 20261106;
const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)];

const now = new Date();
const today = zonedCalendarDate(now, TZ);
const at = (daysAhead: number, hour: number, minute = 0) =>
  zonedTimeToUtc({ ...addCalendarDays(today, daysAhead), hour, minute }, TZ);

async function createUser(input: { name: string; email: string; role: "HOMEOWNER" | "CLEANER" | "CONTROLLER"; extra?: object }) {
  const id = randomUUID();
  return prisma.user.create({
    data: {
      id,
      name: input.name,
      email: input.email,
      emailVerified: true,
      role: input.role,
      ...input.extra,
      accounts: { create: { id: randomUUID(), accountId: id, providerId: "credential", password: await hashPassword(PASSWORD) } },
    },
  });
}

/** A simple drawing of a driveway, snowed in (before) or cleared (after). */
function drivewaySvg(kind: PhotoKind, variant: number): Buffer {
  const snowy = kind === "BEFORE";
  const house = ["#8a5a44", "#5b6b7a", "#a0715a", "#6d5c80"][variant % 4];
  const flakes = snowy
    ? Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 197 + variant * 53) % 1200}" cy="${(i * 113 + variant * 31) % 600}" r="${3 + (i % 4)}" fill="#fff" opacity="0.85"/>`).join("")
    : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
  <rect width="1200" height="900" fill="${snowy ? "#b9c4d1" : "#c9d6e6"}"/>
  <rect y="330" width="1200" height="570" fill="#f3f6fa"/>
  <rect x="660" y="150" width="440" height="230" fill="${house}"/>
  <polygon points="630,160 880,40 1130,160" fill="#3f3f46"/>
  <rect x="760" y="250" width="150" height="130" fill="#d4d4d8"/>
  <polygon points="420,900 760,380 910,380 1060,900" fill="${snowy ? "#ffffff" : "#52525b"}"/>
  ${snowy ? "" : `<polygon points="390,900 745,380 760,380 420,900" fill="#ffffff"/><polygon points="1060,900 910,380 930,380 1100,900" fill="#ffffff"/>`}
  ${flakes}
  <rect x="30" y="30" width="230" height="70" rx="12" fill="#000" opacity="0.55"/>
  <text x="145" y="78" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">${kind}</text>
</svg>`);
}

/** Stores generated display/thumbnail images and records the photo, like finalizePhoto does. */
async function seedPhoto(jobId: string, kind: PhotoKind, uploadedById: string, takenAt: Date, variant: number) {
  const id = randomUUID();
  const { displayKey, thumbKey } = derivedKeys(jobId, kind, id);
  const svg = drivewaySvg(kind, variant);
  const display = await sharp(svg).resize({ width: DISPLAY_MAX_PX, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(svg).resize({ width: THUMB_MAX_PX }).webp({ quality: 70 }).toBuffer();
  const storage = getStorage();
  await storage.put(displayKey, display.data, "image/webp");
  await storage.put(thumbKey, thumb, "image/webp");
  await prisma.jobPhoto.create({
    data: { id, jobId, kind, displayKey, thumbKey, width: display.info.width, height: display.info.height, takenAt, uploadedById, createdAt: takenAt },
  });
}


// ───────────────── main ─────────────────

async function main() {
  console.log("Resetting data…");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "LedgerEntry","Payment","Review","JobPhoto","_JobWindowOptions","Job","ToolRental","Tool","Shift","ServiceWindow","Property","Session","Account","Verification","User" RESTART IDENTITY CASCADE`,
  );

  // Seeded photo objects from earlier runs are orphaned by the TRUNCATE above.
  if (getStorage().name === "local") await rm(path.join(LOCAL_STORAGE_ROOT, "jobs"), { recursive: true, force: true });

  console.log("Creating accounts…");
  const controller = await createUser({ name: "Morgan Lee", email: "controller@snowber.test", role: "CONTROLLER" });

  // Maple Hollow: four short streets around the neighborhood center.
  const streets = [
    { name: "Maple Crescent", lat: 0.0018, lng: -0.0025 },
    { name: "Birch Avenue", lat: 0.0006, lng: -0.0025 },
    { name: "Cedar Lane", lat: -0.0006, lng: -0.0025 },
    { name: "Willow Street", lat: -0.0018, lng: -0.0025 },
  ];
  const homeAt = (street: number, index: number) => ({
    lat: NEIGHBORHOOD_CENTER.lat + streets[street].lat + (rand() - 0.5) * 0.00008,
    lng: NEIGHBORHOOD_CENTER.lng + streets[street].lng + 0.00045 * index + (rand() - 0.5) * 0.00008,
  });
  const addressOf = (street: number, index: number) => `${index * 2 + 10} ${streets[street].name}, Toronto, ON`;

  // Ava lives on Maple Crescent next to Olivia, so Suggest sends Olivia's job to her.
  const cleanerSpecs = [
    { name: "Ava Chen", email: "ava.cleaner@snowber.test", street: 0, index: 2, ownsBlower: false },
    { name: "Ben Okafor", email: "ben.cleaner@snowber.test", street: 2, index: 9, ownsBlower: true },
    { name: "Chloe Martin", email: "chloe.cleaner@snowber.test", street: 1, index: 6, ownsBlower: false },
    { name: "Diego Ramirez", email: "diego.cleaner@snowber.test", street: 3, index: 4, ownsBlower: true },
    // Signed up but haven't posted any shifts yet, so Dispatch never offers them.
    { name: "Emma Wilson", email: "emma.cleaner@snowber.test", street: 1, index: 1, ownsBlower: false },
    { name: "Farah Haddad", email: "farah.cleaner@snowber.test", street: 3, index: 8, ownsBlower: false },
    { name: "Gus Novak", email: "gus.cleaner@snowber.test", street: 0, index: 10, ownsBlower: true },
    { name: "Hana Sato", email: "hana.cleaner@snowber.test", street: 2, index: 1, ownsBlower: false },
  ];
  const cleaners: Awaited<ReturnType<typeof createUser>>[] = [];
  for (const spec of cleanerSpecs) {
    const home = homeAt(spec.street, spec.index);
    cleaners.push(
      await createUser({
        name: spec.name,
        email: spec.email,
        role: "CLEANER",
        extra: {
          homeAddress: `${spec.index * 2 + 3} ${streets[spec.street].name}, Toronto, ON`,
          homeLat: home.lat,
          homeLng: home.lng,
          ownsBlower: spec.ownsBlower,
          phone: `416-555-01${String(cleaners.length).padStart(2, "0")}`,
        },
      }),
    );
  }
  const [ava, ben, chloe, diego] = cleaners;

  // Cleaners spread across Toronto, on shift for every open slot, so a homeowner who
  // signs up live with any Toronto address has someone within walking range (a 2-hour
  // slot leaves ~65 min of walking for a medium job ≈ 4.9 km at 4.5 km/h).
  const areaCleanerSpecs = [
    { name: "Isaac Cohen", email: "isaac.cleaner@snowber.test", area: "Downtown", address: "300 King St W, Toronto, ON", lat: 43.6465, lng: -79.3895, ownsBlower: true },
    { name: "Julia Rossi", email: "julia.cleaner@snowber.test", area: "Leslieville", address: "1000 Queen St E, Toronto, ON", lat: 43.6615, lng: -79.3375, ownsBlower: false },
    { name: "Kevin Osei", email: "kevin.cleaner@snowber.test", area: "High Park", address: "2000 Bloor St W, Toronto, ON", lat: 43.6535, lng: -79.4720, ownsBlower: true },
    { name: "Lena Petrov", email: "lena.cleaner@snowber.test", area: "Midtown", address: "2300 Yonge St, Toronto, ON", lat: 43.7070, lng: -79.3985, ownsBlower: false },
    { name: "Marcus Hall", email: "marcus.cleaner@snowber.test", area: "North York", address: "5100 Yonge St, Toronto, ON", lat: 43.7680, lng: -79.4130, ownsBlower: true },
    { name: "Nadia Rahman", email: "nadia.cleaner@snowber.test", area: "Scarborough", address: "300 Borough Dr, Toronto, ON", lat: 43.7750, lng: -79.2580, ownsBlower: true },
    { name: "Omar Aziz", email: "omar.cleaner@snowber.test", area: "Etobicoke", address: "3000 Bloor St W, Toronto, ON", lat: 43.6450, lng: -79.5200, ownsBlower: false },
    { name: "Paula Silva", email: "paula.cleaner@snowber.test", area: "East York", address: "1000 Pape Ave, Toronto, ON", lat: 43.6900, lng: -79.3480, ownsBlower: false },
  ];
  const areaCleaners: Awaited<ReturnType<typeof createUser>>[] = [];
  for (const [i, spec] of areaCleanerSpecs.entries()) {
    areaCleaners.push(
      await createUser({
        name: spec.name,
        email: spec.email,
        role: "CLEANER",
        extra: { homeAddress: spec.address, homeLat: spec.lat, homeLng: spec.lng, ownsBlower: spec.ownsBlower, phone: `416-555-02${String(i).padStart(2, "0")}` },
      }),
    );
  }

  type HomeSpec = { label?: string; street: number; index: number; lot: LotSize; sidewalk?: boolean; notes?: string };
  type OwnerSpec = { key: string; name: string; discount?: { program: DiscountProgramKey; status: "APPROVED" | "PENDING" }; homes: HomeSpec[] };
  const ownerSpecs: OwnerSpec[] = [
    // The live-demo homeowner: one saved home, nothing booked yet.
    { key: "olivia", name: "Olivia Park", homes: [{ label: "Home", street: 0, index: 3, lot: "MEDIUM", notes: "Please clear a path to the side door too." }] },
    {
      key: "grace",
      name: "Grace Kim",
      homes: [
        { label: "Home", street: 0, index: 6, lot: "SMALL" },
        { label: "Mom's place", street: 1, index: 2, lot: "MEDIUM", notes: "Watch the icy front steps." },
      ],
    },
    { key: "henry", name: "Henry Brown", discount: { program: "SENIOR", status: "APPROVED" }, homes: [{ street: 1, index: 4, lot: "MEDIUM", notes: "Car leaves at 7:30 — driveway first please." }] },
    { key: "isla", name: "Isla Singh", discount: { program: "ACCESSIBILITY", status: "PENDING" }, homes: [{ street: 2, index: 3, lot: "SMALL", notes: "Ramp on the left side of the house." }] },
    { key: "jamal", name: "Jamal Tremblay", homes: [{ street: 2, index: 6, lot: "MEDIUM" }] },
    { key: "kiko", name: "Kiko Roy", homes: [{ street: 3, index: 1, lot: "SMALL" }] },
    { key: "liam", name: "Liam Gagnon", homes: [{ street: 3, index: 6, lot: "LARGE", notes: "Corner lot, two driveways." }] },
    { key: "maya", name: "Maya Wong", homes: [{ street: 2, index: 8, lot: "MEDIUM" }] },
    { key: "noah", name: "Noah Patel", homes: [{ street: 0, index: 8, lot: "LARGE" }] },
    { key: "priya", name: "Priya Nguyen", homes: [{ street: 1, index: 7, lot: "SMALL", sidewalk: false }] },
    { key: "sam", name: "Sam Fraser", homes: [{ street: 3, index: 3, lot: "MEDIUM", notes: pick(["Gate code 4512.", "Pile snow on the left side."]) }] },
  ];

  const owners: Record<string, Awaited<ReturnType<typeof createUser>>> = {};
  const homes: Record<string, Awaited<ReturnType<typeof prisma.property.create>>[]> = {};
  const discountOf = new Map<string, number>();
  for (const spec of ownerSpecs) {
    const extra = spec.discount ? { discountProgram: spec.discount.program, discountStatus: spec.discount.status } : undefined;
    const owner = await createUser({ name: spec.name, email: `${spec.key}.home@snowber.test`, role: "HOMEOWNER", extra });
    owners[spec.key] = owner;
    discountOf.set(owner.id, discountBpsFor(spec.discount?.program, spec.discount?.status));
    homes[spec.key] = [];
    for (const h of spec.homes) {
      const position = homeAt(h.street, h.index);
      homes[spec.key].push(
        await prisma.property.create({
          data: {
            ownerId: owner.id,
            label: h.label ?? null,
            address: addressOf(h.street, h.index),
            lat: position.lat,
            lng: position.lng,
            lotSize: h.lot,
            hasSidewalk: h.sidewalk ?? true,
            notes: h.notes ?? null,
          },
        }),
      );
    }
  }
  const home = (key: string, i = 0) => homes[key][i];

  console.log("Creating time slots…");
  const recentStart = new Date(Math.floor((now.getTime() - 3 * HOUR) / HOUR) * HOUR);
  const windows = {
    yesterday: await prisma.serviceWindow.create({ data: { startsAt: at(-1, 7), endsAt: at(-1, 9), multiplierBps: 12500, status: "CLOSED", createdById: controller.id } }),
    recent: await prisma.serviceWindow.create({ data: { startsAt: recentStart, endsAt: new Date(recentStart.getTime() + 2 * HOUR), multiplierBps: 10000, status: "CLOSED", createdById: controller.id } }),
    early: await prisma.serviceWindow.create({ data: { label: "Early birds", startsAt: at(1, 6), endsAt: at(1, 8), multiplierBps: 15000, createdById: controller.id } }),
    mid: await prisma.serviceWindow.create({ data: { label: "Morning", startsAt: at(1, 8), endsAt: at(1, 10), multiplierBps: 12500, createdById: controller.id } }),
    late: await prisma.serviceWindow.create({ data: { label: "Late morning", startsAt: at(1, 10), endsAt: at(1, 12), multiplierBps: 10000, createdById: controller.id } }),
    nextDay: await prisma.serviceWindow.create({ data: { startsAt: at(2, 7), endsAt: at(2, 9), multiplierBps: 10000, createdById: controller.id } }),
  };
  // Rush (starts in ~2h), tonight, the day after tomorrow and the following week:
  // together with the slots above, every timing tier can be booked.
  const extraSlots = await addTestSlots(prisma, controller.id, TZ);
  console.log(`Added ${extraSlots} extra time slots for the next 7 days`);

  console.log("Posting cleaner shifts…");
  // Ava and Ben cover every open slot (so whatever Olivia books, Dispatch can place it);
  // The area cleaners do too; Chloe and Diego only work tomorrow's storm. Overlapping shifts are merged.
  const openSlots = await prisma.serviceWindow.findMany({ where: { status: "OPEN" }, orderBy: { startsAt: "asc" } });
  const shiftsFor = new Map<string, { from: Date; to: Date }[]>();
  const addShift = (cleanerId: string, from: Date, to: Date) => shiftsFor.set(cleanerId, [...(shiftsFor.get(cleanerId) ?? []), { from, to }]);
  for (const c of [ava, ben]) {
    addShift(c.id, at(-1, 6), at(-1, 11));
    addShift(c.id, new Date(recentStart.getTime() - HOUR), new Date(recentStart.getTime() + 3 * HOUR));
  }
  for (const c of [ava, ben, ...areaCleaners]) {
    for (const w of openSlots) addShift(c.id, new Date(w.startsAt.getTime() - 30 * 60 * 1000), new Date(w.endsAt.getTime() + 30 * 60 * 1000));
  }
  addShift(chloe.id, at(1, 8), at(1, 12));
  addShift(diego.id, at(1, 6), at(1, 10));
  for (const [cleanerId, list] of shiftsFor) {
    const merged: { from: Date; to: Date }[] = [];
    for (const s of [...list].sort((a, b) => a.from.getTime() - b.from.getTime())) {
      const last = merged[merged.length - 1];
      if (last && s.from <= last.to) last.to = new Date(Math.max(last.to.getTime(), s.to.getTime()));
      else merged.push({ ...s });
    }
    for (const s of merged) await prisma.shift.create({ data: { cleanerId, startsAt: s.from, endsAt: s.to } });
  }

  console.log("Booking jobs…");
  type W = keyof typeof windows;
  let paymentSeq = 0;
  async function book(
    property: Awaited<ReturnType<typeof prisma.property.create>>,
    options: W[],
    extra: { tipCents?: number; includeSalt?: boolean; createdAt?: Date; notes?: string } = {},
  ) {
    const opts = options.map((k) => windows[k]);
    const bookedAt = extra.createdAt ?? new Date(now.getTime() - (20 - paymentSeq) * 9 * 60 * 1000);
    const discountBps = discountOf.get(property.ownerId) ?? 0;
    const q = quoteForWindows(
      { lotSize: property.lotSize, includeSidewalk: property.hasSidewalk, includeSalt: extra.includeSalt ?? false, discountBps },
      opts,
      bookedAt,
    );
    const tipCents = extra.tipCents ?? 0;
    return prisma.job.create({
      data: {
        propertyId: property.id,
        homeownerId: property.ownerId,
        includeSidewalk: property.hasSidewalk,
        includeSalt: extra.includeSalt ?? false,
        notes: extra.notes ?? null,
        priceCents: q.totalCents,
        discountBps: q.discountBps,
        discountCents: q.discountCents,
        tipCents,
        estMinutes: q.estMinutes,
        requiresBlower: q.requiresBlower,
        createdAt: bookedAt,
        windowOptions: { connect: opts.map((w) => ({ id: w.id })) },
        payment: { create: { provider: "mock", externalId: `mock_ch_seed_${++paymentSeq}`, amountCents: q.totalCents + tipCents } },
      },
      include: { property: true },
    });
  }

  async function advance(
    job: Awaited<ReturnType<typeof book>>,
    cleanerId: string,
    windowKey: W,
    status: JobStatus,
    when: { assigned: Date; started?: Date; completed?: Date; confirmed?: Date; routeOrder?: number },
  ) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status,
        cleanerId,
        assignedWindowId: windows[windowKey].id,
        assignedAt: when.assigned,
        startedAt: when.started,
        completedAt: when.completed,
        confirmedAt: when.confirmed,
        routeOrder: when.routeOrder ?? 1,
        disputeReason: status === "DISPUTED" ? "The sidewalk was still icy and the end of the driveway wasn't cleared." : null,
      },
    });
  }

  async function credit(job: Awaited<ReturnType<typeof book>>, cleanerId: string, at: Date) {
    await prisma.ledgerEntry.create({
      data: {
        cleanerId,
        type: "EARNING",
        amountCents: jobEarnings(job),
        jobId: job.id,
        description: `${job.property.address}${job.tipCents > 0 ? ` (incl. ${formatMoney(job.tipCents)} tip)` : ""}`,
        createdAt: at,
      },
    });
  }

  // ── Yesterday: finished history (earnings, reviews) and one dispute.
  const y = (h: number, m = 0) => at(-1, h, m);
  const history = [
    { key: "grace", c: ava, st: "CONFIRMED" as const, tip: 500, review: { rating: 5, comment: "Spotless, even the sidewalk!" } },
    { key: "kiko", c: ava, st: "CONFIRMED" as const, review: { rating: 5, comment: "Quick and friendly." } },
    { key: "liam", c: ben, st: "CONFIRMED" as const, tip: 1000, review: { rating: 4, comment: "Good job, missed a corner." } },
    { key: "jamal", c: ben, st: "DISPUTED" as const },
  ];
  for (const [i, h] of history.entries()) {
    const job = await book(home(h.key), ["yesterday"], { tipCents: h.tip, createdAt: at(-2, 18, i * 5) });
    const confirmedAt = h.st === "CONFIRMED" ? y(10, i * 10) : undefined;
    await advance(job, h.c.id, "yesterday", h.st, {
      assigned: at(-2, 20),
      started: y(7, i * 15),
      completed: y(7, i * 15 + 25),
      confirmed: confirmedAt,
      routeOrder: (i % 2) + 1,
    });
    await seedPhoto(job.id, "BEFORE", h.c.id, y(7, i * 15 - 1), i);
    await seedPhoto(job.id, "AFTER", h.c.id, y(7, i * 15 + 24), i);
    if (confirmedAt) {
      await credit(job, h.c.id, confirmedAt);
      if (h.review) await prisma.review.create({ data: { jobId: job.id, authorId: job.homeownerId, subjectId: h.c.id, rating: h.review.rating, comment: h.review.comment } });
      await prisma.review.create({ data: { jobId: job.id, authorId: h.c.id, subjectId: job.homeownerId, rating: 5, comment: "Accurate size, easy access." } });
    }
  }

  // ── Earlier today: Grace has a finished job to confirm; Ben is mid-job at Maya's.
  const graceDone = await book(home("grace"), ["recent"], { tipCents: 500, createdAt: new Date(recentStart.getTime() - 10 * HOUR) });
  const graceStarted = new Date(recentStart.getTime() + 20 * 60 * 1000);
  const graceDoneAt = new Date(Math.max(graceStarted.getTime() + 10 * 60 * 1000, Math.min(now.getTime() - 30 * 60 * 1000, recentStart.getTime() + 55 * 60 * 1000)));
  await advance(graceDone, ava.id, "recent", "COMPLETED", { assigned: new Date(recentStart.getTime() - 8 * HOUR), started: graceStarted, completed: graceDoneAt });
  await seedPhoto(graceDone.id, "BEFORE", ava.id, new Date(graceStarted.getTime() - 60 * 1000), 0);
  await seedPhoto(graceDone.id, "AFTER", ava.id, new Date(graceDoneAt.getTime() - 60 * 1000), 0);

  const mayaWorking = await book(home("maya"), ["recent"], { createdAt: new Date(recentStart.getTime() - 9 * HOUR) });
  await advance(mayaWorking, ben.id, "recent", "IN_PROGRESS", { assigned: new Date(recentStart.getTime() - 8 * HOUR), started: new Date(now.getTime() - 15 * 60 * 1000) });
  await seedPhoto(mayaWorking.id, "BEFORE", ben.id, new Date(now.getTime() - 16 * 60 * 1000), 2);

  // ── Tomorrow's storm. Two jobs are already placed (so cleaners have stops and Henry
  // sees "Cleaner assigned" with his discount); the rest wait in the Dispatch queue.
  const henryJob = await book(home("henry"), ["early"], { notes: "Please salt the front steps.", includeSalt: true });
  await advance(henryJob, ava.id, "early", "ASSIGNED", { assigned: now, routeOrder: 1 });
  const noahJob = await book(home("noah"), ["early", "mid"], { tipCents: 500 });
  await advance(noahJob, ben.id, "early", "ASSIGNED", { assigned: now, routeOrder: 1 });

  await book(home("grace", 1), ["early", "mid"], { tipCents: 500 });
  await book(home("priya"), ["early"]);
  await book(home("sam"), ["mid"], { includeSalt: true });
  await book(home("kiko"), ["mid", "late"]);
  await book(home("liam"), ["early", "mid", "late"], { tipCents: 500 });
  await book(home("jamal"), ["late"]);

  console.log("Stocking the tool library…");
  const tool = async (name: string, type: "SHOVEL" | "SNOW_BLOWER" | "SALT_SPREADER" | "ICE_CHOPPER", feeCents: number, extra: { status?: "MAINTENANCE"; notes?: string } = {}) =>
    prisma.tool.create({ data: { name, type, feeCents, ...extra } });
  const tools = {
    blowerA: await tool("Snow blower A", "SNOW_BLOWER", 1500, { notes: "24-inch two-stage. Fuel can is on the shelf." }),
    blowerB: await tool("Snow blower B", "SNOW_BLOWER", 1500),
    blowerC: await tool("Snow blower C", "SNOW_BLOWER", 1500, { status: "MAINTENANCE", notes: "Auger belt being replaced." }),
    shovel: await tool("Ergonomic shovel", "SHOVEL", 300),
    spreader: await tool("Walk-behind salt spreader", "SALT_SPREADER", 500),
    chopper: await tool("Ice chopper", "ICE_CHOPPER", 400),
  };

  /** A rental, plus its fee on the cleaner's ledger once approved (like transitionRental does). */
  async function rent(
    t: (typeof tools)[keyof typeof tools],
    cleanerId: string,
    startsAt: Date,
    endsAt: Date,
    status: "REQUESTED" | "APPROVED" | "RETURNED" | "REJECTED",
    decidedAt?: Date,
  ) {
    const rental = await prisma.toolRental.create({
      data: { toolId: t.id, cleanerId, startsAt, endsAt, status, feeCents: t.feeCents, decidedAt, createdAt: decidedAt ? new Date(decidedAt.getTime() - HOUR) : now },
    });
    if (status === "APPROVED" || status === "RETURNED") {
      await prisma.ledgerEntry.create({
        data: { cleanerId, type: "RENTAL_FEE", amountCents: -t.feeCents, rentalId: rental.id, description: rentalFeeDescription(t.name, rental), createdAt: decidedAt ?? now },
      });
    }
    return rental;
  }
  // Ava has no snow blower of her own: she rented one yesterday and has one reserved for tomorrow.
  await rent(tools.blowerA, ava.id, at(-1, 6), at(-1, 11), "RETURNED", at(-2, 19));
  await rent(tools.blowerA, ava.id, at(1, 6), at(1, 12), "APPROVED", new Date(now.getTime() - 2 * HOUR));
  // Ben took the ice chopper out this morning and hasn't brought it back (overdue).
  await rent(tools.chopper, ben.id, new Date(recentStart.getTime() - HOUR), new Date(recentStart.getTime() + 2 * HOUR), "APPROVED", new Date(recentStart.getTime() - 2 * HOUR));
  // Waiting for the controller: Chloe wants blower B; Diego asked for blower A, which
  // clashes with Ava's reservation, so it can only be declined.
  await rent(tools.blowerB, chloe.id, at(1, 8), at(1, 12), "REQUESTED");
  await rent(tools.blowerA, diego.id, at(1, 10), at(1, 14), "REQUESTED");
  await rent(tools.spreader, chloe.id, at(-1, 6), at(-1, 10), "REJECTED", at(-2, 20));

  const counts = await prisma.job.groupBy({ by: ["status"], _count: { _all: true } });
  const rush = openSlots.find((w) => w.label === "Rush");
  console.log("Jobs by status:", Object.fromEntries(counts.map((c) => [c.status, c._count._all])));
  console.log(`\nSeeded ${ownerSpecs.length} homeowners, ${cleaners.length + areaCleaners.length} cleaners, ${Object.values(homes).flat().length} homes, ${openSlots.length} open time slots.`);
  console.log(`\nDemo walkthrough (password "${PASSWORD}"):`);
  console.log(`  1. olivia.home@snowber.test  → Book clearing → pick a slot${rush ? ` (Rush slot starts ${rush.startsAt.toLocaleTimeString("en-CA", { timeZone: TZ, hour: "numeric", minute: "2-digit" })})` : ""} → pay`);
  console.log("  2. controller@snowber.test   → Dispatch → pick Olivia's slot → Suggest → Apply (goes to Ava)");
  console.log("  3. ava.cleaner@snowber.test  → open the stop → before photo → Start → after photo → Mark done");
  console.log("  4. olivia.home@snowber.test  → open the job → Looks good — confirm → review");
  console.log("  Ready-made: grace (job to confirm) · henry (senior discount) · isla (discount to approve) · ben (in progress) · jamal (dispute)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
