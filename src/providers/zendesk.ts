import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * Zendesk webhook normalizer.
 * Docs: https://developer.zendesk.com/documentation/event-connectors/webhooks
 * Signature: HMAC-SHA256 of request body, sent in X-Zendesk-Webhook-Signature header (base64).
 */
export const zendesk: WebhookProvider = {
  name: "zendesk",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("x-zendesk-webhook-signature");
    if (!signature) return false;

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
      headers.get("x-zendesk-webhook-id") ||
      (payload.id as string)?.toString() ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    const eventType = mapEventType(payload);
    const ticket = (payload.ticket as Record<string, unknown>) || payload;
    const ticketId = (ticket.id as number)?.toString() || (payload.id as string) || "unknown";
    const subject = (ticket.subject as string) || (ticket.title as string) || "";
    const status = (ticket.status as string) || "";
    const priority = (ticket.priority as string) || "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "zendesk",
      event_type: eventType,
      severity: getSeverity(eventType, priority),
      summary: buildSummary(eventType, ticketId, subject, status),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function mapEventType(payload: Record<string, unknown>): string {
  const type = (payload.type as string) || (payload.event_type as string) || "";
  const action = (payload.action as string) || "";

  const map: Record<string, string> = {
    "ticket.created": "ticket.created",
    "ticket.updated": "ticket.updated",
    "ticket.solved": "ticket.solved",
    "ticket.closed": "ticket.closed",
    "ticket.deleted": "ticket.deleted",
    "ticket.assigned": "ticket.assigned",
    "user.created": "user.created",
    "user.updated": "user.updated",
    "organization.created": "organization.created",
    "organization.updated": "organization.updated",
    "comment.created": "comment.created",
    "satisfaction_rating.created": "rating.created",
  };

  // Try direct match
  if (map[type]) return map[type];

  // Try combining type + action
  const combined = type && action ? `${type}.${action}` : type || action;
  if (map[combined]) return map[combined];

  // Infer from payload shape
  if (payload.ticket) {
    if (action === "created") return "ticket.created";
    if (action === "updated") return "ticket.updated";
    return "ticket.updated";
  }

  return combined || "unknown";
}

function getSeverity(
  eventType: string,
  priority: string
): "info" | "warning" | "error" | "critical" {
  if (priority === "urgent") return "critical";
  if (priority === "high") return "warning";
  if (eventType.includes("deleted")) return "warning";
  return "info";
}

function buildSummary(
  eventType: string,
  ticketId: string,
  subject: string,
  status: string
): string {
  const statusLabel = status ? ` [${status}]` : "";
  if (subject) {
    return `Zendesk ${eventType}: '${subject}' (#${ticketId})${statusLabel}`;
  }
  return `Zendesk ${eventType} — ticket #${ticketId}${statusLabel}`;
}
