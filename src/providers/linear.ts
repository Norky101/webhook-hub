import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * Linear webhook normalizer.
 * Docs: https://linear.app/docs/webhooks
 * Signature: HMAC-SHA256 of request body, sent in Linear-Signature header (hex)
 */
export const linear: WebhookProvider = {
  name: "linear",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("linear-signature");
    if (!signature) return false;

    const expected = await hmacSHA256(secret, body);
    return timeSafeEqual(signature, expected);
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    return (
      headers.get("linear-delivery") ||
      (payload.webhookId as string) ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    const action = payload.action as string || "unknown";
    const type = payload.type as string || "unknown";
    const data = (payload.data as Record<string, unknown>) || {};

    const eventType = mapEventType(type, action);
    const objectId = (data.id as string) || "unknown";
    const title = (data.title as string) ||
      (data.name as string) ||
      "";
    const state = (data.state as Record<string, unknown>)?.name as string || "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "linear",
      event_type: eventType,
      severity: getSeverity(eventType, data),
      summary: buildSummary(eventType, title, objectId, state),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function mapEventType(type: string, action: string): string {
  const map: Record<string, Record<string, string>> = {
    Issue: {
      create: "issue.created",
      update: "issue.updated",
      remove: "issue.deleted",
    },
    Comment: {
      create: "comment.created",
      update: "comment.updated",
      remove: "comment.deleted",
    },
    Project: {
      create: "project.created",
      update: "project.updated",
      remove: "project.deleted",
    },
    Cycle: {
      create: "cycle.created",
      update: "cycle.updated",
      remove: "cycle.deleted",
    },
    IssueLabel: {
      create: "label.created",
      update: "label.updated",
      remove: "label.deleted",
    },
  };

  return map[type]?.[action] || `${type.toLowerCase()}.${action}`;
}

function getSeverity(
  eventType: string,
  data: Record<string, unknown>
): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("deleted")) return "warning";
  // High-priority or urgent issues
  const priority = data.priority as number;
  if (priority === 1) return "critical";
  if (priority === 2) return "warning";
  return "info";
}

function buildSummary(
  eventType: string,
  title: string,
  objectId: string,
  state: string
): string {
  const stateLabel = state ? ` [${state}]` : "";
  if (title) {
    return `Linear ${eventType}: '${title}'${stateLabel}`;
  }
  return `Linear ${eventType} on ${objectId}${stateLabel}`;
}
