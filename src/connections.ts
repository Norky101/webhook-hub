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
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 12px; border-bottom: 1px solid #21262d; }
    td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #161b22; }
    tr:hover td { background: #161b22; }
    .empty { color: #484f58; font-style: italic; padding: 20px; text-align: center; }
    .delete-btn {
      background: #3d1418; color: #f85149; border: 1px solid #f85149;
      padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Connections</h1>
    <div class="nav">
      <a href="/dashboard">Dashboard</a>
      <a href="/connections">Connections</a>
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
    <table>
      <thead>
        <tr><th>Event Pattern</th><th>Provider</th><th>Title</th><th>Steps</th><th></th></tr>
      </thead>
      <tbody id="playbooks-table">
        <tr><td colspan="5" class="empty">No playbooks</td></tr>
      </tbody>
    </table>
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
    channels.innerHTML = allTypes.map(type => {
      const active = byType[type] && byType[type].length > 0;
      const destinations = active ? byType[type].map(r => r.destination).join(', ') : 'Not configured';
      const severity = active ? (byType[type][0].severity_filter || 'all') : '—';
      return '<div class="channel-card ' + (active ? 'active' : '') + '">'
        + '<div class="channel-header">'
        + '<span class="channel-name">' + (CHANNEL_ICONS[type] || '') + ' ' + (CHANNEL_NAMES[type] || type) + '</span>'
        + '<span class="badge ' + (active ? 'on' : 'off') + '">' + (active ? 'Active' : 'Off') + '</span>'
        + '</div>'
        + '<div class="channel-status">Severity: ' + severity + ' | Rules: ' + (active ? byType[type].length : 0) + '</div>'
        + '<div class="channel-dest">' + esc(destinations) + '</div>'
        + '</div>';
    }).join('');
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
