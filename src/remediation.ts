/**
 * Remediation Engine
 *
 * Matches events against playbooks and returns remediation steps.
 * Steps get included in Slack messages, emails, and dashboard event details.
 */

import type { NormalizedEvent } from "./types";

export interface RemediationPlaybook {
  id: number;
  tenant_id: string;
  event_pattern: string;
  provider_filter: string | null;
  title: string;
  steps: string; // JSON array
  auto_forward: number;
}

export interface RemediationMatch {
  playbook_id: number;
  title: string;
  steps: string[];
}

/**
 * Find matching remediation playbooks for an event.
 * Supports wildcard patterns: 'incident.*' matches 'incident.triggered'
 */
export async function findRemediation(
  db: D1Database,
  event: NormalizedEvent
): Promise<RemediationMatch[]> {
  const result = await db
    .prepare(
      "SELECT * FROM remediation_playbooks WHERE tenant_id = ? AND auto_forward = 1"
    )
    .bind(event.tenant_id)
    .all();

  const playbooks = (result.results || []) as unknown as RemediationPlaybook[];
  const matches: RemediationMatch[] = [];

  for (const pb of playbooks) {
    // Check provider filter
    if (pb.provider_filter && pb.provider_filter !== event.provider) continue;

    // Check event pattern (supports wildcards)
    if (!matchPattern(pb.event_pattern, event.event_type)) continue;

    try {
      const steps = JSON.parse(pb.steps) as string[];
      matches.push({
        playbook_id: pb.id,
        title: pb.title,
        steps,
      });
    } catch {
      // Invalid JSON in steps — skip
    }
  }

  return matches;
}

/**
 * Match an event type against a pattern.
 * Supports: exact match, wildcard (*), and prefix wildcard (incident.*)
 */
function matchPattern(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern === eventType) return true;

  // Wildcard: 'incident.*' matches 'incident.triggered'
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return eventType.startsWith(prefix + ".");
  }

  // Partial match: 'incident' matches 'incident.triggered'
  if (eventType.startsWith(pattern + ".")) return true;

  return false;
}
