import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * Stripe webhook normalizer.
 * Docs: https://docs.stripe.com/webhooks
 * Signature: HMAC-SHA256 with timestamp, sent in Stripe-Signature header.
 */
export const stripe: WebhookProvider = {
  name: "stripe",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const sigHeader = headers.get("stripe-signature");
    if (!sigHeader) return false;

    // Parse Stripe's "t=timestamp,v1=signature" format
    const parts: Record<string, string> = {};
    sigHeader.split(",").forEach((p) => {
      const [k, v] = p.split("=");
      parts[k] = v;
    });

    if (!parts.t || !parts.v1) return false;

    // Stripe signs: timestamp.body
    const payload = `${parts.t}.${body}`;
    const expected = await hmacSHA256(secret, payload);
    return timeSafeEqual(parts.v1, expected);
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    return (
      (payload.id as string) ||
      headers.get("stripe-event-id") ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    const type = (payload.type as string) || "unknown";
    const eventType = mapEventType(type);
    const data = (payload.data as Record<string, unknown>)?.object as Record<string, unknown> || {};
    const objectId = (data.id as string) || (payload.id as string) || "unknown";
    const amount = data.amount as number;
    const currency = (data.currency as string)?.toUpperCase() || "";
    const customerEmail = (data.email as string) || (data.customer_email as string) || "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "stripe",
      event_type: eventType,
      severity: getSeverity(eventType),
      summary: buildSummary(eventType, objectId, amount, currency, customerEmail),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function mapEventType(type: string): string {
  const map: Record<string, string> = {
    "payment_intent.succeeded": "payment.succeeded",
    "payment_intent.payment_failed": "payment.failed",
    "charge.succeeded": "charge.succeeded",
    "charge.failed": "charge.failed",
    "charge.refunded": "charge.refunded",
    "charge.disputed": "charge.disputed",
    "customer.subscription.created": "subscription.created",
    "customer.subscription.updated": "subscription.updated",
    "customer.subscription.deleted": "subscription.cancelled",
    "customer.subscription.trial_will_end": "subscription.trial_ending",
    "invoice.paid": "invoice.paid",
    "invoice.payment_failed": "invoice.payment_failed",
    "invoice.upcoming": "invoice.upcoming",
    "customer.created": "customer.created",
    "customer.updated": "customer.updated",
    "customer.deleted": "customer.deleted",
    "checkout.session.completed": "checkout.completed",
    "payout.paid": "payout.paid",
    "payout.failed": "payout.failed",
  };

  return map[type] || type;
}

function getSeverity(eventType: string): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("failed")) return "error";
  if (eventType.includes("disputed")) return "critical";
  if (eventType.includes("cancelled")) return "warning";
  if (eventType.includes("refunded")) return "warning";
  return "info";
}

function buildSummary(
  eventType: string,
  objectId: string,
  amount: number | undefined,
  currency: string,
  email: string
): string {
  const amountStr = amount ? ` $${(amount / 100).toFixed(2)} ${currency}` : "";
  const emailStr = email ? ` (${email})` : "";
  return `Stripe ${eventType}${amountStr}${emailStr} — ${objectId}`;
}
