# Deployment Log

How I built webhook-hub in 24 hours using Claude Code as my primary development tool.

---

## Tool

Claude Code (CLI) — Claude Opus, max effort. (Upgraded to the $100 subscription for this project lol) Used for architecture, code generation, deployment, testing, and spec auditing. I drove prioritization, scope decisions, and deployment sequencing.

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
- Built the webhook simulator: realistic payload generators for all 8 providers
- Wired `POST /api/simulate/:provider/:tenant_id?count=N` endpoint
- Sends simulated webhooks through the real pipeline (normalization, D1, dashboard)
- Tested live: single events, burst mode, all providers
- **Commit:** `Phase 8: webhook simulator`

### Session 8 — Dashboard UX Polish (13:00–13:15)
- Dashboard auto-loads demo_tenant by default (no blank screen on first visit)
- Added "Simulate Webhook" button directly in the dashboard UI
- Added "All Providers" option to the dropdown
- Added explainer text so visitors immediately understand what they're looking at
- **Commit:** `Dashboard UX: auto-load demo tenant, simulate buttons, explainer text`

### Session 9 — Extra Credit Providers (13:15–13:40)
- Added 3 extra credit providers: Salesforce, PagerDuty, Zendesk (8 total)
- Each stamped out in ~10 minutes using the registry pattern
- Added all 3 to simulator with realistic payloads
- Made all dashboard sections collapsible (click to expand/collapse)
- **Commits:** `Phase 9: extra credit providers` + dashboard UX commits

### Session 10 — Sprint 1: Search, Export, Chart Toggle (13:40–14:15)
- Added event search/filter bar to dashboard — keyword search + provider/severity/status dropdowns
- Built `GET /api/export?tenant_id=X&format=csv|json` endpoint for data export
- Added CSV and JSON export buttons to dashboard
- Added bar/pie chart toggle for Events by Provider section
- Fixed time search to handle browser locale differences
- **Commit:** `Sprint 1: search, export, chart toggle`

### Session 11 — Webhook Forwarding + Slack (14:45–16:30)
- Built webhook forwarding engine: forward events to email, Slack, or webhook URLs
- `forwarding_rules` D1 table with provider and severity filters
- Dashboard UI to add/view/delete forwarding rules
- Email forwarding via Resend API — styled HTML, verified end-to-end
- Slack integration: auto-detects Slack URLs, sends rich Block Kit messages
- Root URL `/` now redirects to dashboard
- Fixed severity filter to work as "this level and above"
- **Commits:** `Phase 10` through `Phase 11`

### Session 12 — Remediation Playbooks (16:30–17:05)
- Built remediation engine: match events against playbooks with wildcard patterns
- Remediation steps automatically included in Slack messages and emails
- CRUD API: GET/POST/DELETE /api/playbooks
- Pattern matching: exact, wildcard (*), and prefix (incident.*)
- **Commit:** `Phase 12: remediation playbooks`

### Session 13 — Provider Health Scores (17:05–17:25)
- Per-provider success/error rates calculated from events table
- Dashboard: color-coded health cards (green/yellow/red)
- API: GET /api/health/providers?tenant_id=X
- Scheduled health digest to Slack #provider-health-stats every 20 min
- Manual trigger: POST /api/health/digest
- **Commits:** `Phase 13` + `Phase 14: health digest`

### Session 14 — Twilio SMS + Voice Call Alerts (17:25–17:50)
- SMS forwarding via Twilio: text with event summary + remediation steps
- Voice call forwarding via Twilio: phone rings, AI voice reads the alert
- 5 forwarding channels total: email, Slack, SMS, voice call, webhook URL
- All Twilio credentials stored as CF Workers secrets
- Dashboard forwarding UI updated with SMS and Voice Call options
- **Commit:** `Phase 15: Twilio SMS + voice call alerts`

### Session 15 — DECISIONS.md Rewrite (17:50–18:00)
- Restructured from to-do list into pure decision-making document
- 17 decisions across Architecture, Tradeoffs, and Product Thinking
- Elevated Twilio SMS/voice to standalone decision with escalation ladder
- **Commit:** `Phase 15b: DECISIONS.md rewrite`

### Session 16 — Stripe, Datadog, GitHub Providers (18:30–18:50)
- 3 new providers bringing total to 11
- Stripe: payment.succeeded/failed, subscription, invoice, charge, dispute events
- Datadog: monitor alerts with triggered/recovered/warn/no_data mapping
- GitHub: PR, push, issue, deployment, workflow events
- All 3 added to simulator with realistic payloads
- Dashboard dropdown + colors updated, test updated to verify 11 providers
- **Commit:** `Phase 17: Stripe, Datadog, GitHub providers (11 total)`

### Session 17 — Cross-Tool Correlation Engine (18:50–19:00)
- Built correlation engine: detect patterns across providers in real time
- When event A + event B happen within N minutes → generate critical alert
- Correlation alerts flow through all forwarding channels (Slack, email, SMS, call)
- Stored as system events in the events table for dashboard visibility
- CRUD API: GET/POST/DELETE /api/correlations
- Supports wildcard event patterns (payment.* matches payment.failed)
- **Commit:** `Phase 18: cross-tool correlation engine`

### Session 18 — Connections Page (18:50–19:00)
- Built `/connections` page: manage all integrations from one place
- Channel cards show active/inactive status for email, Slack, SMS, voice call, webhook
- Lists correlation rules and remediation playbooks with delete buttons
- Nav link added to dashboard header
- Auto-loads demo_tenant by default
- **Commit:** `Phase 19: connections page`

### Session 19 — Event Detail Modal (19:15–19:25)
- Click any event row → modal overlay with full detail
- Shows: all metadata, raw JSON payload (syntax formatted), matching remediation playbooks
- Replay button to re-process event from modal
- Close with X button, click outside, or Escape key
- **Commit:** `Phase 20: event detail modal`

### Session 20 — Alerting Rules Engine (19:35–19:55)
- Metric-based alerting: error_rate, failed_count, retry_queue_depth, dead_letter_count, event_volume
- Evaluated every 5 minutes on cron trigger
- Cooldown prevents re-triggering during the same window
- Alert events stored in events table + forwarded through all channels
- CRUD API: GET/POST/DELETE /api/alerts
- Supports per-provider filtering and comparison operators (gt, lt, gte, lte)
- **Commit:** `Phase 21: alerting rules engine`

---

## Process Notes

- **Deployed after every phase.** At no point was `main` broken or the live URL stale. The evaluator could have tested at any commit.
- **Breadth first, then depth.** Got all core features working before polishing any single one. The spec rewards completion over perfection.
- **Claude generated, I steered.** Claude wrote the normalizer files, test suite, and dashboard. I made the architecture decisions, set the build order, and enforced the "deploy early, deploy often" cadence.
- **Spec-driven development.** Used Claude to audit the eval spec against the codebase after each phase, catching gaps before they became problems.
- **Kept building past the spec.** After completing all eval requirements, continued building business features: forwarding engine, Slack/email/SMS/voice integration, remediation playbooks, health scoring. Velocity didn't stop at "done."

---

## Sessions with Claude

- **Total sessions:** 2 (1 initial scaffold session, 1 long continuous build session)
- **Primary tool:** Claude Code CLI (Opus, max effort)
- **Workflow:** Feed spec → plan phase → build → deploy → verify live → commit → next phase
