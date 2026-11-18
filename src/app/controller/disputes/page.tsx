import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertTriangle, Mail, Phone } from "lucide-react";
import { resolveDisputeAction } from "@/app/actions/disputes";
import { ActionButton } from "@/components/forms";
import { JobPhotos } from "@/components/job-photos";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LOT_SIZE_LABEL } from "@/lib/contracts/domain";
import { listDisputes } from "@/lib/dal/disputes";
import { listJobPhotos } from "@/lib/dal/photos";
import { requireRole } from "@/lib/dal/session";
import { firstName, formatDateTime, formatMoney, formatWindow } from "@/lib/format";

// Member 4: the controller settles jobs a homeowner disputed instead of confirming.

export const metadata: Metadata = { title: "Disputes" };

export default function DisputesPage() {
  return (
    <>
      <PageHeader
        title="Disputes"
        description="Homeowners can report a problem instead of confirming a finished job. Check the photos, talk to both sides, then pay the cleaner or refund the homeowner."
      />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Disputes />
      </Suspense>
    </>
  );
}

type Person = { name: string; email: string; phone: string | null } | null;

function Contact({ label, person }: { label: string; person: Person }) {
  return (
    <div className="grid gap-0.5 text-sm">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      {person ? (
        <>
          <p className="font-medium">{person.name}</p>
          <a href={`mailto:${person.email}`} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
            <Mail className="size-3.5" aria-hidden /> {person.email}
          </a>
          {person.phone && (
            <a href={`tel:${person.phone}`} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
              <Phone className="size-3.5" aria-hidden /> {person.phone}
            </a>
          )}
        </>
      ) : (
        <p className="text-muted-foreground">No longer assigned</p>
      )}
    </div>
  );
}

async function Disputes() {
  const user = await requireRole("CONTROLLER");
  const { open, resolved } = await listDisputes(user);
  const photos = await Promise.all(open.map((job) => listJobPhotos(user, job.id)));

  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-labelledby="open-disputes">
        <h2 id="open-disputes" className="text-lg font-semibold">
          Open ({open.length})
        </h2>
        {open.length === 0 ? (
          <EmptyState title="No open disputes">When a homeowner reports a problem with a finished job, it shows up here.</EmptyState>
        ) : (
          open.map((job, i) => {
            const cleaner = job.cleaner ? firstName(job.cleaner.name) : "the cleaner";
            const homeowner = firstName(job.homeowner.name);
            return (
              <Card key={job.id} className="border-destructive/40">
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <div className="grid gap-1">
                    <CardTitle>{job.property.address}</CardTitle>
                    <CardDescription>
                      {job.assignedWindow ? formatWindow(job.assignedWindow.startsAt, job.assignedWindow.endsAt) : "No time slot"} ·{" "}
                      {LOT_SIZE_LABEL[job.property.lotSize]}
                      {job.completedAt && ` · finished ${formatDateTime(job.completedAt)}`}
                    </CardDescription>
                  </div>
                  <StatusBadge status={job.status} />
                </CardHeader>
                <CardContent className="grid gap-5">
                  <blockquote className="rounded-lg border-l-4 border-destructive bg-destructive/5 p-3 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">{homeowner} reported</p>
                    <p className="mt-1 whitespace-pre-line">“{job.disputeReason}”</p>
                  </blockquote>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Contact label="Homeowner" person={job.homeowner} />
                    <Contact label="Cleaner" person={job.cleaner} />
                    <div className="grid content-start gap-0.5 text-sm">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Money</p>
                      <p>
                        Paid <span className="font-medium tabular-nums">{formatMoney(job.payment?.amountCents ?? 0)}</span>
                        {job.payment && job.payment.refundedCents > 0 && ` (${formatMoney(job.payment.refundedCents)} refunded)`}
                      </p>
                      <p>
                        Cleaner&apos;s pay <span className="font-medium tabular-nums">{formatMoney(job.cleanerPayCents)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    {job.flaggedPhotos > 0 && (
                      <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden />
                        {job.flaggedPhotos} photo{job.flaggedPhotos === 1 ? " was" : "s were"} flagged when uploaded. Open a photo to see why.
                      </p>
                    )}
                    <JobPhotos photos={photos[i]} showFlags emptyText="No photos were uploaded for this job." />
                  </div>

                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    <ActionButton
                      action={resolveDisputeAction.bind(null, job.id, "PAY_CLEANER")}
                      disabled={!job.cleaner}
                      confirm={{
                        title: `Close the dispute and pay ${cleaner}?`,
                        description: `${cleaner} is credited ${formatMoney(job.cleanerPayCents)}, as if ${homeowner} had confirmed. ${homeowner} isn't refunded.`,
                        confirmLabel: `Pay ${cleaner}`,
                      }}
                    >
                      Pay the cleaner
                    </ActionButton>
                    <ActionButton
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      action={resolveDisputeAction.bind(null, job.id, "REFUND")}
                      confirm={{
                        title: `Refund ${formatMoney(job.refundableCents)} to ${homeowner}?`,
                        description: `The job is cancelled and ${cleaner} isn't paid for it.`,
                        confirmLabel: "Refund the homeowner",
                        destructive: true,
                      }}
                    >
                      Refund the homeowner
                    </ActionButton>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>

      {resolved.length > 0 && (
        <section className="grid gap-3" aria-labelledby="resolved-disputes">
          <h2 id="resolved-disputes" className="text-lg font-semibold">
            Resolved in the last two weeks
          </h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {resolved.map((job) => (
              <li key={job.id} className="grid gap-1 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{job.property.address}</span>
                  <Badge variant={job.status === "CONFIRMED" ? "success" : "secondary"}>
                    {job.status === "CONFIRMED" ? `${job.cleaner ? firstName(job.cleaner.name) : "Cleaner"} paid` : "Homeowner refunded"}
                  </Badge>
                </div>
                <p className="line-clamp-1 text-muted-foreground">“{job.disputeReason}”</p>
                <p className="text-xs text-muted-foreground">Closed {formatDateTime(job.confirmedAt ?? job.cancelledAt ?? job.updatedAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
