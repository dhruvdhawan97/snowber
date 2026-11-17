import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { PageHeader, PageSkeleton, Stat } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { checkDatabase } from "@/lib/dal/health";
import { requireRole } from "@/lib/dal/session";
import { paymentsAreSimulated } from "@/lib/payments";
import { prisma } from "@/lib/prisma";

// Member 1 version of the controller home: time slots, people, discounts and system status.
// Dispatch, jobs and the tool library are Members 3 and 4's
// areas and plug in here as they are built.

export default function ControllerOverviewPage() {
  return (
    <>
      <PageHeader title="Controller" description="Open time slots, manage people and discount requests, and check that the system is healthy." />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  await requireRole("CONTROLLER");
  const [homeowners, cleaners, pendingDiscounts, openJobs, db] = await Promise.all([
    prisma.user.count({ where: { role: "HOMEOWNER", deactivatedAt: null } }),
    prisma.user.count({ where: { role: "CLEANER", deactivatedAt: null } }),
    prisma.user.count({ where: { discountStatus: "PENDING", deactivatedAt: null } }),
    prisma.job.count({ where: { status: { in: ["REQUESTED", "ASSIGNED", "IN_PROGRESS"] } } }),
    checkDatabase(),
  ]);
  const simulated = paymentsAreSimulated();

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Homeowners" value={homeowners} />
        <Stat label="Cleaners" value={cleaners} />
        <Stat label="Open bookings" value={openJobs} />
        <Stat label="Discount requests" value={pendingDiscounts} hint={pendingDiscounts > 0 ? "Waiting for you" : undefined} />
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
      </div>

      <p className="text-sm text-muted-foreground">
        Dispatch, the jobs list and the tool library are built by the other team members.
      </p>
    </div>
  );
}
