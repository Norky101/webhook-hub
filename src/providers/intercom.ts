import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * Intercom webhook normalizer.
 * Docs: https://developers.intercom.com/docs/webhooks
 * Signature: HMAC-SHA1 of request body using hub secret, sent in X-Hub-Signature header
 */
export const intercom: WebhookProvider = {
  name: "intercom",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("x-hub-signature");
    if (!signature) return false;

    // Intercom uses HMAC-SHA1 with "sha1=" prefix
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expected =
      "sha1=" +
      Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    return timeSafeEqual(signature, expected);
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    return (
      (payload.id as string) ||
      headers.get("x-request-id") ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    const topic = (payload.topic as string) || "unknown";
    const data = (payload.data as Record<string, unknown>) || {};
    const item = (data.item as Record<string, unknown>) || {};

    const eventType = mapEventType(topic);
    const objectId = (item.id as string) || (data.id as string) || "unknown";
    const itemType = (item.type as string) || "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "intercom",
      event_type: eventType,
      severity: getSeverity(eventType),
      summary: buildSummary(eventType, objectId, itemType, item),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function mapEventType(topic: string): string {
  const map: Record<string, string> = {
    "conversation.user.created": "conversation.created",
    "conversation.user.replied": "conversation.replied",
    "conversation.admin.replied": "conversation.admin_replied",
    "conversation.admin.assigned": "conversation.assigned",
    "conversation.admin.closed": "conversation.closed",
    "conversation.admin.opened": "conversation.opened",
    "conversation.admin.noted": "conversation.noted",
    "conversation.admin.snoozed": "conversation.snoozed",
    "conversation.admin.unsnoozed": "conversation.unsnoozed",
    "contact.created": "contact.created",
    "contact.updated": "contact.updated",
    "contact.deleted": "contact.deleted",
    "contact.signed_up": "contact.signed_up",
    "contact.tag.created": "contact.tagged",
    "contact.tag.deleted": "contact.untagged",
    "user.created": "user.created",
    "user.deleted": "user.deleted",
    "user.email.updated": "user.email_updated",
    "user.tag.created": "user.tagged",
    "user.tag.deleted": "user.untagged",
    "visitor.signed_up": "visitor.signed_up",
  };

  return map[topic] || topic || "unknown";
}

function getSeverity(eventType: string): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("deleted")) return "warning";
  if (eventType.includes("closed")) return "info";
  if (eventType.includes("created") && eventType.includes("conversation"))
    return "info";
  return "info";
}

function buildSummary(
  eventType: string,
  objectId: string,
  itemType: string,
  item: Record<string, unknown>
): string {
  const assignee = (item.assignee as Record<string, unknown>)?.name as string;
  const subject =
    (item.source as Record<string, unknown>)?.subject as string ||
    (item.title as string) ||
    "";

  let summary = `Intercom ${eventType}`;
  if (subject) summary += `: '${subject}'`;
  if (itemType) summary += ` (${itemType} ${objectId})`;
  else summary += ` — ${objectId}`;
  if (assignee) summary += ` assigned to ${assignee}`;

  return summary;
}
