/**
 * AI Agent API Layer
 *
 * Enables AI agents (OpenClaw, LangChain, CrewAI, GPT Actions, etc.)
 * to connect to the platform, listen for events, and take actions.
 *
 * Agents don't just read — they resolve.
 *
 * GET  /api/agent/feed?tenant_id=X     — events with suggested actions
 * POST /api/agent/action               — execute an action
 * GET  /api/openapi.json               — API discovery for any agent framework
 */

import type { NormalizedEvent } from "./types";

export interface AgentEvent {
  event: {
    id: string;
    provider: string;
    event_type: string;
    severity: string;
    summary: string;
    status: string;
    received_at: string;
  };
  suggested_actions: string[];
  available_actions: AgentAction[];
}

export interface AgentAction {
  action: string;
  description: string;
  params: Record<string, string>;
}

/**
 * Get events formatted for agent consumption with suggested actions.
 */
export async function getAgentFeed(
  db: D1Database,
  tenantId: string,
  limit: number = 20
): Promise<AgentEvent[]> {
  const result = await db
    .prepare(
      "SELECT id, provider, event_type, severity, summary, status, received_at FROM events WHERE tenant_id = ? ORDER BY received_at DESC LIMIT ?"
    )
    .bind(tenantId, limit)
    .all();

  return (result.results || []).map((row) => {
    const event = {
      id: row.id as string,
      provider: row.provider as string,
      event_type: row.event_type as string,
      severity: row.severity as string,
      summary: row.summary as string,
      status: row.status as string,
      received_at: row.received_at as string,
    };

    return {
      event,
      suggested_actions: suggestActions(event),
      available_actions: getAvailableActions(event),
    };
  });
}

function suggestActions(event: { provider: string; event_type: string; severity: string; status: string }): string[] {
  const suggestions: string[] = [];

  if (event.status === "failed") {
    suggestions.push("Replay this event to retry processing");
  }

  if (event.severity === "critical") {
    suggestions.push("Acknowledge this alert and begin investigation");
    suggestions.push("Escalate to the on-call engineer");
  }

  if (event.event_type.includes("payment") && event.event_type.includes("failed")) {
    suggestions.push("Check customer payment method and send retry notification");
    suggestions.push("Create a support ticket for the affected customer");
  }

  if (event.event_type.includes("incident") && event.event_type.includes("triggered")) {
    suggestions.push("Check recent deployments for potential cause");
    suggestions.push("Review infrastructure metrics for anomalies");
  }

  if (event.event_type.includes("terminated") || event.event_type.includes("deleted")) {
    suggestions.push("Verify this action was intentional");
    suggestions.push("Trigger offboarding/cleanup workflow if applicable");
  }

  if (suggestions.length === 0) {
    suggestions.push("No immediate action required — monitor for patterns");
  }

  return suggestions;
}

function getAvailableActions(event: { id: string; provider: string }): AgentAction[] {
  return [
    {
      action: "replay_event",
      description: "Re-process this event from its raw payload",
      params: { event_id: event.id },
    },
    {
      action: "create_forwarding_rule",
      description: "Create a forwarding rule for this provider",
      params: { provider: event.provider, destination_type: "slack|email|sms|call|webhook", destination: "URL or address" },
    },
    {
      action: "create_playbook",
      description: "Create a remediation playbook for this event type",
      params: { event_pattern: "pattern", title: "Playbook title", steps: "JSON array of steps" },
    },
    {
      action: "create_automation",
      description: "Create an automation workflow triggered by this event type",
      params: { trigger_provider: event.provider, trigger_event_pattern: "pattern", actions: "JSON array of actions" },
    },
    {
      action: "create_alert_rule",
      description: "Create an alert rule to monitor this provider",
      params: { metric: "error_rate|failed_count|retry_queue_depth", threshold: "number", window_minutes: "number" },
    },
    {
      action: "analyze_events",
      description: "Run AI analysis on recent events",
      params: {},
    },
  ];
}

/**
 * Execute an agent action.
 */
export async function executeAgentAction(
  db: D1Database,
  tenantId: string,
  action: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  try {
    switch (action) {
      case "replay_event": {
        const eventId = params.event_id as string;
        if (!eventId) return { success: false, result: null, error: "event_id required" };
        // Just return the instruction — the agent should call POST /api/replay/:id
        return { success: true, result: { instruction: `POST /api/replay/${eventId}`, event_id: eventId } };
      }

      case "create_forwarding_rule": {
        const destType = params.destination_type as string;
        const dest = params.destination as string;
        const provider = params.provider_filter as string;
        const severity = params.severity_filter as string;
        if (!destType || !dest) return { success: false, result: null, error: "destination_type and destination required" };

        await db.prepare(
          "INSERT INTO forwarding_rules (tenant_id, name, destination_type, destination, provider_filter, severity_filter) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(tenantId, params.name || "Agent-created rule", destType, dest, provider || null, severity || null).run();

        return { success: true, result: { created: "forwarding_rule", destination_type: destType, destination: dest } };
      }

      case "create_playbook": {
        const pattern = params.event_pattern as string;
        const title = params.title as string;
        const steps = params.steps as string;
        if (!pattern || !title || !steps) return { success: false, result: null, error: "event_pattern, title, and steps required" };

        await db.prepare(
          "INSERT INTO remediation_playbooks (tenant_id, event_pattern, provider_filter, title, steps) VALUES (?, ?, ?, ?, ?)"
        ).bind(tenantId, pattern, (params.provider_filter as string) || null, title, steps).run();

        return { success: true, result: { created: "playbook", event_pattern: pattern, title } };
      }

      case "create_automation": {
        const triggerProvider = params.trigger_provider as string;
        const triggerPattern = params.trigger_event_pattern as string;
        const actions = params.actions as string;
        if (!triggerProvider || !triggerPattern || !actions) return { success: false, result: null, error: "trigger_provider, trigger_event_pattern, and actions required" };

        await db.prepare(
          "INSERT INTO automation_workflows (tenant_id, name, trigger_provider, trigger_event_pattern, actions) VALUES (?, ?, ?, ?, ?)"
        ).bind(tenantId, params.name || "Agent-created workflow", triggerProvider, triggerPattern, actions).run();

        return { success: true, result: { created: "automation", trigger: triggerProvider + "/" + triggerPattern } };
      }

      case "create_alert_rule": {
        const metric = params.metric as string;
        const threshold = params.threshold as number;
        if (!metric || threshold === undefined) return { success: false, result: null, error: "metric and threshold required" };

        await db.prepare(
          "INSERT INTO alert_rules (tenant_id, name, metric, provider_filter, threshold, window_minutes, comparison) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          tenantId, params.name || "Agent-created alert", metric,
          (params.provider_filter as string) || null, threshold,
          (params.window_minutes as number) || 15, (params.comparison as string) || "gt"
        ).run();

        return { success: true, result: { created: "alert_rule", metric, threshold } };
      }

      case "toggle_forwarding_rule": {
        const ruleId = params.rule_id as number;
        const active = params.active as number;
        if (ruleId === undefined || active === undefined) return { success: false, result: null, error: "rule_id and active required" };

        await db.prepare("UPDATE forwarding_rules SET active = ? WHERE id = ?").bind(active, ruleId).run();
        return { success: true, result: { toggled: ruleId, active } };
      }

      default:
        return { success: false, result: null, error: `Unknown action: ${action}. Available: replay_event, create_forwarding_rule, create_playbook, create_automation, create_alert_rule, toggle_forwarding_rule` };
    }
  } catch (e) {
    return { success: false, result: null, error: String(e) };
  }
}

/**
 * OpenAPI spec for agent discovery.
 */
export function getOpenAPISpec(): Record<string, unknown> {
  return {
    openapi: "3.0.0",
    info: {
      title: "Webhook Hub API",
      description: "Multi-tenant webhook processing platform with forwarding, correlation, automation, and AI analysis. Designed for both human operators and AI agents.",
      version: "1.0.0",
    },
    servers: [
      { url: "https://webhook-hub.noahpilkington98.workers.dev" },
    ],
    paths: {
      "/api/agent/feed": {
        get: {
          summary: "Get events formatted for AI agent consumption",
          description: "Returns recent events with suggested actions and available agent actions",
          parameters: [
            { name: "tenant_id", in: "query", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: { "200": { description: "Agent-formatted event feed" } },
        },
      },
      "/api/agent/action": {
        post: {
          summary: "Execute an agent action",
          description: "AI agents can take actions: create rules, replay events, set up automations",
          requestBody: {
            content: { "application/json": { schema: {
              type: "object",
              properties: {
                tenant_id: { type: "string" },
                action: { type: "string", enum: ["replay_event", "create_forwarding_rule", "create_playbook", "create_automation", "create_alert_rule", "toggle_forwarding_rule"] },
                params: { type: "object" },
              },
              required: ["tenant_id", "action", "params"],
            }}},
          },
          responses: { "200": { description: "Action result" } },
        },
      },
      "/api/analyze": {
        post: {
          summary: "AI-powered event analysis",
          description: "Analyzes recent events using Claude AI or structured analysis",
          parameters: [{ name: "tenant_id", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Analysis with summary, risks, and recommendations" } },
        },
      },
      "/webhooks/{provider}/{tenant_id}": {
        post: {
          summary: "Receive a webhook",
          parameters: [
            { name: "provider", in: "path", required: true, schema: { type: "string" } },
            { name: "tenant_id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Event accepted or duplicate" } },
        },
      },
      "/api/events": {
        get: {
          summary: "List events",
          parameters: [
            { name: "tenant_id", in: "query", required: true, schema: { type: "string" } },
            { name: "provider", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Paginated events" } },
        },
      },
      "/api/health": {
        get: { summary: "System health", responses: { "200": { description: "Health status" } } },
      },
      "/api/health/providers": {
        get: {
          summary: "Provider health scores",
          parameters: [{ name: "tenant_id", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Per-provider success rates" } },
        },
      },
      "/api/simulate/{provider}/{tenant_id}": {
        post: {
          summary: "Simulate a webhook",
          parameters: [
            { name: "provider", in: "path", required: true, schema: { type: "string" } },
            { name: "tenant_id", in: "path", required: true, schema: { type: "string" } },
            { name: "count", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Simulated events" } },
        },
      },
    },
  };
}
