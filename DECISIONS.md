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

## 14. Sprint 1: Search, export, chart toggle — visible features first

**Considered:** Building auth and Stripe first (infrastructure), or building visible dashboard features first
**Chose:** Dashboard features: event search/filter, CSV/JSON export, bar/pie chart toggle
**Why:** Auth is invisible plumbing. Search, export, and chart toggle are things the evaluator can interact with when they open the dashboard. Build what the user can s
ee first, infrastructure second. A dashboard with search and export is more impressive than invisible middleware.

**Search design:** The search bar matches against every visible field — provider, event type, severity, status, summary, event ID, and time. Time search works with both 12h format (`1:29:15 PM`) and 24h format (`13:29:15`), plus ISO timestamps (`2026-04-14`). Handles browser locale differences by normalizing whitespace (browsers insert non-breaking spaces before AM/PM). Filters combine: provider and status filter server-side via the API, severity and text search filter client-side for instant feedback.

**Export design:** `GET /api/export?tenant_id=X&format=csv` returns a proper file download with Content-Disposition header. Supports the same provider/status filters. CSV uses proper quoting for values containing commas. Up to 5,000 events per export.

## 15. Webhook forwarding — turning monitoring into automation

**Considered:** Email-only notifications, Slack-only integration, or a generic forwarding engine
**Chose:** One forwarding engine supporting 5 channels: email (Resend), Slack (Block Kit), SMS (Twilio), voice call (Twilio), webhook URL
**Why:** Monitoring alone answers "what happened." Forwarding answers "who needs to know?" Building a generic engine with destination types means one architecture covers every channel. The forwarding rules table doesn't care about the destination type; the engine dispatches based on it.

## 16. SMS and voice call alerts via Twilio — severity demands urgency

**Considered:** Email and Slack only, third-party alerting service (PagerDuty/OpsGenie), or building SMS/call directly with Twilio
**Chose:** Twilio SMS + voice call as forwarding destinations, integrated into the same forwarding engine
**Why:** Email sits in an inbox. Slack gets buried in channels. When a production database goes down at 3am, you need a phone ringing on someone's nightstand. SMS and voice calls are the only channels that reliably wake people up.

**SMS:** Sends a concise text message — event severity, provider, event type, summary, plus the first 3 remediation steps from any matching playbook. Designed to be actionable from a phone screen without opening a laptop.

**Voice call:** Phone rings. An AI voice (Twilio TwiML) reads the alert summary twice — once to wake you up, once so you can actually process it. Then directs you to the dashboard for details.

**Channel escalation ladder:**

| Severity | Channels | Why |
|---|---|---|
| Info | Email, Slack | Low urgency. Review when convenient. |
| Warning | Slack, Email | Needs attention today. |
| Error | Slack, SMS, Email | Needs attention now. SMS reaches people away from their desk. |
| Critical | Voice call, SMS, Slack, Email | Wake someone up. Phone rings. Cannot be ignored. |

**Why Twilio over PagerDuty/OpsGenie:** Twilio is a raw API — we control the message format, delivery logic, and escalation. And webhook-hub already receives PagerDuty webhooks as a provider, so using PagerDuty for alerting would be circular.

**Credentials:** All stored as Cloudflare Workers secrets. Never in code, never in git.

## 17. Notification sync: all channels receive the same alerts

**Considered:** Independent rules per channel (email gets critical only, Slack gets everything)
**Chose:** All forwarding rules use the same severity and provider filters
**Why:** If a PagerDuty incident is worth sending to Slack, it's worth sending to email and SMS. Split policies create confusion. Ops teams need one source of truth for what counts as an alert.

## 18. Remediation playbooks over automated actions

**Considered:** Alerts only, automated API calls, or human-readable playbooks
**Chose:** Playbooks first — structured remediation steps attached to event patterns, included in all notifications
**Why:** Automated actions are powerful but dangerous without guardrails — you don't want an auto-rollback firing on a false positive. Playbooks are the safe middle ground: the system tells you what happened AND what to do about it. The human decides whether to act.

## 19. Scheduled health digests: push over pull

**Considered:** Dashboard-only health scores (pull), alert-on-degradation only (reactive), scheduled digests (proactive)
**Chose:** Scheduled digest to Slack every 20 minutes + dashboard health cards
**Why:** Dashboards are pull-based — someone has to open them. Digests are push-based. An ops team that gets a health report every 20 minutes sees trends: "HubSpot was 99% at 2pm, 87% at 2:40pm — something is degrading." That's impossible to spot by checking a dashboard sporadically.

## 20. Cross-tool correlation as the product vision

**The insight:** No single tool sees patterns across providers. Webhook-hub is the only system that sees events from all providers in one timeline — which means it's the only system that can correlate across them.

| Cross-tool pattern | What it means | Action |
|---|---|---|
| Stripe payment failed + Zendesk ticket opened | Customer is churning | Auto-escalate to retention team |
| HubSpot deal closed + Shopify order created | New revenue confirmed | Update finance dashboard |
| PagerDuty incident + GitHub deploy | Deploy caused an outage | Auto-rollback or alert oncall |
| Gusto employee terminated + Intercom agent removed | Offboarding event | Trigger access revocation |

This is the path from "webhook monitoring tool" to "business operations automation platform."

### 21. Connections page: one place to manage everything

**Considered:** Managing forwarding rules, correlation rules, and playbooks all from the dashboard, or a separate dedicated page
**Chose:** Dedicated `/connections` page linked from the dashboard header
**Why:** The dashboard is for monitoring — glancing at health, events, failures. Managing integrations is a different task: adding Slack channels, setting up correlation rules, configuring playbooks. Mixing both on one page creates clutter. A separate page means the dashboard stays clean for ops, and connections is where you go to configure. Both link to each other.

**What it shows:** Every forwarding channel (email, Slack, SMS, voice call, webhook URL) as a card with active/inactive status, severity filter, and rule name (not raw URLs — human-readable labels like "Slack alerts #webhook-alerts"). Plus the health digest Slack channel (configured via Worker secret, shown as a system channel). Below that: correlation rules and remediation playbooks with delete buttons.

### 22. 11 providers: Stripe, Datadog, GitHub complete the coverage

**Considered:** Stopping at 8 (already proved the framework), or pushing to double digits
**Chose:** Added Stripe (revenue events), Datadog (infrastructure monitoring), GitHub (development lifecycle) — bringing total to 11
**Why:** These three fill the most important gaps. Stripe is the #1 webhook integration for any SaaS — payment.failed, subscription.cancelled, invoice.paid are the events that directly map to revenue. Datadog covers infrastructure alerting (monitor triggered/recovered). GitHub covers the development pipeline (PR merged, deploy succeeded/failed). Together with the original 8, the platform now covers CRM, e-commerce, project management, support, HR, engineering, finance, and development. Each took ~10 minutes — the framework pattern continues to prove itself.

### 23. Alerting rules engine: the platform watches so you don't have to

**Considered:** Dashboard-only monitoring (pull), event-triggered alerts only (reactive), or threshold-based alerting (proactive)
**Chose:** Metric-based alerting rules evaluated on cron, with cooldown to prevent alert fatigue
**Why:** Forwarding rules react to individual events. Correlation rules detect cross-tool patterns. Alerting rules detect trends — "error rate has been climbing for 15 minutes." This is the intelligence layer. An ops person sets thresholds once and the platform watches continuously.

**Supported metrics:**
- `error_rate` — % of failed events for a provider over a time window
- `failed_count` — absolute count of failures
- `retry_queue_depth` — how backed up is the retry queue
- `dead_letter_count` — how many events have been permanently abandoned
- `event_volume` — total events (spike/drop detection)

**Cooldown:** After an alert fires, it won't re-trigger for the same rule until the window expires. This prevents "alert every minute" fatigue while the team is already working the issue.

**Evaluated every 5 minutes** on the existing cron trigger. Alert events are stored in the events table (visible on dashboard) and forwarded through all channels (Slack, email, SMS, voice call).

### 24. Event detail modal: inspect, understand, act

**Considered:** Separate event detail page, inline expand, or modal overlay
**Chose:** Modal overlay — click any event row to see full detail without leaving the dashboard
**Why:** A separate page breaks flow — you leave the dashboard, lose context, have to navigate back. Inline expand clutters the table. A modal keeps you on the dashboard while showing everything: all metadata, full raw JSON payload, matching remediation playbooks, and a replay button. Click outside or press Escape to close. The ops workflow is: glance at dashboard → spot anomaly → click for detail → act (replay or follow remediation steps) → close → continue monitoring. No page navigation, no context switching.

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

## What's Next

**Next 48 hours:**
- Enforce signature validation with a tenant secret store (Workers KV)
- Rate limiting per tenant
- Auth + login UI (D1-based)
- Alerting rules engine — "notify when error rate > X"
- More providers (BambooHR, DocuSign, Notion, Mailchimp)

**Production:**
- Stripe billing (tiered pricing: Free/Pro/Business/Enterprise)
- Automated remediation actions — "when event X happens, call API Y"
- Durable Objects for real-time state
- CF Queues for retry instead of cron
- Multi-region D1 read replicas
- SOC 2 compliance
