/**
 * Demo data for one fictional neighborhood ("Maple Hollow"): 40 homes, 25 homeowners,
 * 8 cleaner accounts, service windows for tomorrow's storm, and bookings in every
 * state a homeowner can see. Photos, shifts, tools and earnings are added by the
 * members who build those areas.
 *
 *   npm run db:seed        (or: npx prisma db seed)
 *
 * Every account's password is "snowber-demo".
 * The seed wipes existing data first; never run it against a production database.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type JobStatus, type LotSize } from "../src/generated/prisma/client";
import { NEIGHBORHOOD_CENTER } from "../src/lib/config";
import { quoteForWindows } from "../src/lib/pricing";
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

// ───────────────── main ─────────────────

async function main() {
  console.log("Resetting data…");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "LedgerEntry","Payment","Review","JobPhoto","_JobWindowOptions","Job","ToolRental","Tool","Shift","ServiceWindow","Property","Session","Account","Verification","User" RESTART IDENTITY CASCADE`,
  );

  console.log("Creating accounts…");
  const controller = await createUser({ name: "Morgan Lee", email: "controller@snowber.test", role: "CONTROLLER" });

  // Maple Hollow: five streets around the neighborhood center.
  const streets = [
    { name: "Maple Crescent", lat: 0.0022, lng: -0.004, dLat: 0, dLng: 0.00045 },
    { name: "Birch Avenue", lat: 0.0008, lng: -0.004, dLat: 0, dLng: 0.00045 },
    { name: "Cedar Lane", lat: -0.0006, lng: -0.004, dLat: 0, dLng: 0.00045 },
    { name: "Willow Street", lat: -0.002, lng: -0.004, dLat: 0, dLng: 0.00045 },
    { name: "Juniper Road", lat: -0.0026, lng: 0.0006, dLat: 0.0006, dLng: 0 },
  ];
  const homeAt = (street: number, index: number) => ({
    lat: NEIGHBORHOOD_CENTER.lat + streets[street].lat + streets[street].dLat * index + (rand() - 0.5) * 0.00008,
    lng: NEIGHBORHOOD_CENTER.lng + streets[street].lng + streets[street].dLng * index + (rand() - 0.5) * 0.00008,
  });

  const cleanerSpecs = [
    { name: "Ava Chen", email: "ava.cleaner@snowber.test", street: 0, index: 2, ownsBlower: false },
    { name: "Ben Okafor", email: "ben.cleaner@snowber.test", street: 2, index: 15, ownsBlower: true },
    { name: "Chloe Martin", email: "chloe.cleaner@snowber.test", street: 1, index: 9, ownsBlower: false },
    { name: "Diego Ramirez", email: "diego.cleaner@snowber.test", street: 3, index: 4, ownsBlower: true },
    { name: "Emma Wilson", email: "emma.cleaner@snowber.test", street: 4, index: 3, ownsBlower: false },
    { name: "Farah Haddad", email: "farah.cleaner@snowber.test", street: 3, index: 13, ownsBlower: false },
    { name: "Gus Novak", email: "gus.cleaner@snowber.test", street: 0, index: 12, ownsBlower: false },
    { name: "Hana Sato", email: "hana.cleaner@snowber.test", street: 1, index: 1, ownsBlower: false },
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
  const [ava, ben] = cleaners;

  const firstNames = ["Grace", "Henry", "Isla", "Jamal", "Kiko", "Liam", "Maya", "Noah", "Olivia", "Priya", "Quinn", "Rosa", "Sam", "Tara", "Umar", "Vera", "Will", "Xin", "Yara", "Zoe", "Arjun", "Bea", "Carlos", "Dana", "Eli"];
  const lastNames = ["Kim", "Brown", "Singh", "Tremblay", "Roy", "Gagnon", "Wong", "Patel", "Lee", "Martin", "Nguyen", "Fraser", "Cohen", "Ali", "Rossi"];
  const homeowners: Awaited<ReturnType<typeof createUser>>[] = [];
  for (let i = 0; i < firstNames.length; i++) {
    const name = `${firstNames[i]} ${i === 0 ? "Kim" : lastNames[i % lastNames.length]}`;
    const email = i === 0 ? "grace.home@snowber.test" : `${firstNames[i].toLowerCase()}.home@snowber.test`;
    // Henry already has an approved senior discount; Isla's accessibility request waits for the controller.
    const extra = i === 1 ? { discountProgram: "SENIOR", discountStatus: "APPROVED" } : i === 2 ? { discountProgram: "ACCESSIBILITY", discountStatus: "PENDING" } : undefined;
    homeowners.push(await createUser({ name, email, role: "HOMEOWNER", extra }));
  }

  console.log("Creating 40 properties…");
  const lotCycle: LotSize[] = ["SMALL", "MEDIUM", "SMALL", "MEDIUM", "LARGE", "MEDIUM", "SMALL", "MEDIUM", "SMALL", "LARGE"];
  const notes = [null, null, "Please pile snow on the left side.", "Watch the icy front steps.", null, "Gate code 4512.", null, "Car leaves at 7:30 — driveway first please."];
  const properties: Awaited<ReturnType<typeof prisma.property.create>>[] = [];
  for (let i = 0; i < 40; i++) {
    const street = i % 5;
    const index = Math.floor(i / 5) * 2 + (street % 2);
    const owner = i < 25 ? homeowners[i] : homeowners[(i - 25) % 6]; // Grace and a few others own two properties
    const position = homeAt(street, index);
    properties.push(
      await prisma.property.create({
        data: {
          ownerId: owner.id,
          label: owner.id === homeowners[0].id ? (i === 0 ? "Home" : "Mom's place") : null,
          address: `${index * 2 + 10} ${streets[street].name}, Toronto, ON`,
          lat: position.lat,
          lng: position.lng,
          lotSize: lotCycle[i % lotCycle.length],
          hasSidewalk: i % 7 !== 3,
          notes: pick(notes),
        },
      }),
    );
  }

  console.log("Creating service windows…");
  const recentStart = new Date(Math.floor((now.getTime() - 3 * HOUR) / HOUR) * HOUR);
  const windows = {
    yesterday: await prisma.serviceWindow.create({ data: { startsAt: at(-1, 7), endsAt: at(-1, 9), multiplierBps: 12500, status: "CLOSED", createdById: controller.id } }),
    recent: await prisma.serviceWindow.create({ data: { startsAt: recentStart, endsAt: new Date(recentStart.getTime() + 2 * HOUR), multiplierBps: 10000, status: "CLOSED", createdById: controller.id } }),
    early: await prisma.serviceWindow.create({ data: { label: "Early birds", startsAt: at(1, 6), endsAt: at(1, 8), multiplierBps: 15000, createdById: controller.id } }),
    mid: await prisma.serviceWindow.create({ data: { startsAt: at(1, 8), endsAt: at(1, 10), multiplierBps: 12500, createdById: controller.id } }),
    late: await prisma.serviceWindow.create({ data: { startsAt: at(1, 10), endsAt: at(1, 12), multiplierBps: 10000, createdById: controller.id } }),
    nextDay: await prisma.serviceWindow.create({ data: { startsAt: at(2, 7), endsAt: at(2, 9), multiplierBps: 10000, createdById: controller.id } }),
  };

  const extraSlots = await addTestSlots(prisma, controller.id, TZ);
  console.log(`Added ${extraSlots} extra test time slots for the next 7 days`);

  console.log("Booking jobs…");
  type W = keyof typeof windows;
  async function book(propertyIndex: number, options: W[], extra: { tipCents?: number; includeSalt?: boolean; createdAt?: Date } = {}) {
    const property = properties[propertyIndex];
    const opts = options.map((k) => windows[k]);
    const q = quoteForWindows({ lotSize: property.lotSize, includeSidewalk: property.hasSidewalk, includeSalt: extra.includeSalt ?? false }, opts, extra.createdAt ?? now);
    const tipCents = extra.tipCents ?? 0;
    return prisma.job.create({
      data: {
        propertyId: property.id,
        homeownerId: property.ownerId,
        includeSidewalk: property.hasSidewalk,
        includeSalt: extra.includeSalt ?? false,
        priceCents: q.totalCents,
        tipCents,
        estMinutes: q.estMinutes,
        requiresBlower: q.requiresBlower,
        createdAt: extra.createdAt ?? new Date(now.getTime() - (40 - propertyIndex) * 7 * 60 * 1000),
        windowOptions: { connect: opts.map((w) => ({ id: w.id })) },
        payment: { create: { provider: "mock", externalId: `mock_ch_seed_${propertyIndex}`, amountCents: q.totalCents + tipCents } },
      },
      include: { property: true },
    });
  }

  async function advance(
    job: Awaited<ReturnType<typeof book>>,
    cleanerId: string,
    windowKey: W,
    status: JobStatus,
    when: { assigned: Date; started?: Date; completed?: Date; confirmed?: Date },
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
        disputeReason: status === "DISPUTED" ? "The sidewalk was still icy and the end of the driveway wasn't cleared." : null,
      },
    });
  }

  // Yesterday: finished history for Ava and Ben.
  const y = (h: number, m = 0) => at(-1, h, m);
  const history = [
    { p: 5, c: ava, st: "CONFIRMED" as const, tip: 500 },
    { p: 10, c: ava, st: "CONFIRMED" as const },
    { p: 15, c: ben, st: "CONFIRMED" as const },
    { p: 20, c: ben, st: "CONFIRMED" as const, tip: 1000 },
    { p: 25, c: ben, st: "DISPUTED" as const },
  ];
  for (const [i, h] of history.entries()) {
    const job = await book(h.p, ["yesterday"], { tipCents: h.tip, createdAt: at(-2, 18, i * 5) });
    await advance(job, h.c.id, "yesterday", h.st, {
      assigned: at(-2, 20),
      started: y(7, i * 15),
      completed: y(7, i * 15 + 25),
      confirmed: h.st === "CONFIRMED" ? y(10, i * 10) : undefined,
    });
    await prisma.job.update({ where: { id: job.id }, data: { routeOrder: (i % 3) + 1 } });
  }
  // Two-way reviews on the confirmed history.
  const confirmed = await prisma.job.findMany({ where: { status: "CONFIRMED" }, select: { id: true, cleanerId: true, homeownerId: true } });
  for (const [i, job] of confirmed.entries()) {
    await prisma.review.create({ data: { jobId: job.id, authorId: job.homeownerId, subjectId: job.cleanerId!, rating: [5, 5, 4, 5][i % 4], comment: ["Spotless, even the sidewalk!", "Quick and friendly.", "Good job, missed a corner.", null][i % 4] } });
    if (i % 2 === 0) await prisma.review.create({ data: { jobId: job.id, authorId: job.cleanerId!, subjectId: job.homeownerId, rating: 5, comment: "Accurate size, easy access." } });
  }

  // Earlier today: one job waiting for Grace to confirm, one still in progress.
  const graceDone = await book(0, ["recent"], { tipCents: 500, createdAt: new Date(recentStart.getTime() - 10 * HOUR) });
  await advance(graceDone, ava.id, "recent", "COMPLETED", {
    assigned: new Date(recentStart.getTime() - 8 * HOUR),
    started: new Date(recentStart.getTime() + 20 * 60 * 1000),
    completed: new Date(Math.min(now.getTime() - 30 * 60 * 1000, recentStart.getTime() + 55 * 60 * 1000)),
  });
  await prisma.job.update({ where: { id: graceDone.id }, data: { routeOrder: 1 } });
  const benWorking = await book(12, ["recent"], { createdAt: new Date(recentStart.getTime() - 9 * HOUR) });
  await advance(benWorking, ben.id, "recent", "IN_PROGRESS", {
    assigned: new Date(recentStart.getTime() - 8 * HOUR),
    started: new Date(now.getTime() - 15 * 60 * 1000),
  });
  await prisma.job.update({ where: { id: benWorking.id }, data: { routeOrder: 1 } });

  // Tomorrow's storm: a surge of requests across the three windows.
  const optionSets: W[][] = [["early"], ["early", "mid"], ["mid"], ["mid", "late"], ["late"], ["early", "mid", "late"]];
  for (let i = 1; i < 40; i++) {
    if ([5, 10, 15, 20, 25, 12].includes(i) || i % 9 === 8) continue; // history above, and some homes didn't book
    await book(i, optionSets[i % optionSets.length], { tipCents: i % 4 === 0 ? 500 : 0, includeSalt: i % 6 === 0 });
  }
  // Grace's own home also books an early slot.
  await book(0, ["early", "mid"], { tipCents: 500 });

  // The controller already placed the oldest early requests with Ava and Ben,
  // so homeowners can see "Cleaner assigned". The rest wait in the queue.
  const earlyJobs = await prisma.job.findMany({
    where: { status: "REQUESTED", windowOptions: { some: { id: windows.early.id } } },
    orderBy: { createdAt: "asc" },
    take: 4,
  });
  for (const [i, job] of earlyJobs.entries()) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "ASSIGNED", cleanerId: i < 2 ? ava.id : ben.id, assignedWindowId: windows.early.id, assignedAt: now, routeOrder: (i % 2) + 1 },
    });
  }
  // Notes so the cleaner preview shows what homeowners wrote.
  if (earlyJobs[0]) {
    await prisma.job.update({ where: { id: earlyJobs[0].id }, data: { notes: "Please clear a path to the side door too." } });
    await prisma.property.update({ where: { id: earlyJobs[0].propertyId }, data: { notes: "Gate code 4512. Pile snow on the left side." } });
  }

  const counts = await prisma.job.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("Jobs by status:", Object.fromEntries(counts.map((c) => [c.status, c._count._all])));
  console.log(`\nSeeded ${homeowners.length} homeowners, ${cleaners.length} cleaners, ${properties.length} properties.`);
  console.log(`Sign in with any demo account, password "${PASSWORD}":`);
  console.log("  grace.home@snowber.test · henry.home@snowber.test (senior discount) · controller@snowber.test");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
