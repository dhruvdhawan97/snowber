import { finalizeCheckout } from "@/lib/dal/jobs";
import { getStripe } from "@/lib/payments";

// Stripe calls this when a Checkout payment succeeds, so the job is created even
// if the homeowner closes the tab before returning to the success page.
// Local testing:  stripe listen --forward-to localhost:3000/api/stripe/webhook
// and put the whsec_... it prints in STRIPE_WEBHOOK_SECRET.

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return new Response("Stripe webhooks are not configured", { status: 501 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event;
  try {
    // The signature covers the exact raw body, so read it as text.
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    try {
      await finalizeCheckout(event.data.object.id);
    } catch (error) {
      // Already handled (e.g. windows closed → refunded). Don't make Stripe retry forever.
      console.error("[stripe] finalize from webhook failed", error);
    }
  }
  return Response.json({ received: true });
}
