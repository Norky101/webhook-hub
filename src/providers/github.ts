import type { WebhookProvider, NormalizedEvent } from "../types";
import { generateEventId, nowISO, hmacSHA256, timeSafeEqual } from "../utils";

/**
 * GitHub webhook normalizer.
 * Docs: https://docs.github.com/en/webhooks
 * Signature: HMAC-SHA256, sent in X-Hub-Signature-256 header with "sha256=" prefix.
 */
export const github: WebhookProvider = {
  name: "github",

  async validateSignature(
    body: string,
    headers: Headers,
    secret: string
  ): Promise<boolean> {
    const signature = headers.get("x-hub-signature-256");
    if (!signature) return false;

    const hex = signature.replace("sha256=", "");
    const expected = await hmacSHA256(secret, body);
    return timeSafeEqual(hex, expected);
  },

  getDeliveryId(
    payload: Record<string, unknown>,
    headers: Headers
  ): string {
    return (
      headers.get("x-github-delivery") ||
      (payload.hook_id as string)?.toString() ||
      generateEventId()
    );
  },

  normalize(
    payload: Record<string, unknown>,
    tenantId: string
  ): NormalizedEvent {
    const action = (payload.action as string) || "";
    const eventType = mapEventType(payload, action);
    const repo = (payload.repository as Record<string, unknown>)?.full_name as string || "";
    const sender = (payload.sender as Record<string, unknown>)?.login as string || "";

    const detail = extractDetail(payload, action);

    return {
      id: generateEventId(),
      tenant_id: tenantId,
      provider: "github",
      event_type: eventType,
      severity: getSeverity(eventType, action),
      summary: buildSummary(eventType, repo, sender, detail),
      raw_payload: payload,
      received_at: nowISO(),
      processed_at: nowISO(),
      status: "processed",
    };
  },
};

function mapEventType(payload: Record<string, unknown>, action: string): string {
  if (payload.pull_request) return `pr.${action || "opened"}`;
  if (payload.issue) return `issue.${action || "opened"}`;
  if (payload.ref && payload.commits) return "push";
  if (payload.release) return `release.${action || "published"}`;
  if (payload.deployment) return `deployment.${action || "created"}`;
  if (payload.deployment_status) {
    const state = (payload.deployment_status as Record<string, unknown>)?.state as string || action;
    return `deployment.${state}`;
  }
  if (payload.workflow_run) return `workflow.${action || "completed"}`;
  if (payload.check_run) return `check.${action || "completed"}`;
  if (action) return `repo.${action}`;
  return "repo.event";
}

function extractDetail(payload: Record<string, unknown>, action: string): string {
  const pr = payload.pull_request as Record<string, unknown>;
  if (pr) return (pr.title as string) || "";

  const issue = payload.issue as Record<string, unknown>;
  if (issue) return (issue.title as string) || "";

  if (payload.ref && payload.commits) {
    const commits = payload.commits as Array<Record<string, unknown>>;
    const branch = (payload.ref as string).replace("refs/heads/", "");
    return `${commits.length} commit${commits.length > 1 ? "s" : ""} to ${branch}`;
  }

  const release = payload.release as Record<string, unknown>;
  if (release) return (release.tag_name as string) || "";

  const deployStatus = payload.deployment_status as Record<string, unknown>;
  if (deployStatus) return (deployStatus.state as string) || "";

  return "";
}

function getSeverity(
  eventType: string,
  action: string
): "info" | "warning" | "error" | "critical" {
  if (eventType.includes("deployment.failure")) return "error";
  if (eventType.includes("deployment.error")) return "error";
  if (eventType.includes("check") && action === "completed") return "info";
  if (eventType.includes("deleted")) return "warning";
  return "info";
}

function buildSummary(
  eventType: string,
  repo: string,
  sender: string,
  detail: string
): string {
  const detailStr = detail ? `: '${detail}'` : "";
  const repoStr = repo ? ` in ${repo}` : "";
  const senderStr = sender ? ` by ${sender}` : "";
  return `GitHub ${eventType}${detailStr}${repoStr}${senderStr}`;
}
