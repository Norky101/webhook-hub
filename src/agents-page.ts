/**
 * Agents Page — dedicated page for AI agent integrations
 * Shows OpenAPI spec, agent feed, actions, and AI analysis endpoints
 */
export function agentsPageHTML(): string {
  const logo = `<a href="/dashboard" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:#e1e4e8;"><svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="6" fill="none" stroke="#58a6ff" stroke-width="2"/><circle cx="14" cy="14" r="2.5" fill="#58a6ff"/><circle cx="4" cy="4" r="2" fill="#3fb950"/><line x1="6" y1="6" x2="10" y2="10" stroke="#3fb950" stroke-width="1.5" opacity="0.6"/><circle cx="24" cy="4" r="2" fill="#f85149"/><line x1="22" y1="6" x2="18" y2="10" stroke="#f85149" stroke-width="1.5" opacity="0.6"/><circle cx="4" cy="24" r="2" fill="#d29922"/><line x1="6" y1="22" x2="10" y2="18" stroke="#d29922" stroke-width="1.5" opacity="0.6"/><circle cx="24" cy="24" r="2" fill="#bc8cff"/><line x1="22" y1="22" x2="18" y2="18" stroke="#bc8cff" stroke-width="1.5" opacity="0.6"/><circle cx="14" cy="2" r="2" fill="#ff7a59"/><line x1="14" y1="4" x2="14" y2="8" stroke="#ff7a59" stroke-width="1.5" opacity="0.6"/><circle cx="14" cy="26" r="2" fill="#96bf48"/><line x1="14" y1="24" x2="14" y2="20" stroke="#96bf48" stroke-width="1.5" opacity="0.6"/></svg><h1>Agents</h1></a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'><circle cx='14' cy='14' r='6' fill='none' stroke='%2358a6ff' stroke-width='2'/><circle cx='14' cy='14' r='2.5' fill='%2358a6ff'/><circle cx='4' cy='4' r='2' fill='%233fb950'/><circle cx='24' cy='4' r='2' fill='%23f85149'/><circle cx='4' cy='24' r='2' fill='%23d29922'/><circle cx='24' cy='24' r='2' fill='%23bc8cff'/><circle cx='14' cy='2' r='2' fill='%23ff7a59'/><circle cx='14' cy='26' r='2' fill='%2396bf48'/></svg>">
  <title>Webhook Hub — Agents</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0f1117;
      color: #e1e4e8;
      padding: 24px;
    }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #2d333b;
    }
    .header h1 { font-size: 20px; font-weight: 600; }
    .nav { display: flex; gap: 16px; font-size: 13px; }
    .nav a { color: #58a6ff; text-decoration: none; }
    .nav a:hover { text-decoration: underline; }
    .section { margin-bottom: 32px; }
    .section h2 { font-size: 16px; font-weight: 600; margin-bottom: 8px; color: #d2a8ff; }
    .section p { font-size: 13px; color: #8b949e; margin-bottom: 16px; line-height: 1.5; }
    .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card {
      background: #161b22; border: 1px solid #d2a8ff; border-radius: 8px; padding: 20px;
    }
    .card h3 { font-size: 14px; font-weight: 600; color: #d2a8ff; margin-bottom: 8px; }
    .card .method { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-bottom: 8px; }
    .card .method.get { background: #0d3321; color: #3fb950; }
    .card .method.post { background: #1f3a5f; color: #58a6ff; }
    .card p { font-size: 12px; color: #8b949e; margin-bottom: 12px; }
    .card .url {
      background: #0d1117; border: 1px solid #21262d; border-radius: 4px;
      padding: 8px 12px; font-family: monospace; font-size: 12px; color: #58a6ff;
      word-break: break-all; display: flex; justify-content: space-between; align-items: center;
    }
    .card .url button {
      background: #30363d; color: #e1e4e8; border: 1px solid #484f58;
      padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; flex-shrink: 0; margin-left: 8px;
    }
    .actions-list { margin-top: 12px; }
    .actions-list li { font-size: 12px; color: #e1e4e8; padding: 4px 0; list-style: none; }
    .actions-list li::before { content: '\\u2192 '; color: #d2a8ff; }
    .code-block {
      background: #0d1117; border: 1px solid #21262d; border-radius: 6px;
      padding: 16px; font-family: monospace; font-size: 12px; white-space: pre-wrap;
      word-break: break-all; line-height: 1.5; overflow-x: auto;
    }
    .code-block .key { color: #d2a8ff; }
    .code-block .str { color: #a5d6ff; }
    .code-block .comment { color: #484f58; }
    .test-btn {
      background: #8957e5; color: white; border: none; padding: 8px 16px;
      border-radius: 6px; cursor: pointer; font-size: 13px; margin-top: 8px;
    }
    .test-btn:hover { background: #7048c6; }
    #test-result {
      display: none; background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      padding: 16px; margin-top: 12px; font-family: monospace; font-size: 12px;
      white-space: pre-wrap; max-height: 300px; overflow-y: auto;
    }
    @media (max-width: 768px) {
      body { padding: 12px; }
      .card-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="header">
    ${logo}
    <div class="nav">
      <a href="/dashboard">Dashboard</a>
      <a href="/connections">Connections</a>
      <a href="/agents">Agents</a>
      <a href="/account">Account</a>
      <a href="/account#plans" style="font-size:12px;color:white;background:#238636;padding:4px 12px;border-radius:12px;text-decoration:none;font-weight:600;">Upgrade</a>
    </div>
  </div>

  <div class="section">
    <h2>AI Agent API</h2>
    <p>Connect AI agents (OpenClaw, LangChain, CrewAI, GPT Actions) to Webhook Hub. Agents can discover the API, listen for events with suggested actions, and take automated corrective action — create tickets, set up alerts, toggle forwarding, replay events.</p>
  </div>

  <div class="section">
    <h2>Endpoints</h2>
    <div class="card-grid">

      <div class="card">
        <h3>API Discovery</h3>
        <span class="method get">GET</span>
        <p>Machine-readable OpenAPI spec. Point any agent framework at this URL to auto-discover all endpoints.</p>
        <div class="url"><span id="url-openapi"></span><button onclick="copyUrl('url-openapi')">Copy</button></div>
      </div>

      <div class="card">
        <h3>Event Feed</h3>
        <span class="method get">GET</span>
        <p>Recent events formatted for agent consumption. Each event includes suggested actions and available API actions the agent can execute.</p>
        <div class="url"><span id="url-feed"></span><button onclick="copyUrl('url-feed')">Copy</button></div>
      </div>

      <div class="card">
        <h3>Agent Actions</h3>
        <span class="method post">POST</span>
        <p>Execute actions programmatically. Agents can create rules, replay events, toggle forwarding, and more.</p>
        <div class="url"><span id="url-action"></span><button onclick="copyUrl('url-action')">Copy</button></div>
        <ul class="actions-list">
          <li>replay_event — re-process from raw payload</li>
          <li>create_forwarding_rule — set up email/Slack/SMS/call/webhook</li>
          <li>create_playbook — attach remediation steps to events</li>
          <li>create_automation — trigger action chains on events</li>
          <li>create_alert_rule — monitor metrics with thresholds</li>
          <li>toggle_forwarding_rule — enable/disable a rule</li>
        </ul>
      </div>

      <div class="card">
        <h3>AI Analysis</h3>
        <span class="method post">POST</span>
        <p>Analyze recent events with Claude AI. Returns summary, patterns, risks, and actionable recommendations. Falls back to structured analysis without API key.</p>
        <div class="url"><span id="url-analyze"></span><button onclick="copyUrl('url-analyze')">Copy</button></div>
      </div>

    </div>
  </div>

  <div class="section">
    <h2>Quick Start</h2>
    <p>Copy this into your agent framework to get started:</p>
    <div class="code-block"><span class="comment"># 1. Discover the API</span>
curl <span class="str" id="curl-openapi"></span>

<span class="comment"># 2. Get events with suggested actions</span>
curl <span class="str" id="curl-feed"></span>

<span class="comment"># 3. Take an action</span>
curl -X POST <span class="str" id="curl-action"></span> \\
  -H "Content-Type: application/json" \\
  -d '{"<span class="key">tenant_id</span>":"demo_tenant","<span class="key">action</span>":"create_alert_rule","<span class="key">params</span>":{"name":"Agent alert","metric":"error_rate","threshold":25}}'</div>
  </div>

  <div class="section">
    <h2>Test It</h2>
    <p>Click to fetch the agent feed for demo_tenant and see what an agent receives:</p>
    <button class="test-btn" onclick="testFeed()">Fetch Agent Feed</button>
    <button class="test-btn" onclick="testAnalysis()" style="background:#238636;">Run AI Analysis</button>
    <div id="test-result"></div>
  </div>

<script>
var BASE = location.origin;
var tenant = 'demo_tenant';

function updateURLs() {
  document.getElementById('url-openapi').textContent = BASE + '/api/openapi.json';
  document.getElementById('url-feed').textContent = BASE + '/api/agent/feed?tenant_id=' + tenant;
  document.getElementById('url-action').textContent = BASE + '/api/agent/action';
  document.getElementById('url-analyze').textContent = BASE + '/api/analyze?tenant_id=' + tenant;
  document.getElementById('curl-openapi').textContent = BASE + '/api/openapi.json';
  document.getElementById('curl-feed').textContent = BASE + '/api/agent/feed?tenant_id=' + tenant;
  document.getElementById('curl-action').textContent = BASE + '/api/agent/action';
}

function copyUrl(id) {
  var text = document.getElementById(id).textContent;
  navigator.clipboard.writeText(text).then(function() {
    var btn = event.target;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
  });
}

async function testFeed() {
  var result = document.getElementById('test-result');
  result.style.display = 'block';
  result.textContent = 'Loading...';
  try {
    var res = await fetch(BASE + '/api/agent/feed?tenant_id=' + tenant + '&limit=3');
    var data = await res.json();
    result.textContent = JSON.stringify(data, null, 2);
  } catch(e) { result.textContent = 'Error: ' + e.message; }
}

async function testAnalysis() {
  var result = document.getElementById('test-result');
  result.style.display = 'block';
  result.textContent = 'Analyzing events...';
  try {
    var res = await fetch(BASE + '/api/analyze?tenant_id=' + tenant, { method: 'POST' });
    var data = await res.json();
    result.textContent = JSON.stringify(data, null, 2);
  } catch(e) { result.textContent = 'Error: ' + e.message; }
}

updateURLs();
</script>
</body>
</html>`;
}
