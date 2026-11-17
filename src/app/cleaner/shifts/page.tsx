import type { Metadata } from "next";
import { Suspense } from "react";
import { Trash2 } from "lucide-react";
import { deleteShiftAction } from "@/app/actions/cleaner";
import { ActionButton } from "@/components/forms";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_TIMEZONE } from "@/lib/config";
import { requireRole } from "@/lib/dal/session";
import { listMyShifts, listUpcomingWindowsForCleaner } from "@/lib/dal/shifts";
import { formatMinutes, formatWindow } from "@/lib/format";
import { wallClockIso } from "@/lib/time";
import { ShiftForm } from "./shift-form";

export const metadata: Metadata = { title: "Shifts" };

const MAX_PRESETS = 8;

export default function ShiftsPage() {
  return (
    <>
      <PageHeader
        title="Shifts"
        description="Post the hours you can work. The controller only assigns you jobs in time slots that fall inside your shifts."
      />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Shifts />
      </Suspense>
    </>
  );
}

async function Shifts() {
  const user = await requireRole("CLEANER");
  const [shifts, windows] = await Promise.all([listMyShifts(user), listUpcomingWindowsForCleaner(user)]);
  const upcoming = shifts.filter((s) => !s.isPast);
  const past = shifts.filter((s) => s.isPast).reverse();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Post availability</CardTitle>
          <CardDescription>
            {windows.length > 0
              ? `${windows.length} open time slot${windows.length === 1 ? "" : "s"} this week.`
              : "No open time slots this week yet; you can still post availability."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShiftForm
            defaultStart={wallClockIso(1, 6, APP_TIMEZONE)}
            defaultEnd={wallClockIso(1, 12, APP_TIMEZONE)}
            presets={windows.slice(0, MAX_PRESETS).map((w) => ({
              id: w.id,
              label: `${w.label ? `${w.label} · ` : ""}${formatWindow(w.startsAt, w.endsAt)}${w._count.optionJobs > 0 ? ` (${w._count.optionJobs} requests)` : ""}`,
              startsAt: w.startsAt.toISOString(),
              endsAt: w.endsAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>

      <div className="grid content-start gap-6">
        <section className="grid gap-3" aria-labelledby="upcoming-shifts">
          <h2 id="upcoming-shifts" className="text-lg font-semibold">
            Upcoming ({upcoming.length})
          </h2>
          {upcoming.length === 0 ? (
            <EmptyState title="No shifts posted">Post when you can work, and the controller will fill your shift with nearby jobs.</EmptyState>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {upcoming.map((shift) => (
                <li key={shift.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{formatWindow(shift.startsAt, shift.endsAt)}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatMinutes(Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / 60000))}
                      {" · "}
                      {shift.jobCount === 0 ? "no jobs yet" : `${shift.jobCount} job${shift.jobCount === 1 ? "" : "s"} assigned`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {shift.isActive && <Badge variant="success">On now</Badge>}
                    {!shift.isActive && shift.jobCount === 0 && (
                      <ActionButton
                        action={deleteShiftAction.bind(null, shift.id)}
                        variant="ghost"
                        size="lg"
                        aria-label={`Remove shift ${formatWindow(shift.startsAt, shift.endsAt)}`}
                        confirm={{ title: "Remove this shift?", description: "The controller won't assign you jobs in it.", confirmLabel: "Remove", destructive: true }}
                      >
                        <Trash2 aria-hidden /> Remove
                      </ActionButton>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {past.length > 0 && (
          <section className="grid gap-3" aria-labelledby="past-shifts">
            <h2 id="past-shifts" className="text-lg font-semibold">
              Past week
            </h2>
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {past.map((shift) => (
                <li key={shift.id} className="p-4 text-muted-foreground">
                  {formatWindow(shift.startsAt, shift.endsAt)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
