import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageSkeleton, Stat } from "@/components/page";
import { Stars } from "@/components/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getEarnings } from "@/lib/dal/earnings";
import { listReviewsReceived } from "@/lib/dal/reviews";
import { requireRole } from "@/lib/dal/session";
import { firstName, formatDateTime, formatMoney } from "@/lib/format";
import { RATE_CARD } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Earnings" };

const ENTRY_LABEL = { EARNING: "Job", RENTAL_FEE: "Tool rental", PAYOUT: "Payout", ADJUSTMENT: "Adjustment" } as const;

export default function EarningsPage() {
  return (
    <>
      <PageHeader
        title="Earnings"
        description={`You keep ${RATE_CARD.cleanerShareBps / 100}% of each job's price (before any senior discount) plus every tip. Jobs are paid once the homeowner confirms.`}
      />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Earnings />
      </Suspense>
    </>
  );
}

async function Earnings() {
  const user = await requireRole("CLEANER");
  const [{ summary, entries }, { reviews, summary: rating }] = await Promise.all([getEarnings(user), listReviewsReceived(user)]);

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Balance" value={formatMoney(summary.balanceCents)} hint="Earnings minus tool rentals" />
        <Stat label="Last 7 days" value={formatMoney(summary.last7DaysCents)} hint={`${summary.jobsLast7Days} job${summary.jobsLast7Days === 1 ? "" : "s"} paid`} />
        <Stat
          label="Awaiting confirmation"
          value={formatMoney(summary.awaitingCents)}
          hint={summary.awaitingCount > 0 ? `${summary.awaitingCount} finished job${summary.awaitingCount === 1 ? "" : "s"}` : "Nothing waiting"}
        />
        <Stat
          label="Upcoming"
          value={formatMoney(summary.upcomingCents)}
          hint={summary.upcomingCount > 0 ? `${summary.upcomingCount} assigned job${summary.upcomingCount === 1 ? "" : "s"}` : "No jobs assigned"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>The last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <EmptyState title="No earnings yet">Finish a job and it shows up here once the homeowner confirms.</EmptyState>
            ) : (
              <ul className="divide-y">
                {entries.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {entry.jobId ? (
                          <Link href={`/cleaner/jobs/${entry.jobId}`} className="underline-offset-4 hover:underline">
                            {entry.description}
                          </Link>
                        ) : (
                          entry.description
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ENTRY_LABEL[entry.type]} · {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                    <span className={cn("shrink-0 font-medium tabular-nums", entry.amountCents < 0 ? "text-destructive" : "text-success")}>
                      {entry.amountCents < 0 ? "−" : "+"}
                      {formatMoney(Math.abs(entry.amountCents))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              Your rating
              <Stars rating={rating?.average} count={rating?.count} />
            </CardTitle>
            <CardDescription>What homeowners said after confirmed jobs.</CardDescription>
          </CardHeader>
          <CardContent>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews yet.</p>
            ) : (
              <ul className="grid gap-4">
                {reviews.map((review) => (
                  <li key={review.id} className="grid gap-1 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Stars rating={review.rating} />
                      <span className="text-xs text-muted-foreground">{formatDateTime(review.createdAt)}</span>
                    </div>
                    {review.comment && <p>“{review.comment}”</p>}
                    <p className="text-xs text-muted-foreground">
                      {firstName(review.author.name)} ·{" "}
                      <Link href={`/cleaner/jobs/${review.job.id}`} className="underline-offset-4 hover:underline">
                        {review.job.property.address}
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
