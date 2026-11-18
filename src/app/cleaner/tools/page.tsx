import type { Metadata } from "next";
import { Suspense } from "react";
import { Wrench } from "lucide-react";
import { cancelRentalAction } from "@/app/actions/rentals";
import { ActionButton } from "@/components/forms";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/page";
import { RentalBadge } from "@/components/rental-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/misc";
import { APP_TIMEZONE } from "@/lib/config";
import { TOOL_TYPE_LABEL } from "@/lib/contracts/domain";
import { listMyRentals } from "@/lib/dal/rentals";
import { requireRole } from "@/lib/dal/session";
import { listMyShifts } from "@/lib/dal/shifts";
import { listToolsForCleaner } from "@/lib/dal/tools";
import { formatMoney, formatRange, formatWindow } from "@/lib/format";
import { wallClockIso } from "@/lib/time";
import { RentalForm } from "./rental-form";

// Member 4: cleaners rent tools from the library for the hours they work.

export const metadata: Metadata = { title: "Tools" };

const OPEN_PHASES = ["PENDING", "UPCOMING", "OUT", "OVERDUE"];
const MAX_PRESETS = 6;
const MAX_RESERVED_SHOWN = 3;

export default function CleanerToolsPage() {
  return (
    <>
      <PageHeader
        title="Tools"
        description="Rent a snow blower, shovel or salt spreader from the Snowber tool library. The controller approves each request, and the fee comes out of your earnings."
      />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Tools />
      </Suspense>
    </>
  );
}

async function Tools() {
  const user = await requireRole("CLEANER");
  const [{ tools, ownsBlower }, rentals, shifts] = await Promise.all([listToolsForCleaner(user), listMyRentals(user), listMyShifts(user)]);
  const open = rentals.filter((r) => OPEN_PHASES.includes(r.phase));
  const past = rentals.filter((r) => !OPEN_PHASES.includes(r.phase)).reverse();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Request a tool</CardTitle>
          <CardDescription>
            {ownsBlower
              ? "You own a snow blower, so large driveways don't need a rental."
              : "Large driveways need a snow blower. Reserve one for your shifts so the controller can give you those jobs."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">The tool library is empty right now.</p>
          ) : (
            <RentalForm
              tools={tools.map((t) => ({
                id: t.id,
                name: t.name,
                detail: TOOL_TYPE_LABEL[t.type] + ".",
                fee: formatMoney(t.feeCents),
                available: t.status === "AVAILABLE",
              }))}
              presets={shifts
                .filter((s) => !s.isPast)
                .slice(0, MAX_PRESETS)
                .map((s) => ({ id: s.id, label: formatWindow(s.startsAt, s.endsAt), startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }))}
              defaultStart={wallClockIso(1, 6, APP_TIMEZONE)}
              defaultEnd={wallClockIso(1, 12, APP_TIMEZONE)}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid content-start gap-6">
        <section className="grid gap-3" aria-labelledby="my-rentals">
          <h2 id="my-rentals" className="text-lg font-semibold">
            My rentals ({open.length})
          </h2>
          {open.length === 0 ? (
            <EmptyState title="No rentals">Pick a tool and the hours you need it.</EmptyState>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {open.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{r.tool.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatRange(r.startsAt, r.endsAt)} · {formatMoney(r.feeCents)}
                    </p>
                    {r.phase === "OVERDUE" && <p className="text-sm text-destructive">Please bring it back to the tool library.</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <RentalBadge phase={r.phase} status={r.status} />
                    {r.canCancel && (
                      <ActionButton
                        action={cancelRentalAction.bind(null, r.id)}
                        variant="ghost"
                        size="lg"
                        aria-label={`Cancel ${r.tool.name}, ${formatRange(r.startsAt, r.endsAt)}`}
                        confirm={
                          r.status === "APPROVED"
                            ? { title: "Cancel this reservation?", description: `${formatMoney(r.feeCents)} goes back to your balance.`, confirmLabel: "Cancel reservation", destructive: true }
                            : undefined
                        }
                      >
                        Cancel
                      </ActionButton>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-3" aria-labelledby="library">
          <h2 id="library" className="text-lg font-semibold">
            Tool library
          </h2>
          {tools.length === 0 ? (
            <EmptyState title="No tools yet">The controller hasn&apos;t added any tools.</EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {tools.map((t) => (
                <li key={t.id} className="grid content-start gap-1.5 rounded-xl border bg-card p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex items-center gap-2 font-medium">
                      <Wrench className="size-4 shrink-0 text-primary" aria-hidden />
                      {t.name}
                    </p>
                    <span className="font-medium tabular-nums">{formatMoney(t.feeCents)}</span>
                  </div>
                  <p className="text-muted-foreground">{TOOL_TYPE_LABEL[t.type]}</p>
                  {t.status !== "AVAILABLE" ? (
                    <Badge variant="warning">Out for repair</Badge>
                  ) : t.reserved.length === 0 ? (
                    <p className="text-success">Free for the next 30 days</p>
                  ) : (
                    <div className="text-muted-foreground">
                      <p>Reserved:</p>
                      <ul className="list-inside list-disc">
                        {t.reserved.slice(0, MAX_RESERVED_SHOWN).map((r) => (
                          <li key={r.startsAt.toISOString()}>{formatRange(r.startsAt, r.endsAt)}</li>
                        ))}
                        {t.reserved.length > MAX_RESERVED_SHOWN && <li>and {t.reserved.length - MAX_RESERVED_SHOWN} more</li>}
                      </ul>
                    </div>
                  )}
                  {t.notes && <p className="text-xs text-muted-foreground">{t.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {past.length > 0 && (
          <section className="grid gap-3" aria-labelledby="past-rentals">
            <h2 id="past-rentals" className="text-lg font-semibold">
              Past two weeks
            </h2>
            <ul className="divide-y rounded-xl border bg-card text-sm">
              {past.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground">{r.tool.name}</span> · {formatRange(r.startsAt, r.endsAt)}
                  </span>
                  <RentalBadge phase={r.phase} status={r.status} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {!ownsBlower && tools.every((t) => t.type !== "SNOW_BLOWER" || t.status !== "AVAILABLE") && tools.length > 0 && (
          <Alert variant="warning">
            <AlertDescription>No snow blower is in service right now, so you can only take small and medium driveways.</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
