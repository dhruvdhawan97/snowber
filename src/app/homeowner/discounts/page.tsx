import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyDiscount } from "@/lib/dal/jobs";
import { requireRole } from "@/lib/dal/session";
import { DiscountForm } from "./discount-form";

export const metadata: Metadata = { title: "Discounts" };

export default function DiscountsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Discounts" description="Seniors and people living with a disability get 20% off every clearing." />
      <Suspense fallback={<PageSkeleton rows={1} />}>
        <Discount />
      </Suspense>
    </div>
  );
}

async function Discount() {
  const user = await requireRole("HOMEOWNER");
  const discount = await getMyDiscount(user);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {discount.label ?? "No discount yet"}
          {discount.status === "APPROVED" && <Badge className="bg-success text-white">Active · 20% off</Badge>}
          {discount.status === "PENDING" && <Badge variant="secondary">Waiting for approval</Badge>}
        </CardTitle>
        <CardDescription>
          {discount.status === "APPROVED"
            ? "Your discount is taken off the service price automatically when you book (not off tips)."
            : discount.status === "PENDING"
              ? "A controller will review your request. Once approved, the discount applies to new bookings."
              : "Apply below. A controller reviews each request before the discount starts."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DiscountForm current={discount.program} />
        <p className="mt-4 text-xs text-muted-foreground">
          We only store which discount you have. We never ask for or keep medical records or ID numbers. The controller may
          contact you to confirm.
        </p>
      </CardContent>
    </Card>
  );
}
