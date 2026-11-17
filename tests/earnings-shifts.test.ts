import { describe, expect, it } from "vitest";
import { shiftSchema } from "@/lib/contracts/schemas";
import { summarizeEarnings, type LedgerLine } from "@/lib/earnings";
import { jobEarnings } from "@/lib/pricing";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-18T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);

describe("earnings summary", () => {
  const ledger: LedgerLine[] = [
    { type: "EARNING", amountCents: 4000, createdAt: ago(1) },
    { type: "EARNING", amountCents: 3000, createdAt: ago(6) },
    { type: "EARNING", amountCents: 9999, createdAt: ago(10) },
    { type: "RENTAL_FEE", amountCents: -1500, createdAt: ago(2) },
  ];
  const job = (status: string) => ({ status, priceCents: 5000, discountCents: 0, tipCents: 500 });

  it("sums the last 7 days of job earnings only", () => {
    const s = summarizeEarnings(14499, ledger, [], now);
    expect(s.balanceCents).toBe(14499);
    expect(s.last7DaysCents).toBe(7000);
    expect(s.jobsLast7Days).toBe(2);
  });

  it("estimates unconfirmed jobs with the ledger's pay rule", () => {
    const s = summarizeEarnings(0, [], [job("COMPLETED"), job("DISPUTED"), job("ASSIGNED"), job("IN_PROGRESS"), job("IN_PROGRESS")], now);
    const each = jobEarnings(job("COMPLETED"));
    expect(each).toBe(4500); // 80% of $50 plus the $5 tip
    expect(s.awaitingCount).toBe(2);
    expect(s.awaitingCents).toBe(2 * each);
    expect(s.upcomingCount).toBe(3);
    expect(s.upcomingCents).toBe(3 * each);
  });

  it("pays the cleaner on the price before a senior discount", () => {
    const discounted = { status: "COMPLETED", priceCents: 4000, discountCents: 1000, tipCents: 0 };
    expect(summarizeEarnings(0, [], [discounted], now).awaitingCents).toBe(4000);
  });
});

describe("shift form", () => {
  const iso = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

  it("accepts a normal shift", () => {
    expect(shiftSchema.safeParse({ startsAt: iso(1), endsAt: iso(5) }).success).toBe(true);
  });

  it("rejects shifts that end before they start or run over 12 hours", () => {
    expect(shiftSchema.safeParse({ startsAt: iso(5), endsAt: iso(1) }).success).toBe(false);
    expect(shiftSchema.safeParse({ startsAt: iso(1), endsAt: iso(14) }).success).toBe(false);
  });
});
