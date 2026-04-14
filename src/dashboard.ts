/**
 * Monitoring Dashboard — single HTML page at /dashboard
 * Shows: events per provider (24h), error rate, retry queue depth, recent failures
 * Auto-refreshes every 30 seconds, filterable by tenant
 */
export function dashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Webhook Hub — Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0f1117;
      color: #e1e4e8;
      padding: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #2d333b;
    }
    .header h1 { font-size: 20px; font-weight: 600; }
    .header .status { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .header .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot.green { background: #3fb950; }
    .dot.red { background: #f85149; }
    .dot.yellow { background: #d29922; }
    .controls {
      display: flex; gap: 12px; align-items: center; margin-bottom: 24px;
    }
    .controls input, .controls select {
      background: #161b22;
      border: 1px solid #30363d;
      color: #e1e4e8;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
    }
    .controls button {
      background: #238636;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    .controls button:hover { background: #2ea043; }
    .controls button[style*="8957e5"]:hover { background: #7048c6 !important; }
    .controls button:disabled { opacity: 0.5; cursor: wait; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
    }
    .card .label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
    .card .value { font-size: 32px; font-weight: 700; margin-top: 4px; }
    .card .value.green { color: #3fb950; }
    .card .value.red { color: #f85149; }
    .card .value.yellow { color: #d29922; }
    .card .value.blue { color: #58a6ff; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 15px; font-weight: 600; margin-bottom: 12px; color: #8b949e; }
    .collapsible { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; }
    .collapsible:hover { color: #e1e4e8; }
    .collapsible .arrow { transition: transform 0.2s; font-size: 12px; }
    .collapsible .arrow.open { transform: rotate(90deg); }
    .collapsible-content { overflow: hidden; transition: max-height 0.3s ease; }
    .collapsible-content.collapsed { max-height: 0 !important; }
    .provider-bars { display: flex; flex-direction: column; gap: 8px; }
    .bar-row { display: flex; align-items: center; gap: 12px; }
    .bar-label { width: 80px; font-size: 13px; text-align: right; color: #8b949e; }
    .bar-track { flex: 1; height: 24px; background: #21262d; border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; display: flex; align-items: center; padding-left: 8px; font-size: 12px; font-weight: 600; min-width: fit-content; }
    .bar-count { font-size: 13px; width: 50px; text-align: right; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 12px; border-bottom: 1px solid #21262d; }
    td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #161b22; }
    tr:hover td { background: #161b22; }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
    }
    .badge.info { background: #1f3a5f; color: #58a6ff; }
    .badge.warning { background: #3d2e00; color: #d29922; }
    .badge.error { background: #3d1418; color: #f85149; }
    .badge.critical { background: #5c1a1a; color: #ff7b72; }
    .badge.processed { background: #0d3321; color: #3fb950; }
    .badge.failed { background: #3d1418; color: #f85149; }
    .badge.retrying { background: #3d2e00; color: #d29922; }
    .badge.dead_letter { background: #2d1b35; color: #bc8cff; }
    .empty { color: #484f58; font-style: italic; padding: 20px; text-align: center; }
    .refresh-note { font-size: 11px; color: #484f58; }
    .colors { display: flex; gap: 4px; }
    .colors span { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
    #error-banner {
      display: none; background: #3d1418; border: 1px solid #f85149; color: #f85149;
      padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Webhook Hub</h1>
    <div class="status">
      <div class="dot" id="status-dot"></div>
      <span id="status-text">Connecting...</span>
      <span class="refresh-note">Auto-refresh 30s</span>
    </div>
  </div>

  <p style="color:#8b949e; font-size:13px; margin-bottom:16px; line-height:1.5;">
    Multi-tenant webhook monitoring. Enter any tenant name to create an isolated workspace, or use the default. Simulate webhooks to see the platform in action.
  </p>

  <div id="error-banner"></div>

  <div class="controls">
    <input type="text" id="tenant-input" placeholder="Enter any name — e.g. acme_corp, my_team, test" value="" title="Each tenant is an isolated namespace. Type any name to create or view one.">
    <button onclick="loadDashboard()">Load</button>
    <span style="color:#30363d; margin:0 4px;">|</span>
    <select id="sim-provider">
      <option value="all">All Providers</option>
      <option value="hubspot">HubSpot</option>
      <option value="shopify">Shopify</option>
      <option value="linear">Linear</option>
      <option value="intercom">Intercom</option>
      <option value="gusto">Gusto</option>
      <option value="salesforce">Salesforce</option>
      <option value="pagerduty">PagerDuty</option>
      <option value="zendesk">Zendesk</option>
    </select>
    <button onclick="simulateWebhook()" id="sim-btn" style="background:#8957e5;">Simulate Webhook</button>
    <span id="sim-status" style="font-size:12px; color:#8b949e;"></span>
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Total Events</div>
      <div class="value blue" id="total-events">—</div>
    </div>
    <div class="card">
      <div class="label">Error Rate (1h)</div>
      <div class="value" id="error-rate">—</div>
    </div>
    <div class="card">
      <div class="label">Retry Queue</div>
      <div class="value" id="retry-depth">—</div>
    </div>
    <div class="card">
      <div class="label">Dead Letters</div>
      <div class="value" id="dead-letters">—</div>
    </div>
  </div>

  <div class="section">
    <h2 class="collapsible" onclick="toggleSection('providers')"><span class="arrow open" id="arrow-providers">&#9654;</span> Events by Provider</h2>
    <div class="collapsible-content" id="section-providers">
      <div class="provider-bars" id="provider-bars">
        <div class="empty">Enter a tenant ID above</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2 class="collapsible" onclick="toggleSection('events')"><span class="arrow open" id="arrow-events">&#9654;</span> Recent Events</h2>
    <div class="collapsible-content" id="section-events">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Provider</th>
          <th>Type</th>
          <th>Severity</th>
          <th>Status</th>
          <th>Summary</th>
        </tr>
      </thead>
      <tbody id="events-table">
        <tr><td colspan="6" class="empty">No events loaded</td></tr>
      </tbody>
    </table>
    </div>
  </div>

  <div class="section">
    <h2 class="collapsible" onclick="toggleSection('failures')"><span class="arrow open" id="arrow-failures">&#9654;</span> Recent Failures</h2>
    <div class="collapsible-content" id="section-failures">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Provider</th>
          <th>Type</th>
          <th>Summary</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody id="failures-table">
        <tr><td colspan="5" class="empty">No failures</td></tr>
      </tbody>
    </table>
    </div>
  </div>

<script>
const PROVIDER_COLORS = {
  hubspot: '#ff7a59',
  shopify: '#96bf48',
  linear: '#5e6ad2',
  intercom: '#286efa',
  gusto: '#f45d48',
  salesforce: '#00a1e0',
  pagerduty: '#06ac38',
  zendesk: '#03363d',
};
const BASE = location.origin;
let refreshTimer = null;

async function api(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
  return res.json();
}

async function loadDashboard() {
  const tenant = document.getElementById('tenant-input').value.trim();
  if (!tenant) return;

  const banner = document.getElementById('error-banner');
  banner.style.display = 'none';

  try {
    // Fetch health, stats, events, failures in parallel
    const [health, stats, events, failures] = await Promise.all([
      api('/api/health'),
      api('/api/stats?tenant_id=' + tenant),
      api('/api/events?tenant_id=' + tenant + '&limit=20'),
      api('/api/events?tenant_id=' + tenant + '&status=failed&limit=10'),
    ]);

    // Status indicator
    const dot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    if (health.status === 'healthy') {
      dot.className = 'dot green';
      statusText.textContent = 'Healthy';
    } else {
      dot.className = 'dot red';
      statusText.textContent = 'Unhealthy';
    }

    // Summary cards
    document.getElementById('total-events').textContent = stats.total.toLocaleString();

    const errorCount = health.error_rate_last_hour || 0;
    const errorEl = document.getElementById('error-rate');
    errorEl.textContent = errorCount;
    errorEl.className = 'value ' + (errorCount > 10 ? 'red' : errorCount > 0 ? 'yellow' : 'green');

    const retryDepth = health.retry_queue_depth || 0;
    const retryEl = document.getElementById('retry-depth');
    retryEl.textContent = retryDepth;
    retryEl.className = 'value ' + (retryDepth > 20 ? 'red' : retryDepth > 0 ? 'yellow' : 'green');

    // Dead letter count
    const dlCount = (stats.by_status || []).find(s => s.status === 'dead_letter');
    const dlEl = document.getElementById('dead-letters');
    dlEl.textContent = dlCount ? dlCount.count : '0';
    dlEl.className = 'value ' + (dlCount && dlCount.count > 0 ? 'red' : 'green');

    // Provider bars
    const providerBars = document.getElementById('provider-bars');
    const byProvider = stats.by_provider || [];
    const maxCount = Math.max(...byProvider.map(p => p.count), 1);
    if (byProvider.length === 0) {
      providerBars.innerHTML = '<div class="empty">No events for this tenant</div>';
    } else {
      providerBars.innerHTML = byProvider.map(p => {
        const pct = Math.max((p.count / maxCount) * 100, 2);
        const color = PROVIDER_COLORS[p.provider] || '#8b949e';
        return '<div class="bar-row">'
          + '<span class="bar-label">' + p.provider + '</span>'
          + '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '">' + p.count + '</div></div>'
          + '</div>';
      }).join('');
    }

    // Events table
    const eventsTable = document.getElementById('events-table');
    const evts = events.events || [];
    if (evts.length === 0) {
      eventsTable.innerHTML = '<tr><td colspan="6" class="empty">No events</td></tr>';
    } else {
      eventsTable.innerHTML = evts.map(e =>
        '<tr>'
        + '<td>' + fmtTime(e.received_at) + '</td>'
        + '<td>' + e.provider + '</td>'
        + '<td>' + e.event_type + '</td>'
        + '<td><span class="badge ' + e.severity + '">' + e.severity + '</span></td>'
        + '<td><span class="badge ' + e.status + '">' + e.status + '</span></td>'
        + '<td>' + esc(e.summary || '') + '</td>'
        + '</tr>'
      ).join('');
    }

    // Failures table
    const failuresTable = document.getElementById('failures-table');
    const fails = failures.events || [];
    if (fails.length === 0) {
      failuresTable.innerHTML = '<tr><td colspan="5" class="empty">No failures — looking good</td></tr>';
    } else {
      failuresTable.innerHTML = fails.map(e =>
        '<tr>'
        + '<td>' + fmtTime(e.received_at) + '</td>'
        + '<td>' + e.provider + '</td>'
        + '<td>' + e.event_type + '</td>'
        + '<td>' + esc(e.summary || '') + '</td>'
        + '<td><span class="badge ' + e.status + '">' + e.status + '</span></td>'
        + '</tr>'
      ).join('');
    }

  } catch (err) {
    banner.textContent = 'Error loading dashboard: ' + err.message;
    banner.style.display = 'block';
    document.getElementById('status-dot').className = 'dot red';
    document.getElementById('status-text').textContent = 'Error';
  }

  // Schedule next refresh
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadDashboard, 30000);
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function toggleSection(name) {
  const content = document.getElementById('section-' + name);
  const arrow = document.getElementById('arrow-' + name);
  if (content.classList.contains('collapsed')) {
    content.classList.remove('collapsed');
    content.style.maxHeight = content.scrollHeight + 'px';
    arrow.classList.add('open');
  } else {
    content.style.maxHeight = content.scrollHeight + 'px';
    requestAnimationFrame(() => {
      content.classList.add('collapsed');
      arrow.classList.remove('open');
    });
  }
}

async function simulateWebhook() {
  const tenant = document.getElementById('tenant-input').value.trim();
  if (!tenant) { alert('Enter a tenant ID first'); return; }
  const provider = document.getElementById('sim-provider').value;
  const status = document.getElementById('sim-status');
  const btn = document.getElementById('sim-btn');
  btn.disabled = true;

  const allProviders = ['hubspot', 'shopify', 'linear', 'intercom', 'gusto', 'salesforce', 'pagerduty', 'zendesk'];

  if (provider === 'all') {
    status.textContent = 'Sending ' + (allProviders.length * 5) + ' events across all providers...';
    try {
      await Promise.all(allProviders.map(p =>
        fetch(BASE + '/api/simulate/' + p + '/' + tenant + '?count=5', { method: 'POST' })
      ));
      status.textContent = (allProviders.length * 5) + ' events sent across all providers!';
      setTimeout(() => { status.textContent = ''; }, 3000);
      loadDashboard();
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
    }
  } else {
    status.textContent = 'Sending...';
    try {
      const res = await fetch(BASE + '/api/simulate/' + provider + '/' + tenant, { method: 'POST' });
      const json = await res.json();
      status.textContent = 'Sent: ' + (json.events?.[0]?.event_type || 'ok');
      setTimeout(() => { status.textContent = ''; }, 3000);
      loadDashboard();
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
    }
  }
  btn.disabled = false;
}

// Auto-load: URL param > default to demo_tenant
const params = new URLSearchParams(location.search);
const defaultTenant = params.get('tenant_id') || 'demo_tenant';
document.getElementById('tenant-input').value = defaultTenant;
loadDashboard();
</script>
</body>
</html>`;
}
