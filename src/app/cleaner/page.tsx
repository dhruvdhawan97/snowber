import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarPlus, ChevronRight, MapPin, StickyNote } from "lucide-react";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LOT_SIZE_LABEL } from "@/lib/contracts/domain";
import { listCleanerJobs } from "@/lib/dal/jobs";
import { requireRole } from "@/lib/dal/session";
import { firstName, formatMinutes, formatWindow } from "@/lib/format";

export const metadata: Metadata = { title: "My jobs" };

export default function CleanerHomePage() {
  return (
    <>
      <PageHeader
        title="My jobs"
        description="Jobs the controller has assigned to you, in route order. Tap a job to start it."
        actions={
          <Button asChild variant="outline">
            <Link href="/cleaner/shifts">
              <CalendarPlus aria-hidden /> Post availability
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Jobs />
      </Suspense>
    </>
  );
}

async function Jobs() {
  const user = await requireRole("CLEANER");
  const jobs = await listCleanerJobs(user);

  if (jobs.length === 0) {
    return (
      <EmptyState title={`No jobs assigned yet, ${firstName(user.name)}`}>
        <p>Post the hours you can work, and the controller will assign you nearby jobs.</p>
        <Button asChild className="mt-4">
          <Link href="/cleaner/shifts">
            <CalendarPlus aria-hidden /> Post availability
          </Link>
        </Button>
      </EmptyState>
    );
  }

  const upcoming = jobs.filter((j) => j.status === "ASSIGNED" || j.status === "IN_PROGRESS");
  const finished = jobs.filter((j) => j.status !== "ASSIGNED" && j.status !== "IN_PROGRESS").reverse();

  return (
    <div className="grid gap-8">
      <JobSection title={`Upcoming (${upcoming.length})`} jobs={upcoming} empty="Nothing upcoming right now." />
      {finished.length > 0 && <JobSection title="Finished this week" jobs={finished} />}
    </div>
  );
}

type CleanerJob = Awaited<ReturnType<typeof listCleanerJobs>>[number];

function nextAction(job: CleanerJob): string | null {
  const before = job.photos.some((p) => p.kind === "BEFORE");
  const after = job.photos.some((p) => p.kind === "AFTER");
  if (job.status === "ASSIGNED") return before ? "Next: start clearing" : "Next: take a before photo";
  if (job.status === "IN_PROGRESS") return after ? "Next: mark the job done" : "Next: take an after photo";
  return null;
}

function JobSection({ title, jobs, empty }: { title: string; jobs: CleanerJob[]; empty?: string }) {
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

function JobCard({ job }: { job: CleanerJob }) {
  const action = nextAction(job);
  return (
    <Link href={`/cleaner/jobs/${job.id}`} className="group rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
      <Card className="h-full transition-shadow group-hover:shadow-md">
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
              {job.assignedWindow ? formatWindow(job.assignedWindow.startsAt, job.assignedWindow.endsAt) : "Not scheduled"}
              {job.routeOrder && <span className="text-muted-foreground"> · stop {job.routeOrder}</span>}
            </dd>
            <dt className="text-muted-foreground">Driveway</dt>
            <dd>
              {LOT_SIZE_LABEL[job.property.lotSize]}
              {job.requiresBlower && <span className="text-muted-foreground"> · needs a snow blower</span>}
            </dd>
            <dt className="text-muted-foreground">Also clear</dt>
            <dd>{[job.includeSidewalk && "public sidewalk", job.includeSalt && "salt walkways"].filter(Boolean).join(", ") || "Driveway only"}</dd>
            <dt className="text-muted-foreground">About</dt>
            <dd>{formatMinutes(job.estMinutes)}</dd>
            <dt className="text-muted-foreground">Homeowner</dt>
            <dd>{firstName(job.homeowner.name)}</dd>
          </dl>
          {(job.property.notes || job.notes) && (
            <p className="flex gap-2 rounded-lg bg-muted/50 p-3">
              <StickyNote className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="line-clamp-2 whitespace-pre-line">{[job.property.notes, job.notes].filter(Boolean).join("\n")}</span>
            </p>
          )}
          <p className="flex items-center justify-between font-medium text-primary">
            {action ?? "View job"}
            <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
