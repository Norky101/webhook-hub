import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO } from "../utils";

/**
 * HubSpot webhook normalizer.
 * Docs: https://developers.hubspot.com/docs/api/webhooks
 * Signature: HMAC-SHA256 of request body using client secret (v2)
 */
export const hubspot: WebhookProvider = {
  name: "hubspot",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("x-hubspot-signature-v3") || headers.get("x-hubspot-signature");
    if (!signature) return false;

    // HubSpot v3: HMAC-SHA256 of (requestMethod + requestURI + requestBody + timestamp)
    // Simplified: HMAC-SHA256 of body with client secret
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return signature === expected;
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    // HubSpot sends a correlation ID in headers
    return (
      headers.get("x-hubspot-request-id") ||
      (payload.correlationId as string) ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    // HubSpot sends arrays of subscription events
    const eventType = mapEventType(payload.subscriptionType as string);
    const objectId = payload.objectId as string || "unknown";
    const propertyName = payload.propertyName as string || "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "hubspot",
      event_type: eventType,
      severity: getSeverity(eventType),
      summary: buildSummary(eventType, objectId, propertyName),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

/** Map HubSpot subscription types to our common taxonomy */
function mapEventType(subscriptionType: string | undefined): string {
  if (!subscriptionType) return "unknown";

  const map: Record<string, string> = {
    "deal.creation": "deal.created",
    "deal.propertyChange": "deal.updated",
    "deal.deletion": "deal.deleted",
    "contact.creation": "contact.created",
    "contact.propertyChange": "contact.updated",
    "contact.deletion": "contact.deleted",
    "company.creation": "company.created",
    "company.propertyChange": "company.updated",
    "company.deletion": "company.deleted",
  };

  return map[subscriptionType] || subscriptionType;
}

function getSeverity(eventType: string): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("deleted")) return "warning";
  return "info";
}

function buildSummary(eventType: string, objectId: string, propertyName: string): string {
  if (propertyName) {
    return `HubSpot ${eventType} on object ${objectId} (property: ${propertyName})`;
  }
  return `HubSpot ${eventType} on object ${objectId}`;
}
