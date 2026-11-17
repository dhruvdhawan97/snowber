import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, StickyNote } from "lucide-react";
import { JobPhotos } from "@/components/job-photos";
import { PageSkeleton } from "@/components/page";
import { ReviewForm } from "@/components/review-form";
import { Stars, StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/misc";
import { LOT_SIZE_LABEL } from "@/lib/contracts/domain";
import { getCleanerJob } from "@/lib/dal/jobs";
import { listJobPhotos } from "@/lib/dal/photos";
import { requireRole } from "@/lib/dal/session";
import { AppError } from "@/lib/errors";
import { firstName, formatMinutes, formatMoney, formatWindow } from "@/lib/format";
import { photoKindFor } from "@/lib/photo-rules";
import { JobWorkflow } from "./job-workflow";

export const metadata: Metadata = { title: "Job" };

export default function CleanerJobPage(props: PageProps<"/cleaner/jobs/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobDetail params={props.params} />
    </Suspense>
  );
}

async function JobDetail({ params }: { params: PageProps<"/cleaner/jobs/[id]">["params"] }) {
  const user = await requireRole("CLEANER");
  const { id } = await params;
  const [job, photos] = await Promise.all([getCleanerJob(user, id), listJobPhotos(user, id)]).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${job.property.lat},${job.property.lng}`;
  const active = job.status === "ASSIGNED" || job.status === "IN_PROGRESS";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/cleaner">
            <ArrowLeft aria-hidden /> My jobs
          </Link>
        </Button>
        <StatusBadge status={job.status} className="text-sm" />
      </div>
      <div>
        <h1 className="flex items-start gap-2 text-2xl font-semibold">
          <MapPin className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
          {job.property.address}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {job.assignedWindow ? formatWindow(job.assignedWindow.startsAt, job.assignedWindow.endsAt) : "Not scheduled"}
          {job.routeOrder && ` · stop ${job.routeOrder}`}
        </p>
      </div>

      {job.status === "COMPLETED" && (
        <Alert variant="success">
          <AlertTitle>Waiting for the homeowner</AlertTitle>
          <AlertDescription>They check your photos and confirm. You&apos;re paid {formatMoney(job.earningsCents)} once they do.</AlertDescription>
        </Alert>
      )}
      {job.status === "DISPUTED" && (
        <Alert variant="destructive">
          <AlertTitle>The homeowner reported a problem</AlertTitle>
          <AlertDescription>“{job.disputeReason}” The controller will follow up with you.</AlertDescription>
        </Alert>
      )}
      {job.status === "CANCELLED" && (
        <Alert>
          <AlertTitle>This job was cancelled</AlertTitle>
          <AlertDescription>No need to go. It no longer counts toward your route.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid content-start gap-6">
          {active && (
            <Card>
              <CardHeader>
                <CardTitle>Steps</CardTitle>
              </CardHeader>
              <CardContent>
                <JobWorkflow
                  jobId={job.id}
                  status={job.status}
                  beforeCount={photos.filter((p) => p.kind === "BEFORE").length}
                  afterCount={photos.filter((p) => p.kind === "AFTER").length}
                  mapsUrl={mapsUrl}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Before &amp; after</CardTitle>
              {active && <CardDescription>Tap a photo to see it full size or remove it.</CardDescription>}
            </CardHeader>
            <CardContent>
              <JobPhotos photos={photos} showFlags deletableKind={photoKindFor(job.status)} emptyText="Take a before photo when you arrive." />
            </CardContent>
          </Card>

          {job.status === "CONFIRMED" && (
            <Card>
              <CardHeader>
                <CardTitle>Reviews</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div>
                  <p className="mb-2 text-sm font-medium">{firstName(job.homeowner.name)}&apos;s review of you</p>
                  {job.reviewOfMe ? (
                    <div className="grid gap-1 text-sm">
                      <Stars rating={job.reviewOfMe.rating} />
                      {job.reviewOfMe.comment && <p className="text-muted-foreground">“{job.reviewOfMe.comment}”</p>}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No review yet.</p>
                  )}
                </div>
                <div>
                  {job.myReview ? (
                    <>
                      <p className="mb-2 text-sm font-medium">Your review of this home</p>
                      <div className="grid gap-1 text-sm">
                        <Stars rating={job.myReview.rating} />
                        {job.myReview.comment && <p className="text-muted-foreground">“{job.myReview.comment}”</p>}
                      </div>
                    </>
                  ) : (
                    <ReviewForm jobId={job.id} prompt="How was this home to work at? (accurate size, safe access)" />
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Job details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Detail label="Driveway">
                {LOT_SIZE_LABEL[job.property.lotSize]}
                {job.requiresBlower && <span className="block text-muted-foreground">needs a snow blower</span>}
              </Detail>
              <Detail label="Also clear">
                {[job.includeSidewalk && "public sidewalk", job.includeSalt && "salt walkways"].filter(Boolean).join(", ") || "Driveway only"}
              </Detail>
              <Detail label="About">{formatMinutes(job.estMinutes)}</Detail>
              <Detail label="Homeowner">
                <span className="flex flex-col items-end gap-0.5">
                  {firstName(job.homeowner.name)}
                  <Stars rating={job.homeownerRating?.average} count={job.homeownerRating?.count} className="text-xs" />
                </span>
              </Detail>
              <Detail label={job.status === "CONFIRMED" ? "You earned" : "You'll earn"}>
                <span className="font-medium">{formatMoney(job.earningsCents)}</span>
                {job.tipCents > 0 && <span className="block text-muted-foreground">incl. {formatMoney(job.tipCents)} tip</span>}
              </Detail>
              {active && (
                <Button asChild variant="outline" size="lg" className="mt-2">
                  <a href={mapsUrl} target="_blank" rel="noreferrer">
                    Open in maps
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          {(job.property.notes || job.notes) && (
            <Card>
              <CardHeader>
                <CardTitle>Notes from the homeowner</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {job.property.notes && <Note label="Property notes">{job.property.notes}</Note>}
                {job.notes && <Note label="Notes for this booking">{job.notes}</Note>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Note({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <StickyNote className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="whitespace-pre-line">{children}</p>
      </div>
    </div>
  );
}
