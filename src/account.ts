/**
 * Account Page — user profile, subscription plan, tenant details
 * Demo page showing what a logged-in user would see
 */
export function accountHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Webhook Hub — Account</title>
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
    .section { margin-bottom: 32px; }
    .section h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #8b949e; }
    .card {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;
      margin-bottom: 16px;
    }
    .detail-grid { display: grid; grid-template-columns: 160px 1fr; gap: 12px; }
    .detail-label { font-size: 13px; color: #8b949e; }
    .detail-value { font-size: 13px; }
    .badge {
      display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
    }
    .badge.pro { background: #1f3a5f; color: #58a6ff; }
    .badge.active { background: #0d3321; color: #3fb950; }
    .usage-bar-track { height: 8px; background: #21262d; border-radius: 4px; margin-top: 4px; }
    .usage-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
    .tier-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 16px; }
    .tier-card {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px;
    }
    .tier-card.current { border-color: #58a6ff; }
    .tier-name { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .tier-price { font-size: 24px; font-weight: 700; color: #58a6ff; margin-bottom: 8px; }
    .tier-features { font-size: 12px; color: #8b949e; line-height: 1.8; }
    .tier-btn {
      margin-top: 12px; padding: 6px 16px; border-radius: 6px; font-size: 12px; cursor: pointer; border: none;
    }
    .tier-btn.current { background: #30363d; color: #8b949e; cursor: default; }
    .tier-btn.upgrade { background: #238636; color: white; }
    @media (max-width: 768px) {
      body { padding: 12px; }
      .detail-grid { grid-template-columns: 1fr; }
      .tier-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Account</h1>
    <div class="nav">
      <a href="/dashboard">Dashboard</a>
      <a href="/connections">Connections</a>
      <a href="/account">Account</a>
    </div>
  </div>

  <div class="section">
    <h2>Profile</h2>
    <div class="card">
      <div class="detail-grid">
        <div class="detail-label">Name</div>
        <div class="detail-value">Noah Pilkington</div>
        <div class="detail-label">Email</div>
        <div class="detail-value">noah@webhook-hub.dev</div>
        <div class="detail-label">Role</div>
        <div class="detail-value">Admin</div>
        <div class="detail-label">Tenant</div>
        <div class="detail-value">demo_tenant</div>
        <div class="detail-label">Status</div>
        <div class="detail-value"><span class="badge active">Active</span></div>
        <div class="detail-label">Member since</div>
        <div class="detail-value">April 2026</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Subscription</h2>
    <div class="card">
      <div class="detail-grid">
        <div class="detail-label">Current plan</div>
        <div class="detail-value"><span class="badge pro">Pro</span> $29/mo</div>
        <div class="detail-label">Billing cycle</div>
        <div class="detail-value">Monthly — renews May 14, 2026</div>
        <div class="detail-label">Payment method</div>
        <div class="detail-value">Visa ending 4242</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Usage (this month)</h2>
    <div class="card">
      <div class="detail-grid">
        <div class="detail-label">Events processed</div>
        <div class="detail-value" id="usage-events">Loading...</div>
        <div class="detail-label">Events limit</div>
        <div class="detail-value">25,000 / month</div>
        <div class="detail-label">Usage</div>
        <div class="detail-value">
          <div class="usage-bar-track"><div class="usage-bar-fill" id="usage-bar" style="width:0%;background:#3fb950;"></div></div>
        </div>
        <div class="detail-label">Providers active</div>
        <div class="detail-value" id="usage-providers">Loading...</div>
        <div class="detail-label">Providers limit</div>
        <div class="detail-value">All (Pro plan)</div>
        <div class="detail-label">Forwarding channels</div>
        <div class="detail-value" id="usage-channels">Loading...</div>
        <div class="detail-label">Team members</div>
        <div class="detail-value">1 / 5</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2 id="plans">Plans</h2>
    <div class="tier-grid">
      <div class="tier-card">
        <div class="tier-name">Free</div>
        <div class="tier-price">$0</div>
        <div class="tier-features">
          2 providers<br>
          1,000 events/mo<br>
          7-day retention<br>
          1 user<br>
          Dashboard only
        </div>
        <button class="tier-btn current" disabled>Downgrade</button>
      </div>
      <div class="tier-card current">
        <div class="tier-name" style="color:#58a6ff;">Pro <span class="badge pro">Current</span></div>
        <div class="tier-price">$29/mo</div>
        <div class="tier-features">
          All providers<br>
          25,000 events/mo<br>
          30-day retention<br>
          5 users<br>
          Search, export, notifications
        </div>
        <button class="tier-btn current" disabled>Current plan</button>
      </div>
      <div class="tier-card">
        <div class="tier-name">Business</div>
        <div class="tier-price">$99/mo</div>
        <div class="tier-features">
          All providers + extras<br>
          100,000 events/mo<br>
          90-day retention<br>
          15 users + roles<br>
          Automations, correlation, AI
        </div>
        <button class="tier-btn upgrade">Upgrade</button>
      </div>
      <div class="tier-card">
        <div class="tier-name">Enterprise</div>
        <div class="tier-price">Custom</div>
        <div class="tier-features">
          Unlimited everything<br>
          1-year retention<br>
          SSO/SAML<br>
          Dedicated infrastructure<br>
          SLA guarantee
        </div>
        <button class="tier-btn upgrade">Contact sales</button>
      </div>
    </div>
  </div>

<script>
const BASE = location.origin;

async function loadUsage() {
  try {
    const health = await (await fetch(BASE + '/api/health')).json();
    const stats = await (await fetch(BASE + '/api/stats?tenant_id=demo_tenant')).json();
    const fwd = await (await fetch(BASE + '/api/forwarding?tenant_id=demo_tenant')).json();

    const eventCount = stats.total || 0;
    const limit = 25000;
    const pct = Math.min((eventCount / limit) * 100, 100);

    document.getElementById('usage-events').textContent = eventCount.toLocaleString() + ' / 25,000';
    document.getElementById('usage-bar').style.width = pct + '%';
    document.getElementById('usage-bar').style.background = pct > 80 ? '#f85149' : pct > 50 ? '#d29922' : '#3fb950';
    document.getElementById('usage-providers').textContent = health.providers.length + ' active';

    const channels = {};
    (fwd.rules || []).forEach(function(r) { if (r.active) channels[r.destination_type] = true; });
    document.getElementById('usage-channels').textContent = Object.keys(channels).join(', ') || 'None configured';
  } catch (e) { /* ignore */ }
}

loadUsage();
</script>
</body>
</html>`;
}
