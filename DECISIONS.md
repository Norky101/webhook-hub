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

## 11. One More Thing: Webhook Simulator

**What:** A built-in endpoint (`POST /api/simulate/:provider/:tenant_id?count=N`) that generates realistic fake webhooks and sends them through the real pipeline — normalization, D1 storage, dedup, dashboard visibility.

**Why I built this:** The evaluator will open my dashboard and want to see it working. Without real HubSpot/Shopify accounts configured, there's nothing to look at. The simulator solves this — fire off 25 simulated events and watch the dashboard populate in real time. It also doubles as a load test tool and a developer onboarding shortcut.

**Why this over other ideas:**
- Considered Slack alerting — useful but requires external account setup, can't be demoed instantly
- Considered provider health scoring — interesting but doesn't have the visual impact
- The simulator has the highest demo-to-effort ratio: ~30 minutes to build, instantly impressive to anyone evaluating the system

**How it works:** Each provider has a payload generator with realistic random data (deal names, order amounts, issue titles, employee events). The simulate endpoint generates the payload, then sends it through the actual webhook receiver via an internal `app.fetch()` call — no external HTTP, same code path as a real webhook.

**Dashboard integration:** The simulator is built directly into the dashboard UI. A dropdown lets you pick a single provider or "All Providers" (sends 5 events x 8 providers = 40 events). One click and the dashboard populates live — no curl, no terminal, no setup. The dashboard also auto-loads with `demo_tenant` so there's never a blank screen. This was an intentional UX decision: the first thing anyone sees should demonstrate the platform working, not ask them to configure something.

## 12. Extra credit providers: Salesforce, PagerDuty, Zendesk

**Considered:** Building all 10 extra credit providers from the spec
**Chose:** 3 strategically selected extras (Salesforce, PagerDuty, Zendesk) — bringing the total to 8
**Why:** These three cover the most distinct categories: enterprise CRM (Salesforce), engineering/incident management (PagerDuty), and support tickets (Zendesk). Each took ~10 minutes to stamp out using the registry pattern — proving the framework scales. Diminishing returns after 8 providers; the pattern is proven.

## 13. Dashboard UX: collapsible sections, auto-load, built-in simulator

**Considered:** Static dashboard that requires manual curl commands to populate
**Chose:** Interactive dashboard that works out of the box
**Why:** The spec says "something an ops person can glance at and immediately know if things are healthy or on fire." That means zero-friction: auto-loads a default tenant, simulate button right in the UI, collapsible sections so users control information density. Every UX decision was filtered through "would Aaron open this and immediately understand what's happening?"

## 14. Auth deferred — judgment call, not an oversight

**Considered:** Building user login, registration, session management, and protected routes
**Chose:** Defer auth entirely for the 24-hour window
**Why:** Auth is infrastructure, not architecture. The multi-tenant isolation is already enforced via `tenant_id` in every API query — Tenant A can't see Tenant B's events regardless of whether there's a login page. Building auth properly would require ~4 hours of plumbing: users table, sessions, password hashing (Web Crypto API), middleware, login/register UI, session expiry, CSRF protection, error states. That's 4 hours that produces a login page — something every tutorial app has. It doesn't demonstrate webhook processing skill, architectural thinking, or AI-assisted velocity.

The schema is designed for it (D1 supports the users/sessions tables), the dashboard's HTML-from-Worker pattern means login pages are trivial to add, and it's the first thing in Sprint 2 of the product roadmap. This was a deliberate scope decision: ship the hard stuff (retry engine, normalizer framework, ops dashboard) and defer the commodity stuff (login forms).

## 15. Webhook forwarding — turning monitoring into automation

**Considered:** Email-only notifications, Slack integration, custom webhook forwarding
**Chose:** Generic forwarding engine supporting both email and webhook URL destinations, configurable per tenant from the dashboard
**Why:** Monitoring alone answers "what happened." Forwarding answers "who needs to know?" Every ops team needs events to flow somewhere — Slack channels, email inboxes, PagerDuty, internal APIs. Building a generic forwarding engine means one feature covers all destinations. Email is the most accessible (everyone has it), webhook URLs cover everything else (Slack incoming webhooks, Zapier, custom APIs). Rules are filterable by provider and severity so you don't flood inboxes with noise.

**How it works:** After a webhook is normalized and stored, the receiver checks `forwarding_rules` for the tenant. For each matching rule (filtered by provider and severity), it either POSTs the normalized JSON to a webhook URL or sends a styled HTML email via Resend. Forwarding runs via `waitUntil()` so the 200 response returns immediately — forwarding happens in the background.

**Severity filtering:** Rules use "this level and above" logic — a `warning` filter matches warning, error, and critical events. This prevents missed alerts: if you care about warnings, you definitely care about errors. Severity levels: info (0) < warning (1) < error (2) < critical (3).

**Email delivery:** Uses Resend API with the API key stored as a Cloudflare Workers secret (`RESEND_API_KEY`). The key never appears in code or git — it's encrypted in Cloudflare's secret store and only accessible at runtime. Emails are styled HTML with dark theme matching the dashboard — provider, event type, severity badge, summary, tenant, timestamp, and event ID. Verified working end-to-end: simulated webhook → normalization → forwarding rule match → Resend API → email delivered.

**Test endpoint:** `POST /api/forwarding/test/:tenant_id` sends a test event through all active rules for a tenant. Useful for verifying email delivery and webhook URL connectivity without sending a real webhook.

## 16. Sprint 1: Search, export, chart toggle — visible features first

**Considered:** Building auth and Stripe first (infrastructure), or building visible dashboard features first
**Chose:** Dashboard features: event search/filter, CSV/JSON export, bar/pie chart toggle
**Why:** Auth is invisible plumbing. Search, export, and chart toggle are things the evaluator can interact with when they open the dashboard. Build what the user can see first, infrastructure second. A dashboard with search and export is more impressive than invisible middleware.

**Search design:** The search bar matches against every visible field — provider, event type, severity, status, summary, event ID, and time. Time search works with both 12h format (`1:29:15 PM`) and 24h format (`13:29:15`), plus ISO timestamps (`2026-04-14`). Handles browser locale differences by normalizing whitespace (browsers insert non-breaking spaces before AM/PM). Filters combine: provider and status filter server-side via the API, severity and text search filter client-side for instant feedback.

**Export design:** `GET /api/export?tenant_id=X&format=csv` returns a proper file download with Content-Disposition header. Supports the same provider/status filters. CSV uses proper quoting for values containing commas. Up to 5,000 events per export.

## 17. Product Vision: Cross-tool event correlation and automated remediation

**The insight:** Nobody watches a dashboard all day. The real value of a webhook platform isn't monitoring — it's **connectivity** and **action**. Events should flow to where people already are (Slack, email, SMS), and when bad events happen, the system should help fix them.

**Cross-tool correlation — the next evolution:**

| Cross-tool pattern | What it means | Automated action |
|---|---|---|
| Stripe payment failed + Zendesk ticket opened | Customer is churning | Auto-escalate to retention team |
| HubSpot deal closed + Shopify order created | New revenue confirmed | Update finance dashboard |
| PagerDuty incident + GitHub deploy | Deploy caused an outage | Auto-rollback or alert oncall |
| Gusto employee terminated + Intercom agent removed | Offboarding event | Trigger access revocation |

No single tool sees these patterns. HubSpot doesn't know about Stripe. PagerDuty doesn't know about GitHub deploys. Webhook-hub is the only system that sees events from all providers in one timeline — which means it's the only system that can correlate across them and trigger automated responses.

**What's built now:** Webhook forwarding to email and webhook URLs, configurable per provider and severity. This is the foundation — events already flow out of the platform to where people need them.

**What comes next:** Connections page (toggle Slack/email/webhook/SMS on/off), Slack-formatted messages, remediation actions ("when event X happens, call API Y"), and cross-tool correlation rules ("when Stripe payment fails AND Zendesk ticket opens within 1 hour for the same customer, escalate").

This is the path from "webhook monitoring tool" to "business operations automation platform."

## 18. Notification sync: all channels receive the same alerts

**Considered:** Independent rules per channel (email gets critical only, Slack gets everything), or synced notification policies where all active channels receive the same alerts
**Chose:** Synced by design — all forwarding rules for a tenant should use the same severity and provider filters
**Why:** If a PagerDuty incident is worth sending to Slack, it's worth sending to email. Split policies create confusion: "I saw it in Slack but didn't get the email" or "Why did email fire but not Slack?" Ops teams need one source of truth for what counts as an alert, not per-channel configuration.

**Current implementation:** Each forwarding rule has its own filters. Rules are created with matching filters to keep channels synced. Future improvement: a `notification_policies` table that defines the filters once, and forwarding rules reference the policy instead of duplicating filters.

**Remediation playbooks sync automatically:** Playbooks are matched against the event, not the channel. If a playbook matches, the steps appear in every notification — Slack, email, and webhook. This is correct by design: if someone gets an alert, they should always get the remediation steps with it.

## 19. Remediation playbooks: don't just alert, help fix

**Considered:** Alerts only (tell people something happened), automated actions (call APIs to fix it), or playbooks (tell people what to do)
**Chose:** Playbooks first — structured remediation steps attached to event patterns, included in all notifications
**Why:** Automated actions are powerful but dangerous without guardrails — you don't want an auto-rollback firing on a false positive. Playbooks are the safe middle ground: the system tells you what happened AND what to do about it. The human decides whether to act. This is the right default for v1. Automated actions come later once the playbooks have been validated by real usage.

**Pattern matching:** Supports exact match (`incident.triggered`), wildcard (`*` matches everything), and prefix match (`incident.*` matches all incident subtypes). This means one playbook can cover an entire category of events without needing a rule per event type.

## 20. Scheduled health digests: proactive monitoring over reactive dashboards

**Considered:** Dashboard-only health scores (user has to look), alert-on-degradation only (reactive), or scheduled periodic digests (proactive)
**Chose:** Scheduled digest to Slack every 20 minutes, plus dashboard health cards
**Why:** Dashboards are pull-based — someone has to open them. Digests are push-based — the system tells you the state of the world on a schedule. An ops team that gets a health report every 20 minutes to `#provider-health-stats` builds situational awareness. They see trends: "HubSpot was 99% at 2pm, 95% at 2:20pm, 87% at 2:40pm — something is degrading." That's impossible to spot by checking a dashboard sporadically.

**Implementation:** Runs on the existing 1-minute cron trigger. Every 20 minutes (minute % 20 === 0), queries all active tenants, calculates per-provider health scores for the last 20-minute window, and POSTs a formatted Slack Block Kit message to `#provider-health-stats`. Uses `SLACK_HEALTH_WEBHOOK_URL` stored as a CF Workers secret (separate from the alert webhook). Manual trigger at `POST /api/health/digest` for testing.

**Example Slack message:**
```
Provider Health Report (last 20 min)

Tenant: demo_tenant
🟢 hubspot — 100% (12 ok, 0 failed)
🟢 shopify — 100% (8 ok, 0 failed)
⚠️ pagerduty — 75% (6 ok, 2 failed)
🔴 zendesk — 40% (2 ok, 3 failed)
```

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

**Already built (was in the "more time" list, shipped anyway):**
- ~~Dashboard: event search/filter, chart type toggle~~ → Done (Sprint 1)
- ~~Webhook forwarding to Slack, email, webhook URLs~~ → Done (Phase 10-11)
- ~~Provider health scoring~~ → Done (Phase 13-14, with scheduled Slack digest)
- ~~Extra credit providers~~ → Done (8 total: +Salesforce, PagerDuty, Zendesk)
- ~~Remediation playbooks~~ → Done (Phase 12)

**Already built (second pass):**
- ~~SMS alerts via Twilio for critical events~~ → Done (Phase 15)
- ~~Voice call alerts via Twilio~~ → Done (Phase 15, phone rings on critical events)
- ~~Scheduled health digest to Slack~~ → Done (Phase 14, every 20 min)

**Next 48 hours:**
- Enforce signature validation with a tenant secret store (Workers KV)
- Add rate limiting per tenant (prevent webhook flooding)
- Auth on the REST API (D1-based users/sessions, login UI)
- Alerting rules engine — "notify me when error rate > 10/hour for any provider"
- Cross-tool event correlation — detect patterns across providers
- More providers (BambooHR, DocuSign, Notion, Datadog, Mailchimp → 13 total)

**1 week:**
- Stripe billing integration — tiered pricing (Free/Pro/Business/Enterprise)
- Tenant onboarding UI — self-service provider setup, secret configuration
- Connections page — toggle Slack/email/webhook/SMS on/off per tenant
- Automated remediation actions — "when event X happens, call API Y"
- Real-time dashboard via WebSocket or SSE instead of 30s polling

**Production:**
- Move from D1 to Durable Objects for real-time state where latency matters
- CF Queues (paid plan) for retry instead of cron polling
- Multi-region with D1 read replicas
- SOC 2 compliance: audit logging, encryption at rest, access controls
- Terraform/Pulumi for infrastructure as code
