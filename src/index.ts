import { Hono } from "hono";
import { cors } from "hono/cors";
import { getProvider, listProviders } from "./providers/registry";
import { generateEventId, nowISO } from "./utils";
import { processRetryQueue, queueForRetry } from "./retry";
import { dashboardHTML } from "./dashboard";
import { generateWebhook, simulatorProviders } from "./simulator";

/** Env bindings for Cloudflare Workers */
export type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

// Allow cross-origin for dashboard
app.use("*", cors());

// ─── Health ─────────────────────────────────────────────
app.get("/", (c) =>
  c.json({ status: "ok", service: "webhook-hub", providers: listProviders() })
);

app.get("/api/health", async (c) => {
  try {
    const dbCheck = await c.env.DB.prepare("SELECT 1 as ok").first();
    const retryDepth = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM retry_queue"
    ).first<{ count: number }>();
    const errorRate = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM events WHERE status = 'failed' AND received_at > datetime('now', '-1 hour')"
    ).first<{ count: number }>();

    return c.json({
      status: "healthy",
      db: dbCheck ? "connected" : "error",
      retry_queue_depth: retryDepth?.count || 0,
      error_rate_last_hour: errorRate?.count || 0,
      providers: listProviders(),
      timestamp: nowISO(),
    });
  } catch (e) {
    return c.json({ status: "unhealthy", error: String(e) }, 500);
  }
});

// ─── Dashboard ──────────────────────────────────────────
app.get("/dashboard", (c) => {
  return c.html(dashboardHTML());
});

// ─── Webhook Receiver ───────────────────────────────────
app.post("/webhooks/:provider/:tenant_id", async (c) => {
  const { provider, tenant_id } = c.req.param();
  const providerHandler = getProvider(provider);

  if (!providerHandler) {
    return c.json({ error: `Unknown provider: ${provider}` }, 400);
  }

  const body = await c.req.text();
  const headers = c.req.raw.headers;

  // Signature validation (skip if no secret configured — dev mode)
  // In production, secrets would come from env vars per tenant
  // For now, accept all webhooks to enable testing
  // TODO: per-tenant secret lookup

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Extract delivery ID for idempotency
  const deliveryId = providerHandler.getDeliveryId(payload, headers);

  // Dedup check — if we've already processed this delivery, skip
  const existing = await c.env.DB.prepare(
    "SELECT id FROM events WHERE tenant_id = ? AND provider = ? AND delivery_id = ?"
  )
    .bind(tenant_id, provider, deliveryId)
    .first();

  if (existing) {
    return c.json({ status: "duplicate", event_id: existing.id }, 200);
  }

  // Normalize the payload
  const event = providerHandler.normalize(payload, tenant_id);

  // Store in D1
  try {
    await c.env.DB.prepare(
      `INSERT INTO events (id, tenant_id, provider, event_type, severity, summary, raw_payload, delivery_id, received_at, processed_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        event.id,
        event.tenant_id,
        event.provider,
        event.event_type,
        event.severity,
        event.summary,
        JSON.stringify(event.raw_payload),
        deliveryId,
        event.received_at,
        event.processed_at,
        event.status
      )
      .run();
  } catch (e) {
    // Store as failed, then queue for retry
    try {
      await c.env.DB.prepare(
        `INSERT INTO events (id, tenant_id, provider, event_type, severity, summary, raw_payload, delivery_id, received_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed')`
      )
        .bind(
          event.id,
          event.tenant_id,
          event.provider,
          event.event_type,
          event.severity,
          event.summary,
          JSON.stringify(event.raw_payload),
          deliveryId,
          event.received_at
        )
        .run();
      await queueForRetry(c.env.DB, event.id);
    } catch {
      // If even the fallback fails, return 500
    }
    return c.json({ error: "Processing failed — queued for retry", event_id: event.id }, 500);
  }

  // Return 200 immediately (spec requirement)
  return c.json({
    status: "accepted",
    event_id: event.id,
    event_type: event.event_type,
  });
});

// ─── Events API ─────────────────────────────────────────

// List events — paginated, filterable
app.get("/api/events", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);

  const provider = c.req.query("provider");
  const event_type = c.req.query("event_type");
  const status = c.req.query("status");
  const after = c.req.query("after"); // date range start
  const before = c.req.query("before"); // date range end
  const cursor = c.req.query("cursor"); // pagination cursor (event ID)
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);

  // Build query dynamically — tenant_id always required (isolation)
  let query = "SELECT * FROM events WHERE tenant_id = ?";
  const params: unknown[] = [tenant_id];

  if (provider) {
    query += " AND provider = ?";
    params.push(provider);
  }
  if (event_type) {
    query += " AND event_type = ?";
    params.push(event_type);
  }
  if (status) {
    query += " AND status = ?";
    params.push(status);
  }
  if (after) {
    query += " AND received_at >= ?";
    params.push(after);
  }
  if (before) {
    query += " AND received_at <= ?";
    params.push(before);
  }
  if (cursor) {
    query += " AND received_at < (SELECT received_at FROM events WHERE id = ?)";
    params.push(cursor);
  }

  query += " ORDER BY received_at DESC LIMIT ?";
  params.push(limit + 1); // fetch one extra to detect if there's a next page

  const result = await c.env.DB.prepare(query)
    .bind(...params)
    .all();

  const events = result.results || [];
  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  const nextCursor = hasMore ? (page[page.length - 1] as any).id : null;

  return c.json({
    events: page.map(parseEventRow),
    pagination: { limit, has_more: hasMore, next_cursor: nextCursor },
  });
});

// Single event detail
app.get("/api/events/:id", async (c) => {
  const { id } = c.req.param();
  const row = await c.env.DB.prepare("SELECT * FROM events WHERE id = ?")
    .bind(id)
    .first();

  if (!row) return c.json({ error: "Event not found" }, 404);
  return c.json(parseEventRow(row));
});

// Stats — counts by provider, type, status
app.get("/api/stats", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);

  const [byProvider, byType, byStatus, total] = await Promise.all([
    c.env.DB.prepare(
      "SELECT provider, COUNT(*) as count FROM events WHERE tenant_id = ? GROUP BY provider"
    )
      .bind(tenant_id)
      .all(),
    c.env.DB.prepare(
      "SELECT event_type, COUNT(*) as count FROM events WHERE tenant_id = ? GROUP BY event_type"
    )
      .bind(tenant_id)
      .all(),
    c.env.DB.prepare(
      "SELECT status, COUNT(*) as count FROM events WHERE tenant_id = ? GROUP BY status"
    )
      .bind(tenant_id)
      .all(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM events WHERE tenant_id = ?"
    )
      .bind(tenant_id)
      .first<{ count: number }>(),
  ]);

  return c.json({
    tenant_id,
    total: total?.count || 0,
    by_provider: byProvider.results,
    by_type: byType.results,
    by_status: byStatus.results,
  });
});

// Replay — re-process event from raw payload
app.post("/api/replay/:id", async (c) => {
  const { id } = c.req.param();
  const row = await c.env.DB.prepare("SELECT * FROM events WHERE id = ?")
    .bind(id)
    .first();

  if (!row) return c.json({ error: "Event not found" }, 404);

  const providerHandler = getProvider(row.provider as string);
  if (!providerHandler) {
    return c.json({ error: `Provider ${row.provider} not found` }, 400);
  }

  // Re-normalize from raw payload
  const rawPayload = JSON.parse(row.raw_payload as string);
  const reprocessed = providerHandler.normalize(rawPayload, row.tenant_id as string);

  // Update the existing event
  await c.env.DB.prepare(
    `UPDATE events SET event_type = ?, severity = ?, summary = ?, processed_at = ?, status = 'processed' WHERE id = ?`
  )
    .bind(reprocessed.event_type, reprocessed.severity, reprocessed.summary, nowISO(), id)
    .run();

  return c.json({ status: "replayed", event_id: id });
});

// Purge — delete old events for a tenant
app.delete("/api/events", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  const before = c.req.query("before");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);
  if (!before) return c.json({ error: "before date is required" }, 400);

  const result = await c.env.DB.prepare(
    "DELETE FROM events WHERE tenant_id = ? AND received_at < ?"
  )
    .bind(tenant_id, before)
    .run();

  return c.json({
    status: "purged",
    tenant_id,
    before,
    deleted: result.meta.changes,
  });
});

// ─── Retry / Dead Letter API ────────────────────────────

// View retry queue
app.get("/api/retries", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);

  const result = await c.env.DB.prepare(
    `SELECT rq.*, e.provider, e.event_type, e.summary
     FROM retry_queue rq
     JOIN events e ON rq.event_id = e.id
     WHERE e.tenant_id = ?
     ORDER BY rq.next_retry_at ASC`
  )
    .bind(tenant_id)
    .all();

  return c.json({ retries: result.results || [] });
});

// View dead letter queue
app.get("/api/dead-letter", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);

  const result = await c.env.DB.prepare(
    `SELECT dl.*, e.provider, e.event_type, e.summary
     FROM dead_letter dl
     JOIN events e ON dl.event_id = e.id
     WHERE e.tenant_id = ?
     ORDER BY dl.moved_at DESC`
  )
    .bind(tenant_id)
    .all();

  return c.json({ dead_letters: result.results || [] });
});

// ─── Data Export ────────────────────────────────────────

app.get("/api/export", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);

  const format = c.req.query("format") || "json";
  const provider = c.req.query("provider");
  const status = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") || "1000"), 5000);

  let query = "SELECT * FROM events WHERE tenant_id = ?";
  const params: unknown[] = [tenant_id];

  if (provider) {
    query += " AND provider = ?";
    params.push(provider);
  }
  if (status) {
    query += " AND status = ?";
    params.push(status);
  }

  query += " ORDER BY received_at DESC LIMIT ?";
  params.push(limit);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  const events = (result.results || []).map(parseEventRow);

  if (format === "csv") {
    const headers = ["id", "tenant_id", "provider", "event_type", "severity", "summary", "status", "received_at", "processed_at"];
    const csvRows = [headers.join(",")];
    for (const e of events) {
      const row = headers.map((h) => {
        const val = String((e as Record<string, unknown>)[h] || "");
        return '"' + val.replace(/"/g, '""') + '"';
      });
      csvRows.push(row.join(","));
    }
    return new Response(csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="webhook-hub-${tenant_id}-export.csv"`,
      },
    });
  }

  return c.json({ tenant_id, count: events.length, events });
});

// ─── Webhook Simulator ("One More Thing") ──────────────

// Simulate a single webhook or a burst
app.post("/api/simulate/:provider/:tenant_id", async (c) => {
  const { provider, tenant_id } = c.req.param();
  const count = Math.min(parseInt(c.req.query("count") || "1"), 50);

  const results = [];

  for (let i = 0; i < count; i++) {
    const simulated = generateWebhook(provider);
    if (!simulated) {
      return c.json({
        error: `Unknown provider: ${provider}`,
        available: simulatorProviders(),
      }, 400);
    }

    // Build a real request and send it through the actual webhook receiver
    const req = new Request(
      `${new URL(c.req.url).origin}/webhooks/${provider}/${tenant_id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...simulated.headers,
        },
        body: JSON.stringify(simulated.body),
      }
    );

    const res = await app.fetch(req, c.env);
    const json = await res.json() as Record<string, unknown>;
    results.push(json);
  }

  return c.json({
    status: "simulated",
    provider,
    tenant_id,
    count: results.length,
    events: results,
  });
});

// List available simulator providers
app.get("/api/simulate", (c) => {
  return c.json({
    providers: simulatorProviders(),
    usage: "POST /api/simulate/:provider/:tenant_id?count=N",
    example: "POST /api/simulate/hubspot/demo_tenant?count=5",
  });
});

// ─── Helpers ────────────────────────────────────────────

/** Parse a D1 row back into a clean event object */
function parseEventRow(row: Record<string, unknown>) {
  return {
    ...row,
    raw_payload:
      typeof row.raw_payload === "string"
        ? JSON.parse(row.raw_payload as string)
        : row.raw_payload,
  };
}

export default {
  fetch: app.fetch,

  // Cron trigger — fires every minute, processes retry queue
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(processRetryQueue(env.DB));
  },
};
