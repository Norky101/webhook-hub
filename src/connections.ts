/**
 * Connections Page — manage all integrations from one place
 * Shows active forwarding channels, correlation rules, and playbooks
 * Toggle channels on/off, view status, manage rules
 */
export function connectionsHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><circle cx='14' cy='14' r='6' fill='none' stroke='%2358a6ff' stroke-width='2'/><circle cx='14' cy='14' r='2.5' fill='%2358a6ff'/><circle cx='4' cy='4' r='2' fill='%233fb950'/><circle cx='24' cy='4' r='2' fill='%23f85149'/><circle cx='4' cy='24' r='2' fill='%23d29922'/><circle cx='24' cy='24' r='2' fill='%23bc8cff'/><circle cx='14' cy='2' r='2' fill='%23ff7a59'/><circle cx='14' cy='26' r='2' fill='%2396bf48'/></svg>">
  <title>Webhook Hub — Connections</title>
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
    .nav { display: flex; gap: 16px; font-size: 13px; }
    .nav a { color: #58a6ff; text-decoration: none; }
    .nav a:hover { text-decoration: underline; }
    .controls {
      display: flex; gap: 12px; align-items: center; margin-bottom: 24px;
    }
    .controls input {
      background: #161b22; border: 1px solid #30363d; color: #e1e4e8;
      padding: 8px 12px; border-radius: 6px; font-size: 13px;
    }
    .controls button {
      background: #238636; color: white; border: none;
      padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px;
    }
    .section { margin-bottom: 32px; }
    .section h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #8b949e; }
    .channel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; }
    .channel-card {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px;
    }
    .channel-card.active { border-color: #3fb950; }
    .channel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .channel-name { font-size: 14px; font-weight: 600; }
    .channel-icon { font-size: 20px; }
    .channel-status { font-size: 12px; color: #8b949e; margin-bottom: 8px; }
    .channel-dest { font-size: 12px; color: #58a6ff; word-break: break-all; }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
    }
    .badge.on { background: #0d3321; color: #3fb950; }
    .badge.off { background: #21262d; color: #484f58; }
    .toggle {
      width: 44px; height: 24px; border-radius: 12px; border: none;
      cursor: pointer; position: relative; transition: background 0.2s;
    }
    .toggle.on { background: #238636; }
    .toggle.off { background: #30363d; }
    .toggle::after {
      content: ''; position: absolute; top: 3px; width: 18px; height: 18px;
      border-radius: 50%; background: #e1e4e8; transition: left 0.2s;
    }
    .toggle.on::after { left: 23px; }
    .toggle.off::after { left: 3px; }
    .toggle:hover { opacity: 0.85; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 12px; border-bottom: 1px solid #21262d; }
    td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #161b22; }
    tr:hover td { background: #161b22; }
    .empty { color: #484f58; font-style: italic; padding: 20px; text-align: center; }
    @media (max-width: 768px) {
      body { padding: 12px; }
      .header { flex-direction: column; align-items: flex-start; gap: 8px; }
      .channel-grid { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; white-space: nowrap; }
      th, td { padding: 6px 8px; font-size: 12px; }
    }
    .delete-btn {
      background: #3d1418; color: #f85149; border: 1px solid #f85149;
      padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <a href="/dashboard" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:#e1e4e8;">
      <svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="6" fill="none" stroke="#58a6ff" stroke-width="2"/><circle cx="14" cy="14" r="2.5" fill="#58a6ff"/><circle cx="4" cy="4" r="2" fill="#3fb950"/><line x1="6" y1="6" x2="10" y2="10" stroke="#3fb950" stroke-width="1.5" opacity="0.6"/><circle cx="24" cy="4" r="2" fill="#f85149"/><line x1="22" y1="6" x2="18" y2="10" stroke="#f85149" stroke-width="1.5" opacity="0.6"/><circle cx="4" cy="24" r="2" fill="#d29922"/><line x1="6" y1="22" x2="10" y2="18" stroke="#d29922" stroke-width="1.5" opacity="0.6"/><circle cx="24" cy="24" r="2" fill="#bc8cff"/><line x1="22" y1="22" x2="18" y2="18" stroke="#bc8cff" stroke-width="1.5" opacity="0.6"/><circle cx="14" cy="2" r="2" fill="#ff7a59"/><line x1="14" y1="4" x2="14" y2="8" stroke="#ff7a59" stroke-width="1.5" opacity="0.6"/><circle cx="14" cy="26" r="2" fill="#96bf48"/><line x1="14" y1="24" x2="14" y2="20" stroke="#96bf48" stroke-width="1.5" opacity="0.6"/></svg>
      <h1>Connections</h1>
    </a>
    <div class="nav">
      <a href="/dashboard">Dashboard</a>
      <a href="/connections">Connections</a>
      <a href="/account">Account</a>
      <a href="/account#plans" style="font-size:12px;color:white;background:#238636;padding:4px 12px;border-radius:12px;text-decoration:none;font-weight:600;">Upgrade</a>
    </div>
  </div>

  <div class="controls">
    <input type="text" id="tenant-input" placeholder="Enter tenant ID" value="">
    <button onclick="loadConnections()">Load</button>
  </div>

  <div class="section">
    <h2>Forwarding Channels</h2>
    <div class="channel-grid" id="channels">
      <div class="empty">Enter a tenant ID above</div>
    </div>
  </div>

  <div class="section">
    <h2>Correlation Rules</h2>
    <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap; align-items:center;">
      <input type="text" id="corr-name" placeholder="Rule name" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;width:130px;">
      <input type="text" id="corr-provider-a" placeholder="Provider A" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;width:100px;">
      <input type="text" id="corr-pattern-a" placeholder="Pattern A (e.g. payment.*)" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;width:140px;">
      <input type="text" id="corr-provider-b" placeholder="Provider B" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;width:100px;">
      <input type="text" id="corr-pattern-b" placeholder="Pattern B (e.g. ticket.*)" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;width:140px;">
      <input type="number" id="corr-window" placeholder="30" value="30" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;width:50px;">
      <span style="font-size:11px;color:#8b949e;">min</span>
      <input type="text" id="corr-action" placeholder="Action to take" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;flex:1;min-width:120px;">
      <button onclick="addCorrelation()" style="background:#238636;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;">Add Rule</button>
    </div>
    <table>
      <thead>
        <tr><th>Name</th><th>Provider A</th><th>Pattern A</th><th>Provider B</th><th>Pattern B</th><th>Window</th><th>Action</th><th></th></tr>
      </thead>
      <tbody id="correlations-table">
        <tr><td colspan="8" class="empty">No correlation rules</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Remediation Playbooks</h2>
    <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap; align-items:center;">
      <input type="text" id="pb-pattern" placeholder="Event pattern (e.g. incident.*)" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;width:160px;">
      <input type="text" id="pb-provider" placeholder="Provider (or blank for all)" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;width:150px;">
      <input type="text" id="pb-title" placeholder="Playbook title" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;width:150px;">
      <input type="text" id="pb-steps" placeholder="Step 1 | Step 2 | Step 3 (pipe separated)" style="background:#161b22;border:1px solid #30363d;color:#e1e4e8;padding:6px 10px;border-radius:6px;font-size:12px;flex:1;min-width:200px;">
      <button onclick="addPlaybook()" style="background:#238636;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;">Add Playbook</button>
    </div>
    <table>
      <thead>
        <tr><th>Event Pattern</th><th>Provider</th><th>Title</th><th>Steps</th><th></th></tr>
      </thead>
      <tbody id="playbooks-table">
        <tr><td colspan="5" class="empty">No playbooks</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Agent API</h2>
    <p style="font-size:12px; color:#8b949e; margin-bottom:12px;">Connect AI agents (OpenClaw, LangChain, CrewAI, GPT Actions) to listen for events and take automated actions.</p>
    <div class="channel-grid">
      <div class="channel-card active" style="border-color:#d2a8ff;">
        <div class="channel-header">
          <span class="channel-name" style="color:#d2a8ff;">OpenAPI Spec</span>
          <button onclick="copyToClipboard(BASE+'/api/openapi.json')" style="background:#30363d;color:#e1e4e8;border:1px solid #484f58;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Copy URL</button>
        </div>
        <div class="channel-status">Machine-readable API discovery</div>
        <div class="channel-dest" id="openapi-url"></div>
      </div>
      <div class="channel-card active" style="border-color:#d2a8ff;">
        <div class="channel-header">
          <span class="channel-name" style="color:#d2a8ff;">Agent Event Feed</span>
          <button onclick="copyToClipboard(BASE+'/api/agent/feed?tenant_id='+document.getElementById('tenant-input').value)" style="background:#30363d;color:#e1e4e8;border:1px solid #484f58;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Copy URL</button>
        </div>
        <div class="channel-status">Events with suggested actions for agents</div>
        <div class="channel-dest" id="feed-url"></div>
      </div>
      <div class="channel-card active" style="border-color:#d2a8ff;">
        <div class="channel-header">
          <span class="channel-name" style="color:#d2a8ff;">Agent Actions</span>
          <button onclick="copyToClipboard(BASE+'/api/agent/action')" style="background:#30363d;color:#e1e4e8;border:1px solid #484f58;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Copy URL</button>
        </div>
        <div class="channel-status">POST — 6 actions: replay, forwarding, playbooks, automations, alerts, toggle</div>
        <div class="channel-dest" id="action-url"></div>
      </div>
      <div class="channel-card active" style="border-color:#d2a8ff;">
        <div class="channel-header">
          <span class="channel-name" style="color:#d2a8ff;">AI Analysis</span>
          <button onclick="copyToClipboard(BASE+'/api/analyze?tenant_id='+document.getElementById('tenant-input').value)" style="background:#30363d;color:#e1e4e8;border:1px solid #484f58;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Copy URL</button>
        </div>
        <div class="channel-status">POST — Claude-powered or structured event analysis</div>
        <div class="channel-dest" id="analyze-url"></div>
      </div>
    </div>
  </div>

<script>
const BASE = location.origin;
const CHANNEL_ICONS = { email: '\\u2709', slack: '\\u{1F4AC}', sms: '\\u{1F4F1}', call: '\\u{1F4DE}', webhook: '\\u{1F517}' };
const CHANNEL_NAMES = { email: 'Email', slack: 'Slack', sms: 'SMS', call: 'Voice Call', webhook: 'Webhook URL' };

async function api(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

async function loadConnections() {
  const tenant = document.getElementById('tenant-input').value.trim();
  if (!tenant) return;

  updateAgentURLs();

  // Load forwarding rules
  try {
    const fwd = await api('/api/forwarding?tenant_id=' + tenant);
    const channels = document.getElementById('channels');
    const rules = fwd.rules || [];

    // Group by type
    const byType = {};
    rules.forEach(r => {
      if (!byType[r.destination_type]) byType[r.destination_type] = [];
      byType[r.destination_type].push(r);
    });

    // Show all channel types (even unconfigured ones)
    const allTypes = ['email', 'slack', 'sms', 'call', 'webhook'];
    let cardsHTML = allTypes.map(type => {
      const typeRules = byType[type] || [];
      const active = typeRules.length > 0 && typeRules.some(r => r.active === 1);
      const names = typeRules.length > 0 ? typeRules.map(r => {
        const label = esc(r.name || r.destination);
        const isOn = r.active === 1;
        return '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">'
          + '<button class="toggle ' + (isOn ? 'on' : 'off') + '" onclick="toggleRule(' + r.id + ',' + (isOn ? 0 : 1) + ')"></button>'
          + '<span style="font-size:12px;color:' + (isOn ? '#e1e4e8' : '#484f58') + ';">' + label + '</span>'
          + '</div>';
      }).join('') : '<div style="font-size:12px;color:#484f58;margin-top:6px;">Not configured</div>';
      const severity = typeRules.length > 0 ? (typeRules[0].severity_filter || 'all') : '—';
      return '<div class="channel-card ' + (active ? 'active' : '') + '">'
        + '<div class="channel-header">'
        + '<span class="channel-name">' + (CHANNEL_ICONS[type] || '') + ' ' + (CHANNEL_NAMES[type] || type) + '</span>'
        + '<span class="badge ' + (active ? 'on' : 'off') + '">' + (active ? 'Active' : 'Off') + '</span>'
        + '</div>'
        + '<div class="channel-status">Severity: ' + severity + ' | Rules: ' + typeRules.length + '</div>'
        + names
        + '</div>';
    }).join('');

    // Add health digest Slack card (configured via Worker secret, not forwarding rules)
    cardsHTML += '<div class="channel-card active">'
      + '<div class="channel-header">'
      + '<span class="channel-name">\\u{1F4CA} Slack Health Digest</span>'
      + '<span class="badge on">Active</span>'
      + '</div>'
      + '<div class="channel-status">Schedule: every 20 minutes | Via: cron trigger</div>'
      + '<div class="channel-dest">#provider-health-stats</div>'
      + '</div>';

    channels.innerHTML = cardsHTML;
  } catch (e) { /* ignore */ }

  // Load correlation rules
  try {
    const corr = await api('/api/correlations?tenant_id=' + tenant);
    const table = document.getElementById('correlations-table');
    const rules = corr.rules || [];
    if (rules.length === 0) {
      table.innerHTML = '<tr><td colspan="8" class="empty">No correlation rules</td></tr>';
    } else {
      table.innerHTML = rules.map(r =>
        '<tr>'
        + '<td>' + esc(r.name) + '</td>'
        + '<td>' + r.provider_a + '</td>'
        + '<td>' + r.event_pattern_a + '</td>'
        + '<td>' + r.provider_b + '</td>'
        + '<td>' + r.event_pattern_b + '</td>'
        + '<td>' + r.time_window_minutes + 'min</td>'
        + '<td style="font-size:12px;">' + esc(r.action_description) + '</td>'
        + '<td><button class="delete-btn" onclick="delCorr(' + r.id + ')">Delete</button></td>'
        + '</tr>'
      ).join('');
    }
  } catch (e) { /* ignore */ }

  // Load playbooks
  try {
    const pb = await api('/api/playbooks?tenant_id=' + tenant);
    const table = document.getElementById('playbooks-table');
    const playbooks = pb.playbooks || [];
    if (playbooks.length === 0) {
      table.innerHTML = '<tr><td colspan="5" class="empty">No playbooks</td></tr>';
    } else {
      table.innerHTML = playbooks.map(r => {
        let steps = [];
        try { steps = JSON.parse(r.steps); } catch {}
        return '<tr>'
          + '<td>' + esc(r.event_pattern) + '</td>'
          + '<td>' + (r.provider_filter || 'all') + '</td>'
          + '<td>' + esc(r.title) + '</td>'
          + '<td style="font-size:12px;">' + steps.map((s,i) => (i+1) + '. ' + esc(s)).join('<br>') + '</td>'
          + '<td><button class="delete-btn" onclick="delPlaybook(' + r.id + ')">Delete</button></td>'
          + '</tr>';
      }).join('');
    }
  } catch (e) { /* ignore */ }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(function() {
    var btn = event.target;
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = orig; }, 1500);
  });
}

function updateAgentURLs() {
  var tenant = document.getElementById('tenant-input').value.trim() || 'demo_tenant';
  document.getElementById('openapi-url').textContent = BASE + '/api/openapi.json';
  document.getElementById('feed-url').textContent = BASE + '/api/agent/feed?tenant_id=' + tenant;
  document.getElementById('action-url').textContent = BASE + '/api/agent/action';
  document.getElementById('analyze-url').textContent = BASE + '/api/analyze?tenant_id=' + tenant;
}

async function toggleRule(id, newActive) {
  await fetch(BASE + '/api/forwarding/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: newActive }),
  });
  loadConnections();
}

async function addCorrelation() {
  var tenant = document.getElementById('tenant-input').value.trim();
  if (!tenant) { alert('Enter a tenant ID first'); return; }
  var name = document.getElementById('corr-name').value.trim();
  var provA = document.getElementById('corr-provider-a').value.trim();
  var patA = document.getElementById('corr-pattern-a').value.trim();
  var provB = document.getElementById('corr-provider-b').value.trim();
  var patB = document.getElementById('corr-pattern-b').value.trim();
  var window = parseInt(document.getElementById('corr-window').value) || 30;
  var action = document.getElementById('corr-action').value.trim();
  if (!name || !provA || !patA || !provB || !patB || !action) { alert('All fields required'); return; }

  await fetch(BASE + '/api/correlations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenant, name: name, provider_a: provA, event_pattern_a: patA, provider_b: provB, event_pattern_b: patB, time_window_minutes: window, action_description: action }),
  });
  document.getElementById('corr-name').value = '';
  document.getElementById('corr-provider-a').value = '';
  document.getElementById('corr-pattern-a').value = '';
  document.getElementById('corr-provider-b').value = '';
  document.getElementById('corr-pattern-b').value = '';
  document.getElementById('corr-action').value = '';
  loadConnections();
}

async function addPlaybook() {
  var tenant = document.getElementById('tenant-input').value.trim();
  if (!tenant) { alert('Enter a tenant ID first'); return; }
  var pattern = document.getElementById('pb-pattern').value.trim();
  var provider = document.getElementById('pb-provider').value.trim();
  var title = document.getElementById('pb-title').value.trim();
  var stepsRaw = document.getElementById('pb-steps').value.trim();
  if (!pattern || !title || !stepsRaw) { alert('Pattern, title, and steps required'); return; }
  var steps = stepsRaw.split('|').map(function(s) { return s.trim(); }).filter(function(s) { return s; });

  await fetch(BASE + '/api/playbooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenant, event_pattern: pattern, provider_filter: provider || undefined, title: title, steps: steps }),
  });
  document.getElementById('pb-pattern').value = '';
  document.getElementById('pb-provider').value = '';
  document.getElementById('pb-title').value = '';
  document.getElementById('pb-steps').value = '';
  loadConnections();
}

async function delCorr(id) {
  await fetch(BASE + '/api/correlations/' + id, { method: 'DELETE' });
  loadConnections();
}

async function delPlaybook(id) {
  await fetch(BASE + '/api/playbooks/' + id, { method: 'DELETE' });
  loadConnections();
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// Auto-load
const params = new URLSearchParams(location.search);
const defaultTenant = params.get('tenant_id') || 'demo_tenant';
document.getElementById('tenant-input').value = defaultTenant;
loadConnections();
</script>
</body>
</html>`;
}
