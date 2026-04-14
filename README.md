# Webhook Hub

A multi-tenant webhook processing platform deployed on Cloudflare Workers with D1. Receives webhooks from multiple SaaS providers, normalizes them into a common event format, and provides a REST API and monitoring dashboard for ops visibility.

> It's the webhook infrastructure layer that every B2B SaaS company eventually builds badly — built once, correctly, as a shared platform.

**Live URL:** https://webhook-hub.noahpilkington98.workers.dev

---

## Quick Start (< 5 minutes)

### Prerequisites
- Node.js 18+
- A Cloudflare account (free tier works)
- Wrangler CLI (installed as a dev dependency)

### 1. Clone and install
```bash
git clone https://github.com/Norky101/webhook-hub.git
cd webhook-hub
npm install
```

### 2. Set up Cloudflare
```bash
npx wrangler login
npx wrangler d1 create webhook-hub-db
```

Update `wrangler.toml` with the database ID from the output.

### 3. Initialize the database
```bash
npx wrangler d1 execute webhook-hub-db --remote --file=src/db/schema.sql
```

### 4. Deploy
```bash
npx wrangler deploy
```

### 5. Test it
```bash
# Send a test webhook
curl -X POST https://YOUR-WORKER.workers.dev/webhooks/hubspot/my_tenant \
  -H "Content-Type: application/json" \
  -d '{"subscriptionType":"deal.creation","objectId":"12345"}'

# Check it landed
curl https://YOUR-WORKER.workers.dev/api/events?tenant_id=my_tenant
```

### Local development
```bash
npx wrangler dev
```

### Run tests
```bash
npm test
```

---

## Architecture

```
POST /webhooks/:provider/:tenant_id
        │
        ▼
  ┌─────────────┐
  │  Signature   │──→ 401 (invalid)
  │  Validation  │
  └──────┬───────┘
         ▼
  ┌─────────────┐
  │  Idempotency │──→ 200 (duplicate)
  │  Check (D1)  │
  └──────┬───────┘
         ▼
  ┌─────────────┐     ┌──────────────┐
  │  Normalizer  │──→  │  D1 Storage  │
  │  (per provider)│    └──────┬───────┘
  └─────────────┘           │
                            ▼
                   ┌────────────────┐
                   │  REST API /     │
                   │  Dashboard      │
                   └────────────────┘

  Failed events ──→ Retry Queue (D1) ──→ Cron (1min) ──→ Exponential Backoff
                                                              │
                                               Max retries ──→ Dead Letter Queue
```

**Key design choices:**
- **Provider registry pattern** — adding a provider = one file + one line to register it
- **Single D1 database** — flat `events` table with tenant isolation via WHERE clauses and indexes
- **Cron-based retry** — D1 retry_queue table polled every minute, simpler than Durable Objects or Queues
- **Immediate 200 response** — webhook accepted synchronously, processing is the write to D1

See [DECISIONS.md](DECISIONS.md) for the full rationale behind every technical choice.

---

## Supported Providers

| Provider | Signature Method | Event Categories |
|----------|-----------------|------------------|
| **HubSpot** | HMAC-SHA256 | deal, contact, company |
| **Shopify** | HMAC-SHA256 (base64) | order, product, customer, refund |
| **Linear** | HMAC-SHA256 | issue, comment, project, cycle |
| **Intercom** | HMAC-SHA1 | conversation, contact, user |
| **Gusto** | HMAC-SHA256 | payroll, employee, contractor |
| **Salesforce** | HMAC-SHA256 | opportunity, contact, account, lead, case |
| **PagerDuty** | HMAC-SHA256 (v1= prefix) | incident, service |
| **Zendesk** | HMAC-SHA256 (base64) | ticket, user, organization |

---

## API Reference

### Webhook Receiver

**`POST /webhooks/:provider/:tenant_id`**

Receives a webhook from any supported provider.

```bash
curl -X POST https://webhook-hub.noahpilkington98.workers.dev/webhooks/hubspot/acme_corp \
  -H "Content-Type: application/json" \
  -d '{"subscriptionType":"deal.creation","objectId":"12345","portalId":"999"}'
```

Response:
```json
{
  "status": "accepted",
  "event_id": "evt_feab40a6cef9455b",
  "event_type": "deal.created"
}
```

Duplicate delivery response:
```json
{
  "status": "duplicate",
  "event_id": "evt_feab40a6cef9455b"
}
```

---

### Events API

**`GET /api/events?tenant_id=X`** — List events (paginated)

Query parameters:
| Param | Required | Description |
|-------|----------|-------------|
| `tenant_id` | Yes | Tenant identifier |
| `provider` | No | Filter by provider |
| `event_type` | No | Filter by event type |
| `status` | No | Filter by status (processed, failed, retrying, dead_letter) |
| `after` | No | Events after this ISO date |
| `before` | No | Events before this ISO date |
| `cursor` | No | Pagination cursor (event ID) |
| `limit` | No | Results per page (default 50, max 100) |

```bash
curl "https://webhook-hub.noahpilkington98.workers.dev/api/events?tenant_id=acme_corp&provider=hubspot&limit=10"
```

Response:
```json
{
  "events": [
    {
      "id": "evt_feab40a6cef9455b",
      "tenant_id": "acme_corp",
      "provider": "hubspot",
      "event_type": "deal.created",
      "severity": "info",
      "summary": "HubSpot deal.created on object 12345",
      "raw_payload": { "subscriptionType": "deal.creation", "objectId": "12345" },
      "received_at": "2026-04-14T12:00:00.000Z",
      "processed_at": "2026-04-14T12:00:00.000Z",
      "status": "processed"
    }
  ],
  "pagination": {
    "limit": 10,
    "has_more": false,
    "next_cursor": null
  }
}
```

---

**`GET /api/events/:id`** — Single event detail

```bash
curl https://webhook-hub.noahpilkington98.workers.dev/api/events/evt_feab40a6cef9455b
```

---

**`GET /api/stats?tenant_id=X`** — Event counts by provider, type, status

```bash
curl "https://webhook-hub.noahpilkington98.workers.dev/api/stats?tenant_id=acme_corp"
```

Response:
```json
{
  "tenant_id": "acme_corp",
  "total": 42,
  "by_provider": [{ "provider": "hubspot", "count": 30 }, { "provider": "shopify", "count": 12 }],
  "by_type": [{ "event_type": "deal.created", "count": 20 }],
  "by_status": [{ "status": "processed", "count": 40 }, { "status": "failed", "count": 2 }]
}
```

---

**`POST /api/replay/:id`** — Re-process an event from its raw payload

```bash
curl -X POST https://webhook-hub.noahpilkington98.workers.dev/api/replay/evt_feab40a6cef9455b
```

---

**`DELETE /api/events?tenant_id=X&before=DATE`** — Purge old events

```bash
curl -X DELETE "https://webhook-hub.noahpilkington98.workers.dev/api/events?tenant_id=acme_corp&before=2026-01-01"
```

---

**`GET /api/health`** — System health

```bash
curl https://webhook-hub.noahpilkington98.workers.dev/api/health
```

Response:
```json
{
  "status": "healthy",
  "db": "connected",
  "retry_queue_depth": 0,
  "error_rate_last_hour": 0,
  "providers": ["hubspot", "shopify", "linear", "intercom", "gusto"],
  "timestamp": "2026-04-14T12:00:00.000Z"
}
```

---

**`GET /api/retries?tenant_id=X`** — View retry queue

**`GET /api/dead-letter?tenant_id=X`** — View dead letter queue

---

### Webhook Simulator (One More Thing)

Built-in webhook simulator for live demos and testing — no real provider accounts needed.

**`GET /api/simulate`** — List available providers and usage

**`POST /api/simulate/:provider/:tenant_id`** — Generate and process a simulated webhook

**`POST /api/simulate/:provider/:tenant_id?count=N`** — Burst mode (max 50)

```bash
# Simulate a single HubSpot webhook
curl -X POST https://webhook-hub.noahpilkington98.workers.dev/api/simulate/hubspot/demo_tenant

# Simulate 10 Shopify webhooks
curl -X POST "https://webhook-hub.noahpilkington98.workers.dev/api/simulate/shopify/demo_tenant?count=10"

# Populate the dashboard with events from all providers
for p in hubspot shopify linear intercom gusto; do
  curl -X POST "https://webhook-hub.noahpilkington98.workers.dev/api/simulate/$p/demo_tenant?count=5"
done
```

Response:
```json
{
  "status": "simulated",
  "provider": "hubspot",
  "tenant_id": "demo_tenant",
  "count": 1,
  "events": [
    { "status": "accepted", "event_id": "evt_b6ba42ed2e7847ec", "event_type": "company.created" }
  ]
}
```

Simulated events go through the **real pipeline** — normalization, D1 storage, dedup, dashboard visibility. Open the dashboard and fire simulated webhooks to watch events flow in live.

---

### Dashboard

**`GET /dashboard`** — Monitoring dashboard

Open in a browser: `https://webhook-hub.noahpilkington98.workers.dev/dashboard?tenant_id=acme_corp`

- Events per provider bar chart
- Error rate, retry queue depth, dead letter count
- Recent events and failures tables
- Auto-refreshes every 30 seconds

---

## Project Structure

```
src/
  index.ts          — Hono app, routes, request handling
  types.ts          — NormalizedEvent + WebhookProvider interface
  utils.ts          — HMAC, timing-safe compare, ID generation
  retry.ts          — Retry engine with exponential backoff
  simulator.ts      — Webhook simulator for demos and testing
  dashboard.ts      — HTML dashboard template
  db/
    schema.sql      — D1 schema (events, retry_queue, dead_letter)
  providers/
    registry.ts     — Provider registry (Map-based lookup)
    hubspot.ts      — HubSpot normalizer
    shopify.ts      — Shopify normalizer
    linear.ts       — Linear normalizer
    intercom.ts     — Intercom normalizer
    gusto.ts        — Gusto normalizer
    salesforce.ts   — Salesforce normalizer
    pagerduty.ts    — PagerDuty normalizer
    zendesk.ts      — Zendesk normalizer
test/
  webhook-hub.test.ts — 18 tests covering all spec requirements
```

---

## Test Suite

```bash
npm test
```

18 tests covering:
1. Each provider receives and normalizes correctly (5 tests)
2. Signature validation — valid accepted, invalid rejected (2 tests)
3. Idempotency — duplicate delivery produces one record (1 test)
4. Tenant isolation — tenant A can't see tenant B's data (1 test)
5. Retry queue — failed events queued with backoff (1 test)
6. Dead letter — max retries exhausted moves to dead letter (1 test)
7. Replay — re-processes from raw payload (1 test)
8. Pagination — 100 events with limit=10 returns cursor (1 test)
9. Stats — correct counts after ingestion (1 test)
10. Health — returns system status with all providers (1 test)
11. Edge cases — unknown provider, invalid JSON (2 tests)
12. Provider registry — all 5 registered (1 test)
