const API = '';  // same origin
const PRIMARY_WALLET = '0x6e4c6da09f06690cc4db53d42ab539d3d4882015';

let ws = null;
let charts = {};
let activeTab = {};

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => setStatus(true);
  ws.onclose = () => { setStatus(false); setTimeout(connectWS, 3000); };
  ws.onerror = () => setStatus(false);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === 'positions_update') {
      if (document.getElementById('page-overview').classList.contains('active')) {
        renderOverview(msg.summary, msg.positions);
      }
    }
    if (msg.event === 'notification' || msg.event === 'wallet_change') {
      addNotification(msg.notification);
    }
  };
}

function setStatus(online) {
  document.getElementById('ws-status').className = 'status-dot' + (online ? '' : ' off');
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  const loaders = { overview: loadOverview, trades: loadTrades, funding: loadFunding, flows: loadFlows, phases: loadPhases, watchlist: loadWatchlist, settings: loadSettings };
  if (loaders[page]) loaders[page]();
}

// ── Overview ──────────────────────────────────────────────────────────────────

async function loadOverview() {
  const el = document.getElementById('overview-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading positions…</div>';
  try {
    const data = await fetch(`${API}/api/positions?wallet=${PRIMARY_WALLET}`).then(r => r.json());
    renderOverview(data.summary, data.positions);
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function renderOverview(summary, positions) {
  const pnlClass = summary.total_ntl_pos >= 0 ? 'pos' : 'neg';
  document.getElementById('overview-content').innerHTML = `
    <div class="grid-4">
      <div class="stat-card">
        <div class="stat-label">Account Value</div>
        <div class="stat-value">${fmt$(summary.account_value)}</div>
        <div class="stat-sub">Withdrawable: ${fmt$(summary.withdrawable)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Notional</div>
        <div class="stat-value">${fmt$(summary.total_ntl_pos)}</div>
        <div class="stat-sub">Positions open: ${positions.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Margin Used</div>
        <div class="stat-value">${fmt$(summary.total_margin_used)}</div>
        <div class="stat-sub">${summary.account_value > 0 ? ((summary.total_margin_used / summary.account_value)*100).toFixed(1) : 0}% of account</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Unrealized PnL</div>
        <div class="stat-value ${positions.reduce((a,p)=>a+p.unrealized_pnl,0)>=0?'pos':'neg'}">${fmt$(positions.reduce((a,p)=>a+p.unrealized_pnl,0))}</div>
        <div class="stat-sub">Across ${positions.length} position(s)</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Open Positions</div>
      ${positions.length === 0 ? '<div class="loading" style="padding:20px">No open positions</div>' : `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Coin</th><th>Side</th><th>Size</th><th>Entry</th>
            <th>Liq Price</th><th>Unr. PnL</th><th>Funding</th><th>Leverage</th>
          </tr></thead>
          <tbody>
            ${positions.map(p => `
            <tr>
              <td class="accent">${p.coin}</td>
              <td><span class="side-badge ${p.side}">${p.side.toUpperCase()}</span></td>
              <td>${p.size}</td>
              <td>${fmt$(p.entry_price)}</td>
              <td class="${p.liquidation_price > 0 ? 'neg' : 'muted'}">${p.liquidation_price > 0 ? fmt$(p.liquidation_price) : '—'}</td>
              <td class="${p.unrealized_pnl>=0?'pos':'neg'}">${fmt$(p.unrealized_pnl)}</td>
              <td class="${p.cum_funding>=0?'pos':'neg'}">${p.cum_funding.toFixed(4)}</td>
              <td>${p.leverage_value}x ${p.leverage_type}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>
  `;
}

// ── Trades ────────────────────────────────────────────────────────────────────

async function loadTrades() {
  const el = document.getElementById('trades-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading trades…</div>';
  try {
    const data = await fetch(`${API}/api/trades?wallet=${PRIMARY_WALLET}&limit=200`).then(r => r.json());
    const trades = data.trades;
    const totalPnl = trades.reduce((a,t) => a+t.closed_pnl, 0);
    const wins = trades.filter(t => t.closed_pnl > 0).length;
    const wr = trades.length > 0 ? (wins/trades.length*100).toFixed(1) : 0;

    el.innerHTML = `
      <div class="grid-3" style="margin-bottom:20px">
        <div class="stat-card">
          <div class="stat-label">Total Trades</div>
          <div class="stat-value">${trades.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Realized PnL</div>
          <div class="stat-value ${totalPnl>=0?'pos':'neg'}">${fmt$(totalPnl)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Win Rate</div>
          <div class="stat-value">${wr}%</div>
          <div class="stat-sub">${wins} wins / ${trades.length - wins} losses</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Fill History</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Time</th><th>Coin</th><th>Side</th><th>Price</th><th>Size</th><th>Fee</th><th>Closed PnL</th>
            </tr></thead>
            <tbody>
              ${trades.slice(0,100).map(t => `
              <tr>
                <td class="muted">${fmtTime(t.time)}</td>
                <td class="accent">${t.coin}</td>
                <td><span class="side-badge ${t.side==='B'?'long':'short'}">${t.side==='B'?'BUY':'SELL'}</span></td>
                <td>${fmt$(t.price)}</td>
                <td>${t.size}</td>
                <td class="neg">${t.fee.toFixed(4)}</td>
                <td class="${t.closed_pnl>=0?'pos':'neg'}">${t.closed_pnl !== 0 ? fmt$(t.closed_pnl) : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

// ── Funding ───────────────────────────────────────────────────────────────────

async function loadFunding() {
  const el = document.getElementById('funding-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading funding…</div>';
  try {
    const data = await fetch(`${API}/api/funding?wallet=${PRIMARY_WALLET}&days=30`).then(r => r.json());
    const byCoin = data.by_coin;
    const coinRows = Object.entries(byCoin).sort((a,b) => a[1]-b[1]);

    el.innerHTML = `
      <div class="grid-2" style="margin-bottom:20px">
        <div class="stat-card">
          <div class="stat-label">Total Funding Paid (30d)</div>
          <div class="stat-value ${data.total_usdc>=0?'pos':'neg'}">${fmt$(data.total_usdc)}</div>
          <div class="stat-sub">Positive = received, Negative = paid</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Most Costly Position</div>
          <div class="stat-value accent">${coinRows.length ? coinRows[0][0] : '—'}</div>
          <div class="stat-sub">${coinRows.length ? fmt$(coinRows[0][1]) : ''}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Funding by Coin</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Coin</th><th>Total USDC</th></tr></thead>
              <tbody>
                ${coinRows.map(([coin,usdc]) => `
                <tr>
                  <td class="accent">${coin}</td>
                  <td class="${usdc>=0?'pos':'neg'}">${fmt$(usdc)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-title">Recent Funding Payments</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Coin</th><th>Rate</th><th>USDC</th></tr></thead>
              <tbody>
                ${data.funding.slice(0,50).map(f => `
                <tr>
                  <td class="muted">${fmtTime(f.time)}</td>
                  <td class="accent">${f.coin||'?'}</td>
                  <td class="${f.funding_rate>=0?'pos':'neg'}">${(f.funding_rate*100).toFixed(4)}%</td>
                  <td class="${f.usdc>=0?'pos':'neg'}">${f.usdc.toFixed(4)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

// ── Flows ─────────────────────────────────────────────────────────────────────

async function loadFlows() {
  const el = document.getElementById('flows-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading flows…</div>';
  try {
    const data = await fetch(`${API}/api/flows?wallet=${PRIMARY_WALLET}&days=90`).then(r => r.json());
    el.innerHTML = `
      <div class="grid-3" style="margin-bottom:20px">
        <div class="stat-card">
          <div class="stat-label">Total Inflow (90d)</div>
          <div class="stat-value pos">${fmt$(data.total_inflow)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Outflow (90d)</div>
          <div class="stat-value neg">−${fmt$(data.total_outflow)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Net Flow</div>
          <div class="stat-value ${data.net>=0?'pos':'neg'}">${fmt$(data.net)}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Flow History</div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Time</th><th>Direction</th><th>Type</th><th>Amount</th><th>Tx</th>
            </tr></thead>
            <tbody>
              ${data.flows.map(f => `
              <tr>
                <td class="muted">${fmtTime(f.time)}</td>
                <td><span class="side-badge ${f.direction==='inflow'?'long':'short'}">${f.direction.toUpperCase()}</span></td>
                <td class="muted">${f.type}</td>
                <td class="${f.usdc>=0?'flow-in':'flow-out'}">${fmt$(Math.abs(f.usdc))}</td>
                <td class="muted" style="font-size:10px">${f.hash ? f.hash.slice(0,12)+'…' : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

// ── Phases ────────────────────────────────────────────────────────────────────

async function loadPhases() {
  const el = document.getElementById('phases-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Detecting phases…</div>';
  try {
    const data = await fetch(`${API}/api/phase?wallet=${PRIMARY_WALLET}`).then(r => r.json());
    const phases = data.phases;

    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">Market Phase Detection</div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="muted" style="font-size:12px">Interval:</span>
          <div class="tabs" style="margin:0">
            <button class="tab active" onclick="reloadPhases('1h',this)">1h</button>
            <button class="tab" onclick="reloadPhases('4h',this)">4h</button>
            <button class="tab" onclick="reloadPhases('1d',this)">1d</button>
          </div>
        </div>
      </div>
      <div class="grid-3" id="phase-cards">
        ${phases.length === 0 ? '<div class="loading" style="grid-column:1/-1">No positions to analyze</div>' :
          phases.map(p => phaseCard(p)).join('')}
      </div>
      <div class="card">
        <div class="card-title">Phase Key</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding:4px 0">
          <span class="phase-badge phase-ACCUMULATION">🔵 Accumulation — quiet buying, tight range, low volume</span>
          <span class="phase-badge phase-MARKUP">🚀 Markup — trend up with volume</span>
          <span class="phase-badge phase-DISTRIBUTION">🟡 Distribution — topping, smart money selling</span>
          <span class="phase-badge phase-MARKDOWN">🔻 Markdown — downtrend with volume</span>
          <span class="phase-badge phase-NEUTRAL">⚪ Neutral — no clear signal</span>
        </div>
      </div>
    `;
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function phaseCard(p) {
  const icons = { ACCUMULATION:'🔵', MARKUP:'🚀', DISTRIBUTION:'🟡', MARKDOWN:'🔻', NEUTRAL:'⚪' };
  const icon = icons[p.phase] || '⚪';
  const conf = Math.round((p.confidence||0)*100);
  return `
    <div class="card">
      <div class="card-title">${p.coin}</div>
      <div style="margin-bottom:10px">
        <span class="phase-badge phase-${p.phase}">${icon} ${p.phase}</span>
      </div>
      <div style="margin-bottom:8px">
        <div class="conf-bar">
          <span class="muted" style="font-size:11px">Confidence</span>
          <span class="conf-val">${conf}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${conf}%"></div></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">
        Price: <span style="color:var(--text)">${p.price_trend}</span> &nbsp;
        Volume: <span style="color:var(--text)">${p.volume_trend}</span>
      </div>
      <ul style="font-size:11px;color:var(--text-muted);padding-left:14px;line-height:1.7">
        ${(p.signals||[]).map(s=>`<li>${s}</li>`).join('')}
      </ul>
    </div>
  `;
}

async function reloadPhases(interval, btn) {
  document.querySelectorAll('#phases-content .tabs .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById('phase-cards');
  if (!el) return;
  el.innerHTML = '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div> Detecting…</div>';
  try {
    const data = await fetch(`${API}/api/phase?wallet=${PRIMARY_WALLET}&interval=${interval}`).then(r => r.json());
    el.innerHTML = data.phases.map(p => phaseCard(p)).join('');
  } catch(e) { el.innerHTML = `<div class="loading" style="grid-column:1/-1">Error: ${e.message}</div>`; }
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

async function loadWatchlist() {
  const el = document.getElementById('watchlist-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading watchlist…</div>';
  try {
    const data = await fetch(`${API}/api/watchlist`).then(r => r.json());
    el.innerHTML = `
      <div class="section-header">
        <div class="section-title">Wallet Watchlist</div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">Add Wallet</div>
        <div class="input-group">
          <input class="input" id="add-addr" placeholder="0x… address" style="flex:2">
          <input class="input" id="add-label" placeholder="Label (optional)" style="flex:1">
          <button class="btn btn-primary" onclick="addWallet()">Add</button>
        </div>
      </div>
      <div id="wallet-list">
        ${data.wallets.map(w => walletRow(w)).join('') || '<div class="loading">No wallets in watchlist</div>'}
      </div>
    `;
  } catch(e) { el.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function walletRow(w) {
  const snap = w.snapshot || {};
  const summary = snap.summary || {};
  const positions = snap.positions || [];
  const isPrimary = w.address === PRIMARY_WALLET.toLowerCase();
  return `
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div>
          <span style="font-weight:600">${w.label}</span>
          ${isPrimary ? '<span style="margin-left:8px;font-size:10px;background:rgba(124,106,255,0.15);color:var(--accent);padding:2px 8px;border-radius:10px">PRIMARY</span>' : ''}
          <div class="muted" style="font-family:var(--mono);font-size:11px;margin-top:2px">${w.address}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="refreshWallet('${w.address}')">Refresh</button>
          ${!isPrimary ? `<button class="btn btn-danger btn-sm" onclick="removeWallet('${w.address}')">Remove</button>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div><div class="stat-label">Account Value</div><div style="font-family:var(--mono)">${fmt$(summary.account_value||0)}</div></div>
        <div><div class="stat-label">Positions</div><div style="font-family:var(--mono)">${positions.length}</div></div>
        <div><div class="stat-label">Coins</div><div style="font-family:var(--mono);font-size:12px">${(snap.coins||[]).join(', ') || '—'}</div></div>
      </div>
    </div>
  `;
}

async function addWallet() {
  const addr = document.getElementById('add-addr').value.trim();
  const label = document.getElementById('add-label').value.trim();
  if (!addr) return;
  try {
    await fetch(`${API}/api/watchlist`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({address: addr, label}) });
    loadWatchlist();
  } catch(e) { alert('Error: ' + e.message); }
}

async function removeWallet(addr) {
  if (!confirm('Remove this wallet from watchlist?')) return;
  await fetch(`${API}/api/watchlist/${addr}`, { method: 'DELETE' });
  loadWatchlist();
}

async function refreshWallet(addr) {
  try {
    const snap = await fetch(`${API}/api/watchlist/${addr}/snapshot`).then(r => r.json());
    loadWatchlist();
  } catch(e) { alert('Error: ' + e.message); }
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const el = document.getElementById('settings-content');
  const tgStatus = await fetch(`${API}/api/telegram/status`).then(r => r.json());
  el.innerHTML = `
    <div class="section-header"><div class="section-title">Settings</div></div>
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Telegram Alerts</div>
        <div style="margin-bottom:14px">
          Status: <span class="tg-status ${tgStatus.enabled?'on':'off'}">${tgStatus.enabled ? '✓ Connected' : '✗ Not configured'}</span>
        </div>
        <div class="settings-row">
          <div class="settings-label">Bot Token (from @BotFather)</div>
          <input class="input" id="tg-token" placeholder="1234567890:ABCDef…" type="password">
        </div>
        <div class="settings-row">
          <div class="settings-label">Chat ID</div>
          <input class="input" id="tg-chat" placeholder="-100xxxxxxxxx or @username">
        </div>
        <button class="btn btn-primary" onclick="saveTelegram()">Save & Test</button>
      </div>
      <div class="card">
        <div class="card-title">Primary Wallet</div>
        <div style="font-family:var(--mono);font-size:12px;color:var(--text-muted);word-break:break-all;margin-bottom:8px">${PRIMARY_WALLET}</div>
        <div class="settings-label">To change the primary wallet, edit the PRIMARY_WALLET value in your .env file and restart the server.</div>
      </div>
    </div>
  `;
}

async function saveTelegram() {
  const token = document.getElementById('tg-token').value.trim();
  const chat = document.getElementById('tg-chat').value.trim();
  if (!token || !chat) { alert('Enter both bot token and chat ID'); return; }
  try {
    const res = await fetch(`${API}/api/telegram/configure`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({bot_token: token, chat_id: chat})
    });
    const data = await res.json();
    if (data.configured) { alert('Telegram configured!'); loadSettings(); }
  } catch(e) { alert('Error: ' + e.message); }
}

// ── Notifications ─────────────────────────────────────────────────────────────

function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) loadNotifications();
}

async function loadNotifications() {
  const el = document.getElementById('notif-list');
  const data = await fetch(`${API}/api/notifications`).then(r => r.json());
  const notifs = data.notifications;
  updateNotifBadge(notifs.filter(n => !n.read).length);
  if (notifs.length === 0) {
    el.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }
  el.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read?'':'unread'}" onclick="markRead(${n.id})">
      <div class="notif-type">${n.type}</div>
      <div class="notif-msg">${n.message}</div>
      <div class="notif-time">${fmtTime(n.time * 1000)}</div>
    </div>
  `).join('');
}

function addNotification(notif) {
  const panel = document.getElementById('notif-panel');
  if (panel.classList.contains('open')) loadNotifications();
  const current = parseInt(document.getElementById('notif-count').textContent || '0');
  updateNotifBadge(current + 1);
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notif-count');
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

async function markRead(id) {
  await fetch(`${API}/api/notifications/${id}/read`, {method:'POST'});
  loadNotifications();
}

async function markAllRead() {
  await fetch(`${API}/api/notifications/read-all`, {method:'POST'});
  loadNotifications();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n) {
  if (n === undefined || n === null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return sign + '$' + (abs/1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + '$' + abs.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  return sign + '$' + abs.toFixed(2);
}

function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  connectWS();
  navigate('overview');
  // Poll notifications every minute
  setInterval(() => {
    const panel = document.getElementById('notif-panel');
    if (!panel.classList.contains('open')) {
      fetch(`${API}/api/notifications`).then(r=>r.json()).then(d => {
        updateNotifBadge(d.notifications.filter(n => !n.read).length);
      });
    }
  }, 60000);
});

// Close notification panel when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  const btn = document.getElementById('notif-toggle-btn');
  if (!panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.remove('open');
  }
});
