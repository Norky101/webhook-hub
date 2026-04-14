# Deployment Log

How I built webhook-hub in 24 hours using Claude Code as my primary development tool.

---

## Tool

Claude Code (CLI) — Claude Opus, max effort. Used for architecture, code generation, deployment, testing, and spec auditing. I drove prioritization, scope decisions, and deployment sequencing.

---

## Timeline

### Session 1 — Scaffold + Infra (10:00–11:00)
- Read the full eval spec, planned the build sequence
- Created Cloudflare account, D1 database, GitHub repo
- Scaffolded project: Hono + TypeScript + CF Workers
- Deployed "hello world" Worker to a live URL immediately — proving infra works before writing business logic
- **Commit:** `Phase 1: scaffold project — Hono + CF Workers + D1`

### Session 2 — Core Platform (11:00–11:15)
- Built the webhook receiver (`POST /webhooks/:provider/:tenant_id`)
- Designed the `WebhookProvider` interface + provider registry pattern
- Implemented HubSpot as the first normalizer (signature validation, event mapping, delivery ID extraction)
- Created D1 schema: events, retry_queue, dead_letter tables with indexes
- Built the full REST API: list, detail, stats, replay, purge, health endpoints
- Added shared utilities: HMAC-SHA256, timing-safe compare, ID generation
- Deployed and verified the live URL accepts real webhooks
- **Commit:** `Phase 2: webhook receiver, HubSpot normalizer, events API, D1 schema`

### Session 3 — Stamp Out Normalizers (11:15–11:25)
- Used the registry pattern to stamp out 4 remaining normalizers in parallel:
  - Shopify (HMAC-SHA256 base64, order/product/customer events)
  - Linear (HMAC-SHA256 hex, issue/comment/project events)
  - Intercom (HMAC-SHA1, conversation/contact events)
  - Gusto (HMAC-SHA256, payroll/employee/contractor events)
- Registered all 5 in the registry — one import + one line each
- Deployed, verified all 5 providers accept webhooks on the live URL
- **Commit:** `Phase 3: add Shopify, Linear, Intercom, Gusto normalizers`

### Session 4 — Retry Engine (11:25–11:30)
- Built the retry engine: cron trigger polls retry_queue every minute
- Exponential backoff schedule: 1min, 5min, 30min, 2hr, 12hr
- Dead letter queue for events that exhaust 5 retries
- Updated webhook receiver to queue failures instead of returning 500
- Added `/api/retries` and `/api/dead-letter` endpoints for visibility
- Deployed with cron trigger active
- **Commit:** `Phase 4: retry engine with exponential backoff + dead letter queue`

### Session 5 — Tests + Dashboard (11:30–11:32)
- Wrote 18 tests covering all 15 spec requirements + 3 edge cases
- Built a lightweight mock D1 for test speed (~150ms total runtime)
- Built the monitoring dashboard: dark theme ops view served at `/dashboard`
  - Summary cards: total events, error rate, retry queue depth, dead letters
  - Provider bar chart, recent events table, recent failures table
  - Auto-refresh every 30 seconds, filterable by tenant
- Deployed and verified dashboard loads with real data
- **Commit:** `Phase 5: test suite (18 tests) + monitoring dashboard`

### Session 6 — Documentation (11:32–12:35)
- Wrote README: quick start guide, API reference with curl examples, architecture diagram, project structure
- Updated DECISIONS.md: researched evaluator (Aaron Hall / SprintMode), added founder-context section, AI workflow, "what I'd do differently" at 48h/1wk/production scale
- Added proprietary license
- Tested all edge cases against the live URL (unknown provider, invalid JSON, missing params, nonexistent events — all handled correctly)
- Sent test webhooks across all 5 providers to populate the dashboard with real data
- **Commit:** `Phase 6` through `Phase 7` + supporting commits

### Session 7 — One More Thing: Webhook Simulator (12:35–13:00)
- Built the webhook simulator: realistic payload generators for all 5 providers
- Wired `POST /api/simulate/:provider/:tenant_id?count=N` endpoint
- Sends simulated webhooks through the real pipeline (normalization, D1, dashboard)
- Tested live: single events, burst mode, all 5 providers
- Populated demo_tenant with 25 simulated events across all providers
- Updated README with simulator docs, DECISIONS.md with "One More Thing" rationale
- **Commit:** `Phase 8: webhook simulator`

### Session 8 — Dashboard UX Polish (13:00–13:15)
- Dashboard auto-loads demo_tenant by default (no blank screen on first visit)
- Added "Simulate Webhook" button directly in the dashboard UI
- Added "All Providers" option to the dropdown (sends 25 events in one click)
- Added explainer text so visitors immediately understand what they're looking at
- Improved tenant input placeholder to explain what to enter
- **Commit:** `Dashboard UX: auto-load demo tenant, simulate buttons, explainer text`

### Session 9 — Extra Credit Providers + Final Polish (13:15–)
- Added extra credit providers to prove the framework pattern scales
- End-to-end review of all docs, live URL, dashboard
- Final deployment log update

---

## Process Notes

- **Deployed after every phase.** At no point was `main` broken or the live URL stale. The evaluator could have tested at any commit.
- **Breadth first, then depth.** Got all core features working before polishing any single one. The spec rewards completion over perfection.
- **Claude generated, I steered.** Claude wrote the normalizer files, test suite, and dashboard. I made the architecture decisions, set the build order, and enforced the "deploy early, deploy often" cadence.
- **Spec-driven development.** Used Claude to audit the eval spec against the codebase after each phase, catching gaps before they became problems.

---

## Sessions with Claude

- **Total sessions:** 2 (1 initial scaffold session, 1 long build session)
- **Primary tool:** Claude Code CLI (Opus, max effort)
- **Workflow:** Feed spec → plan phase → build → deploy → verify live → commit → next phase
