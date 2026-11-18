import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ArrowRight, CircleCheck } from "lucide-react";
import { PageHeader, PageSkeleton, Stat } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { countOpenDisputes } from "@/lib/dal/disputes";
import { checkDatabase } from "@/lib/dal/health";
import { runIntegrityChecks } from "@/lib/dal/integrity";
import { autoConfirmStale } from "@/lib/dal/jobs";
import { requireRole } from "@/lib/dal/session";
import { paymentsAreSimulated } from "@/lib/payments";
import { prisma } from "@/lib/prisma";

// Controller home: time slots, people and discounts (Member 1); tool library, disputes
// and workflow checks (Member 4); system status. Dispatch and the jobs list are
// Member 3's area and plug in here as they are built.

export default function ControllerOverviewPage() {
  return (
    <>
      <PageHeader
        title="Controller"
        description="Open time slots, manage people, tools and disputes, and check that the system and its workflows are healthy."
      />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  const user = await requireRole("CONTROLLER");
  // Pays cleaners for jobs nobody confirmed in time (also runs from /api/cron/auto-confirm).
  await autoConfirmStale();
  const [homeowners, cleaners, pendingDiscounts, openJobs, db, openDisputes, toolRequests, issues] = await Promise.all([
    prisma.user.count({ where: { role: "HOMEOWNER", deactivatedAt: null } }),
    prisma.user.count({ where: { role: "CLEANER", deactivatedAt: null } }),
    prisma.user.count({ where: { discountStatus: "PENDING", deactivatedAt: null } }),
    prisma.job.count({ where: { status: { in: ["REQUESTED", "ASSIGNED", "IN_PROGRESS"] } } }),
    checkDatabase(),
    countOpenDisputes(user),
    prisma.toolRental.count({ where: { status: "REQUESTED", endsAt: { gt: new Date() } } }),
    runIntegrityChecks(user),
  ]);
  const simulated = paymentsAreSimulated();

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Homeowners" value={homeowners} />
        <Stat label="Cleaners" value={cleaners} />
        <Stat label="Open bookings" value={openJobs} />
        <Stat label="Discount requests" value={pendingDiscounts} hint={pendingDiscounts > 0 ? "Waiting for you" : undefined} />
        <Stat label="Open disputes" value={openDisputes} hint={openDisputes > 0 ? "Waiting for you" : undefined} />
        <Stat label="Tool requests" value={toolRequests} hint={toolRequests > 0 ? "Waiting for you" : undefined} />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Time slots</CardTitle>
            <CardDescription>Open the windows homeowners can book, set their price rate, and close them when full.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/controller/windows">
                Open Time slots <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>People</CardTitle>
            <CardDescription>Add or remove homeowners, cleaners and controllers, and approve discount requests.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/controller/users">
                Open Users <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tool library</CardTitle>
            <CardDescription>Stock snow blowers and other tools, approve rental requests and check tools back in.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant={toolRequests > 0 ? "default" : "outline"}>
              <Link href="/controller/tools">
                Open Tools <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Disputes</CardTitle>
            <CardDescription>Review the photos for jobs a homeowner disputed, then pay the cleaner or refund the homeowner.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant={openDisputes > 0 ? "default" : "outline"}>
              <Link href="/controller/disputes">
                Open Disputes <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System status</CardTitle>
            <CardDescription>
              Raw details at{" "}
              <a href="/api/health" className="underline underline-offset-2">
                /api/health
              </a>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${db.ok ? "bg-success" : "bg-destructive"}`} aria-hidden />
              {db.ok ? `Database "${db.database}" connected (${db.latencyMs} ms)` : `Database unreachable: ${db.error}`}
            </p>
            <p className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${simulated ? "bg-warning" : "bg-success"}`} aria-hidden />
              Payments: {simulated ? "simulated (no Stripe key set)" : "Stripe test mode (card, Apple Pay, Google Pay)"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow checks</CardTitle>
            <CardDescription>Jobs, payments and rentals that don&apos;t add up. Normally this stays empty.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {issues.length === 0 ? (
              <p className="flex items-center gap-2 text-success">
                <CircleCheck className="size-4 shrink-0" aria-hidden /> All checks pass
              </p>
            ) : (
              <ul className="grid gap-2">
                {issues.map((issue) => (
                  <li key={issue.key} className="flex gap-2">
                    <AlertTriangle
                      className={`mt-0.5 size-4 shrink-0 ${issue.severity === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-300"}`}
                      aria-hidden
                    />
                    <div>
                      <p className="font-medium">
                        {issue.href ? (
                          <Link href={issue.href} className="underline-offset-4 hover:underline">
                            {issue.title}
                          </Link>
                        ) : (
                          issue.title
                        )}{" "}
                        <span className="tabular-nums">({issue.count})</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{issue.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-sm text-muted-foreground">Dispatch and the jobs list are being built by Member 3.</p>
    </div>
  );
}
