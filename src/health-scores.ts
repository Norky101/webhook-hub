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
