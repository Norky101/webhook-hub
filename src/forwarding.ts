/**
 * Webhook Forwarding Engine
 *
 * After an event is normalized and stored, check if the tenant has
 * forwarding rules. If yes, send the normalized event to each destination.
 *
 * Supports:
 * - webhook/slack: POST the normalized event JSON to a URL
 * - email: send via Resend API (free tier: 3,000/mo)
 * - sms: send via Twilio API
 * - call: voice call via Twilio API (critical alerts)
 */

import type { NormalizedEvent } from "./types";
import { findRemediation, type RemediationMatch } from "./remediation";

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

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

/**
 * Process forwarding rules for a normalized event.
 * Called after successful event storage.
 */
export async function forwardEvent(
  db: D1Database,
  event: NormalizedEvent,
  resendApiKey?: string,
  twilioConfig?: TwilioConfig
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

  // Look up remediation playbooks for this event
  let remediation: RemediationMatch[] = [];
  try {
    remediation = await findRemediation(db, event);
  } catch {
    // Remediation lookup failed — continue without it
  }

  const SEVERITY_LEVELS: Record<string, number> = {
    info: 0,
    warning: 1,
    error: 2,
    critical: 3,
  };

  for (const rule of rules) {
    // Apply filters
    if (rule.provider_filter && rule.provider_filter !== event.provider) continue;
    // Severity filter means "this level and above"
    if (rule.severity_filter) {
      const eventLevel = SEVERITY_LEVELS[event.severity] ?? 0;
      const ruleLevel = SEVERITY_LEVELS[rule.severity_filter] ?? 0;
      if (eventLevel < ruleLevel) continue;
    }

    try {
      if (rule.destination_type === "webhook" || rule.destination_type === "slack") {
        await forwardToWebhook(rule.destination, event, remediation);
        stats.forwarded++;
      } else if (rule.destination_type === "email") {
        if (!resendApiKey) {
          stats.errors.push(`Email forwarding not configured (no API key)`);
          continue;
        }
        await forwardToEmail(rule.destination, event, resendApiKey, remediation);
        stats.forwarded++;
      } else if (rule.destination_type === "sms") {
        if (!twilioConfig) {
          stats.errors.push(`SMS forwarding not configured (no Twilio credentials)`);
          continue;
        }
        await forwardToSMS(rule.destination, event, twilioConfig, remediation);
        stats.forwarded++;
      } else if (rule.destination_type === "call") {
        if (!twilioConfig) {
          stats.errors.push(`Call forwarding not configured (no Twilio credentials)`);
          continue;
        }
        await forwardToCall(rule.destination, event, twilioConfig);
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
  event: NormalizedEvent,
  remediation: RemediationMatch[] = []
): Promise<void> {
  // Detect Slack incoming webhooks and format as Slack blocks
  const isSlack = url.includes("hooks.slack.com") || url.includes("slack.com/api");
  const body = isSlack ? buildSlackPayload(event, remediation) : {
    source: "webhook-hub",
    event,
    forwarded_at: new Date().toISOString(),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "webhook-hub/1.0",
      "X-Webhook-Hub-Event": event.event_type,
      "X-Webhook-Hub-Provider": event.provider,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
}

function buildSlackPayload(event: NormalizedEvent, remediation: RemediationMatch[] = []): Record<string, unknown> {
  const severityEmoji: Record<string, string> = {
    info: ":large_blue_circle:",
    warning: ":warning:",
    error: ":red_circle:",
    critical: ":rotating_light:",
  };
  const emoji = severityEmoji[event.severity] || ":bell:";

  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${event.provider} — ${event.event_type}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Provider:*\n${event.provider}` },
          { type: "mrkdwn", text: `*Event:*\n${event.event_type}` },
          { type: "mrkdwn", text: `*Severity:*\n${emoji} ${event.severity}` },
          { type: "mrkdwn", text: `*Tenant:*\n${event.tenant_id}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Summary:*\n${event.summary}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Event ID: \`${event.id}\` | ${event.received_at} | <https://webhook-hub.noahpilkington98.workers.dev/dashboard|View Dashboard>`,
          },
        ],
      },
      // Add remediation steps if any match
      ...(remediation.length > 0
        ? [
            { type: "divider" },
            {
              type: "header",
              text: { type: "plain_text", text: ":wrench: Remediation Steps" },
            },
            ...remediation.flatMap((r) => [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*${r.title}*\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
                },
              },
            ]),
          ]
        : []),
      { type: "divider" },
    ],
  };
}

async function forwardToEmail(
  to: string,
  event: NormalizedEvent,
  apiKey: string,
  remediation: RemediationMatch[] = []
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
      html: buildEmailHTML(event, remediation),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

function buildEmailHTML(event: NormalizedEvent, remediation: RemediationMatch[] = []): string {
  const remediationHTML = remediation.length > 0
    ? `<div style="margin-top: 16px; padding: 16px; background: #1a1e2a; border-left: 3px solid #f0883e; border-radius: 4px;">
        <h3 style="margin: 0 0 8px 0; font-size: 15px; color: #f0883e;">Remediation Steps</h3>
        ${remediation.map(r => `
          <p style="margin: 0 0 4px 0; font-weight: 600; font-size: 14px;">${r.title}</p>
          <ol style="margin: 4px 0 12px 0; padding-left: 20px;">
            ${r.steps.map(s => `<li style="padding: 2px 0; font-size: 13px;">${s}</li>`).join('')}
          </ol>
        `).join('')}
      </div>`
    : '';

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
        ${remediationHTML}
      </div>
      <p style="color: #8b949e; font-size: 12px; margin-top: 16px; text-align: center;">
        Sent by <a href="https://webhook-hub.noahpilkington98.workers.dev/dashboard" style="color: #58a6ff;">Webhook Hub</a>
      </p>
    </div>
  `;
}

// ─── SMS via Twilio ─────────────────────────────────────

async function forwardToSMS(
  to: string,
  event: NormalizedEvent,
  config: TwilioConfig,
  remediation: RemediationMatch[] = []
): Promise<void> {
  const severityLabel: Record<string, string> = {
    info: "INFO",
    warning: "WARN",
    error: "ERROR",
    critical: "CRITICAL",
  };

  let message = `[${severityLabel[event.severity] || event.severity}] ${event.provider}: ${event.event_type}\n${event.summary}`;

  if (remediation.length > 0) {
    const steps = remediation[0].steps.slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join("\n");
    message += `\n\nAction:\n${steps}`;
  }

  // Twilio SMS API
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const body = new URLSearchParams({
    To: to,
    From: config.fromNumber,
    Body: message,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${config.accountSid}:${config.authToken}`),
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Twilio SMS ${res.status}: ${err}`);
  }
}

// ─── Voice Call via Twilio ──────────────────────────────

async function forwardToCall(
  to: string,
  event: NormalizedEvent,
  config: TwilioConfig
): Promise<void> {
  const severityLabel: Record<string, string> = {
    info: "info",
    warning: "warning",
    error: "error",
    critical: "critical",
  };

  // TwiML: Twilio's XML markup for what to say on the call
  const twiml = `<Response><Say voice="alice">Webhook Hub alert. ${severityLabel[event.severity] || ""} severity. Provider: ${event.provider}. Event: ${event.event_type.replace(/\./g, " ")}. ${event.summary.replace(/[<>&'"]/g, "")}. Check your dashboard for details.</Say><Pause length="1"/><Say voice="alice">Repeating. ${event.summary.replace(/[<>&'"]/g, "")}.</Say></Response>`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`;
  const body = new URLSearchParams({
    To: to,
    From: config.fromNumber,
    Twiml: twiml,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${config.accountSid}:${config.authToken}`),
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Twilio Call ${res.status}: ${err}`);
  }
}
