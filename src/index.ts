import { Hono } from "hono";
import { cors } from "hono/cors";
import { getProvider, listProviders } from "./providers/registry";
import { generateEventId, nowISO } from "./utils";
import { processRetryQueue, queueForRetry } from "./retry";
import { forwardEvent } from "./forwarding";
import { dashboardHTML } from "./dashboard";
import { connectionsHTML } from "./connections";
import { accountHTML } from "./account";
import { presentationHTML } from "./presentation";
import { agentsPageHTML } from "./agents-page";
import { getProviderHealthScores, sendHealthDigest } from "./health-scores";
import { checkCorrelations } from "./correlation";
import { evaluateAlertRules } from "./alerting";
import { analyzeEvents } from "./ai-analysis";
import { getAgentFeed, executeAgentAction, getOpenAPISpec } from "./agent-api";
import { executeAutomations } from "./automation";
import { generateWebhook, simulatorProviders } from "./simulator";

/** Env bindings for Cloudflare Workers */
export type Bindings = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  SLACK_HEALTH_WEBHOOK_URL?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  ANTHROPIC_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Allow cross-origin for dashboard
app.use("*", cors());

// ─── Health ─────────────────────────────────────────────
app.get("/", (c) => c.redirect("/dashboard"));

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

app.get("/connections", (c) => {
  return c.html(connectionsHTML());
});

app.get("/account", (c) => {
  return c.html(accountHTML());
});

app.get("/agents", (c) => {
  return c.html(agentsPageHTML());
});

app.get("/presentation", (c) => {
  return c.html(presentationHTML());
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

  // Forward to configured destinations (non-blocking)
  // Uses waitUntil so the response returns immediately while forwarding happens in background
  try {
    const ctx = c.executionCtx;
    if (ctx?.waitUntil) {
      const twilioConfig = c.env.TWILIO_ACCOUNT_SID && c.env.TWILIO_AUTH_TOKEN && c.env.TWILIO_FROM_NUMBER
        ? { accountSid: c.env.TWILIO_ACCOUNT_SID, authToken: c.env.TWILIO_AUTH_TOKEN, fromNumber: c.env.TWILIO_FROM_NUMBER }
        : undefined;
      ctx.waitUntil(forwardEvent(c.env.DB, event, c.env.RESEND_API_KEY, twilioConfig));
      ctx.waitUntil(checkCorrelations(c.env.DB, event, c.env.RESEND_API_KEY, twilioConfig));
      ctx.waitUntil(executeAutomations(c.env.DB, event));
    }
  } catch {
    // executionCtx not available (test environment) — skip forwarding
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

// ─── Forwarding Rules API ───────────────────────────────

// List forwarding rules for a tenant
app.get("/api/forwarding", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);

  const result = await c.env.DB.prepare(
    "SELECT * FROM forwarding_rules WHERE tenant_id = ? ORDER BY created_at DESC"
  ).bind(tenant_id).all();

  return c.json({ rules: result.results || [] });
});

// Create a forwarding rule
app.post("/api/forwarding", async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    name?: string;
    destination_type: string;
    destination: string;
    provider_filter?: string;
    severity_filter?: string;
  }>();

  if (!body.tenant_id || !body.destination_type || !body.destination) {
    return c.json({ error: "tenant_id, destination_type, and destination are required" }, 400);
  }

  if (!["webhook", "email", "slack", "sms", "call"].includes(body.destination_type)) {
    return c.json({ error: "destination_type must be 'webhook', 'email', 'slack', 'sms', or 'call'" }, 400);
  }

  await c.env.DB.prepare(
    "INSERT INTO forwarding_rules (tenant_id, name, destination_type, destination, provider_filter, severity_filter) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(
    body.tenant_id,
    body.name || "",
    body.destination_type,
    body.destination,
    body.provider_filter || null,
    body.severity_filter || null
  ).run();

  return c.json({ status: "created" }, 201);
});

// Toggle a forwarding rule on/off
app.patch("/api/forwarding/:id", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<{ active: number }>();
  await c.env.DB.prepare("UPDATE forwarding_rules SET active = ? WHERE id = ?")
    .bind(body.active, id)
    .run();
  return c.json({ status: "updated", active: body.active });
});

// Delete a forwarding rule
app.delete("/api/forwarding/:id", async (c) => {
  const { id } = c.req.param();
  await c.env.DB.prepare("DELETE FROM forwarding_rules WHERE id = ?").bind(id).run();
  return c.json({ status: "deleted" });
});

// ─── Provider Health Scores ─────────────────────────────

app.get("/api/health/providers", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);
  const window = parseInt(c.req.query("window") || "60");

  const scores = await getProviderHealthScores(c.env.DB, tenant_id, window);
  return c.json({
    tenant_id,
    window_minutes: window,
    providers: scores,
    overall_status: scores.some((s) => s.status === "critical")
      ? "critical"
      : scores.some((s) => s.status === "degraded")
        ? "degraded"
        : "healthy",
  });
});

// Manually trigger health digest (for testing)
app.post("/api/health/digest", async (c) => {
  if (!c.env.SLACK_HEALTH_WEBHOOK_URL) {
    return c.json({ error: "SLACK_HEALTH_WEBHOOK_URL not configured" }, 400);
  }
  await sendHealthDigest(c.env.DB, c.env.SLACK_HEALTH_WEBHOOK_URL);
  return c.json({ status: "digest_sent" });
});

// ─── Remediation Playbooks API ──────────────────────────

app.get("/api/playbooks", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);
  const result = await c.env.DB.prepare(
    "SELECT * FROM remediation_playbooks WHERE tenant_id = ? ORDER BY created_at DESC"
  ).bind(tenant_id).all();
  return c.json({ playbooks: result.results || [] });
});

app.post("/api/playbooks", async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    event_pattern: string;
    provider_filter?: string;
    title: string;
    steps: string[];
  }>();

  if (!body.tenant_id || !body.event_pattern || !body.title || !body.steps?.length) {
    return c.json({ error: "tenant_id, event_pattern, title, and steps are required" }, 400);
  }

  await c.env.DB.prepare(
    "INSERT INTO remediation_playbooks (tenant_id, event_pattern, provider_filter, title, steps) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    body.tenant_id,
    body.event_pattern,
    body.provider_filter || null,
    body.title,
    JSON.stringify(body.steps)
  ).run();

  return c.json({ status: "created" }, 201);
});

app.delete("/api/playbooks/:id", async (c) => {
  const { id } = c.req.param();
  await c.env.DB.prepare("DELETE FROM remediation_playbooks WHERE id = ?").bind(id).run();
  return c.json({ status: "deleted" });
});

// ─── Agent API ──────────────────────────────────────────

app.get("/api/openapi.json", (c) => {
  return c.json(getOpenAPISpec());
});

app.get("/api/agent/feed", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);
  const limit = parseInt(c.req.query("limit") || "20");
  const feed = await getAgentFeed(c.env.DB, tenant_id, limit);
  return c.json({ tenant_id, count: feed.length, events: feed });
});

app.post("/api/agent/action", async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    action: string;
    params: Record<string, unknown>;
  }>();

  if (!body.tenant_id || !body.action) {
    return c.json({ error: "tenant_id and action are required" }, 400);
  }

  const result = await executeAgentAction(c.env.DB, body.tenant_id, body.action, body.params || {});
  return c.json(result);
});

// ─── AI Analysis ────────────────────────────────────────

app.post("/api/analyze", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);

  const analysis = await analyzeEvents(c.env.DB, tenant_id, c.env.ANTHROPIC_API_KEY);
  return c.json(analysis);
});

// ─── Automation Workflows API ────────────────────────────

app.get("/api/automations", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);
  const result = await c.env.DB.prepare(
    "SELECT * FROM automation_workflows WHERE tenant_id = ? ORDER BY created_at DESC"
  ).bind(tenant_id).all();
  return c.json({ workflows: result.results || [] });
});

app.post("/api/automations", async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    name: string;
    trigger_provider: string;
    trigger_event_pattern: string;
    actions: Array<{
      type: string;
      name: string;
      config: Record<string, unknown>;
    }>;
  }>();

  if (!body.tenant_id || !body.name || !body.trigger_provider || !body.trigger_event_pattern || !body.actions?.length) {
    return c.json({ error: "tenant_id, name, trigger_provider, trigger_event_pattern, and actions are required" }, 400);
  }

  await c.env.DB.prepare(
    "INSERT INTO automation_workflows (tenant_id, name, trigger_provider, trigger_event_pattern, actions) VALUES (?, ?, ?, ?, ?)"
  ).bind(
    body.tenant_id,
    body.name,
    body.trigger_provider,
    body.trigger_event_pattern,
    JSON.stringify(body.actions)
  ).run();

  return c.json({ status: "created" }, 201);
});

app.delete("/api/automations/:id", async (c) => {
  const { id } = c.req.param();
  await c.env.DB.prepare("DELETE FROM automation_workflows WHERE id = ?").bind(id).run();
  return c.json({ status: "deleted" });
});

// ─── Alert Rules API ────────────────────────────────────

app.get("/api/alerts", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);
  const result = await c.env.DB.prepare(
    "SELECT * FROM alert_rules WHERE tenant_id = ? ORDER BY created_at DESC"
  ).bind(tenant_id).all();
  return c.json({ rules: result.results || [] });
});

app.post("/api/alerts", async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    name: string;
    metric: string;
    provider_filter?: string;
    threshold: number;
    window_minutes?: number;
    comparison?: string;
  }>();

  if (!body.tenant_id || !body.name || !body.metric || body.threshold === undefined) {
    return c.json({ error: "tenant_id, name, metric, and threshold are required" }, 400);
  }

  const validMetrics = ["error_rate", "failed_count", "retry_queue_depth", "dead_letter_count", "event_volume"];
  if (!validMetrics.includes(body.metric)) {
    return c.json({ error: `metric must be one of: ${validMetrics.join(", ")}` }, 400);
  }

  await c.env.DB.prepare(
    "INSERT INTO alert_rules (tenant_id, name, metric, provider_filter, threshold, window_minutes, comparison) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    body.tenant_id,
    body.name,
    body.metric,
    body.provider_filter || null,
    body.threshold,
    body.window_minutes || 15,
    body.comparison || "gt"
  ).run();

  return c.json({ status: "created" }, 201);
});

app.delete("/api/alerts/:id", async (c) => {
  const { id } = c.req.param();
  await c.env.DB.prepare("DELETE FROM alert_rules WHERE id = ?").bind(id).run();
  return c.json({ status: "deleted" });
});

// ─── Correlation Rules API ──────────────────────────────

app.get("/api/correlations", async (c) => {
  const tenant_id = c.req.query("tenant_id");
  if (!tenant_id) return c.json({ error: "tenant_id is required" }, 400);
  const result = await c.env.DB.prepare(
    "SELECT * FROM correlation_rules WHERE tenant_id = ? ORDER BY created_at DESC"
  ).bind(tenant_id).all();
  return c.json({ rules: result.results || [] });
});

app.post("/api/correlations", async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    name: string;
    provider_a: string;
    event_pattern_a: string;
    provider_b: string;
    event_pattern_b: string;
    time_window_minutes?: number;
    action_description: string;
  }>();

  if (!body.tenant_id || !body.name || !body.provider_a || !body.event_pattern_a || !body.provider_b || !body.event_pattern_b || !body.action_description) {
    return c.json({ error: "All fields required: tenant_id, name, provider_a, event_pattern_a, provider_b, event_pattern_b, action_description" }, 400);
  }

  await c.env.DB.prepare(
    "INSERT INTO correlation_rules (tenant_id, name, provider_a, event_pattern_a, provider_b, event_pattern_b, time_window_minutes, action_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    body.tenant_id,
    body.name,
    body.provider_a,
    body.event_pattern_a,
    body.provider_b,
    body.event_pattern_b,
    body.time_window_minutes || 30,
    body.action_description
  ).run();

  return c.json({ status: "created" }, 201);
});

app.delete("/api/correlations/:id", async (c) => {
  const { id } = c.req.param();
  await c.env.DB.prepare("DELETE FROM correlation_rules WHERE id = ?").bind(id).run();
  return c.json({ status: "deleted" });
});

// Test forwarding — sends a test event through all active rules for the tenant
app.post("/api/forwarding/test/:tenant_id", async (c) => {
  const { tenant_id } = c.req.param();
  const testEvent = {
    id: "evt_test",
    tenant_id,
    provider: "system",
    event_type: "forwarding.test",
    severity: "critical" as const,
    summary: "Test notification from Webhook Hub — forwarding is working!",
    raw_payload: { test: true },
    received_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    status: "processed" as const,
  };

  const twilioConfig = c.env.TWILIO_ACCOUNT_SID && c.env.TWILIO_AUTH_TOKEN && c.env.TWILIO_FROM_NUMBER
    ? { accountSid: c.env.TWILIO_ACCOUNT_SID, authToken: c.env.TWILIO_AUTH_TOKEN, fromNumber: c.env.TWILIO_FROM_NUMBER }
    : undefined;
  const result = await forwardEvent(c.env.DB, testEvent, c.env.RESEND_API_KEY, twilioConfig);
  return c.json({ status: "test_sent", ...result });
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

  // Cron trigger — fires every minute
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Process retry queue every minute
    ctx.waitUntil(processRetryQueue(env.DB));

    // Evaluate alert rules every 5 minutes
    const minute = new Date(event.scheduledTime).getMinutes();
    if (minute % 5 === 0) {
      const twilioConfig = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER
        ? { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, fromNumber: env.TWILIO_FROM_NUMBER }
        : undefined;
      ctx.waitUntil(evaluateAlertRules(env.DB, env.RESEND_API_KEY, twilioConfig));
    }

    // Send health digest to Slack every 20 minutes
    if (minute % 20 === 0 && env.SLACK_HEALTH_WEBHOOK_URL) {
      ctx.waitUntil(sendHealthDigest(env.DB, env.SLACK_HEALTH_WEBHOOK_URL));
    }
  },
};
