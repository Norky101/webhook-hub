import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * PagerDuty webhook normalizer (V3 Events).
 * Docs: https://developer.pagerduty.com/docs/webhooks
 * Signature: HMAC-SHA256 of request body, sent in X-PagerDuty-Signature header.
 */
export const pagerduty: WebhookProvider = {
  name: "pagerduty",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("x-pagerduty-signature");
    if (!signature) return false;
    // PagerDuty sends "v1=<hex>" format
    const hex = signature.replace("v1=", "");
    const expected = await hmacSHA256(secret, body);
    return timeSafeEqual(hex, expected);
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    return (
      headers.get("x-webhook-id") ||
      (payload.message_id as string) ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    const event = (payload.event as Record<string, unknown>) || payload;
    const eventType = mapEventType(event);
    const data = (event.data as Record<string, unknown>) || {};
    const incidentId = (data.id as string) || (payload.incident?.id as string) || "unknown";
    const title =
      (data.title as string) ||
      (payload.incident?.title as string) ||
      (event.summary as string) ||
      "";
    const urgency = (data.urgency as string) || "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "pagerduty",
      event_type: eventType,
      severity: getSeverity(eventType, urgency),
      summary: buildSummary(eventType, incidentId, title, urgency),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function mapEventType(event: Record<string, unknown>): string {
  const type = (event.event_type as string) || (event.type as string) || "";

  const map: Record<string, string> = {
    "incident.triggered": "incident.triggered",
    "incident.acknowledged": "incident.acknowledged",
    "incident.resolved": "incident.resolved",
    "incident.escalated": "incident.escalated",
    "incident.reassigned": "incident.reassigned",
    "incident.unacknowledged": "incident.unacknowledged",
    "incident.delegated": "incident.delegated",
    "incident.priority_updated": "incident.priority_updated",
    "service.created": "service.created",
    "service.updated": "service.updated",
    "service.deleted": "service.deleted",
  };

  return map[type] || type || "unknown";
}

function getSeverity(
  eventType: string,
  urgency: string
): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("triggered") && urgency === "high") return "critical";
  if (eventType.includes("triggered")) return "error";
  if (eventType.includes("escalated")) return "warning";
  if (eventType.includes("resolved")) return "info";
  if (eventType.includes("acknowledged")) return "info";
  return "info";
}

function buildSummary(
  eventType: string,
  incidentId: string,
  title: string,
  urgency: string
): string {
  const urgencyLabel = urgency ? ` [${urgency}]` : "";
  if (title) {
    return `PagerDuty ${eventType}: '${title}'${urgencyLabel}`;
  }
  return `PagerDuty ${eventType} — incident ${incidentId}${urgencyLabel}`;
}
