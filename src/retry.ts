import { getProvider } from "./providers/registry";
import { nowISO } from "./utils";

/**
 * Retry engine — processes the retry queue on each cron tick.
 *
 * How it works:
 * 1. Cron fires every minute
 * 2. We grab all retry_queue entries where next_retry_at <= now
 * 3. For each, re-process the event from its raw payload
 * 4. If it succeeds, remove from retry queue and mark event as processed
 * 5. If it fails again, bump attempt count and schedule next retry
 * 6. If max attempts exhausted, move to dead letter queue
 *
 * Backoff schedule (from spec): 1min, 5min, 30min, 2hr, 12hr
 */

const BACKOFF_MINUTES = [1, 5, 30, 120, 720];

export async function processRetryQueue(db: D1Database): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  dead_lettered: number;
}> {
  const stats = { processed: 0, succeeded: 0, failed: 0, dead_lettered: 0 };

  // Grab entries ready for retry (limit batch to 50 to stay within Worker CPU limits)
  const pending = await db
    .prepare(
      "SELECT rq.*, e.raw_payload, e.provider, e.tenant_id FROM retry_queue rq JOIN events e ON rq.event_id = e.id WHERE rq.next_retry_at <= datetime('now') ORDER BY rq.next_retry_at ASC LIMIT 50"
    )
    .all();

  if (!pending.results || pending.results.length === 0) return stats;

  for (const row of pending.results) {
    stats.processed++;
    const eventId = row.event_id as string;
    const attempt = row.attempt as number;
    const maxAttempts = row.max_attempts as number;
    const provider = row.provider as string;
    const tenantId = row.tenant_id as string;

    try {
      const handler = getProvider(provider);
      if (!handler) throw new Error(`Provider ${provider} not found`);

      const rawPayload = JSON.parse(row.raw_payload as string);
      const reprocessed = handler.normalize(rawPayload, tenantId);

      // Success — update event and remove from retry queue
      await db
        .prepare(
          "UPDATE events SET event_type = ?, severity = ?, summary = ?, processed_at = ?, status = 'processed' WHERE id = ?"
        )
        .bind(
          reprocessed.event_type,
          reprocessed.severity,
          reprocessed.summary,
          nowISO(),
          eventId
        )
        .run();

      await db
        .prepare("DELETE FROM retry_queue WHERE id = ?")
        .bind(row.id)
        .run();

      stats.succeeded++;
    } catch (e) {
      const errorMsg = String(e);

      if (attempt >= maxAttempts) {
        // Exhausted all retries — move to dead letter
        await db
          .prepare(
            "INSERT INTO dead_letter (event_id, attempts, last_error) VALUES (?, ?, ?)"
          )
          .bind(eventId, attempt, errorMsg)
          .run();

        await db
          .prepare("UPDATE events SET status = 'dead_letter' WHERE id = ?")
          .bind(eventId)
          .run();

        await db
          .prepare("DELETE FROM retry_queue WHERE id = ?")
          .bind(row.id)
          .run();

        stats.dead_lettered++;
      } else {
        // Schedule next retry with exponential backoff
        const backoffMinutes = BACKOFF_MINUTES[attempt] || 720;
        const nextRetry = new Date(
          Date.now() + backoffMinutes * 60 * 1000
        ).toISOString();

        await db
          .prepare(
            "UPDATE retry_queue SET attempt = ?, next_retry_at = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?"
          )
          .bind(attempt + 1, nextRetry, errorMsg, row.id)
          .run();

        stats.failed++;
      }
    }
  }

  return stats;
}

/**
 * Queue a failed event for retry.
 * Called from the webhook receiver when initial processing fails.
 */
export async function queueForRetry(
  db: D1Database,
  eventId: string
): Promise<void> {
  const nextRetry = new Date(
    Date.now() + BACKOFF_MINUTES[0] * 60 * 1000
  ).toISOString();

  await db
    .prepare(
      "INSERT INTO retry_queue (event_id, attempt, max_attempts, next_retry_at) VALUES (?, 1, 5, ?)"
    )
    .bind(eventId, nextRetry)
    .run();
}
