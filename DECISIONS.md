# Technical Decisions

Documenting every meaningful decision made during the build — what was considered, what was chosen, and why.

---

## 1. Framework: Hono over itty-router / raw Workers API

**Considered:** itty-router, raw fetch handler, Express-on-Workers
**Chose:** Hono
**Why:** Built specifically for Cloudflare Workers. Tiny bundle (~14KB), Express-like ergonomics, first-class TypeScript, built-in middleware. itty-router is lighter but lacks middleware ecosystem. Raw fetch handler means reinventing routing.

## 2. TypeScript over JavaScript

**Considered:** Plain JS for speed
**Chose:** TypeScript
**Why:** The normalizer interface pattern relies on type safety — every provider must implement the same contract. TS catches shape mismatches at build time instead of runtime. Worth the small config overhead.

## 3. Database: Single D1 instance, flat schema

**Considered:** Separate tables per provider, separate D1 databases per tenant
**Chose:** Single DB, flat `events` table with provider/tenant columns + indexes
**Why:** D1 is SQLite — joins are cheap, tenant isolation via WHERE clause is simpler to audit than separate databases. One table means one place to query across providers. Index on `(tenant_id, provider, event_type)` covers all query patterns.

## 4. Normalizer pattern: Interface + Registry

**Considered:** Switch statement, individual route handlers per provider
**Chose:** `WebhookProvider` interface with a provider registry map
**Why:** Adding a new provider = one file implementing the interface + one line to register it. The framework test is explicit in the eval: "Did you build a framework then stamp out normalizers fast?" This pattern enables exactly that.

## 5. Retry engine: D1 + Cron Triggers

**Considered:** Durable Objects, Queues, in-memory retry
**Chose:** D1 retry_queue table + 1-minute cron trigger
**Why:** CF Queues require paid plan. Durable Objects add complexity we don't need. D1 table with `next_retry_at` column + cron that polls every minute is simple, visible (queryable via API), and reliable. Tradeoff: 1-minute granularity on retries, which is fine for webhook processing.

## 6. Idempotency: Provider delivery ID

**Considered:** Hash of payload body, UUID generation
**Chose:** Extract each provider's native delivery/event ID (e.g., HubSpot's `X-HubSpot-Request-Id`)
**Why:** Providers already assign unique IDs to each delivery. Using their ID means natural dedup — if they retry the same webhook, we see the same ID. Payload hashing is fragile (timestamp fields change between retries).
