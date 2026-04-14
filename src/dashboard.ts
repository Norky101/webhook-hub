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
    <h2 class="collapsible" onclick="toggleSection('health')"><span class="arrow open" id="arrow-health">&#9654;</span> Provider Health</h2>
    <div class="collapsible-content" id="section-health">
      <div id="health-scores" style="display:flex; gap:12px; flex-wrap:wrap;">
        <div class="empty">Loading health scores...</div>
      </div>
    </div>
  </div>

  <div class="filters" style="display:flex; gap:10px; align-items:center; margin-bottom:20px; flex-wrap:wrap;">
    <input type="text" id="search-input" placeholder="Search events — type a keyword, event ID, or provider..." style="flex:1; min-width:200px; background:#161b22; border:1px solid #30363d; color:#e1e4e8; padding:8px 12px; border-radius:6px; font-size:13px;">
    <select id="filter-provider" style="background:#161b22; border:1px solid #30363d; color:#e1e4e8; padding:8px 12px; border-radius:6px; font-size:13px;">
      <option value="">All providers</option>
      <option value="hubspot">HubSpot</option>
      <option value="shopify">Shopify</option>
      <option value="linear">Linear</option>
      <option value="intercom">Intercom</option>
      <option value="gusto">Gusto</option>
      <option value="salesforce">Salesforce</option>
      <option value="pagerduty">PagerDuty</option>
      <option value="zendesk">Zendesk</option>
    </select>
    <select id="filter-severity" style="background:#161b22; border:1px solid #30363d; color:#e1e4e8; padding:8px 12px; border-radius:6px; font-size:13px;">
      <option value="">All severities</option>
      <option value="info">Info</option>
      <option value="warning">Warning</option>
      <option value="error">Error</option>
      <option value="critical">Critical</option>
    </select>
    <select id="filter-status" style="background:#161b22; border:1px solid #30363d; color:#e1e4e8; padding:8px 12px; border-radius:6px; font-size:13px;">
      <option value="">All statuses</option>
      <option value="processed">Processed</option>
      <option value="failed">Failed</option>
      <option value="retrying">Retrying</option>
      <option value="dead_letter">Dead Letter</option>
    </select>
    <button onclick="applyFilters()" style="background:#238636; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:13px;">Filter</button>
    <button onclick="exportData('csv')" style="background:#30363d; color:#e1e4e8; border:1px solid #484f58; padding:8px 12px; border-radius:6px; cursor:pointer; font-size:13px;">Export CSV</button>
    <button onclick="exportData('json')" style="background:#30363d; color:#e1e4e8; border:1px solid #484f58; padding:8px 12px; border-radius:6px; cursor:pointer; font-size:13px;">Export JSON</button>
  </div>

  <div class="section">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h2 class="collapsible" onclick="toggleSection('providers')"><span class="arrow open" id="arrow-providers">&#9654;</span> Events by Provider</h2>
      <div style="display:flex; gap:4px;">
        <button onclick="setChart('bar')" id="chart-bar" class="chart-toggle active" style="background:#30363d; color:#e1e4e8; border:1px solid #484f58; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px;">Bar</button>
        <button onclick="setChart('pie')" id="chart-pie" class="chart-toggle" style="background:#161b22; color:#8b949e; border:1px solid #30363d; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:11px;">Pie</button>
      </div>
    </div>
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

  <div class="section">
    <h2 class="collapsible" onclick="toggleSection('forwarding')"><span class="arrow open" id="arrow-forwarding">&#9654;</span> Webhook Forwarding</h2>
    <div class="collapsible-content" id="section-forwarding">
      <p style="font-size:12px; color:#8b949e; margin-bottom:12px;">Forward normalized events to email or webhook URLs. Rules apply to all incoming webhooks for this tenant.</p>
      <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; align-items:center;">
        <input type="text" id="fwd-name" placeholder="Rule name (e.g. Ops alerts)" style="background:#161b22; border:1px solid #30363d; color:#e1e4e8; padding:6px 10px; border-radius:6px; font-size:12px; width:150px;">
        <select id="fwd-type" onchange="updateDestPlaceholder()" style="background:#161b22; border:1px solid #30363d; color:#e1e4e8; padding:6px 10px; border-radius:6px; font-size:12px;">
          <option value="email">Email</option>
          <option value="slack">Slack</option>
          <option value="webhook">Webhook URL</option>
        </select>
        <input type="text" id="fwd-dest" placeholder="email@example.com" style="background:#161b22; border:1px solid #30363d; color:#e1e4e8; padding:6px 10px; border-radius:6px; font-size:12px; flex:1; min-width:200px;">
        <select id="fwd-provider" style="background:#161b22; border:1px solid #30363d; color:#e1e4e8; padding:6px 10px; border-radius:6px; font-size:12px;">
          <option value="">All providers</option>
          <option value="hubspot">HubSpot</option>
          <option value="shopify">Shopify</option>
          <option value="linear">Linear</option>
          <option value="intercom">Intercom</option>
          <option value="gusto">Gusto</option>
          <option value="salesforce">Salesforce</option>
          <option value="pagerduty">PagerDuty</option>
          <option value="zendesk">Zendesk</option>
        </select>
        <select id="fwd-severity" style="background:#161b22; border:1px solid #30363d; color:#e1e4e8; padding:6px 10px; border-radius:6px; font-size:12px;">
          <option value="">All severities</option>
          <option value="warning">Warning+</option>
          <option value="error">Error+</option>
          <option value="critical">Critical only</option>
        </select>
        <button onclick="addForwardingRule()" style="background:#238636; color:white; border:none; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:12px;">Add Rule</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Destination</th>
            <th>Provider</th>
            <th>Severity</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="forwarding-table">
          <tr><td colspan="6" class="empty">No forwarding rules</td></tr>
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
let currentChart = 'bar';
let lastProviderData = [];

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
    // Build filtered events URL
    const filterProvider = document.getElementById('filter-provider').value;
    const filterSeverity = document.getElementById('filter-severity').value;
    const filterStatus = document.getElementById('filter-status').value;
    let eventsUrl = '/api/events?tenant_id=' + tenant + '&limit=50';
    if (filterProvider) eventsUrl += '&provider=' + filterProvider;
    if (filterStatus) eventsUrl += '&status=' + filterStatus;

    // Fetch health, stats, events, failures in parallel
    const [health, stats, events, failures] = await Promise.all([
      api('/api/health'),
      api('/api/stats?tenant_id=' + tenant),
      api(eventsUrl),
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

    // Provider chart — store data for chart toggle
    lastProviderData = stats.by_provider || [];
    renderProviderChart();

    // Provider health scores
    try {
      const healthData = await api('/api/health/providers?tenant_id=' + tenant);
      const container = document.getElementById('health-scores');
      const providers = healthData.providers || [];
      if (providers.length === 0) {
        container.innerHTML = '<div class="empty">No provider data in the last hour</div>';
      } else {
        container.innerHTML = providers.map(p => {
          const color = p.status === 'healthy' ? '#3fb950' : p.status === 'degraded' ? '#d29922' : p.status === 'critical' ? '#f85149' : '#484f58';
          const bg = p.status === 'healthy' ? '#0d3321' : p.status === 'degraded' ? '#3d2e00' : p.status === 'critical' ? '#3d1418' : '#161b22';
          const provColor = PROVIDER_COLORS[p.provider] || '#8b949e';
          return '<div style="background:' + bg + ';border:1px solid ' + color + ';border-radius:8px;padding:14px 18px;min-width:140px;">'
            + '<div style="font-size:12px;color:' + provColor + ';font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">' + p.provider + '</div>'
            + '<div style="font-size:28px;font-weight:700;color:' + color + ';margin:4px 0;">' + p.success_rate + '%</div>'
            + '<div style="font-size:11px;color:#8b949e;">' + p.processed + ' ok / ' + p.failed + ' failed</div>'
            + '<div style="font-size:11px;color:' + color + ';margin-top:2px;">' + p.status + '</div>'
            + '</div>';
        }).join('');
      }
    } catch (e) { /* health scores optional */ }

    // Events table — apply client-side search + severity filter
    const eventsTable = document.getElementById('events-table');
    const searchTerm = (document.getElementById('search-input').value || '').toLowerCase().trim();
    let evts = events.events || [];
    if (filterSeverity) evts = evts.filter(e => e.severity === filterSeverity);
    if (searchTerm) {
      // Normalize search: strip non-breaking spaces, normalize whitespace
      const normSearch = searchTerm.replace(/\s+/g, ' ');
      evts = evts.filter(e => {
        const timeStr = fmtTime(e.received_at).toLowerCase().replace(/\s+/g, ' ');
        const isoStr = (e.received_at || '').toLowerCase();
        // Also format as 24h for matching
        const d = e.received_at ? new Date(e.received_at) : null;
        const h24 = d ? (d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0')) : '';
        return (e.id || '').toLowerCase().includes(normSearch) ||
          (e.provider || '').toLowerCase().includes(normSearch) ||
          (e.event_type || '').toLowerCase().includes(normSearch) ||
          (e.summary || '').toLowerCase().includes(normSearch) ||
          (e.severity || '').toLowerCase().includes(normSearch) ||
          (e.status || '').toLowerCase().includes(normSearch) ||
          isoStr.includes(normSearch) ||
          timeStr.includes(normSearch) ||
          h24.includes(normSearch);
      });
    }
    if (evts.length === 0) {
      eventsTable.innerHTML = '<tr><td colspan="6" class="empty">' + (searchTerm ? 'No events matching "' + esc(searchTerm) + '"' : 'No events') + '</td></tr>';
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
  loadForwardingRules();
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

function renderProviderChart() {
  const container = document.getElementById('provider-bars');
  const data = lastProviderData;
  if (data.length === 0) {
    container.innerHTML = '<div class="empty">No events for this tenant</div>';
    return;
  }
  if (currentChart === 'pie') {
    renderPieChart(container, data);
  } else {
    renderBarChart(container, data);
  }
}

function renderBarChart(container, data) {
  const maxCount = Math.max(...data.map(p => p.count), 1);
  container.innerHTML = data.map(p => {
    const pct = Math.max((p.count / maxCount) * 100, 2);
    const color = PROVIDER_COLORS[p.provider] || '#8b949e';
    return '<div class="bar-row">'
      + '<span class="bar-label">' + p.provider + '</span>'
      + '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '">' + p.count + '</div></div>'
      + '</div>';
  }).join('');
}

function renderPieChart(container, data) {
  const total = data.reduce((s, p) => s + p.count, 0);
  const size = 180;
  const cx = size / 2, cy = size / 2, r = 70;
  let startAngle = 0;
  let paths = '';
  let legend = '';

  data.forEach(p => {
    const slice = (p.count / total) * Math.PI * 2;
    const endAngle = startAngle + slice;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = slice > Math.PI ? 1 : 0;
    const color = PROVIDER_COLORS[p.provider] || '#8b949e';
    paths += '<path d="M ' + cx + ' ' + cy + ' L ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2 + ' Z" fill="' + color + '" stroke="#0f1117" stroke-width="1.5"/>';
    const pct = Math.round((p.count / total) * 100);
    legend += '<div style="display:flex;align-items:center;gap:8px;font-size:12px;"><span style="width:10px;height:10px;border-radius:2px;background:' + color + ';display:inline-block;"></span>' + p.provider + ' — ' + p.count + ' (' + pct + '%)</div>';
    startAngle = endAngle;
  });

  container.innerHTML = '<div style="display:flex;align-items:center;gap:24px;">'
    + '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + paths + '</svg>'
    + '<div style="display:flex;flex-direction:column;gap:6px;">' + legend + '</div>'
    + '</div>';
}

function setChart(type) {
  currentChart = type;
  document.querySelectorAll('.chart-toggle').forEach(b => {
    b.style.background = '#161b22';
    b.style.color = '#8b949e';
    b.style.borderColor = '#30363d';
  });
  const active = document.getElementById('chart-' + type);
  if (active) {
    active.style.background = '#30363d';
    active.style.color = '#e1e4e8';
    active.style.borderColor = '#484f58';
  }
  renderProviderChart();
}

function updateDestPlaceholder() {
  const type = document.getElementById('fwd-type').value;
  const dest = document.getElementById('fwd-dest');
  if (type === 'email') dest.placeholder = 'email@example.com';
  else if (type === 'slack') dest.placeholder = 'https://hooks.slack.com/services/...';
  else dest.placeholder = 'https://your-api.com/webhook';
}

async function loadForwardingRules() {
  const tenant = document.getElementById('tenant-input').value.trim();
  if (!tenant) return;
  try {
    const data = await api('/api/forwarding?tenant_id=' + tenant);
    const table = document.getElementById('forwarding-table');
    const rules = data.rules || [];
    if (rules.length === 0) {
      table.innerHTML = '<tr><td colspan="6" class="empty">No forwarding rules — add one above</td></tr>';
    } else {
      table.innerHTML = rules.map(r =>
        '<tr>'
        + '<td>' + esc(r.name || '(unnamed)') + '</td>'
        + '<td>' + r.destination_type + '</td>'
        + '<td style="font-size:12px;word-break:break-all;">' + esc(r.destination) + '</td>'
        + '<td>' + (r.provider_filter || 'all') + '</td>'
        + '<td>' + (r.severity_filter || 'all') + '</td>'
        + '<td><button onclick="deleteRule(' + r.id + ')" style="background:#3d1418;color:#f85149;border:1px solid #f85149;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Delete</button></td>'
        + '</tr>'
      ).join('');
    }
  } catch (err) { /* ignore */ }
}

async function addForwardingRule() {
  const tenant = document.getElementById('tenant-input').value.trim();
  if (!tenant) { alert('Enter a tenant ID first'); return; }
  const name = document.getElementById('fwd-name').value.trim();
  const destType = document.getElementById('fwd-type').value;
  const dest = document.getElementById('fwd-dest').value.trim();
  const provider = document.getElementById('fwd-provider').value;
  const severity = document.getElementById('fwd-severity').value;
  if (!dest) { alert('Enter a destination (email or URL)'); return; }

  try {
    await fetch(BASE + '/api/forwarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenant,
        name: name,
        destination_type: destType,
        destination: dest,
        provider_filter: provider || undefined,
        severity_filter: severity || undefined,
      }),
    });
    document.getElementById('fwd-name').value = '';
    document.getElementById('fwd-dest').value = '';
    loadForwardingRules();
  } catch (err) { alert('Error: ' + err.message); }
}

async function deleteRule(id) {
  await fetch(BASE + '/api/forwarding/' + id, { method: 'DELETE' });
  loadForwardingRules();
}

function applyFilters() {
  loadDashboard();
}

function exportData(format) {
  const tenant = document.getElementById('tenant-input').value.trim();
  if (!tenant) { alert('Enter a tenant ID first'); return; }
  const provider = document.getElementById('filter-provider').value;
  const status = document.getElementById('filter-status').value;
  let url = BASE + '/api/export?tenant_id=' + tenant + '&format=' + format;
  if (provider) url += '&provider=' + provider;
  if (status) url += '&status=' + status;
  window.open(url, '_blank');
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

// Enter key triggers search/filter
document.getElementById('search-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') applyFilters();
});
document.getElementById('tenant-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') loadDashboard();
});

// Auto-load: URL param > default to demo_tenant
const params = new URLSearchParams(location.search);
const defaultTenant = params.get('tenant_id') || 'demo_tenant';
document.getElementById('tenant-input').value = defaultTenant;
loadDashboard();
</script>
</body>
</html>`;
}
