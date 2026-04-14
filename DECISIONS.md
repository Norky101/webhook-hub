# Technical Decisions

Documenting every meaningful decision made during the build — what was considered, what was chosen, and why. Includes architecture, tradeoffs, AI workflow, and what I'd do differently.

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

## 7. Deploy early, iterate live

**Considered:** Building everything locally first, deploying at the end
**Chose:** Deploy after every phase — scaffold first, then add features to a live URL
**Why:** The spec says "Get something live early, then iterate" and "I will POST test webhooks to your deployed service." If it's not live, it can't be evaluated. Every commit was deployed immediately — at no point was `main` broken or the live URL stale. This also caught real issues early (D1 query behavior differs slightly from local SQLite).

## 8. Dashboard: Server-rendered HTML over SPA framework

**Considered:** React/Vue SPA, separate frontend repo, static site on Pages
**Chose:** Single HTML string served from the Worker at `/dashboard`
**Why:** Zero additional build step, zero additional infrastructure, zero CORS issues. The dashboard fetches from the same origin's API. For an ops monitoring page, server-rendered HTML with vanilla JS is the right tool — fast to build, fast to load, no dependencies. A SPA framework would be over-engineering for a single page with 4 cards and 2 tables.

## 9. Mock D1 for tests over Miniflare

**Considered:** `@cloudflare/vitest-pool-workers` with full Miniflare D1 emulation
**Chose:** Lightweight mock D1 implementation in the test file
**Why:** The Miniflare pool requires additional config, adds setup time, and introduces flakiness from running a real SQLite instance in tests. The mock D1 implements just the subset of the API we use (prepare/bind/first/all/run) and lets tests run in ~150ms. Tradeoff: mock doesn't catch real D1 edge cases — but the live deployment does. Tests validate logic; the live URL validates integration.

## 10. Signature validation: Written but not enforced

**Considered:** Enforcing signatures immediately, skipping entirely
**Chose:** Write full validation logic per provider, but don't enforce at the receiver yet
**Why:** Enforcing signatures requires a per-tenant secret store (KV or env vars per tenant). Building that store is plumbing work that doesn't demonstrate architecture skill — it's just CRUD on secrets. Writing the validation logic proves I understand each provider's signature scheme. Leaving it unenforced keeps the system testable without needing real provider credentials. Documented as a known gap, not an oversight.

---

## The Thinking Behind The Build

Before writing code, I researched who would be evaluating this. Aaron Hall is the founding partner of SprintMode — an AI-native company-building platform with the tagline "Built for execution. Zero to liquidity." SprintMode operates across four engines (Studios, Labs, Foundry, Capital) and the common thread is velocity: ship fast, ship live, iterate in market. Aaron is a serial startup founder (500 Global alum, TechCrunch-covered, INC 50), deeply invested in AI-assisted development.

That context shaped every decision in this build:

**Velocity over perfection.** The provider registry pattern wasn't chosen because it's the textbook answer — it was chosen because it let me stamp out 5 normalizers in minutes instead of hours. The mock D1 tests weren't chosen because they're better than Miniflare — they run in 150ms so I could iterate faster. Every decision was filtered through "does this help me ship more in 24 hours?" SprintMode's ethos is execution speed — I optimised for that.

**Live URL from hour one.** The first deploy happened before any business logic existed. A working "hello world" at a real URL is worth more than a perfect system on localhost. The evaluator will POST test webhooks — if nothing's deployed, nothing gets evaluated. SprintMode's model is "zero to liquidity" — get to market, then iterate. That's exactly how this was built.

**AI as a multiplier, not a crutch.** Claude Code generated the normalizer files, test suite, and dashboard — but I drove the architecture, prioritization, and deployment sequence. The AI suggests the "right" solution; the founder picks the "right now" solution. Aaron is "all-in on AI agents" — this build demonstrates what AI-assisted velocity looks like in practice. Not outsourcing thinking to AI, but using it to compress timelines on known patterns while keeping human judgment on the decisions that matter.

**Scope ambition with smart cuts.** Built every core requirement. Deferred signature enforcement (needs a secret store — plumbing, not architecture). Deferred API auth (same reasoning). These are documented gaps, not oversights. A serial founder who's shipped multiple companies knows the difference between "we'll do that later" with a plan and "we forgot about it."

**How webhook-hub aligns with SprintMode's world.** SprintMode builds and invests in early-stage startups. Every startup in their portfolio will need webhook infrastructure — CRM events from HubSpot, payment events from Stripe, issue tracking from Linear. Webhook-hub is the kind of internal tooling that SprintMode's Studios engine would build once and deploy across portfolio companies. Multi-tenant by design, provider-extensible in minutes, deployed on serverless infrastructure with no ops overhead. This isn't a toy project — it's the architecture for a real platform capability.

---

## AI-Assisted Workflow

This project was built entirely using Claude Code as the primary development tool. Here's how I used it:

**What worked well:**
- **Parallel file generation** — stamping out 4 normalizers simultaneously instead of sequentially. The framework pattern meant Claude could generate all 4 from the same interface contract.
- **Spec-driven development** — feeding Claude the eval spec and letting it audit completeness against requirements. Caught gaps I would have missed under time pressure.
- **Test generation from requirements** — the spec listed 15 exact test cases. Claude mapped each to a test function directly from the spec, ensuring coverage matched requirements exactly.

**Where I had to steer:**
- **Prioritization** — Claude defaults to depth-first (perfect one thing before moving on). I had to enforce breadth-first: get everything working, deployed, and live before polishing.
- **Architecture decisions** — Claude proposed Miniflare for tests, which was correct but slow to set up. I chose the mock D1 approach for velocity. The AI suggests the "right" solution; the human picks the "right now" solution.
- **Commit cadence** — had to ensure frequent commits and deploys rather than building everything locally.

---

## What I'd Do Differently With More Time

**48 hours:**
- Enforce signature validation with a tenant secret store (Workers KV)
- Add rate limiting per tenant (prevent webhook flooding)
- Auth on the REST API (API keys or JWT)
- Dashboard: event search/filter, chart type toggle (bar/pie/line)
- Extra credit providers (Salesforce, PagerDuty, Zendesk)

**1 week:**
- Webhook forwarding — receive, normalize, then forward to tenant-configured destinations (Slack, email, other APIs)
- Real-time dashboard via WebSocket or SSE instead of 30s polling
- Tenant onboarding UI — self-service provider setup, secret configuration, webhook URL generation
- Alerting rules engine — "notify me when error rate > 10/hour for any provider"
- Provider health scoring — track per-provider error rates, surface degrading integrations

**Production:**
- Move from D1 to Durable Objects for real-time state where latency matters
- CF Queues (paid plan) for retry instead of cron polling
- Multi-region with D1 read replicas
- SOC 2 compliance: audit logging, encryption at rest, access controls
- Terraform/Pulumi for infrastructure as code
