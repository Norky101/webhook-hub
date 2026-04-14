/**
 * Cross-Tool Correlation Engine
 *
 * Detects patterns across providers. When event A from provider X
 * happens within N minutes of event B from provider Y for the same tenant,
 * generate a correlation alert that flows through the forwarding pipeline.
 *
 * Example: Stripe payment_failed + Zendesk ticket.created within 30 min = churn risk
 */

import type { NormalizedEvent } from "./types";
import { generateEventId, nowISO } from "./utils";
import { forwardEvent, type TwilioConfig } from "./forwarding";

export interface CorrelationRule {
  id: number;
  tenant_id: string;
  name: string;
  provider_a: string;
  event_pattern_a: string;
  provider_b: string;
  event_pattern_b: string;
  time_window_minutes: number;
  action_description: string;
  active: number;
}

/**
 * Check if a newly stored event triggers any correlation rules.
 * Looks backward in time: "did event A happen within the last N minutes?"
 */
export async function checkCorrelations(
  db: D1Database,
  event: NormalizedEvent,
  resendApiKey?: string,
  twilioConfig?: TwilioConfig
): Promise<{ correlations_found: number }> {
  let found = 0;

  // Fetch active rules for this tenant
  const result = await db
    .prepare(
      "SELECT * FROM correlation_rules WHERE tenant_id = ? AND active = 1"
    )
    .bind(event.tenant_id)
    .all();

  const rules = (result.results || []) as unknown as CorrelationRule[];
  if (rules.length === 0) return { correlations_found: 0 };

  for (const rule of rules) {
    // Check if this event matches side A or side B of the rule
    const matchesSideA =
      event.provider === rule.provider_a &&
      matchPattern(rule.event_pattern_a, event.event_type);
    const matchesSideB =
      event.provider === rule.provider_b &&
      matchPattern(rule.event_pattern_b, event.event_type);

    if (!matchesSideA && !matchesSideB) continue;

    // Look for the other side in recent events
    const otherProvider = matchesSideA ? rule.provider_b : rule.provider_a;
    const otherPattern = matchesSideA
      ? rule.event_pattern_b
      : rule.event_pattern_a;

    const recentEvents = await db
      .prepare(
        `SELECT * FROM events
         WHERE tenant_id = ? AND provider = ?
         AND received_at > datetime('now', '-' || ? || ' minutes')
         ORDER BY received_at DESC LIMIT 10`
      )
      .bind(event.tenant_id, otherProvider, rule.time_window_minutes)
      .all();

    const matchingOther = (recentEvents.results || []).find((row) =>
      matchPattern(otherPattern, row.event_type as string)
    );

    if (matchingOther) {
      // Correlation detected! Generate a correlation alert event
      found++;

      const correlationEvent: NormalizedEvent = {
        id: generateEventId(),
        tenant_id: event.tenant_id,
        provider: "system",
        event_type: "correlation.detected",
        severity: "critical",
        summary: `CORRELATION: ${rule.name} — ${rule.provider_a} ${rule.event_pattern_a} + ${rule.provider_b} ${rule.event_pattern_b} detected within ${rule.time_window_minutes}min. Action: ${rule.action_description}`,
        raw_payload: {
          correlation_rule: rule.name,
          event_a: {
            provider: matchesSideA ? event.provider : matchingOther.provider,
            event_type: matchesSideA
              ? event.event_type
              : matchingOther.event_type,
            event_id: matchesSideA ? event.id : matchingOther.id,
          },
          event_b: {
            provider: matchesSideA ? matchingOther.provider : event.provider,
            event_type: matchesSideA
              ? matchingOther.event_type
              : event.event_type,
            event_id: matchesSideA ? matchingOther.id : event.id,
          },
          action: rule.action_description,
        },
        received_at: nowISO(),
        processed_at: nowISO(),
        status: "processed",
      };

      // Store the correlation event
      try {
        await db
          .prepare(
            `INSERT INTO events (id, tenant_id, provider, event_type, severity, summary, raw_payload, delivery_id, received_at, processed_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            correlationEvent.id,
            correlationEvent.tenant_id,
            correlationEvent.provider,
            correlationEvent.event_type,
            correlationEvent.severity,
            correlationEvent.summary,
            JSON.stringify(correlationEvent.raw_payload),
            `corr_${rule.id}_${Date.now()}`,
            correlationEvent.received_at,
            correlationEvent.processed_at,
            correlationEvent.status
          )
          .run();
      } catch {
        // Dedup might reject it — that's fine
      }

      // Forward through all channels (Slack, email, SMS, call)
      await forwardEvent(db, correlationEvent, resendApiKey, twilioConfig);
    }
  }

  return { correlations_found: found };
}

function matchPattern(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern === eventType) return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return eventType.startsWith(prefix + ".");
  }
  if (eventType.startsWith(pattern + ".")) return true;
  return false;
}
