import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EmptyState, PageSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { finalizeCheckout } from "@/lib/dal/jobs";
import { requireRole } from "@/lib/dal/session";

export const metadata: Metadata = { title: "Confirming payment" };

// Stripe sends the homeowner here after paying. We confirm the payment with Stripe
// directly (never trusting the URL alone), create the job, and open it.
export default function CheckoutCompletePage({ searchParams }: PageProps<"/homeowner/book/complete">) {
  return (
    <div className="mx-auto max-w-xl">
      <Suspense fallback={<PageSkeleton rows={1} />}>
        <Complete searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Complete({ searchParams }: { searchParams: PageProps<"/homeowner/book/complete">["searchParams"] }) {
  const user = await requireRole("HOMEOWNER");
  const { session_id } = await searchParams;
  if (typeof session_id !== "string") redirect("/homeowner/book");

  let jobId: string;
  try {
    ({ jobId } = await finalizeCheckout(session_id, user.id));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <EmptyState title="We couldn't finish your booking">
        <p>{error.message}</p>
        <Button asChild className="mt-4">
          <Link href="/homeowner/book">Book again</Link>
        </Button>
      </EmptyState>
    );
  }
  redirect(`/homeowner/jobs/${jobId}?booked=1`);
}
