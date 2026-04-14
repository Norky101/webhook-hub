import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * Gusto webhook normalizer.
 * Docs: https://docs.gusto.com/embedded-payroll/docs/webhooks
 * Signature: HMAC-SHA256 of request body using webhook secret, sent in X-Gusto-Signature header
 */
export const gusto: WebhookProvider = {
  name: "gusto",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("x-gusto-signature");
    if (!signature) return false;

    const expected = await hmacSHA256(secret, body);
    return timeSafeEqual(signature, expected);
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    return (
      headers.get("x-gusto-delivery-id") ||
      (payload.event_id as string) ||
      (payload.uuid as string) ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    const eventType = mapEventType(payload.event_type as string);
    const entityType = (payload.entity_type as string) || "";
    const entityId =
      (payload.entity_uuid as string) ||
      ((payload.entity as Record<string, unknown>)?.uuid as string) ||
      "unknown";
    const companyId =
      (payload.company_uuid as string) ||
      ((payload.company as Record<string, unknown>)?.uuid as string) ||
      "";

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "gusto",
      event_type: eventType,
      severity: getSeverity(eventType),
      summary: buildSummary(eventType, entityType, entityId, companyId),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function mapEventType(eventType: string | undefined): string {
  if (!eventType) return "unknown";

  const map: Record<string, string> = {
    "payroll.processed": "payroll.processed",
    "payroll.created": "payroll.created",
    "payroll.updated": "payroll.updated",
    "payroll.reversed": "payroll.reversed",
    "employee.created": "employee.created",
    "employee.updated": "employee.updated",
    "employee.terminated": "employee.terminated",
    "employee.rehired": "employee.rehired",
    "contractor.created": "contractor.created",
    "contractor.updated": "contractor.updated",
    "contractor_payment.processed": "contractor_payment.processed",
    "contractor_payment.created": "contractor_payment.created",
    "company.updated": "company.updated",
    "company.created": "company.created",
    "tax_filing.created": "tax_filing.created",
    "tax_filing.updated": "tax_filing.updated",
    "garnishment.created": "garnishment.created",
    "garnishment.updated": "garnishment.updated",
  };

  return map[eventType] || eventType;
}

function getSeverity(eventType: string): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("terminated")) return "warning";
  if (eventType.includes("reversed")) return "warning";
  if (eventType.includes("garnishment")) return "warning";
  if (eventType.includes("payroll.processed")) return "info";
  return "info";
}

function buildSummary(
  eventType: string,
  entityType: string,
  entityId: string,
  companyId: string
): string {
  let summary = `Gusto ${eventType}`;
  if (entityType) summary += ` — ${entityType} ${entityId}`;
  else summary += ` — ${entityId}`;
  if (companyId) summary += ` (company: ${companyId})`;
  return summary;
}
