import "server-only";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";

// Payments sit behind a small interface so the rest of the app never talks to a
// payment company directly.
//
// • mock   – default. Homeowners are "charged" instantly at booking, refunds are
//            no-ops. Used whenever STRIPE_SECRET_KEY is not set.
// • stripe – Stripe test mode. Homeowners pay on a Stripe Checkout page, which
//            shows card, Apple Pay and Google Pay (wallets are switched on in the
//            Stripe dashboard; nothing in this code lists payment methods, so
//            Stripe shows whatever the dashboard enables). Refunds go back to
//            the original card or wallet.
//
// Cleaners are paid through the earnings ledger; real payouts would need Stripe
// Connect identity checks and are out of scope for the course build.

export interface PaymentProvider {
  readonly name: "mock" | "stripe";
  /** Instant charge. Only the mock provider charges this way; Stripe uses Checkout. */
  charge(input: { jobId: string; amountCents: number; description: string }): Promise<{ externalId: string }>;
  refund(input: { externalId: string | null; amountCents: number }): Promise<void>;
}

export const mockPaymentProvider: PaymentProvider = {
  name: "mock",
  async charge() {
    return { externalId: `mock_ch_${randomUUID()}` };
  },
  async refund() {
    // Nothing to do: no real money moves in the mock provider.
  },
};

let stripeClient: Stripe | null = null;

/** The Stripe client, or null when Stripe isn't configured (mock payments). */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // STRIPE_API_BASE is only for local testing against a fake Stripe server (e.g. stripe-mock).
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  stripeClient ??= new Stripe(
    key,
    base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol.replace(":", "") as "http" | "https" } : undefined,
  );
  return stripeClient;
}

const stripePaymentProvider: PaymentProvider = {
  name: "stripe",
  async charge() {
    throw new Error("Stripe charges go through Checkout (createCheckoutSession), not charge().");
  },
  async refund({ externalId, amountCents }) {
    // externalId is the Stripe PaymentIntent id saved when the Checkout session completed.
    if (!externalId || amountCents <= 0) return;
    await getStripe()!.refunds.create({ payment_intent: externalId, amount: amountCents });
  },
};

export function getPaymentProvider(): PaymentProvider {
  return getStripe() ? stripePaymentProvider : mockPaymentProvider;
}

export function paymentsAreSimulated(): boolean {
  return getStripe() === null;
}

export type CheckoutLine = { name: string; description?: string; amountCents: number };

/**
 * Creates a Stripe Checkout page for a booking that hasn't been saved yet.
 * The booking details travel in `metadata` and the job is only created once
 * Stripe confirms the payment (see finalizeCheckout in src/lib/dal/jobs.ts).
 */
export async function createCheckoutSession(input: {
  customerEmail: string;
  lines: CheckoutLine[];
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured");
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.customerEmail,
    line_items: input.lines
      .filter((l) => l.amountCents > 0)
      .map((l) => ({
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: l.amountCents,
          product_data: { name: l.name, ...(l.description ? { description: l.description } : {}) },
        },
      })),
    metadata: input.metadata,
    payment_intent_data: { metadata: input.metadata },
    // Stripe replaces {CHECKOUT_SESSION_ID} with the real id on redirect.
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/** Reads a finished Checkout session; returns null unless it has actually been paid. */
export async function getPaidCheckoutSession(sessionId: string) {
  const stripe = getStripe();
  if (!stripe) return null;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid" || typeof session.payment_intent !== "string") return null;
  return {
    id: session.id,
    paymentIntentId: session.payment_intent,
    amountTotal: session.amount_total ?? 0,
    metadata: (session.metadata ?? {}) as Record<string, string>,
  };
}
