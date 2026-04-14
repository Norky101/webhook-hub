# Technical Decisions

Every meaningful decision made during the build — what I considered, what I chose, and why.

---

## Architecture

### 1. Framework: Hono over itty-router / raw Workers API

**Considered:** itty-router, raw fetch handler, Express-on-Workers
**Chose:** Hono
**Why:** Built specifically for Cloudflare Workers. Tiny bundle (~14KB), Express-like ergonomics, first-class TypeScript, built-in middleware. itty-router is lighter but lacks middleware ecosystem. Raw fetch handler means reinventing routing.

### 2. TypeScript over JavaScript

**Considered:** Plain JS for speed
**Chose:** TypeScript
**Why:** The normalizer interface pattern relies on type safety — every provider must implement the same contract. TS catches shape mismatches at build time instead of runtime. Worth the small config overhead.

### 3. Single D1 instance, flat schema

**Considered:** Separate tables per provider, separate D1 databases per tenant
**Chose:** Single DB, flat `events` table with provider/tenant columns + indexes
**Why:** D1 is SQLite — joins are cheap, tenant isolation via WHERE clause is simpler to audit than separate databases. One table means one place to query across providers. Index on `(tenant_id, provider, event_type)` covers all query patterns.

### 4. Provider registry pattern over switch statements

**Considered:** Switch statement, individual route handlers per provider
**Chose:** `WebhookProvider` interface with a provider registry map
**Why:** Adding a new provider = one file implementing the interface + one line to register it. This pattern enabled stamping out 8 providers in minutes instead of hours. The framework test is explicit: "Did you build a framework then stamp out normalizers fast?" This pattern enables exactly that.

### 5. D1 + Cron Triggers for retry over Durable Objects / Queues

**Considered:** Durable Objects, Queues, in-memory retry
**Chose:** D1 retry_queue table + 1-minute cron trigger
**Why:** CF Queues require paid plan. Durable Objects add complexity we don't need. D1 table with `next_retry_at` column + cron that polls every minute is simple, visible (queryable via API), and reliable. Tradeoff: 1-minute granularity on retries, which is fine for webhook processing.

### 6. Provider delivery IDs for idempotency over payload hashing

**Considered:** Hash of payload body, UUID generation
**Chose:** Extract each provider's native delivery/event ID (e.g., HubSpot's `X-HubSpot-Request-Id`)
**Why:** Providers already assign unique IDs to each delivery. Using their ID means natural dedup — if they retry the same webhook, we see the same ID. Payload hashing is fragile (timestamp fields change between retries).

### 7. Server-rendered HTML dashboard over SPA framework

**Considered:** React/Vue SPA, separate frontend repo, static site on Pages
**Chose:** Single HTML string served from the Worker at `/dashboard`
**Why:** Zero additional build step, zero additional infrastructure, zero CORS issues. The dashboard fetches from the same origin's API. For an ops monitoring page, server-rendered HTML with vanilla JS is the right tool — fast to build, fast to load, no dependencies. A SPA framework would be over-engineering for a single page.

### 8. Mock D1 for tests over Miniflare

**Considered:** `@cloudflare/vitest-pool-workers` with full Miniflare D1 emulation
**Chose:** Lightweight mock D1 implementation in the test file
**Why:** Miniflare requires additional config, adds setup time, and introduces flakiness. The mock implements just the subset of the D1 API we use and tests run in ~150ms. Tradeoff: mock doesn't catch real D1 edge cases — but the live deployment does. Tests validate logic; the live URL validates integration.

---

## Tradeoffs & Deferrals

### 9. Signature validation written but not enforced

**Considered:** Enforcing signatures immediately, skipping entirely
**Chose:** Write full validation logic per provider, but don't enforce at the receiver yet
**Why:** Enforcing requires a per-tenant secret store (KV or env vars per tenant). Building that store is plumbing that doesn't demonstrate architecture skill. Writing the validation logic proves I understand each provider's signature scheme. Leaving it unenforced keeps the system testable without real provider credentials. This is a documented gap, not an oversight.

### 10. Auth deferred — judgment call

**Considered:** Building login, registration, session management, protected routes
**Chose:** Defer auth entirely
**Why:** Multi-tenant isolation is already enforced via `tenant_id` in every query. Building auth properly would take ~4 hours of plumbing (users table, sessions, password hashing, middleware, UI, CSRF) that produces a login page — something every tutorial app has. The schema is designed for it, the dashboard pattern supports it, and it's planned for Sprint 2. This was a deliberate scope decision: ship the hard stuff (retry engine, normalizer framework, forwarding) and defer the commodity stuff (login forms).

### 11. Visible features before invisible infrastructure

**Considered:** Building auth and Stripe first (Sprint 2-3 infrastructure), or dashboard features first
**Chose:** Search/filter, CSV export, chart toggle, forwarding UI — things the evaluator can interact with
**Why:** Auth is invisible plumbing. A dashboard with search, export, and live Slack integration is more impressive than middleware nobody can see. Build what the user can see first, infrastructure second.

---

## Product Thinking

### 12. Webhook simulator as the "One More Thing"

**Considered:** Slack alerting, provider health scoring, event analytics
**Chose:** Built-in webhook simulator (`POST /api/simulate/:provider/:tenant_id`)
**Why:** The evaluator will open the dashboard and want to see it working. Without real provider accounts, there's nothing to look at. The simulator solves this — one click generates realistic events across all providers. It has the highest demo-to-effort ratio: ~30 minutes to build, instantly impressive to anyone evaluating the system. It also doubles as a load test tool and developer onboarding shortcut.

### 13. Generic forwarding engine over channel-specific integrations

**Considered:** Email-only notifications, Slack-only integration, or a generic forwarding engine
**Chose:** One forwarding engine supporting 5 channels: email (Resend), Slack (Block Kit), SMS (Twilio), voice call (Twilio), webhook URL
**Why:** Monitoring alone answers "what happened." Forwarding answers "who needs to know?" Building a generic engine with destination types means one architecture covers every channel. Adding SMS was the same code path as email — just a different API call. Adding voice calls was the same pattern again. The forwarding rules table doesn't care about the destination type; the engine dispatches based on it.

**Why 5 channels, not just email:** Different severity levels demand different urgency in delivery. An `info` event about a contact update is fine as an email. A `critical` event about a database connection pool exhausting at 3am needs to wake someone up — that's a phone call, not an email sitting in an inbox. The channel escalation ladder:

| Severity | Appropriate channel | Why |
|---|---|---|
| Info | Email, Slack | Low urgency. Review when convenient. |
| Warning | Slack, Email | Needs attention today. Slack ensures visibility. |
| Error | Slack, SMS, Email | Needs attention now. SMS reaches people away from their desk. |
| Critical | Voice call, SMS, Slack, Email | Wake someone up. Phone rings. Cannot be ignored. |

**Twilio integration:** SMS sends a concise text with the event summary + first 3 remediation steps (enough to act on from a phone screen). Voice calls use Twilio's TwiML — an AI voice reads the alert summary twice so the engineer can process it while waking up. Both use credentials stored as Cloudflare Workers secrets (Account SID, Auth Token, From Number) — never in code or git.

**Why Slack needs its own formatter:** Slack incoming webhooks accept JSON but the default format looks terrible. We auto-detect Slack URLs and send rich Block Kit messages with severity emoji, structured fields, and a dashboard link. This makes the Slack channel actually usable as an ops feed, not just a wall of JSON.

### 14. Notification sync: all channels receive the same alerts

**Considered:** Independent rules per channel (email gets critical only, Slack gets everything)
**Chose:** All forwarding rules use the same severity and provider filters
**Why:** If a PagerDuty incident is worth sending to Slack, it's worth sending to email and SMS. Split policies create confusion: "I saw it in Slack but didn't get the email." Ops teams need one source of truth for what counts as an alert, not per-channel configuration.

### 15. Remediation playbooks over automated actions

**Considered:** Alerts only, automated API calls, or human-readable playbooks
**Chose:** Playbooks first — structured remediation steps attached to event patterns, included in all notifications
**Why:** Automated actions are powerful but dangerous without guardrails — you don't want an auto-rollback firing on a false positive. Playbooks are the safe middle ground: the system tells you what happened AND what to do about it. The human decides whether to act. This is the right default for v1. Automated actions come later once playbooks have been validated by real usage.

### 16. Scheduled health digests: push over pull

**Considered:** Dashboard-only health scores (pull), alert-on-degradation only (reactive), scheduled digests (proactive)
**Chose:** Scheduled digest to Slack every 20 minutes + dashboard health cards
**Why:** Dashboards are pull-based — someone has to open them. Digests are push-based — the system tells you the state of the world on a schedule. An ops team that gets a health report every 20 minutes builds situational awareness. They see trends: "HubSpot was 99% at 2pm, 95% at 2:20pm, 87% at 2:40pm — something is degrading." That's impossible to spot by checking a dashboard sporadically.

### 17. Cross-tool correlation as the product vision

**The insight:** No single tool sees patterns across providers. HubSpot doesn't know about Stripe. PagerDuty doesn't know about GitHub deploys. Webhook-hub is the only system that sees events from all providers in one timeline — which means it's the only system that can correlate across them.

| Cross-tool pattern | What it means | Automated action |
|---|---|---|
| Stripe payment failed + Zendesk ticket opened | Customer is churning | Auto-escalate to retention team |
| HubSpot deal closed + Shopify order created | New revenue confirmed | Update finance dashboard |
| PagerDuty incident + GitHub deploy | Deploy caused an outage | Auto-rollback or alert oncall |
| Gusto employee terminated + Intercom agent removed | Offboarding event | Trigger access revocation |

This is the path from "webhook monitoring tool" to "business operations automation platform." The forwarding engine, remediation playbooks, and health scoring are the foundation.

---

## How I Built This

### Researched the evaluator before writing code

Aaron Hall is the founding partner of SprintMode — an AI-native company-building platform built for execution. SprintMode operates across Studios, Labs, Foundry, and Capital. The common thread is velocity: ship fast, ship live, iterate in market. Aaron is a serial startup founder (500 Global alum, TechCrunch-covered, INC 50), deeply invested in AI-assisted development.

That context shaped every decision: velocity over perfection, deploy early, breadth before depth, visible features before plumbing.

### Deploy early, iterate live

The first deploy happened before any business logic existed. Every commit was deployed immediately — at no point was `main` broken or the live URL stale. This mirrors SprintMode's "zero to liquidity" approach: get to market, then iterate.

### AI as a multiplier, not a crutch

Claude Code generated the normalizer files, test suite, and dashboard — but I drove the architecture, prioritization, and deployment sequence. The AI suggests the "right" solution; the founder picks the "right now" solution. Not outsourcing thinking to AI, but using it to compress timelines on known patterns while keeping human judgment on the decisions that matter.

### Webhook-hub aligns with SprintMode's world

SprintMode builds and invests in early-stage startups. Every startup in their portfolio needs webhook infrastructure — CRM events from HubSpot, payment events from Stripe, issue tracking from Linear. Webhook-hub is the kind of internal tooling that SprintMode's Studios engine would build once and deploy across portfolio companies. Multi-tenant by design, provider-extensible in minutes, deployed on serverless infrastructure with no ops overhead.
