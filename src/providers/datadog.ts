import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * Datadog webhook normalizer.
 * Docs: https://docs.datadoghq.com/integrations/webhooks/
 * Signature: HMAC-SHA256 in X-DD-Signature header.
 */
export const datadog: WebhookProvider = {
  name: "datadog",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("x-dd-signature");
    if (!signature) return false;
    const expected = await hmacSHA256(secret, body);
    return timeSafeEqual(signature, expected);
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    return (
      (payload.id as string) ||
      (payload.alert_id as string)?.toString() ||
      headers.get("x-dd-delivery-id") ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    const eventType = mapEventType(payload);
    const title = (payload.title as string) || (payload.alert_title as string) || "";
    const alertId = (payload.alert_id as string)?.toString() || (payload.id as string) || "unknown";
    const status = (payload.alert_transition as string) || (payload.status as string) || "";
    const priority = (payload.priority as string) || "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "datadog",
      event_type: eventType,
      severity: getSeverity(eventType, status, priority),
      summary: buildSummary(eventType, title, alertId, status),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function mapEventType(payload: Record<string, unknown>): string {
  const transition = (payload.alert_transition as string) || "";
  const type = (payload.event_type as string) || "";

  if (transition === "Triggered") return "monitor.triggered";
  if (transition === "Recovered") return "monitor.recovered";
  if (transition === "Warn") return "monitor.warning";
  if (transition === "No Data") return "monitor.no_data";
  if (type) return `monitor.${type.toLowerCase()}`;
  return "monitor.alert";
}

function getSeverity(
  eventType: string,
  status: string,
  priority: string
): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("triggered") || status === "Triggered") return "critical";
  if (eventType.includes("warning") || status === "Warn") return "warning";
  if (eventType.includes("recovered")) return "info";
  if (priority === "P1") return "critical";
  if (priority === "P2") return "error";
  return "warning";
}

function buildSummary(
  eventType: string,
  title: string,
  alertId: string,
  status: string
): string {
  const statusLabel = status ? ` [${status}]` : "";
  if (title) return `Datadog ${eventType}: '${title}'${statusLabel}`;
  return `Datadog ${eventType} — alert ${alertId}${statusLabel}`;
}
