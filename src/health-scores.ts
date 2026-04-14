/**
 * Provider Health Scores
 *
 * Calculates per-provider success/error rates from the events table.
 * Generates health_degraded events when a provider drops below threshold.
 */

export interface ProviderHealth {
  provider: string;
  total: number;
  processed: number;
  failed: number;
  success_rate: number;
  status: "healthy" | "degraded" | "critical" | "no_data";
}

/**
 * Send a health digest to Slack with all tenants' provider health.
 */
export async function sendHealthDigest(
  db: D1Database,
  slackUrl: string
): Promise<void> {
  // Get all active tenants from the last hour
  const tenantResult = await db
    .prepare(
      "SELECT DISTINCT tenant_id FROM events WHERE received_at > datetime('now', '-60 minutes')"
    )
    .all();

  const tenants = (tenantResult.results || []).map((r) => r.tenant_id as string);
  if (tenants.length === 0) return;

  const allScores: Array<{ tenant: string; scores: ProviderHealth[] }> = [];

  for (const tenant of tenants) {
    const scores = await getProviderHealthScores(db, tenant, 20);
    if (scores.length > 0) {
      allScores.push({ tenant, scores });
    }
  }

  if (allScores.length === 0) return;

  // Build Slack message
  const statusEmoji: Record<string, string> = {
    healthy: ":large_green_circle:",
    degraded: ":warning:",
    critical: ":red_circle:",
    no_data: ":white_circle:",
  };

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Provider Health Report (last 20 min)" },
    },
  ];

  for (const { tenant, scores } of allScores) {
    const lines = scores
      .map((s) => {
        const emoji = statusEmoji[s.status] || ":grey_question:";
        return `${emoji} *${s.provider}* — ${s.success_rate}% (${s.processed} ok, ${s.failed} failed)`;
      })
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Tenant: ${tenant}*\n${lines}`,
      },
    });
  }

  blocks.push(
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${new Date().toISOString()} | <https://webhook-hub.noahpilkington98.workers.dev/dashboard|View Dashboard>`,
        },
      ],
    }
  );

  await fetch(slackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
}

/**
 * Calculate health scores for all providers for a tenant.
 * Looks at events from the last hour by default.
 */
export async function getProviderHealthScores(
  db: D1Database,
  tenantId: string,
  windowMinutes: number = 60
): Promise<ProviderHealth[]> {
  const result = await db
    .prepare(
      `SELECT
        provider,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) as processed,
        SUM(CASE WHEN status IN ('failed', 'dead_letter') THEN 1 ELSE 0 END) as failed
       FROM events
       WHERE tenant_id = ? AND received_at > datetime('now', '-' || ? || ' minutes')
       GROUP BY provider`
    )
    .bind(tenantId, windowMinutes)
    .all();

  return (result.results || []).map((row) => {
    const total = (row.total as number) || 0;
    const processed = (row.processed as number) || 0;
    const failed = (row.failed as number) || 0;
    const successRate = total > 0 ? (processed / total) * 100 : 100;

    let status: ProviderHealth["status"] = "healthy";
    if (total === 0) status = "no_data";
    else if (successRate < 50) status = "critical";
    else if (successRate < 90) status = "degraded";

    return {
      provider: row.provider as string,
      total,
      processed,
      failed,
      success_rate: Math.round(successRate * 10) / 10,
      status,
    };
  });
}
