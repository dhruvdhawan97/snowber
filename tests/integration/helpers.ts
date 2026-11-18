import { randomUUID } from "node:crypto";
import type { JobStatus, LotSize, PhotoKind, ToolType } from "@/lib/contracts/domain";
import type { CurrentUser } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";

// Small factories for integration tests. They write rows directly only to set the
// scene; every behavior under test goes through the real DAL functions.

const HOUR = 60 * 60 * 1000;

export const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR);

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "LedgerEntry","Payment","Review","JobPhoto","_JobWindowOptions","Job","ToolRental","Tool","Shift","ServiceWindow","Property","Session","Account","Verification","User" RESTART IDENTITY CASCADE`,
  );
}

export async function makeUser(role: CurrentUser["role"], extra: { name?: string; ownsBlower?: boolean } = {}): Promise<CurrentUser> {
  const id = randomUUID();
  const name = extra.name ?? `${role.toLowerCase()} ${id.slice(0, 6)}`;
  const email = `${role.toLowerCase()}-${id}@snowber.test`;
  await prisma.user.create({ data: { id, name, email, emailVerified: true, role, ownsBlower: extra.ownsBlower ?? false } });
  return { id, name, email, role };
}

export async function makeProperty(ownerId: string, lotSize: LotSize = "MEDIUM") {
  return prisma.property.create({
    data: { ownerId, address: `${Math.floor(Math.random() * 900) + 100} Test Street`, lat: 43.66, lng: -79.41, lotSize },
  });
}

export async function makeWindow(startsAt: Date, endsAt: Date) {
  return prisma.serviceWindow.create({ data: { startsAt, endsAt } });
}

export async function makeTool(type: ToolType = "SNOW_BLOWER", feeCents = 1500, name = `${type} ${randomUUID().slice(0, 4)}`) {
  return prisma.tool.create({ data: { name, type, feeCents } });
}

/** A photo row as finalizePhoto would leave it (no image processing needed). */
export async function addPhoto(jobId: string, kind: PhotoKind, uploadedById: string) {
  const id = randomUUID();
  return prisma.jobPhoto.create({
    data: { id, jobId, kind, displayKey: `jobs/${jobId}/${kind.toLowerCase()}/${id}.webp`, thumbKey: `jobs/${jobId}/${kind.toLowerCase()}/${id}-thumb.webp`, width: 1600, height: 1200, uploadedById },
  });
}

/**
 * A paid job already at `status`, with the photos and timestamps that status implies.
 * Used for scenarios that start mid-workflow (disputes, auto-confirm, integrity checks).
 */
export async function makeJob(opts: {
  homeownerId: string;
  cleanerId?: string;
  status: JobStatus;
  lotSize?: LotSize;
  window?: { id: string };
  completedAt?: Date;
  priceCents?: number;
}) {
  const property = await makeProperty(opts.homeownerId, opts.lotSize ?? "MEDIUM");
  const priceCents = opts.priceCents ?? 5000;
  const job = await prisma.job.create({
    data: {
      propertyId: property.id,
      homeownerId: opts.homeownerId,
      cleanerId: opts.cleanerId,
      assignedWindowId: opts.window?.id,
      status: opts.status,
      priceCents,
      estMinutes: 40,
      requiresBlower: (opts.lotSize ?? "MEDIUM") === "LARGE",
      completedAt: opts.completedAt ?? (["COMPLETED", "DISPUTED", "CONFIRMED"].includes(opts.status) ? new Date() : null),
      payment: { create: { provider: "mock", externalId: `mock_ch_${randomUUID()}`, amountCents: priceCents } },
    },
  });
  if (opts.cleanerId && ["IN_PROGRESS", "COMPLETED", "DISPUTED", "CONFIRMED"].includes(opts.status)) await addPhoto(job.id, "BEFORE", opts.cleanerId);
  if (opts.cleanerId && ["COMPLETED", "DISPUTED", "CONFIRMED"].includes(opts.status)) await addPhoto(job.id, "AFTER", opts.cleanerId);
  return job;
}

/** A cleaner's balance: the sum of their append-only ledger. */
export async function balance(cleanerId: string): Promise<number> {
  const sum = await prisma.ledgerEntry.aggregate({ where: { cleanerId }, _sum: { amountCents: true } });
  return sum._sum.amountCents ?? 0;
}
