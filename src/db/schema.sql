-- Core events table — every webhook lands here
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  summary TEXT NOT NULL DEFAULT '',
  raw_payload TEXT NOT NULL,
  delivery_id TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'processed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fast lookups by tenant + filters
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_tenant_provider ON events(tenant_id, provider);
CREATE INDEX IF NOT EXISTS idx_events_tenant_type ON events(tenant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_tenant_status ON events(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at);
-- Idempotency: prevent duplicate deliveries per provider+tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup ON events(tenant_id, provider, delivery_id);

-- Retry queue — failed events waiting for retry
CREATE TABLE IF NOT EXISTS retry_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id),
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_retry_next ON retry_queue(next_retry_at);

-- Forwarding rules — where to send normalized events
CREATE TABLE IF NOT EXISTS forwarding_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  destination_type TEXT NOT NULL, -- 'webhook', 'email'
  destination TEXT NOT NULL, -- URL or email address
  provider_filter TEXT, -- NULL = all providers, or specific provider name
  severity_filter TEXT, -- NULL = all, or 'warning', 'error', 'critical'
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_forwarding_tenant ON forwarding_rules(tenant_id, active);

-- Remediation playbooks — what to do when bad events happen
CREATE TABLE IF NOT EXISTS remediation_playbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  event_pattern TEXT NOT NULL, -- matches against event_type (supports wildcards: 'incident.*')
  provider_filter TEXT, -- NULL = all providers
  title TEXT NOT NULL,
  steps TEXT NOT NULL, -- JSON array of step strings
  auto_forward INTEGER NOT NULL DEFAULT 1, -- include in Slack/email forwards
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_remediation_tenant ON remediation_playbooks(tenant_id);

-- Cross-tool correlation rules
CREATE TABLE IF NOT EXISTS correlation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider_a TEXT NOT NULL,
  event_pattern_a TEXT NOT NULL,
  provider_b TEXT NOT NULL,
  event_pattern_b TEXT NOT NULL,
  time_window_minutes INTEGER NOT NULL DEFAULT 30,
  action_description TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_correlation_tenant ON correlation_rules(tenant_id, active);

-- Dead letter queue — events that exhausted all retries
CREATE TABLE IF NOT EXISTS dead_letter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id),
  attempts INTEGER NOT NULL,
  last_error TEXT,
  moved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
