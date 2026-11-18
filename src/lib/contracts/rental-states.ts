// Tool rentals as a pure, unit-tested state machine (Member 4).
// `transitionRental` in src/lib/dal/rentals.ts is the only code that changes a
// rental's status, and it always asks `checkRentalTransition` first. The database
// backs this up: the "ToolRental_no_overlap" exclusion constraint stops two
// approved rentals of the same tool from overlapping, however the requests race.
//
//   REQUESTED ──approve──▶ APPROVED ──return──▶ RETURNED
//       │  └──reject──▶ REJECTED     │
//       └──cancel──▶ CANCELLED ◀──cancel (before pickup; fee refunded)

import type { RentalStatus, Role, ToolStatus } from "./domain";
import { formatRange } from "../format";

export const RENTAL_TRANSITIONS: Record<RentalStatus, readonly RentalStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["RETURNED", "CANCELLED"],
  REJECTED: [],
  RETURNED: [],
  CANCELLED: [],
};

/** How far ahead a cleaner can reserve a tool (matches the shift horizon). */
export const RENTAL_HORIZON_DAYS = 30;
/** Requests may start a little in the past ("from now until noon" submitted a minute late). */
export const RENTAL_START_GRACE_MINUTES = 60;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export type RentalActor = { id: string; role: Role };

export type RentalSnapshot = {
  status: RentalStatus;
  cleanerId: string;
  startsAt: Date;
  endsAt: Date;
  toolStatus: ToolStatus;
};

export type RentalCheck = { ok: true } | { ok: false; reason: string };

const deny = (reason: string): RentalCheck => ({ ok: false, reason });

export function canRentalTransition(from: RentalStatus, to: RentalStatus): boolean {
  return RENTAL_TRANSITIONS[from].includes(to);
}

/** Validates the edge (from → to), who may take it, and its timing rules. */
export function checkRentalTransition(rental: RentalSnapshot, to: RentalStatus, actor: RentalActor, now: Date): RentalCheck {
  if (!canRentalTransition(rental.status, to)) {
    return deny(`A rental that is ${rental.status.toLowerCase()} cannot be ${to.toLowerCase()}.`);
  }
  const isController = actor.role === "CONTROLLER";
  const isRenter = actor.role === "CLEANER" && actor.id === rental.cleanerId;
  const started = rental.startsAt <= now;
  const ended = rental.endsAt <= now;

  switch (`${rental.status}->${to}`) {
    case "REQUESTED->APPROVED":
      if (!isController) return deny("Only the controller can approve rentals.");
      if (ended) return deny("This request has already ended. Reject it instead.");
      if (rental.toolStatus !== "AVAILABLE") return deny("This tool is out of service. Put it back in service first.");
      return { ok: true };

    case "REQUESTED->REJECTED":
      if (!isController) return deny("Only the controller can reject rentals.");
      return { ok: true };

    case "REQUESTED->CANCELLED":
      if (!isController && !isRenter) return deny("Only the cleaner who asked, or the controller, can cancel this request.");
      return { ok: true };

    case "APPROVED->CANCELLED":
      if (!isController && !isRenter) return deny("Only the cleaner who rented it, or the controller, can cancel this rental.");
      if (started) return deny("This rental has started. The controller marks it returned when the tool comes back.");
      return { ok: true };

    case "APPROVED->RETURNED":
      if (!isController) return deny("Only the controller can check a tool back in.");
      if (!started) return deny("This rental hasn't started yet. Cancel it instead.");
      return { ok: true };

    default:
      return deny("This change is not allowed.");
  }
}

/** Checks a new request's time range; returns a user-facing error or null. */
export function rentalRequestError(range: { startsAt: Date; endsAt: Date }, now: Date): string | null {
  if (range.endsAt <= range.startsAt) return "End must be after start.";
  if (range.endsAt <= now) return "That time has already passed.";
  if (range.startsAt.getTime() < now.getTime() - RENTAL_START_GRACE_MINUTES * MINUTE) {
    return "Rentals can't start in the past. Pick a time from now on.";
  }
  if (range.startsAt.getTime() > now.getTime() + RENTAL_HORIZON_DAYS * DAY) {
    return `You can reserve tools up to ${RENTAL_HORIZON_DAYS} days ahead.`;
  }
  return null;
}

export type TimeRange = { startsAt: Date; endsAt: Date };

/** Half-open ranges [start, end): back-to-back rentals do not overlap (same rule as the database's tsrange). */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** True when `outer` covers the whole of `inner`. */
export function covers(outer: TimeRange, inner: TimeRange): boolean {
  return outer.startsAt <= inner.startsAt && outer.endsAt >= inner.endsAt;
}

/** Where a rental stands right now, for dashboards and badges. */
export type RentalPhase = "PENDING" | "EXPIRED" | "UPCOMING" | "OUT" | "OVERDUE" | "CLOSED";

export function rentalPhase(rental: { status: RentalStatus; startsAt: Date; endsAt: Date }, now: Date): RentalPhase {
  if (rental.status === "REQUESTED") return rental.endsAt <= now ? "EXPIRED" : "PENDING";
  if (rental.status !== "APPROVED") return "CLOSED";
  if (rental.startsAt > now) return "UPCOMING";
  return rental.endsAt > now ? "OUT" : "OVERDUE";
}

export const RENTAL_PHASE_LABEL: Record<RentalPhase, string> = {
  PENDING: "Waiting for approval",
  EXPIRED: "Request expired",
  UPCOMING: "Reserved",
  OUT: "Checked out",
  OVERDUE: "Overdue",
  CLOSED: "Closed",
};

/** Ledger description for a rental fee (and its refund), shared by the DAL and the seed. */
export function rentalFeeDescription(toolName: string, range: TimeRange): string {
  return `${toolName} rental · ${formatRange(range.startsAt, range.endsAt)}`;
}

/**
 * Snow-blower coverage (large lots need one): a cleaner is covered for a time slot
 * if they own a blower or hold an approved blower rental covering the whole slot.
 */
export function hasBlowerCoverage(
  cleaner: { ownsBlower: boolean },
  approvedBlowerRentals: readonly TimeRange[],
  slot: TimeRange,
): boolean {
  return cleaner.ownsBlower || approvedBlowerRentals.some((r) => covers(r, slot));
}
