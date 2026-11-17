import type { Metadata } from "next";
import { Suspense } from "react";
import { Eye, MapPin, StickyNote } from "lucide-react";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LOT_SIZE_LABEL } from "@/lib/contracts/domain";
import { listAssignedJobsPreview } from "@/lib/dal/jobs";
import { requireRole } from "@/lib/dal/session";
import { firstName, formatMinutes, formatWindow } from "@/lib/format";

export const metadata: Metadata = { title: "My jobs" };

// Read-only preview: the jobs a controller assigned to this cleaner, with the
// homeowner's booking details and notes. Member 2 builds the full cleaner portal
// (shifts, starting a job, before/after photos, earnings) on top of this.
export default function CleanerHomePage() {
  return (
    <>
      <PageHeader
        title="My assigned jobs"
        description="Jobs the controller has assigned to you, with each homeowner's notes."
      />
      <p className="mb-6 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        <Eye className="size-4 shrink-0" aria-hidden />
        Read-only preview. Starting jobs, photos and earnings come with the full
        cleaner portal.
      </p>
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Jobs />
      </Suspense>
    </>
  );
}

async function Jobs() {
  const user = await requireRole("CLEANER");
  const jobs = await listAssignedJobsPreview(user);

  if (jobs.length === 0) {
    return (
      <EmptyState title={`No jobs assigned yet, ${firstName(user.name)}`}>
        When the controller assigns you a booking, it shows up here with the
        address, time and notes.
      </EmptyState>
    );
  }

  const upcoming = jobs.filter(
    (j) => j.status === "ASSIGNED" || j.status === "IN_PROGRESS",
  );
  const finished = jobs
    .filter((j) => j.status !== "ASSIGNED" && j.status !== "IN_PROGRESS")
    .reverse();

  return (
    <div className="grid gap-8">
      <JobSection
        title={`Upcoming (${upcoming.length})`}
        jobs={upcoming}
        empty="Nothing upcoming right now."
      />
      {finished.length > 0 && (
        <JobSection title="Finished this week" jobs={finished} />
      )}
    </div>
  );
}

type PreviewJob = Awaited<ReturnType<typeof listAssignedJobsPreview>>[number];

function JobSection({
  title,
  jobs,
  empty,
}: {
  title: string;
  jobs: PreviewJob[];
  empty?: string;
}) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </section>
  );
}

function JobCard({ job }: { job: PreviewJob }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <CardTitle className="flex items-start gap-2 text-base">
          <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          {job.property.address}
        </CardTitle>
        <StatusBadge status={job.status} />
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">When</dt>
          <dd>
            {job.assignedWindow
              ? formatWindow(
                  job.assignedWindow.startsAt,
                  job.assignedWindow.endsAt,
                )
              : "Not scheduled"}
            {job.routeOrder && (
              <span className="text-muted-foreground">
                {" "}
                · stop {job.routeOrder}
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">Driveway</dt>
          <dd>
            {LOT_SIZE_LABEL[job.property.lotSize]}
            {job.requiresBlower && (
              <span className="text-muted-foreground">
                {" "}
                · needs a snow blower
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">Also clear</dt>
          <dd>
            {[
              job.includeSidewalk && "public sidewalk",
              job.includeSalt && "salt walkways",
            ]
              .filter(Boolean)
              .join(", ") || "Driveway only"}
          </dd>
          <dt className="text-muted-foreground">About</dt>
          <dd>{formatMinutes(job.estMinutes)}</dd>
          <dt className="text-muted-foreground">Homeowner</dt>
          <dd>{firstName(job.homeowner.name)}</dd>
        </dl>
        {(job.property.notes || job.notes) && (
          <div className="grid gap-2 rounded-lg bg-muted/50 p-3">
            {job.property.notes && (
              <Note label="Property notes">{job.property.notes}</Note>
            )}
            {job.notes && (
              <Note label="Notes for this booking">{job.notes}</Note>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Note({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
