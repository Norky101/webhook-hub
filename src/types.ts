/** The standard event format every provider normalizes into */
export interface NormalizedEvent {
  id: string;
  tenant_id: string;
  provider: string;
  event_type: string;
  severity: "info" | "warning" | "error" | "critical";
  summary: string;
  raw_payload: Record<string, unknown>;
  received_at: string;
  processed_at: string;
  status: "processed" | "failed" | "retrying" | "dead_letter";
}

/** Interface every provider normalizer must implement */
export interface WebhookProvider {
  name: string;

  /** Validate the provider's webhook signature */
  validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean>;

  /** Extract a unique delivery/event ID for idempotency */
  getDeliveryId(payload: Record<string, unknown>, headers: Headers): string;

  /** Normalize the raw payload into our standard format */
  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent;
}
