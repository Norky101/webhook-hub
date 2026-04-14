import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * Salesforce webhook normalizer.
 * Handles Salesforce Outbound Messages and Platform Events.
 * Signature: HMAC-SHA256 of request body using org secret.
 */
export const salesforce: WebhookProvider = {
  name: "salesforce",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("x-sfdc-signature");
    if (!signature) return false;
    const expected = await hmacSHA256(secret, body);
    return timeSafeEqual(signature, expected);
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    return (
      headers.get("x-sfdc-delivery-id") ||
      (payload.Id as string) ||
      (payload.event?.replayId as string)?.toString() ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    const eventType = mapEventType(payload);
    const objectId =
      (payload.Id as string) ||
      (payload.sobject as Record<string, unknown>)?.Id as string ||
      "unknown";
    const objectType =
      (payload.sobjectType as string) ||
      (payload.attributes as Record<string, unknown>)?.type as string ||
      "";
    const name =
      (payload.Name as string) ||
      (payload.sobject as Record<string, unknown>)?.Name as string ||
      "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "salesforce",
      event_type: eventType,
      severity: getSeverity(eventType),
      summary: buildSummary(eventType, objectType, objectId, name),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function mapEventType(payload: Record<string, unknown>): string {
  // Platform Events have a schema field
  const schema = payload.schema as string;
  if (schema) return `platform_event.${schema.toLowerCase()}`;

  // Outbound messages have an action
  const action = (payload.action as string) || "";
  const sobjectType = (
    (payload.sobjectType as string) ||
    (payload.attributes as Record<string, unknown>)?.type as string ||
    "record"
  ).toLowerCase();

  const map: Record<string, string> = {
    created: `${sobjectType}.created`,
    updated: `${sobjectType}.updated`,
    deleted: `${sobjectType}.deleted`,
    undeleted: `${sobjectType}.restored`,
  };

  return map[action.toLowerCase()] || `${sobjectType}.${action || "unknown"}`;
}

function getSeverity(eventType: string): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("deleted")) return "warning";
  if (eventType.includes("restored")) return "info";
  return "info";
}

function buildSummary(
  eventType: string,
  objectType: string,
  objectId: string,
  name: string
): string {
  const label = name ? ` '${name}'` : "";
  const type = objectType || "record";
  return `Salesforce ${eventType}: ${type} ${objectId}${label}`;
}
