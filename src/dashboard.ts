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
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><circle cx='14' cy='14' r='6' fill='none' stroke='%2358a6ff' stroke-width='2'/><circle cx='14' cy='14' r='2.5' fill='%2358a6ff'/><circle cx='4' cy='4' r='2' fill='%233fb950'/><circle cx='24' cy='4' r='2' fill='%23f85149'/><circle cx='4' cy='24' r='2' fill='%23d29922'/><circle cx='24' cy='24' r='2' fill='%23bc8cff'/><circle cx='14' cy='2' r='2' fill='%23ff7a59'/><circle cx='14' cy='26' r='2' fill='%2396bf48'/></svg>">
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
    .card { position: relative; }
    .card .tooltip {
      display: none; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
      background: #30363d; color: #e1e4e8; padding: 8px 12px; border-radius: 6px;
      font-size: 11px; line-height: 1.4; width: 220px; text-align: center;
      margin-bottom: 8px; z-index: 50; pointer-events: none;
    }
    .card:hover .tooltip { display: block; }
    .loading-bar {
      position: fixed; top: 0; left: 0; height: 3px; background: #58a6ff;
      z-index: 200; transition: width 0.3s; border-radius: 0 2px 2px 0;
    }
    @keyframes pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
    .loading .card .value { animation: pulse 1.5s infinite; }
    .refresh-note { font-size: 11px; color: #484f58; }
    .colors { display: flex; gap: 4px; }
    .colors span { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
    /* Mobile responsive */
    @media (max-width: 768px) {
      body { padding: 12px; }
      .header { flex-direction: column; align-items: flex-start; gap: 8px; }
      .grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
      .card .value { font-size: 24px; }
      .card .label { font-size: 11px; }
      .card { padding: 12px; }
      .controls { flex-wrap: wrap; }
      .filters { flex-wrap: wrap; }
      table { display: block; overflow-x: auto; white-space: nowrap; }
      th, td { padding: 6px 8px; font-size: 12px; }
      .bar-label { width: 60px; font-size: 11px; }
      .section h2 { font-size: 13px; }
    }
    @media (max-width: 480px) {
      .grid { grid-template-columns: 1fr 1fr; gap: 6px; }
      .card .value { font-size: 20px; }
      .controls { gap: 6px; }
      .controls input, .controls select, .controls button { font-size: 12px; padding: 6px 10px; }
    }
    .modal-overlay {
      display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7); z-index: 100; justify-content: center; align-items: center; padding: 12px;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: #161b22; border: 1px solid #30363d; border-radius: 12px;
      max-width: 700px; width: 100%; max-height: 85vh; overflow-y: auto; padding: 24px;
    }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .modal-header h2 { font-size: 16px; font-weight: 600; }
    .modal-close {
      background: none; border: none; color: #8b949e; font-size: 20px; cursor: pointer; padding: 4px 8px;
    }
    .modal-close:hover { color: #e1e4e8; }
    .detail-grid { display: grid; grid-template-columns: 120px 1fr; gap: 8px; margin-bottom: 16px; }
    .detail-label { font-size: 12px; color: #8b949e; padding: 4px 0; }
    .detail-value { font-size: 13px; padding: 4px 0; }
    .payload-box {
      background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
      padding: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap;
      word-break: break-all; max-height: 300px; overflow-y: auto; line-height: 1.5;
    }
    .remediation-box {
      background: #1a1e2a; border-left: 3px solid #f0883e; border-radius: 4px;
      padding: 12px 16px; margin-top: 12px;
    }
    .remediation-box h3 { font-size: 14px; color: #f0883e; margin-bottom: 8px; }
    .remediation-box ol { padding-left: 20px; font-size: 13px; }
    .remediation-box li { padding: 2px 0; }
    #error-banner {
      display: none; background: #3d1418; border: 1px solid #f85149; color: #f85149;
      padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="loading-bar" id="loading-bar" style="width:0%"></div>
  <div class="header">
    <div style="display:flex;align-items:center;gap:16px;">
      <a href="/dashboard" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:#e1e4e8;">
        <svg width="28" height="28" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="6" fill="none" stroke="#58a6ff" stroke-width="2"/>
          <circle cx="14" cy="14" r="2.5" fill="#58a6ff"/>
          <circle cx="4" cy="4" r="2" fill="#3fb950"/><line x1="6" y1="6" x2="10" y2="10" stroke="#3fb950" stroke-width="1.5" opacity="0.6"/>
          <circle cx="24" cy="4" r="2" fill="#f85149"/><line x1="22" y1="6" x2="18" y2="10" stroke="#f85149" stroke-width="1.5" opacity="0.6"/>
          <circle cx="4" cy="24" r="2" fill="#d29922"/><line x1="6" y1="22" x2="10" y2="18" stroke="#d29922" stroke-width="1.5" opacity="0.6"/>
          <circle cx="24" cy="24" r="2" fill="#bc8cff"/><line x1="22" y1="22" x2="18" y2="18" stroke="#bc8cff" stroke-width="1.5" opacity="0.6"/>
          <circle cx="14" cy="2" r="2" fill="#ff7a59"/><line x1="14" y1="4" x2="14" y2="8" stroke="#ff7a59" stroke-width="1.5" opacity="0.6"/>
          <circle cx="14" cy="26" r="2" fill="#96bf48"/><line x1="14" y1="24" x2="14" y2="20" stroke="#96bf48" stroke-width="1.5" opacity="0.6"/>
        </svg>
        <h1>Webhook Hub</h1>
      </a>
      <a href="/connections" style="font-size:13px;color:#58a6ff;text-decoration:none;">Connections</a>
      <a href="/agents" style="font-size:13px;color:#58a6ff;text-decoration:none;">Agents</a>
      <a href="/account" style="font-size:13px;color:#58a6ff;text-decoration:none;">Account</a>
      <a href="/account#plans" style="font-size:12px;color:white;background:#238636;padding:4px 12px;border-radius:12px;text-decoration:none;font-weight:600;">Upgrade</a>
    </div>
    <div class="status">
      <div class="dot" id="status-dot"></div>
      <span id="status-text">Connecting...</span>
      <span class="refresh-note">Auto-refresh 30s | <span id="last-updated">—</span></span>
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
      <option value="stripe">Stripe</option>
      <option value="datadog">Datadog</option>
      <option value="github">GitHub</option>
    </select>
    <button onclick="simulateWebhook()" id="sim-btn" style="background:#8957e5;">Simulate Webhook</button>
    <span id="sim-status" style="font-size:12px; color:#8b949e;"></span>
    <span style="flex:1;"></span>
    <button onclick="runAIAnalysis()" id="ai-btn" style="background:#8957e5; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:13px;">Analyze Events with AI</button>
    <span id="ai-status" style="font-size:12px; color:#8b949e;"></span>
  </div>

  <div id="ai-panel" style="display:none; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px; margin-bottom:20px;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3 style="font-size:14px; color:#d2a8ff; margin:0;">AI Analysis</h3>
      <button onclick="document.getElementById('ai-panel').style.display='none'" style="background:none; border:none; color:#8b949e; cursor:pointer; font-size:16px;">&times;</button>
    </div>
    <div id="ai-summary" style="font-size:13px; line-height:1.6; margin-bottom:12px;"></div>
    <div id="ai-details"></div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="tooltip">Total webhook events received and stored for this tenant</div>
      <div class="label">Total Events</div>
      <div class="value blue" id="total-events">—</div>
    </div>
    <div class="card">
      <div class="tooltip">Events that failed processing in the last hour. High numbers may indicate a provider issue.</div>
      <div class="label">Error Rate (1h)</div>
      <div class="value" id="error-rate">—</div>
    </div>
    <div class="card">
      <div class="tooltip">Events waiting to be retried. Retries with exponential backoff: 1min, 5min, 30min, 2hr, 12hr.</div>
      <div class="label">Retry Queue</div>
      <div class="value" id="retry-depth">—</div>
    </div>
    <div class="card">
      <div class="tooltip">Events that failed all 5 retries. Need manual investigation — check raw payload and provider status.</div>
      <div class="label">Dead Letters</div>
      <div class="value" id="dead-letters">—</div>
    </div>
  </div>

  <div class="section">
    <h2 class="collapsible" onclick="toggleSection('health')"><span class="arrow open" id="arrow-health">&#9654;</span> Provider Health</h2>
    <div class="collapsible-content" id="section-health">
      <div id="health-scores" style="display:flex; gap:12px; flex-wrap:wrap; justify-content:center;">
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
      <option value="stripe">Stripe</option>
      <option value="datadog">Datadog</option>
      <option value="github">GitHub</option>
      <option value="system">System</option>
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
    <button onclick="clearFilters()" id="clear-filters-btn" style="display:none; background:#30363d; color:#e1e4e8; border:1px solid #484f58; padding:8px 12px; border-radius:6px; cursor:pointer; font-size:13px;">Clear filters</button>
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
          <option value="sms">SMS</option>
          <option value="call">Voice Call</option>
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

  <div class="modal-overlay" id="event-modal" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header">
        <h2 id="modal-title">Event Detail</h2>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div id="modal-body">Loading...</div>
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
  zendesk: '#49c6d4',
  stripe: '#635bff',
  datadog: '#632ca6',
  github: '#8b949e',
  system: '#d2a8ff',
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
  const loadingBar = document.getElementById('loading-bar');
  loadingBar.style.width = '30%';
  document.body.classList.add('loading');

  try {
    // Build filtered events URL
    const filterProvider = document.getElementById('filter-provider').value;
    const filterSeverity = document.getElementById('filter-severity').value;
    const filterStatus = document.getElementById('filter-status').value;
    let eventsUrl = '/api/events?tenant_id=' + tenant + '&limit=10';
    if (filterProvider) eventsUrl += '&provider=' + filterProvider;
    if (filterStatus) eventsUrl += '&status=' + filterStatus;

    // Fetch health, stats, events, failures in parallel
    const [health, stats, events, failures] = await Promise.all([
      api('/api/health'),
      api('/api/stats?tenant_id=' + tenant),
      api(eventsUrl),
      api('/api/events?tenant_id=' + tenant + '&status=failed&limit=10'),
    ]);

    loadingBar.style.width = '70%';

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
          return '<div data-health-provider="' + p.provider + '" style="background:' + bg + ';border:1px solid ' + color + ';border-radius:8px;padding:14px 18px;min-width:140px;cursor:pointer;" title="Click to filter events by ' + p.provider + '">'
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
        '<tr data-event-id="' + e.id + '" style="cursor:pointer;">'
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

    loadingBar.style.width = '100%';
    setTimeout(function() { loadingBar.style.width = '0%'; }, 500);
    document.body.classList.remove('loading');
    document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();

  } catch (err) {
    banner.textContent = 'Error loading dashboard: ' + err.message;
    banner.style.display = 'block';
    document.getElementById('status-dot').className = 'dot red';
    document.getElementById('status-text').textContent = 'Error';
    loadingBar.style.width = '0%';
    document.body.classList.remove('loading');
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
  else if (type === 'sms') dest.placeholder = '+1234567890';
  else if (type === 'call') dest.placeholder = '+1234567890 (phone will ring)';
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

async function openEventModal(eventId) {
  const modal = document.getElementById('event-modal');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');
  modal.classList.add('open');
  body.innerHTML = '<div class="empty">Loading...</div>';

  try {
    const event = await api('/api/events/' + eventId);

    title.textContent = event.provider + ' — ' + event.event_type;

    let html = '<div class="detail-grid">';
    html += '<div class="detail-label">Event ID</div><div class="detail-value" style="font-family:monospace;font-size:12px;">' + esc(event.id) + '</div>';
    html += '<div class="detail-label">Provider</div><div class="detail-value">' + esc(event.provider) + '</div>';
    html += '<div class="detail-label">Event Type</div><div class="detail-value">' + esc(event.event_type) + '</div>';
    html += '<div class="detail-label">Severity</div><div class="detail-value"><span class="badge ' + event.severity + '">' + event.severity + '</span></div>';
    html += '<div class="detail-label">Status</div><div class="detail-value"><span class="badge ' + event.status + '">' + event.status + '</span></div>';
    html += '<div class="detail-label">Summary</div><div class="detail-value">' + esc(event.summary) + '</div>';
    html += '<div class="detail-label">Tenant</div><div class="detail-value">' + esc(event.tenant_id) + '</div>';
    html += '<div class="detail-label">Received</div><div class="detail-value">' + esc(event.received_at) + '</div>';
    html += '<div class="detail-label">Processed</div><div class="detail-value">' + esc(event.processed_at || '—') + '</div>';
    html += '</div>';

    // Raw payload
    html += '<h3 style="font-size:13px;color:#8b949e;margin:16px 0 8px;">Raw Payload</h3>';
    const payload = typeof event.raw_payload === 'string' ? event.raw_payload : JSON.stringify(event.raw_payload, null, 2);
    html += '<div class="payload-box">' + esc(payload) + '</div>';

    // Remediation (fetch playbooks for this tenant)
    try {
      const tenant = document.getElementById('tenant-input').value.trim();
      const pb = await api('/api/playbooks?tenant_id=' + tenant);
      const playbooks = (pb.playbooks || []).filter(function(p) {
        if (p.provider_filter && p.provider_filter !== event.provider) return false;
        const pat = p.event_pattern;
        if (pat === '*') return true;
        if (pat === event.event_type) return true;
        if (pat.endsWith('.*') && event.event_type.startsWith(pat.slice(0,-2) + '.')) return true;
        if (event.event_type.startsWith(pat + '.')) return true;
        return false;
      });
      if (playbooks.length > 0) {
        playbooks.forEach(function(p) {
          let steps = [];
          try { steps = JSON.parse(p.steps); } catch {}
          html += '<div class="remediation-box">';
          html += '<h3>' + esc(p.title) + '</h3>';
          html += '<ol>' + steps.map(function(s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
          html += '</div>';
        });
      }
    } catch (e) { /* playbooks optional */ }

    // Actions
    html += '<div style="margin-top:16px;display:flex;gap:8px;">';
    html += '<button data-replay-id="' + event.id + '" style="background:#238636;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;">Replay Event</button>';
    html += '<button onclick="closeModal()" style="background:#30363d;color:#e1e4e8;border:1px solid #484f58;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;">Close</button>';
    html += '</div>';

    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = '<div class="empty">Error loading event: ' + esc(err.message) + '</div>';
  }
}

function closeModal() {
  document.getElementById('event-modal').classList.remove('open');
}

async function replayEvent(eventId) {
  try {
    await fetch(BASE + '/api/replay/' + eventId, { method: 'POST' });
    closeModal();
    loadDashboard();
  } catch (err) { alert('Replay failed: ' + err.message); }
}

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

// Delegated click handlers
document.addEventListener('click', function(e) {
  var row = e.target.closest('tr[data-event-id]');
  if (row) openEventModal(row.getAttribute('data-event-id'));
  var replayBtn = e.target.closest('[data-replay-id]');
  if (replayBtn) replayEvent(replayBtn.getAttribute('data-replay-id'));
  var healthCard = e.target.closest('[data-health-provider]');
  if (healthCard) {
    var prov = healthCard.getAttribute('data-health-provider');
    document.getElementById('filter-provider').value = prov;
    document.getElementById('clear-filters-btn').style.display = 'inline-block';
    applyFilters();
    document.getElementById('section-events').scrollIntoView({ behavior: 'smooth' });
  }
});

async function runAIAnalysis() {
  const tenant = document.getElementById('tenant-input').value.trim();
  if (!tenant) { alert('Enter a tenant ID first'); return; }
  var btn = document.getElementById('ai-btn');
  var aiStatus = document.getElementById('ai-status');
  btn.disabled = true;
  aiStatus.textContent = 'Analyzing events...';

  try {
    var res = await fetch(BASE + '/api/analyze?tenant_id=' + tenant, { method: 'POST' });
    var data = await res.json();
    var panel = document.getElementById('ai-panel');
    panel.style.display = 'block';

    var modeLabel = data.mode === 'ai' ? 'Claude AI' : 'Structured';
    var summaryHTML = '<p style="color:#e1e4e8;">' + esc(data.summary) + '</p>';

    var detailsHTML = '';
    if (data.details && data.details.length > 0) {
      detailsHTML += '<div style="margin-bottom:12px;"><strong style="color:#8b949e;font-size:12px;">DETAILS</strong>';
      detailsHTML += '<ul style="margin:4px 0 0 16px;font-size:12px;color:#e1e4e8;">';
      data.details.forEach(function(d) { detailsHTML += '<li style="padding:2px 0;">' + esc(d) + '</li>'; });
      detailsHTML += '</ul></div>';
    }

    if (data.risks && data.risks.length > 0) {
      detailsHTML += '<div style="margin-bottom:12px;"><strong style="color:#f85149;font-size:12px;">RISKS</strong>';
      detailsHTML += '<ul style="margin:4px 0 0 16px;font-size:12px;color:#f85149;">';
      data.risks.forEach(function(r) { detailsHTML += '<li style="padding:2px 0;">' + esc(r) + '</li>'; });
      detailsHTML += '</ul></div>';
    }

    if (data.recommendations && data.recommendations.length > 0) {
      detailsHTML += '<div><strong style="color:#3fb950;font-size:12px;">RECOMMENDATIONS</strong>';
      detailsHTML += '<ol style="margin:4px 0 0 16px;font-size:12px;color:#3fb950;">';
      data.recommendations.forEach(function(r) { detailsHTML += '<li style="padding:2px 0;">' + esc(r) + '</li>'; });
      detailsHTML += '</ol></div>';
    }

    document.getElementById('ai-summary').innerHTML = '<span style="font-size:10px;color:#d2a8ff;background:#2d1b4e;padding:2px 6px;border-radius:4px;margin-right:8px;">' + modeLabel + '</span>' + summaryHTML;
    document.getElementById('ai-details').innerHTML = detailsHTML;
    aiStatus.textContent = 'Analysis complete (' + data.mode + ')';
    setTimeout(function() { aiStatus.textContent = ''; }, 5000);
  } catch (err) {
    aiStatus.textContent = 'Error: ' + err.message;
  }
  btn.disabled = false;
}

function clearFilters() {
  document.getElementById('filter-provider').value = '';
  document.getElementById('filter-severity').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('search-input').value = '';
  document.getElementById('clear-filters-btn').style.display = 'none';
  loadDashboard();
}

function applyFilters() {
  var hasFilter = document.getElementById('filter-provider').value ||
    document.getElementById('filter-severity').value ||
    document.getElementById('filter-status').value ||
    document.getElementById('search-input').value.trim();
  document.getElementById('clear-filters-btn').style.display = hasFilter ? 'inline-block' : 'none';
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

  const allProviders = ['hubspot', 'shopify', 'linear', 'intercom', 'gusto', 'salesforce', 'pagerduty', 'zendesk', 'stripe', 'datadog', 'github'];

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
