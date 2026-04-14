import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * Shopify webhook normalizer.
 * Docs: https://shopify.dev/docs/apps/webhooks
 * Signature: HMAC-SHA256 of request body using app secret, sent in X-Shopify-Hmac-Sha256 (base64)
 */
export const shopify: WebhookProvider = {
  name: "shopify",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("x-shopify-hmac-sha256");
    if (!signature) return false;

    // Shopify sends base64-encoded HMAC-SHA256
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

    return timeSafeEqual(signature, expected);
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    return (
      headers.get("x-shopify-webhook-id") ||
      (payload.id as string)?.toString() ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    // Shopify topic comes in the header at receive time, but we also
    // infer from payload shape. The topic is passed through as a field
    // by the receiver if available, otherwise we detect from payload.
    const topic = (payload._topic as string) || inferTopic(payload);
    const eventType = mapEventType(topic);
    const objectId = (payload.id as number)?.toString() || "unknown";
    const name = (payload.name as string) ||
      (payload.title as string) ||
      (payload.email as string) ||
      "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "shopify",
      event_type: eventType,
      severity: getSeverity(eventType),
      summary: buildSummary(eventType, objectId, name),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function inferTopic(payload: Record<string, unknown>): string {
  // Best-effort inference from payload shape
  if (payload.line_items) return "orders/create";
  if (payload.sku) return "products/update";
  if (payload.email && payload.total_spent !== undefined) return "customers/update";
  return "unknown";
}

function mapEventType(topic: string): string {
  const map: Record<string, string> = {
    "orders/create": "order.created",
    "orders/updated": "order.updated",
    "orders/cancelled": "order.cancelled",
    "orders/fulfilled": "order.fulfilled",
    "orders/paid": "order.paid",
    "orders/partially_fulfilled": "order.partially_fulfilled",
    "products/create": "product.created",
    "products/update": "product.updated",
    "products/delete": "product.deleted",
    "customers/create": "customer.created",
    "customers/update": "customer.updated",
    "customers/delete": "customer.deleted",
    "refunds/create": "refund.created",
    "checkouts/create": "checkout.created",
    "checkouts/update": "checkout.updated",
    "fulfillments/create": "fulfillment.created",
    "fulfillments/update": "fulfillment.updated",
  };

  return map[topic] || topic || "unknown";
}

function getSeverity(eventType: string): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("cancelled")) return "warning";
  if (eventType.includes("deleted")) return "warning";
  if (eventType.includes("refund")) return "warning";
  return "info";
}

function buildSummary(eventType: string, objectId: string, name: string): string {
  const label = name ? ` '${name}'` : "";
  return `Shopify ${eventType} — object ${objectId}${label}`;
}
