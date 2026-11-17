import { describe, expect, it } from "vitest";
import { DISCOUNT_BPS, RATE_CARD, TIMING_TIERS, applyMultiplier, cleanerPayout, discountBpsFor, jobEarnings, quote, quoteForWindows, timingFor } from "@/lib/pricing";

const NOW = new Date("2026-11-20T12:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe("quote", () => {
  it("prices a small driveway with sidewalk at 1x", () => {
    const q = quote({ lotSize: "SMALL", includeSidewalk: true, includeSalt: false, multiplierBps: 10000 });
    expect(q.baseCents).toBe(RATE_CARD.baseCents.SMALL);
    expect(q.addOnsCents).toBe(RATE_CARD.sidewalkCents);
    expect(q.totalCents).toBe(4000);
    expect(q.estMinutes).toBe(35);
    expect(q.requiresBlower).toBe(false);
  });

  it("applies the window multiplier to base plus add-ons", () => {
    const q = quote({ lotSize: "MEDIUM", includeSidewalk: true, includeSalt: true, multiplierBps: 12500 });
    // (4500 + 1000 + 800) * 1.25 = 7875
    expect(q.totalCents).toBe(7875);
    expect(q.estMinutes).toBe(40 + 10 + 5);
  });

  it("marks large lots as needing a snow blower", () => {
    expect(quote({ lotSize: "LARGE", includeSidewalk: false, includeSalt: false, multiplierBps: 10000 }).requiresBlower).toBe(true);
  });

  it("rejects multipliers outside 0.5x–3x", () => {
    expect(() => quote({ lotSize: "SMALL", includeSidewalk: false, includeSalt: false, multiplierBps: 40000 })).toThrow(RangeError);
    expect(() => quote({ lotSize: "SMALL", includeSidewalk: false, includeSalt: false, multiplierBps: 1.5 })).toThrow(RangeError);
  });
});

describe("quoteForWindows", () => {
  it("charges the most expensive accepted window", () => {
    // All three windows start 2 days out (standard timing), so only the window rate differs.
    const q = quoteForWindows(
      { lotSize: "SMALL", includeSidewalk: false, includeSalt: false },
      [10000, 15000, 12500].map((multiplierBps) => ({ multiplierBps, startsAt: inHours(48) })),
      NOW,
    );
    expect(q.multiplierBps).toBe(15000);
    expect(q.totalCents).toBe(4500);
  });

  it("requires at least one window", () => {
    expect(() => quoteForWindows({ lotSize: "SMALL", includeSidewalk: false, includeSalt: false }, [], NOW)).toThrow();
  });
});

describe("payout and rounding", () => {
  it("gives cleaners 80% rounded down to the cent", () => {
    expect(cleanerPayout(4000)).toBe(3200);
    expect(cleanerPayout(7875)).toBe(6300);
    expect(cleanerPayout(999)).toBe(799);
  });

  it("rounds multiplied prices to the nearest cent", () => {
    expect(applyMultiplier(3333, 12500)).toBe(4166);
  });
});

describe("timing", () => {
  it("charges more the sooner the clearing starts and less when booked ahead", () => {
    expect(timingFor(NOW, inHours(3)).key).toBe("RUSH");
    expect(timingFor(NOW, inHours(6)).key).toBe("RUSH");
    expect(timingFor(NOW, inHours(12)).key).toBe("SOON");
    expect(timingFor(NOW, inHours(48)).key).toBe("STANDARD");
    expect(timingFor(NOW, inHours(100)).key).toBe("AHEAD");
    const bps = TIMING_TIERS.map((t) => t.bps);
    expect([...bps].sort((a, b) => b - a)).toEqual(bps); // strictly cheaper as lead time grows
  });

  it("applies the timing factor on top of the window rate", () => {
    const base = { lotSize: "SMALL" as const, includeSidewalk: true, includeSalt: false };
    const rush = quoteForWindows(base, [{ multiplierBps: 10000, startsAt: inHours(2) }], NOW);
    const ahead = quoteForWindows(base, [{ multiplierBps: 10000, startsAt: inHours(96) }], NOW);
    expect(rush.totalCents).toBe(6000); // 4000 × 1.5
    expect(ahead.totalCents).toBe(3600); // 4000 × 0.9
    expect(rush.timingLabel).toMatch(/Rush/);
  });

  it("charges the most expensive window when a rush window beats a busy later one", () => {
    const q = quoteForWindows(
      { lotSize: "SMALL", includeSidewalk: false, includeSalt: false },
      [
        { multiplierBps: 10000, startsAt: inHours(3) }, // 3000 × 1.5 = 4500
        { multiplierBps: 12500, startsAt: inHours(48) }, // 3000 × 1.25 = 3750
      ],
      NOW,
    );
    expect(q.totalCents).toBe(4500);
  });
});

describe("discounts", () => {
  it("only applies once approved", () => {
    expect(discountBpsFor("SENIOR", "PENDING")).toBe(0);
    expect(discountBpsFor("SENIOR", "APPROVED")).toBe(DISCOUNT_BPS.SENIOR);
    expect(discountBpsFor("ACCESSIBILITY", "APPROVED")).toBe(DISCOUNT_BPS.ACCESSIBILITY);
    expect(discountBpsFor(null, null)).toBe(0);
  });

  it("takes 20% off the service price and the platform absorbs it", () => {
    const q = quote({ lotSize: "MEDIUM", includeSidewalk: true, includeSalt: false, multiplierBps: 10000, discountBps: 2000 });
    expect(q.listCents).toBe(5500);
    expect(q.discountCents).toBe(1100);
    expect(q.totalCents).toBe(4400);
    // Cleaner earns 80% of the undiscounted price.
    expect(q.cleanerPayoutCents).toBe(4400);
    expect(jobEarnings({ priceCents: 4400, discountCents: 1100, tipCents: 500 })).toBe(4400 + 500);
  });

  it("rejects out-of-range discounts", () => {
    expect(() => quote({ lotSize: "SMALL", includeSidewalk: false, includeSalt: false, multiplierBps: 10000, discountBps: 9000 })).toThrow(RangeError);
  });
});
