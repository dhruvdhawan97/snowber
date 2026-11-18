import { describe, expect, it } from "vitest";
import {
  RENTAL_HORIZON_DAYS,
  canRentalTransition,
  checkRentalTransition,
  covers,
  hasBlowerCoverage,
  rangesOverlap,
  rentalPhase,
  rentalRequestError,
  type RentalActor,
  type RentalSnapshot,
} from "@/lib/contracts/rental-states";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-20T12:00:00Z");
const at = (hours: number) => new Date(now.getTime() + hours * HOUR);

const renter: RentalActor = { id: "clean-1", role: "CLEANER" };
const otherCleaner: RentalActor = { id: "clean-2", role: "CLEANER" };
const controller: RentalActor = { id: "ctrl-1", role: "CONTROLLER" };
const homeowner: RentalActor = { id: "home-1", role: "HOMEOWNER" };

function rental(overrides: Partial<RentalSnapshot> = {}): RentalSnapshot {
  return { status: "REQUESTED", cleanerId: "clean-1", startsAt: at(2), endsAt: at(8), toolStatus: "AVAILABLE", ...overrides };
}

describe("rental transition graph", () => {
  it("allows request → approve → return", () => {
    expect(canRentalTransition("REQUESTED", "APPROVED")).toBe(true);
    expect(canRentalTransition("APPROVED", "RETURNED")).toBe(true);
  });

  it("never leaves a closed rental", () => {
    for (const closed of ["REJECTED", "RETURNED", "CANCELLED"] as const) {
      for (const to of ["REQUESTED", "APPROVED", "REJECTED", "RETURNED", "CANCELLED"] as const) {
        expect(canRentalTransition(closed, to)).toBe(false);
      }
    }
  });

  it("cannot return a tool that was never approved", () => {
    expect(checkRentalTransition(rental(), "RETURNED", controller, now).ok).toBe(false);
  });
});

describe("who may change a rental", () => {
  it("only the controller approves or declines", () => {
    expect(checkRentalTransition(rental(), "APPROVED", controller, now).ok).toBe(true);
    expect(checkRentalTransition(rental(), "APPROVED", renter, now).ok).toBe(false);
    expect(checkRentalTransition(rental(), "REJECTED", controller, now).ok).toBe(true);
    expect(checkRentalTransition(rental(), "REJECTED", renter, now).ok).toBe(false);
    expect(checkRentalTransition(rental(), "APPROVED", homeowner, now).ok).toBe(false);
  });

  it("the renter or the controller cancels, never another cleaner", () => {
    expect(checkRentalTransition(rental(), "CANCELLED", renter, now).ok).toBe(true);
    expect(checkRentalTransition(rental(), "CANCELLED", controller, now).ok).toBe(true);
    expect(checkRentalTransition(rental(), "CANCELLED", otherCleaner, now).ok).toBe(false);
  });

  it("only the controller checks a tool back in", () => {
    const out = rental({ status: "APPROVED", startsAt: at(-1), endsAt: at(3) });
    expect(checkRentalTransition(out, "RETURNED", controller, now).ok).toBe(true);
    expect(checkRentalTransition(out, "RETURNED", renter, now).ok).toBe(false);
  });
});

describe("timing and stock rules", () => {
  it("won't approve a request that has already ended", () => {
    const check = checkRentalTransition(rental({ startsAt: at(-6), endsAt: at(-1) }), "APPROVED", controller, now);
    expect(check).toEqual({ ok: false, reason: expect.stringContaining("already ended") });
  });

  it("won't approve a tool that is out of service", () => {
    expect(checkRentalTransition(rental({ toolStatus: "MAINTENANCE" }), "APPROVED", controller, now).ok).toBe(false);
    expect(checkRentalTransition(rental({ toolStatus: "RETIRED" }), "APPROVED", controller, now).ok).toBe(false);
  });

  it("a reservation can be cancelled only before pickup", () => {
    const upcoming = rental({ status: "APPROVED" });
    const started = rental({ status: "APPROVED", startsAt: at(-1), endsAt: at(3) });
    expect(checkRentalTransition(upcoming, "CANCELLED", renter, now).ok).toBe(true);
    expect(checkRentalTransition(started, "CANCELLED", renter, now).ok).toBe(false);
    expect(checkRentalTransition(started, "CANCELLED", controller, now).ok).toBe(false);
  });

  it("a reservation is returned only once it has started", () => {
    expect(checkRentalTransition(rental({ status: "APPROVED" }), "RETURNED", controller, now).ok).toBe(false);
    // Late returns are still accepted.
    expect(checkRentalTransition(rental({ status: "APPROVED", startsAt: at(-8), endsAt: at(-2) }), "RETURNED", controller, now).ok).toBe(true);
  });
});

describe("rental requests", () => {
  it("accepts a normal request", () => {
    expect(rentalRequestError({ startsAt: at(1), endsAt: at(5) }, now)).toBeNull();
  });

  it("allows starting a few minutes late, but not hours in the past", () => {
    expect(rentalRequestError({ startsAt: at(-0.25), endsAt: at(4) }, now)).toBeNull();
    expect(rentalRequestError({ startsAt: at(-3), endsAt: at(4) }, now)).toMatch(/past/);
  });

  it("rejects ranges that are over, backwards, or too far ahead", () => {
    expect(rentalRequestError({ startsAt: at(-5), endsAt: at(-1) }, now)).toMatch(/passed/);
    expect(rentalRequestError({ startsAt: at(5), endsAt: at(1) }, now)).toMatch(/after/);
    expect(rentalRequestError({ startsAt: at(RENTAL_HORIZON_DAYS * 24 + 1), endsAt: at(RENTAL_HORIZON_DAYS * 24 + 3) }, now)).toMatch(/days ahead/);
  });
});

describe("time ranges", () => {
  it("treats back-to-back ranges as not overlapping, like the database", () => {
    expect(rangesOverlap({ startsAt: at(0), endsAt: at(2) }, { startsAt: at(2), endsAt: at(4) })).toBe(false);
    expect(rangesOverlap({ startsAt: at(0), endsAt: at(3) }, { startsAt: at(2), endsAt: at(4) })).toBe(true);
    expect(rangesOverlap({ startsAt: at(0), endsAt: at(10) }, { startsAt: at(2), endsAt: at(4) })).toBe(true);
  });

  it("covers means the whole slot is inside", () => {
    expect(covers({ startsAt: at(0), endsAt: at(6) }, { startsAt: at(0), endsAt: at(6) })).toBe(true);
    expect(covers({ startsAt: at(0), endsAt: at(6) }, { startsAt: at(5), endsAt: at(7) })).toBe(false);
  });
});

describe("rental phase", () => {
  it("follows a rental through its life", () => {
    expect(rentalPhase({ status: "REQUESTED", startsAt: at(1), endsAt: at(3) }, now)).toBe("PENDING");
    expect(rentalPhase({ status: "REQUESTED", startsAt: at(-5), endsAt: at(-1) }, now)).toBe("EXPIRED");
    expect(rentalPhase({ status: "APPROVED", startsAt: at(1), endsAt: at(3) }, now)).toBe("UPCOMING");
    expect(rentalPhase({ status: "APPROVED", startsAt: at(-1), endsAt: at(3) }, now)).toBe("OUT");
    expect(rentalPhase({ status: "APPROVED", startsAt: at(-5), endsAt: at(-1) }, now)).toBe("OVERDUE");
    expect(rentalPhase({ status: "RETURNED", startsAt: at(-5), endsAt: at(-1) }, now)).toBe("CLOSED");
  });
});

describe("snow-blower coverage for large driveways", () => {
  const slot = { startsAt: at(18), endsAt: at(20) };

  it("owning a blower is always enough", () => {
    expect(hasBlowerCoverage({ ownsBlower: true }, [], slot)).toBe(true);
  });

  it("otherwise an approved rental must cover the whole slot", () => {
    expect(hasBlowerCoverage({ ownsBlower: false }, [], slot)).toBe(false);
    expect(hasBlowerCoverage({ ownsBlower: false }, [{ startsAt: at(17), endsAt: at(23) }], slot)).toBe(true);
    expect(hasBlowerCoverage({ ownsBlower: false }, [{ startsAt: at(19), endsAt: at(23) }], slot)).toBe(false);
  });
});
