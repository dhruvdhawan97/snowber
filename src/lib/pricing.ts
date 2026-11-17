// Rate card and quoting. Pure functions: the server recomputes every price,
// so a client can never set its own price.
//
//   price = (lot base + add-ons) × window rate × timing factor − discount
//
// • Window rate:   set by the controller per service window (busy mornings cost more).
// • Timing factor: how soon the clearing starts after booking. Rush jobs cost more,
//                  booking days ahead costs less (it lets the controller plan routes).
// • Discount:      approved senior / accessibility discount, taken off the service
//                  price (not the tip). The platform absorbs it: cleaners are paid on
//                  the price before the discount.

import type { LotSize } from "./contracts/domain";

export const RATE_CARD = {
  baseCents: { SMALL: 3000, MEDIUM: 4500, LARGE: 6500 } satisfies Record<LotSize, number>,
  sidewalkCents: 1000,
  saltCents: 800,
  minutes: { SMALL: 25, MEDIUM: 40, LARGE: 55 } satisfies Record<LotSize, number>,
  sidewalkMinutes: 10,
  saltMinutes: 5,
  /** Cleaners keep 80% of the price; the rest funds tools and operations. */
  cleanerShareBps: 8000,
} as const;

/** Timing tiers, checked in order: the first tier whose `maxHours` covers the lead time wins. */
export const TIMING_TIERS = [
  { key: "RUSH", maxHours: 6, bps: 15000, label: "Rush (starts within 6 hours)", short: "Rush +50%" },
  { key: "SOON", maxHours: 24, bps: 12000, label: "Soon (starts within 24 hours)", short: "Soon +20%" },
  { key: "STANDARD", maxHours: 72, bps: 10000, label: "Standard", short: null },
  { key: "AHEAD", maxHours: Infinity, bps: 9000, label: "Booked ahead (3+ days)", short: "Book ahead −10%" },
] as const;

export type TimingTier = (typeof TIMING_TIERS)[number];

/** 20% off for approved seniors (65+) and people with disabilities. */
export const DISCOUNT_BPS = { SENIOR: 2000, ACCESSIBILITY: 2000 } as const;
export type DiscountProgramKey = keyof typeof DISCOUNT_BPS;

export const DISCOUNT_LABEL: Record<DiscountProgramKey, string> = {
  SENIOR: "Senior discount",
  ACCESSIBILITY: "Accessibility discount",
};

/** Discount (in basis points) a homeowner gets right now: only once a controller approves it. */
export function discountBpsFor(program: DiscountProgramKey | null | undefined, status: string | null | undefined): number {
  return program && status === "APPROVED" ? DISCOUNT_BPS[program] : 0;
}

/** Which timing tier applies when a job booked at `bookedAt` starts at `startsAt`. */
export function timingFor(bookedAt: Date, startsAt: Date): TimingTier {
  const hours = (startsAt.getTime() - bookedAt.getTime()) / 3_600_000;
  return TIMING_TIERS.find((tier) => hours <= tier.maxHours) ?? TIMING_TIERS[TIMING_TIERS.length - 1];
}

export type QuoteInput = {
  lotSize: LotSize;
  includeSidewalk: boolean;
  includeSalt: boolean;
  /** Window multiplier in basis points (10000 = 1.00x). */
  multiplierBps: number;
  /** Timing factor in basis points; defaults to 1.00x. */
  timingBps?: number;
  /** Discount in basis points (2000 = 20% off); defaults to none. */
  discountBps?: number;
};

export type Quote = {
  baseCents: number;
  addOnsCents: number;
  subtotalCents: number;
  multiplierBps: number;
  timingBps: number;
  timingLabel: string;
  /** Price after window rate and timing, before any discount. */
  listCents: number;
  discountBps: number;
  discountCents: number;
  /** What the homeowner pays for the service (excludes tip). */
  totalCents: number;
  estMinutes: number;
  requiresBlower: boolean;
  cleanerPayoutCents: number;
};

export function applyMultiplier(cents: number, multiplierBps: number): number {
  return Math.round((cents * multiplierBps) / 10000);
}

export function quote(input: QuoteInput): Quote {
  if (!Number.isInteger(input.multiplierBps) || input.multiplierBps < 5000 || input.multiplierBps > 30000) {
    throw new RangeError("multiplierBps must be an integer between 5000 and 30000");
  }
  const timingBps = input.timingBps ?? 10000;
  const discountBps = input.discountBps ?? 0;
  if (!Number.isInteger(timingBps) || timingBps < 5000 || timingBps > 20000) {
    throw new RangeError("timingBps must be an integer between 5000 and 20000");
  }
  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 5000) {
    throw new RangeError("discountBps must be an integer between 0 and 5000");
  }

  const baseCents = RATE_CARD.baseCents[input.lotSize];
  const addOnsCents =
    (input.includeSidewalk ? RATE_CARD.sidewalkCents : 0) + (input.includeSalt ? RATE_CARD.saltCents : 0);
  const subtotalCents = baseCents + addOnsCents;
  const listCents = applyMultiplier(applyMultiplier(subtotalCents, input.multiplierBps), timingBps);
  const discountCents = Math.round((listCents * discountBps) / 10000);
  const totalCents = listCents - discountCents;
  const estMinutes =
    RATE_CARD.minutes[input.lotSize] +
    (input.includeSidewalk ? RATE_CARD.sidewalkMinutes : 0) +
    (input.includeSalt ? RATE_CARD.saltMinutes : 0);

  return {
    baseCents,
    addOnsCents,
    subtotalCents,
    multiplierBps: input.multiplierBps,
    timingBps,
    timingLabel: TIMING_TIERS.find((t) => t.bps === timingBps)?.label ?? "Standard",
    listCents,
    discountBps,
    discountCents,
    totalCents,
    estMinutes,
    requiresBlower: input.lotSize === "LARGE",
    cleanerPayoutCents: cleanerPayout(listCents),
  };
}

export type WindowPricing = { multiplierBps: number; startsAt: Date };

/** Quote for one window, applying the timing tier for when it starts. */
export function quoteForWindow(
  base: Omit<QuoteInput, "multiplierBps" | "timingBps">,
  window: WindowPricing,
  bookedAt: Date,
): Quote {
  return quote({ ...base, multiplierBps: window.multiplierBps, timingBps: timingFor(bookedAt, window.startsAt).bps });
}

/**
 * A homeowner may accept several windows with different rates and start times.
 * They are charged for the most expensive one up front; if the controller assigns
 * a cheaper window, the difference is refunded at assignment time.
 */
export function quoteForWindows(
  base: Omit<QuoteInput, "multiplierBps" | "timingBps">,
  windows: WindowPricing[],
  bookedAt: Date,
): Quote {
  if (windows.length === 0) throw new RangeError("Pick at least one window");
  return windows
    .map((w) => quoteForWindow(base, w, bookedAt))
    .reduce((max, q) => (q.totalCents > max.totalCents ? q : max));
}

/** What the cleaner earns for a job: their share of the price before any discount. */
export function cleanerPayout(listCents: number): number {
  return Math.floor((listCents * RATE_CARD.cleanerShareBps) / 10000);
}

/** Cleaner earnings for a stored job (price + absorbed discount, plus the full tip). */
export function jobEarnings(job: { priceCents: number; discountCents: number; tipCents: number }): number {
  return cleanerPayout(job.priceCents + job.discountCents) + job.tipCents;
}
