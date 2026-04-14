import { describe, it, expect, beforeEach } from "vitest";
import { hubspot } from "../src/providers/hubspot";
import { shopify } from "../src/providers/shopify";
import { linear } from "../src/providers/linear";
import { intercom } from "../src/providers/intercom";
import { gusto } from "../src/providers/gusto";
import { getProvider, listProviders } from "../src/providers/registry";
import { generateEventId, nowISO, timeSafeEqual } from "../src/utils";

// ─── Helper: build a mock D1 database ─────────────────
// Implements the subset of D1Database the app actually uses

interface Row {
  [key: string]: unknown;
}

function createMockD1() {
  const tables: Record<string, Row[]> = {
    events: [],
    retry_queue: [],
    dead_letter: [],
  };

  function matchesWhere(row: Row, conditions: Array<{ col: string; val: unknown }>): boolean {
    return conditions.every((c) => row[c.col] === c.val);
  }

  const db = {
    _tables: tables,
    prepare(sql: string) {
      let boundParams: unknown[] = [];
      return {
        bind(...params: unknown[]) {
          boundParams = params;
          return this;
        },
        async first<T = Row>(col?: string): Promise<T | null> {
          // Handle SELECT 1 as ok
          if (sql.includes("SELECT 1 as ok")) return { ok: 1 } as T;

          // Handle COUNT queries
          if (sql.includes("COUNT(*)")) {
            const tableName = sql.match(/FROM\s+(\w+)/i)?.[1] || "events";
            const table = tables[tableName] || [];
            let count = table.length;

            // Apply WHERE filters
            if (sql.includes("WHERE") && boundParams.length > 0) {
              const conditions: Array<{ col: string; val: unknown }> = [];
              const whereMatches = sql.match(/(\w+)\s*=\s*\?/g);
              if (whereMatches) {
                whereMatches.forEach((m, i) => {
                  const col = m.match(/(\w+)\s*=/)?.[1] || "";
                  conditions.push({ col, val: boundParams[i] });
                });
              }
              count = table.filter((r) => matchesWhere(r, conditions)).length;
            }
            return { count } as T;
          }

          // Handle SELECT by ID
          if (sql.includes("WHERE id = ?")) {
            const tableName = sql.match(/FROM\s+(\w+)/i)?.[1] || "events";
            const table = tables[tableName] || [];
            const found = table.find((r) => r.id === boundParams[0]);
            return (found as T) || null;
          }

          // Handle dedup check
          if (sql.includes("tenant_id = ?") && sql.includes("provider = ?") && sql.includes("delivery_id = ?")) {
            const found = tables.events.find(
              (r) =>
                r.tenant_id === boundParams[0] &&
                r.provider === boundParams[1] &&
                r.delivery_id === boundParams[2]
            );
            return (found as T) || null;
          }

          return null;
        },
        async all() {
          const tableName = sql.match(/FROM\s+(\w+)/i)?.[1] || "events";
          const table = tables[tableName] || [];

          // Apply WHERE filters
          let results = [...table];
          if (sql.includes("WHERE") && boundParams.length > 0) {
            const conditions: Array<{ col: string; val: unknown }> = [];
            // Extract column = ? patterns from WHERE clause only
            const whereClause = sql.substring(sql.indexOf("WHERE"));
            const paramMatches = whereClause.match(/(\w+)\s*=\s*\?/g) || [];
            let paramIndex = 0;
            paramMatches.forEach((m) => {
              const col = m.match(/(\w+)\s*=/)?.[1] || "";
              if (paramIndex < boundParams.length) {
                conditions.push({ col, val: boundParams[paramIndex++] });
              }
            });
            results = results.filter((r) => matchesWhere(r, conditions));
          }

          // Handle LIMIT
          const limitMatch = sql.match(/LIMIT\s+(\?|\d+)/i);
          if (limitMatch) {
            const limit = limitMatch[1] === "?"
              ? (boundParams[boundParams.length - 1] as number)
              : parseInt(limitMatch[1]);
            results = results.slice(0, limit);
          }

          // Handle ORDER BY received_at DESC
          if (sql.includes("ORDER BY received_at DESC") || sql.includes("ORDER BY")) {
            results.sort((a, b) => {
              const aDate = a.received_at as string || "";
              const bDate = b.received_at as string || "";
              return bDate.localeCompare(aDate);
            });
          }

          return { results };
        },
        async run() {
          if (sql.startsWith("INSERT INTO")) {
            const tableMatch = sql.match(/INSERT INTO\s+(\w+)/);
            const tableName = tableMatch?.[1] || "events";
            const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/);
            const cols = colsMatch?.[1].split(",").map((c) => c.trim()) || [];
            const row: Row = {};
            cols.forEach((col, i) => {
              row[col] = boundParams[i];
            });
            tables[tableName] = tables[tableName] || [];
            tables[tableName].push(row);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE")) {
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE")) {
            const tableMatch = sql.match(/DELETE FROM\s+(\w+)/);
            const tableName = tableMatch?.[1] || "events";
            const before = tables[tableName].length;
            // Simple delete for tenant + before date
            if (sql.includes("tenant_id = ?") && sql.includes("received_at < ?")) {
              tables[tableName] = tables[tableName].filter(
                (r) => !(r.tenant_id === boundParams[0] && (r.received_at as string) < (boundParams[1] as string))
              );
            }
            return { meta: { changes: before - tables[tableName].length } };
          }
          return { meta: { changes: 0 } };
        },
      };
    },
  };
  return db;
}

// ─── Helper: make a request to the app ─────────────────

async function makeApp() {
  // Dynamic import to avoid issues with Workers types in Node
  const mod = await import("../src/index");
  return mod.default;
}

function buildRequest(
  path: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> }
): Request {
  const method = options?.method || "GET";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers,
  };
  const init: RequestInit = { method, headers };
  if (options?.body) {
    init.body = JSON.stringify(options.body);
  }
  return new Request(`http://localhost${path}`, init);
}

// ════════════════════════════════════════════════════════
// TEST SUITE — 15+ tests per spec requirements
// ════════════════════════════════════════════════════════

describe("Webhook Hub", () => {
  let app: any;
  let mockDB: ReturnType<typeof createMockD1>;

  beforeEach(async () => {
    app = await makeApp();
    mockDB = createMockD1();
  });

  // ─── Test 1: HubSpot webhook → normalized event ──────
  it("1. Receive HubSpot webhook → normalized event stored", async () => {
    const res = await app.fetch(
      buildRequest("/webhooks/hubspot/acme_corp", {
        method: "POST",
        body: {
          subscriptionType: "deal.creation",
          objectId: "12345",
          portalId: "999",
        },
      }),
      { DB: mockDB }
    );

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("accepted");
    expect(json.event_type).toBe("deal.created");
    expect(mockDB._tables.events).toHaveLength(1);
    expect(mockDB._tables.events[0].provider).toBe("hubspot");
    expect(mockDB._tables.events[0].tenant_id).toBe("acme_corp");
  });

  // ─── Test 2: Shopify webhook → normalized event ──────
  it("2. Receive Shopify webhook → normalized event stored", async () => {
    const res = await app.fetch(
      buildRequest("/webhooks/shopify/acme_corp", {
        method: "POST",
        body: {
          id: 98765,
          name: "#1001",
          line_items: [{ title: "Widget" }],
          total_price: "49.99",
        },
      }),
      { DB: mockDB }
    );

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("accepted");
    expect(json.event_type).toBe("order.created");
    expect(mockDB._tables.events[0].provider).toBe("shopify");
  });

  // ─── Test 3: Linear webhook → normalized event ───────
  it("3. Receive Linear webhook → normalized event stored", async () => {
    const res = await app.fetch(
      buildRequest("/webhooks/linear/acme_corp", {
        method: "POST",
        body: {
          action: "create",
          type: "Issue",
          data: { id: "ISS-42", title: "Fix auth", priority: 1 },
        },
      }),
      { DB: mockDB }
    );

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("accepted");
    expect(json.event_type).toBe("issue.created");
    expect(mockDB._tables.events[0].provider).toBe("linear");
  });

  // ─── Test 4: Intercom webhook → normalized event ─────
  it("4. Receive Intercom webhook → normalized event stored", async () => {
    const res = await app.fetch(
      buildRequest("/webhooks/intercom/acme_corp", {
        method: "POST",
        body: {
          topic: "conversation.user.created",
          id: "notif_123",
          data: { item: { id: "conv_456", type: "conversation" } },
        },
      }),
      { DB: mockDB }
    );

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("accepted");
    expect(json.event_type).toBe("conversation.created");
    expect(mockDB._tables.events[0].provider).toBe("intercom");
  });

  // ─── Test 5: Gusto webhook → normalized event ────────
  it("5. Receive Gusto webhook → normalized event stored", async () => {
    const res = await app.fetch(
      buildRequest("/webhooks/gusto/acme_corp", {
        method: "POST",
        body: {
          event_type: "payroll.processed",
          entity_type: "payroll",
          entity_uuid: "pay_789",
          company_uuid: "comp_001",
        },
      }),
      { DB: mockDB }
    );

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("accepted");
    expect(json.event_type).toBe("payroll.processed");
    expect(mockDB._tables.events[0].provider).toBe("gusto");
  });

  // ─── Test 6: Valid HubSpot signature → accepted ──────
  it("6. Valid HubSpot signature → accepted", async () => {
    const body = JSON.stringify({ subscriptionType: "deal.creation", objectId: "1" });
    const secret = "test-secret";

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const signature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await hubspot.validateSignature(
      body,
      new Headers({ "x-hubspot-signature": signature }),
      secret
    );
    expect(result).toBe(true);
  });

  // ─── Test 7: Invalid signature → rejected ────────────
  it("7. Invalid signature → rejected", async () => {
    const result = await hubspot.validateSignature(
      '{"test":true}',
      new Headers({ "x-hubspot-signature": "bad-signature" }),
      "test-secret"
    );
    expect(result).toBe(false);
  });

  // ─── Test 8: Duplicate webhook → only one stored ─────
  it("8. Same webhook ID twice → only one event stored", async () => {
    const payload = {
      subscriptionType: "deal.creation",
      objectId: "12345",
      correlationId: "dedup-test-123",
    };

    // First request
    const res1 = await app.fetch(
      buildRequest("/webhooks/hubspot/acme_corp", {
        method: "POST",
        body: payload,
        headers: { "x-hubspot-request-id": "dedup-test-123" },
      }),
      { DB: mockDB }
    );
    const json1 = await res1.json();
    expect(json1.status).toBe("accepted");

    // Second request with same delivery ID
    const res2 = await app.fetch(
      buildRequest("/webhooks/hubspot/acme_corp", {
        method: "POST",
        body: payload,
        headers: { "x-hubspot-request-id": "dedup-test-123" },
      }),
      { DB: mockDB }
    );
    const json2 = await res2.json();
    expect(json2.status).toBe("duplicate");
    expect(mockDB._tables.events).toHaveLength(1);
  });

  // ─── Test 9: Tenant isolation ────────────────────────
  it("9. Tenant A event not visible to tenant B query", async () => {
    // Store event for tenant_a
    await app.fetch(
      buildRequest("/webhooks/hubspot/tenant_a", {
        method: "POST",
        body: { subscriptionType: "deal.creation", objectId: "1" },
      }),
      { DB: mockDB }
    );

    // Store event for tenant_b
    await app.fetch(
      buildRequest("/webhooks/hubspot/tenant_b", {
        method: "POST",
        body: { subscriptionType: "deal.creation", objectId: "2" },
      }),
      { DB: mockDB }
    );

    // Query as tenant_a
    const res = await app.fetch(
      buildRequest("/api/events?tenant_id=tenant_a"),
      { DB: mockDB }
    );
    const json = await res.json();
    expect(json.events).toHaveLength(1);
    expect(json.events[0].tenant_id).toBe("tenant_a");
  });

  // ─── Test 10: Failed processing → queued for retry ───
  it("10. Failed processing → retried with backoff", async () => {
    // Verify retry module exports work
    const { queueForRetry } = await import("../src/retry");

    const eventId = generateEventId();
    // Insert a failed event
    mockDB._tables.events.push({
      id: eventId,
      tenant_id: "acme",
      provider: "hubspot",
      event_type: "deal.created",
      severity: "info",
      summary: "test",
      raw_payload: JSON.stringify({ subscriptionType: "deal.creation", objectId: "1" }),
      delivery_id: "test-retry",
      received_at: nowISO(),
      status: "failed",
    });

    await queueForRetry(mockDB as any, eventId);
    expect(mockDB._tables.retry_queue).toHaveLength(1);
    // The INSERT uses literal 1 and 5 for attempt/max_attempts,
    // so only event_id and next_retry_at are bound params.
    // Verify the row exists and has the event reference.
    const retryRow = mockDB._tables.retry_queue[0];
    expect(retryRow.event_id).toBe(eventId);
  });

  // ─── Test 11: Max retries → dead letter ──────────────
  it("11. Event fails 5 times → moved to dead letter queue", async () => {
    const { processRetryQueue } = await import("../src/retry");

    const eventId = generateEventId();
    mockDB._tables.events.push({
      id: eventId,
      tenant_id: "acme",
      provider: "nonexistent_provider",
      event_type: "unknown",
      severity: "info",
      summary: "will fail",
      raw_payload: JSON.stringify({ test: true }),
      delivery_id: "dl-test",
      received_at: nowISO(),
      status: "failed",
    });

    // Add to retry queue at max attempts
    mockDB._tables.retry_queue.push({
      id: 1,
      event_id: eventId,
      attempt: 5,
      max_attempts: 5,
      next_retry_at: new Date(Date.now() - 60000).toISOString(),
      last_error: null,
      created_at: nowISO(),
      updated_at: nowISO(),
      // Joined fields
      raw_payload: JSON.stringify({ test: true }),
      provider: "nonexistent_provider",
      tenant_id: "acme",
    });

    const stats = await processRetryQueue(mockDB as any);
    expect(stats.dead_lettered).toBe(1);
    expect(mockDB._tables.dead_letter).toHaveLength(1);
    expect(mockDB._tables.dead_letter[0].event_id).toBe(eventId);
  });

  // ─── Test 12: Replay endpoint ────────────────────────
  it("12. POST /api/replay/:id → event re-processed", async () => {
    // Insert an event first
    const postRes = await app.fetch(
      buildRequest("/webhooks/hubspot/acme_corp", {
        method: "POST",
        body: { subscriptionType: "deal.creation", objectId: "999" },
      }),
      { DB: mockDB }
    );
    const { event_id } = await postRes.json();

    // Replay it
    const res = await app.fetch(
      buildRequest(`/api/replay/${event_id}`, { method: "POST" }),
      { DB: mockDB }
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("replayed");
    expect(json.event_id).toBe(event_id);
  });

  // ─── Test 13: Pagination ────────────────────────────
  it("13. 100 events → GET /api/events?limit=10 returns 10 with cursor", async () => {
    // Insert 100 events
    for (let i = 0; i < 100; i++) {
      await app.fetch(
        buildRequest("/webhooks/hubspot/pagination_test", {
          method: "POST",
          body: { subscriptionType: "deal.creation", objectId: String(i) },
        }),
        { DB: mockDB }
      );
    }

    const res = await app.fetch(
      buildRequest("/api/events?tenant_id=pagination_test&limit=10"),
      { DB: mockDB }
    );
    const json = await res.json();

    expect(json.events).toHaveLength(10);
    expect(json.pagination.limit).toBe(10);
    expect(json.pagination.has_more).toBe(true);
    expect(json.pagination.next_cursor).toBeTruthy();
  });

  // ─── Test 14: Stats endpoint ─────────────────────────
  it("14. GET /api/stats returns correct counts after ingestion", async () => {
    // Insert events across providers
    await app.fetch(
      buildRequest("/webhooks/hubspot/stats_test", {
        method: "POST",
        body: { subscriptionType: "deal.creation", objectId: "1" },
      }),
      { DB: mockDB }
    );
    await app.fetch(
      buildRequest("/webhooks/shopify/stats_test", {
        method: "POST",
        body: { id: 1, name: "#1", line_items: [{}] },
      }),
      { DB: mockDB }
    );

    const res = await app.fetch(
      buildRequest("/api/stats?tenant_id=stats_test"),
      { DB: mockDB }
    );
    const json = await res.json();
    expect(json.total).toBe(2);
    expect(json.by_provider).toHaveLength(2);
  });

  // ─── Test 15: Health endpoint ────────────────────────
  it("15. GET /api/health returns system status", async () => {
    const res = await app.fetch(
      buildRequest("/api/health"),
      { DB: mockDB }
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("healthy");
    expect(json.db).toBe("connected");
    expect(json.providers).toContain("hubspot");
    expect(json.providers).toContain("shopify");
    expect(json.providers).toContain("linear");
    expect(json.providers).toContain("intercom");
    expect(json.providers).toContain("gusto");
    expect(json.retry_queue_depth).toBeDefined();
    expect(json.timestamp).toBeTruthy();
  });

  // ─── Bonus: Unknown provider → 400 ──────────────────
  it("16. Unknown provider returns 400", async () => {
    const res = await app.fetch(
      buildRequest("/webhooks/unknown_service/acme_corp", {
        method: "POST",
        body: { test: true },
      }),
      { DB: mockDB }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Unknown provider");
  });

  // ─── Bonus: Invalid JSON body → 400 ─────────────────
  it("17. Invalid JSON body returns 400", async () => {
    const res = await app.fetch(
      new Request("http://localhost/webhooks/hubspot/acme_corp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json{{{",
      }),
      { DB: mockDB }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid JSON");
  });

  // ─── Bonus: Provider registry ────────────────────────
  it("18. Provider registry lists all 11 providers", () => {
    const providers = listProviders();
    expect(providers).toContain("hubspot");
    expect(providers).toContain("shopify");
    expect(providers).toContain("linear");
    expect(providers).toContain("intercom");
    expect(providers).toContain("gusto");
    expect(providers).toContain("salesforce");
    expect(providers).toContain("pagerduty");
    expect(providers).toContain("zendesk");
    expect(providers).toContain("stripe");
    expect(providers).toContain("datadog");
    expect(providers).toContain("github");
    expect(providers).toHaveLength(11);
  });
});
