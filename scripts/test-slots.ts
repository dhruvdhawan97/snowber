// Extra open time slots for testing booking and pricing.
// Covers every timing tier: Rush (<6h), Soon (<24h), Standard (<72h) and Book ahead (3+ days).
// Safe to run more than once: a slot that already starts at the same time is skipped.
import type { PrismaClient } from "../src/generated/prisma/client";
import { addCalendarDays, zonedCalendarDate, zonedTimeToUtc } from "../src/lib/time";

const HOUR = 60 * 60 * 1000;

export async function addTestSlots(prisma: PrismaClient, createdById: string | null, tz: string) {
  const now = new Date();
  const today = zonedCalendarDate(now, tz);
  const at = (daysAhead: number, hour: number) => zonedTimeToUtc({ ...addCalendarDays(today, daysAhead), hour, minute: 0 }, tz);

  // A rush slot that starts on the next full hour + 2h, so it's always in the future.
  const rushStart = new Date(Math.ceil(now.getTime() / HOUR) * HOUR + 2 * HOUR);

  const slots: { label?: string; startsAt: Date; hours: number; multiplierBps: number }[] = [
    { label: "Test: rush", startsAt: rushStart, hours: 2, multiplierBps: 10000 },
    { label: "Test: tonight", startsAt: at(0, 18), hours: 2, multiplierBps: 10000 },
    { startsAt: at(2, 13), hours: 2, multiplierBps: 10000 },
    { startsAt: at(2, 16), hours: 2, multiplierBps: 12500 },
  ];
  for (let day = 3; day <= 7; day++) {
    slots.push({ startsAt: at(day, 8), hours: 2, multiplierBps: 10000 });
    slots.push({ startsAt: at(day, 14), hours: 2, multiplierBps: 10000 });
  }

  let created = 0;
  for (const slot of slots) {
    if (slot.startsAt.getTime() <= now.getTime() + 30 * 60 * 1000) continue; // already started or about to
    const exists = await prisma.serviceWindow.findFirst({ where: { startsAt: slot.startsAt } });
    if (exists) continue;
    await prisma.serviceWindow.create({
      data: {
        label: slot.label,
        startsAt: slot.startsAt,
        endsAt: new Date(slot.startsAt.getTime() + slot.hours * HOUR),
        multiplierBps: slot.multiplierBps,
        createdById,
      },
    });
    created++;
  }
  return created;
}
