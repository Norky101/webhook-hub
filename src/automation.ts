/**
 * Automation Workflows Engine — Level 3
 *
 * Webhooks are the trigger, not the product. When an event matches a workflow,
 * execute a chain of actions: create tickets, call APIs, send messages.
 *
 * Each action is a step with:
 * - type: 'webhook', 'slack', 'email', 'delay'
 * - config: URL, headers, body template
 *
 * Body templates support {{variables}} replaced with event data:
 * {{provider}}, {{event_type}}, {{severity}}, {{summary}},
 * {{tenant_id}}, {{event_id}}, {{received_at}}
 */

import type { NormalizedEvent } from "./types";
import { nowISO } from "./utils";

export interface AutomationAction {
  type: "webhook" | "slack" | "email" | "log";
  name: string;
  config: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown> | string;
    to?: string;
    subject?: string;
    message?: string;
  };
}

export interface AutomationWorkflow {
  id: number;
  tenant_id: string;
  name: string;
  trigger_provider: string;
  trigger_event_pattern: string;
  actions: string; // JSON array of AutomationAction
  active: number;
}

export interface WorkflowResult {
  workflow: string;
  actions_executed: number;
  actions_failed: number;
  results: Array<{ action: string; status: string; error?: string }>;
}

/**
 * Execute automation workflows for a normalized event.
 * Called after event storage, alongside forwarding and correlation.
 */
export async function executeAutomations(
  db: D1Database,
  event: NormalizedEvent
): Promise<WorkflowResult[]> {
  const results: WorkflowResult[] = [];

  // Fetch active workflows for this tenant
  const dbResult = await db
    .prepare(
      "SELECT * FROM automation_workflows WHERE tenant_id = ? AND active = 1"
    )
    .bind(event.tenant_id)
    .all();

  const workflows = (dbResult.results || []) as unknown as AutomationWorkflow[];

  for (const workflow of workflows) {
    // Check if event matches trigger
    if (workflow.trigger_provider !== "*" && workflow.trigger_provider !== event.provider) continue;
    if (!matchPattern(workflow.trigger_event_pattern, event.event_type)) continue;

    // Parse actions
    let actions: AutomationAction[];
    try {
      actions = JSON.parse(workflow.actions);
    } catch {
      continue;
    }

    const workflowResult: WorkflowResult = {
      workflow: workflow.name,
      actions_executed: 0,
      actions_failed: 0,
      results: [],
    };

    // Execute each action in sequence
    for (const action of actions) {
      try {
        await executeAction(action, event);
        workflowResult.actions_executed++;
        workflowResult.results.push({ action: action.name, status: "success" });
      } catch (e) {
        workflowResult.actions_failed++;
        workflowResult.results.push({
          action: action.name,
          status: "failed",
          error: String(e),
        });
        // Continue executing remaining actions — don't stop the chain on one failure
      }
    }

    results.push(workflowResult);
  }

  return results;
}

async function executeAction(
  action: AutomationAction,
  event: NormalizedEvent
): Promise<void> {
  switch (action.type) {
    case "webhook": {
      const url = templateReplace(action.config.url || "", event);
      const method = action.config.method || "POST";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "webhook-hub-automation/1.0",
      };
      // Add custom headers with template replacement
      if (action.config.headers) {
        for (const [k, v] of Object.entries(action.config.headers)) {
          headers[k] = templateReplace(v, event);
        }
      }
      // Build body with template replacement
      let body: string;
      if (typeof action.config.body === "string") {
        body = templateReplace(action.config.body, event);
      } else if (action.config.body) {
        body = templateReplace(JSON.stringify(action.config.body), event);
      } else {
        body = JSON.stringify({ source: "webhook-hub", event, automated_at: nowISO() });
      }

      const res = await fetch(url, { method, headers, body });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
      }
      break;
    }

    case "slack": {
      const url = action.config.url || "";
      const message = templateReplace(action.config.message || "Automation: {{summary}}", event);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: "Automation: " + action.name },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: message },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Triggered by *${event.provider}* ${event.event_type} | ${event.received_at}`,
                },
              ],
            },
            { type: "divider" },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Slack ${res.status}`);
      break;
    }

    case "log": {
      // No-op for now — the workflow result captures this
      break;
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

/**
 * Replace {{variable}} placeholders with event data.
 */
function templateReplace(template: string, event: NormalizedEvent): string {
  return template
    .replace(/\{\{provider\}\}/g, event.provider)
    .replace(/\{\{event_type\}\}/g, event.event_type)
    .replace(/\{\{severity\}\}/g, event.severity)
    .replace(/\{\{summary\}\}/g, event.summary)
    .replace(/\{\{tenant_id\}\}/g, event.tenant_id)
    .replace(/\{\{event_id\}\}/g, event.id)
    .replace(/\{\{received_at\}\}/g, event.received_at)
    .replace(/\{\{status\}\}/g, event.status);
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
