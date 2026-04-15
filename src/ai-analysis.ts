/**
 * AI Event Analysis — Level 4
 *
 * Feeds recent events to Claude for intelligent analysis.
 * Falls back to structured summary when no API key is configured.
 *
 * Answers: What's abnormal? What patterns exist? What should we do?
 */

import { getProviderHealthScores, type ProviderHealth } from "./health-scores";

export interface AIAnalysis {
  mode: "ai" | "structured";
  summary: string;
  details: string[];
  risks: string[];
  recommendations: string[];
  timestamp: string;
}

interface EventRow {
  provider: string;
  event_type: string;
  severity: string;
  summary: string;
  status: string;
  received_at: string;
}

/**
 * Analyze recent events for a tenant.
 * Uses Claude if API key is available, otherwise builds a structured analysis.
 */
export async function analyzeEvents(
  db: D1Database,
  tenantId: string,
  anthropicKey?: string
): Promise<AIAnalysis> {
  // Fetch recent events
  const eventsResult = await db
    .prepare(
      "SELECT provider, event_type, severity, summary, status, received_at FROM events WHERE tenant_id = ? AND received_at > datetime('now', '-60 minutes') ORDER BY received_at DESC LIMIT 100"
    )
    .bind(tenantId)
    .all();

  const events = (eventsResult.results || []) as unknown as EventRow[];
  const healthScores = await getProviderHealthScores(db, tenantId, 60);

  if (anthropicKey && events.length > 0) {
    return await claudeAnalysis(events, healthScores, tenantId, anthropicKey);
  }

  return structuredAnalysis(events, healthScores, tenantId);
}

async function claudeAnalysis(
  events: EventRow[],
  healthScores: ProviderHealth[],
  tenantId: string,
  apiKey: string
): Promise<AIAnalysis> {
  const eventSummary = events.map((e) =>
    `[${e.received_at}] ${e.provider} | ${e.event_type} | ${e.severity} | ${e.status} | ${e.summary}`
  ).join("\n");

  const healthSummary = healthScores.map((h) =>
    `${h.provider}: ${h.success_rate}% success (${h.processed} ok, ${h.failed} failed) — ${h.status}`
  ).join("\n");

  const prompt = `You are an AI ops analyst for a webhook processing platform. Analyze the following events from the last hour for tenant "${tenantId}".

PROVIDER HEALTH SCORES:
${healthSummary}

RECENT EVENTS (last hour, most recent first):
${eventSummary}

Provide a concise analysis in this exact JSON format (no markdown, just JSON):
{
  "summary": "One paragraph overview of the current state — what's healthy, what's concerning",
  "details": ["Detail 1 about a specific pattern or observation", "Detail 2", ...],
  "risks": ["Risk 1 that could escalate if not addressed", "Risk 2", ...],
  "recommendations": ["Action 1 the ops team should take now", "Action 2", ...]
}

Be specific. Reference actual providers, event types, and numbers from the data. If you see correlations across providers, call them out. If a provider is degrading, predict what might happen next. Keep it actionable — an ops person should read this and know exactly what to do.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Claude API ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const text = data.content?.[0]?.text || "";

    // Parse JSON from Claude's response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        mode: "ai",
        summary: parsed.summary || "Analysis complete.",
        details: parsed.details || [],
        risks: parsed.risks || [],
        recommendations: parsed.recommendations || [],
        timestamp: new Date().toISOString(),
      };
    }

    // If JSON parsing fails, use the raw text
    return {
      mode: "ai",
      summary: text,
      details: [],
      risks: [],
      recommendations: [],
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    // Fall back to structured analysis if Claude fails
    const fallback = structuredAnalysis(events, healthScores, tenantId);
    fallback.summary = `(AI analysis failed: ${String(e).substring(0, 100)}. Showing structured analysis.) ` + fallback.summary;
    return fallback;
  }
}

function structuredAnalysis(
  events: EventRow[],
  healthScores: ProviderHealth[],
  tenantId: string
): AIAnalysis {
  const totalEvents = events.length;
  const failedEvents = events.filter((e) => e.status === "failed" || e.status === "dead_letter");
  const criticalEvents = events.filter((e) => e.severity === "critical");
  const warningEvents = events.filter((e) => e.severity === "warning");

  // Group by provider
  const byProvider: Record<string, EventRow[]> = {};
  events.forEach((e) => {
    if (!byProvider[e.provider]) byProvider[e.provider] = [];
    byProvider[e.provider].push(e);
  });

  const degradedProviders = healthScores.filter((h) => h.status === "degraded" || h.status === "critical");
  const healthyProviders = healthScores.filter((h) => h.status === "healthy");

  // Build summary
  let summary = `${totalEvents} events in the last hour across ${Object.keys(byProvider).length} providers. `;
  if (degradedProviders.length === 0) {
    summary += "All providers are healthy.";
  } else {
    summary += `${degradedProviders.length} provider${degradedProviders.length > 1 ? "s" : ""} degraded: ${degradedProviders.map((p) => `${p.provider} (${p.success_rate}%)`).join(", ")}.`;
  }

  // Build details
  const details: string[] = [];
  for (const [provider, provEvents] of Object.entries(byProvider)) {
    const failed = provEvents.filter((e) => e.status === "failed").length;
    const types = [...new Set(provEvents.map((e) => e.event_type))];
    details.push(`${provider}: ${provEvents.length} events (${failed} failed). Types: ${types.join(", ")}`);
  }

  // Build risks
  const risks: string[] = [];
  if (failedEvents.length > 0) {
    risks.push(`${failedEvents.length} failed events may need manual investigation`);
  }
  for (const dp of degradedProviders) {
    risks.push(`${dp.provider} at ${dp.success_rate}% success rate — may continue degrading`);
  }
  if (criticalEvents.length > 0) {
    risks.push(`${criticalEvents.length} critical severity events in the last hour`);
  }

  // Build recommendations
  const recommendations: string[] = [];
  if (degradedProviders.length > 0) {
    recommendations.push(`Investigate degraded providers: ${degradedProviders.map((p) => p.provider).join(", ")}`);
  }
  if (failedEvents.length > 0) {
    recommendations.push("Check the retry queue and dead letter queue for stuck events");
  }
  if (criticalEvents.length > 0) {
    recommendations.push("Review critical events for incidents requiring immediate response");
  }
  if (risks.length === 0) {
    recommendations.push("No immediate action needed — all systems nominal");
  }

  return {
    mode: "structured",
    summary,
    details,
    risks,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}
