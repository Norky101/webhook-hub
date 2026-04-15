/**
 * Alerting Rules Engine
 *
 * Evaluates metric-based rules on every cron tick.
 * When a metric crosses a threshold over a time window,
 * generates a critical alert that flows through the forwarding pipeline.
 *
 * Supported metrics:
 * - error_rate: % of failed events for a provider
 * - failed_count: absolute count of failed events
 * - retry_queue_depth: number of events in retry queue
 * - dead_letter_count: number of events in dead letter queue
 * - event_volume: total events received (spike detection)
 */

import type { NormalizedEvent } from "./types";
import { generateEventId, nowISO } from "./utils";
import { forwardEvent, type TwilioConfig } from "./forwarding";

interface AlertRule {
  id: number;
  tenant_id: string;
  name: string;
  metric: string;
  provider_filter: string | null;
  threshold: number;
  window_minutes: number;
  comparison: string; // 'gt' | 'lt' | 'gte' | 'lte'
  active: number;
  last_triggered_at: string | null;
}

/**
 * Evaluate all active alert rules across all tenants.
 * Called from the cron trigger every minute.
 */
export async function evaluateAlertRules(
  db: D1Database,
  resendApiKey?: string,
  twilioConfig?: TwilioConfig
): Promise<{ evaluated: number; triggered: number }> {
  const stats = { evaluated: 0, triggered: 0 };

  // Fetch all active rules
  const result = await db
    .prepare("SELECT * FROM alert_rules WHERE active = 1")
    .all();

  const rules = (result.results || []) as unknown as AlertRule[];
  if (rules.length === 0) return stats;

  for (const rule of rules) {
    stats.evaluated++;

    // Cooldown: don't re-trigger if fired in the last window
    if (rule.last_triggered_at) {
      const lastFired = new Date(rule.last_triggered_at).getTime();
      const cooldown = rule.window_minutes * 60 * 1000;
      if (Date.now() - lastFired < cooldown) continue;
    }

    const currentValue = await getMetricValue(db, rule);
    const triggered = compare(currentValue, rule.threshold, rule.comparison);

    if (triggered) {
      stats.triggered++;

      // Generate alert event
      const alertEvent: NormalizedEvent = {
        id: generateEventId(),
        tenant_id: rule.tenant_id,
        provider: "system",
        event_type: "alert.triggered",
        severity: "critical",
        summary: `ALERT: ${rule.name} — ${rule.metric}${rule.provider_filter ? ` (${rule.provider_filter})` : ''} is ${currentValue}${rule.metric === 'error_rate' ? '%' : ''}, threshold: ${rule.comparison === 'gt' ? '>' : rule.comparison === 'lt' ? '<' : rule.comparison} ${rule.threshold}${rule.metric === 'error_rate' ? '%' : ''} over ${rule.window_minutes}min`,
        raw_payload: {
          alert_rule: rule.name,
          metric: rule.metric,
          current_value: currentValue,
          threshold: rule.threshold,
          comparison: rule.comparison,
          window_minutes: rule.window_minutes,
          provider_filter: rule.provider_filter,
        },
        received_at: nowISO(),
        processed_at: nowISO(),
        status: "processed",
      };

      // Store the alert event
      try {
        await db
          .prepare(
            `INSERT INTO events (id, tenant_id, provider, event_type, severity, summary, raw_payload, delivery_id, received_at, processed_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            alertEvent.id,
            alertEvent.tenant_id,
            alertEvent.provider,
            alertEvent.event_type,
            alertEvent.severity,
            alertEvent.summary,
            JSON.stringify(alertEvent.raw_payload),
            `alert_${rule.id}_${Date.now()}`,
            alertEvent.received_at,
            alertEvent.processed_at,
            alertEvent.status
          )
          .run();
      } catch {
        // Dedup might reject — fine
      }

      // Update last triggered time
      await db
        .prepare("UPDATE alert_rules SET last_triggered_at = ? WHERE id = ?")
        .bind(nowISO(), rule.id)
        .run();

      // Forward through all channels
      await forwardEvent(db, alertEvent, resendApiKey, twilioConfig);
    }
  }

  return stats;
}

async function getMetricValue(db: D1Database, rule: AlertRule): Promise<number> {
  const window = rule.window_minutes;

  switch (rule.metric) {
    case "error_rate": {
      let query = `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('failed', 'dead_letter') THEN 1 ELSE 0 END) as failed
        FROM events WHERE tenant_id = ? AND received_at > datetime('now', '-' || ? || ' minutes')`;
      const params: unknown[] = [rule.tenant_id, window];
      if (rule.provider_filter) {
        query += " AND provider = ?";
        params.push(rule.provider_filter);
      }
      const row = await db.prepare(query).bind(...params).first<{ total: number; failed: number }>();
      if (!row || row.total === 0) return 0;
      return Math.round((row.failed / row.total) * 100);
    }

    case "failed_count": {
      let query = `SELECT COUNT(*) as count FROM events WHERE tenant_id = ? AND status IN ('failed', 'dead_letter') AND received_at > datetime('now', '-' || ? || ' minutes')`;
      const params: unknown[] = [rule.tenant_id, window];
      if (rule.provider_filter) {
        query += " AND provider = ?";
        params.push(rule.provider_filter);
      }
      const row = await db.prepare(query).bind(...params).first<{ count: number }>();
      return row?.count || 0;
    }

    case "retry_queue_depth": {
      const row = await db
        .prepare("SELECT COUNT(*) as count FROM retry_queue rq JOIN events e ON rq.event_id = e.id WHERE e.tenant_id = ?")
        .bind(rule.tenant_id)
        .first<{ count: number }>();
      return row?.count || 0;
    }

    case "dead_letter_count": {
      const row = await db
        .prepare(`SELECT COUNT(*) as count FROM dead_letter dl JOIN events e ON dl.event_id = e.id WHERE e.tenant_id = ? AND dl.moved_at > datetime('now', '-' || ? || ' minutes')`)
        .bind(rule.tenant_id, window)
        .first<{ count: number }>();
      return row?.count || 0;
    }

    case "event_volume": {
      let query = `SELECT COUNT(*) as count FROM events WHERE tenant_id = ? AND received_at > datetime('now', '-' || ? || ' minutes')`;
      const params: unknown[] = [rule.tenant_id, window];
      if (rule.provider_filter) {
        query += " AND provider = ?";
        params.push(rule.provider_filter);
      }
      const row = await db.prepare(query).bind(...params).first<{ count: number }>();
      return row?.count || 0;
    }

    default:
      return 0;
  }
}

function compare(value: number, threshold: number, comparison: string): boolean {
  switch (comparison) {
    case "gt": return value > threshold;
    case "lt": return value < threshold;
    case "gte": return value >= threshold;
    case "lte": return value <= threshold;
    default: return value > threshold;
  }
}
