/**
 * Webhook Forwarding Engine
 *
 * After an event is normalized and stored, check if the tenant has
 * forwarding rules. If yes, send the normalized event to each destination.
 *
 * Supports:
 * - webhook: POST the normalized event JSON to a URL
 * - email: send via Resend API (free tier: 3,000/mo)
 */

import type { NormalizedEvent } from "./types";

interface ForwardingRule {
  id: number;
  tenant_id: string;
  name: string;
  destination_type: string;
  destination: string;
  provider_filter: string | null;
  severity_filter: string | null;
  active: number;
}

/**
 * Process forwarding rules for a normalized event.
 * Called after successful event storage.
 */
export async function forwardEvent(
  db: D1Database,
  event: NormalizedEvent,
  resendApiKey?: string
): Promise<{ forwarded: number; errors: string[] }> {
  const stats = { forwarded: 0, errors: [] as string[] };

  // Fetch active rules for this tenant
  const result = await db
    .prepare(
      "SELECT * FROM forwarding_rules WHERE tenant_id = ? AND active = 1"
    )
    .bind(event.tenant_id)
    .all();

  const rules = (result.results || []) as unknown as ForwardingRule[];
  if (rules.length === 0) return stats;

  for (const rule of rules) {
    // Apply filters
    if (rule.provider_filter && rule.provider_filter !== event.provider) continue;
    if (rule.severity_filter && rule.severity_filter !== event.severity) continue;

    try {
      if (rule.destination_type === "webhook") {
        await forwardToWebhook(rule.destination, event);
        stats.forwarded++;
      } else if (rule.destination_type === "email") {
        if (!resendApiKey) {
          stats.errors.push(`Email forwarding not configured (no API key)`);
          continue;
        }
        await forwardToEmail(rule.destination, event, resendApiKey);
        stats.forwarded++;
      }
    } catch (e) {
      stats.errors.push(`Rule ${rule.id} (${rule.destination_type}): ${String(e)}`);
    }
  }

  return stats;
}

async function forwardToWebhook(
  url: string,
  event: NormalizedEvent
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "webhook-hub/1.0",
      "X-Webhook-Hub-Event": event.event_type,
      "X-Webhook-Hub-Provider": event.provider,
    },
    body: JSON.stringify({
      source: "webhook-hub",
      event,
      forwarded_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

async function forwardToEmail(
  to: string,
  event: NormalizedEvent,
  apiKey: string
): Promise<void> {
  const severityEmoji: Record<string, string> = {
    info: "ℹ️",
    warning: "⚠️",
    error: "🔴",
    critical: "🚨",
  };
  const emoji = severityEmoji[event.severity] || "📨";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: "Webhook Hub <onboarding@resend.dev>",
      to: [to],
      subject: `${emoji} [${event.provider}] ${event.event_type} — ${event.severity}`,
      html: buildEmailHTML(event),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

function buildEmailHTML(event: NormalizedEvent): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0f1117; color: #e1e4e8; padding: 20px; border-radius: 8px;">
        <h2 style="margin: 0 0 16px 0; font-size: 18px;">Webhook Event</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #8b949e; width: 120px;">Provider</td><td style="padding: 8px 0;">${event.provider}</td></tr>
          <tr><td style="padding: 8px 0; color: #8b949e;">Event Type</td><td style="padding: 8px 0;">${event.event_type}</td></tr>
          <tr><td style="padding: 8px 0; color: #8b949e;">Severity</td><td style="padding: 8px 0;"><span style="padding: 2px 8px; border-radius: 12px; font-size: 12px; background: ${event.severity === 'critical' ? '#5c1a1a' : event.severity === 'error' ? '#3d1418' : event.severity === 'warning' ? '#3d2e00' : '#1f3a5f'}; color: ${event.severity === 'critical' ? '#ff7b72' : event.severity === 'error' ? '#f85149' : event.severity === 'warning' ? '#d29922' : '#58a6ff'}">${event.severity}</span></td></tr>
          <tr><td style="padding: 8px 0; color: #8b949e;">Summary</td><td style="padding: 8px 0;">${event.summary}</td></tr>
          <tr><td style="padding: 8px 0; color: #8b949e;">Tenant</td><td style="padding: 8px 0;">${event.tenant_id}</td></tr>
          <tr><td style="padding: 8px 0; color: #8b949e;">Time</td><td style="padding: 8px 0;">${event.received_at}</td></tr>
          <tr><td style="padding: 8px 0; color: #8b949e;">Event ID</td><td style="padding: 8px 0; font-family: monospace; font-size: 13px;">${event.id}</td></tr>
        </table>
      </div>
      <p style="color: #8b949e; font-size: 12px; margin-top: 16px; text-align: center;">
        Sent by <a href="https://webhook-hub.noahpilkington98.workers.dev/dashboard" style="color: #58a6ff;">Webhook Hub</a>
      </p>
    </div>
  `;
}
