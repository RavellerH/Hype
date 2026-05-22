// ── Data Logger — Hourly Snapshot to Supabase ─────────────────────────────────

const LOG_URL_KEY   = 'hype_sb_url';
const LOG_KEY_KEY   = 'hype_sb_key';
const LOG_LAST_KEY  = 'hype_log_ts';
const LOG_INTERVAL  = 3600000; // 1 h

let _sbClient    = null;
let _logTimer    = null;
let _logRunning  = false;

// ── Supabase client ────────────────────────────────────────────────────────────

function sbClient() {
  if (_sbClient) return _sbClient;
  const url = localStorage.getItem(LOG_URL_KEY);
  const key = localStorage.getItem(LOG_KEY_KEY);
  if (!url || !key) return null;
  try {
    _sbClient = supabase.createClient(url, key);
    return _sbClient;
  } catch (e) {
    console.error('[Logger] Supabase init failed:', e);
    return null;
  }
}

function loggerConfigured() {
  return !!(localStorage.getItem(LOG_URL_KEY) && localStorage.getItem(LOG_KEY_KEY));
}

// Round down to the nearest hour so snapshots align perfectly
function hourTs() {
  return new Date(Math.floor(Date.now() / LOG_INTERVAL) * LOG_INTERVAL).toISOString();
}

// ── Trigger logic ─────────────────────────────────────────────────────────────

async function loggerMaybeFire() {
  if (!loggerConfigured() || _logRunning) return;
  const last = parseInt(localStorage.getItem(LOG_LAST_KEY) || '0');
  if (Date.now() - last < LOG_INTERVAL) return;
  await loggerFire();
}

async function loggerFire(manual = false) {
  const client = sbClient();
  if (!client) { loggerSetStatus('error', 'Supabase not configured'); return; }
  if (_logRunning && !manual) return;
  _logRunning = true;
  loggerSetStatus('running', 'Logging…');

  const ts = hourTs();
  try {
    const [mkErr, indErr, portErr, nanErr] = await Promise.all([
      logMarket(client, ts),
      logIndicators(client, ts),
      currentWallet ? logPortfolio(client, ts) : null,
      window._nansenData?.netflows?.length ? logNansen(client, ts) : null,
    ]);

    const errs = [mkErr, indErr, portErr, nanErr].filter(Boolean);
    localStorage.setItem(LOG_LAST_KEY, Date.now().toString());
    const msg = errs.length ? `Done (${errs.length} warnings)` : 'Done';
    loggerSetStatus('ok', msg, ts);
    console.log('[Logger] Snapshot logged for', ts, errs.length ? errs : '');
  } catch (err) {
    loggerSetStatus('error', err.message);
    console.error('[Logger] Snapshot failed:', err);
  } finally {
    _logRunning = false;
  }
}

// ── Market data ───────────────────────────────────────────────────────────────
// All Hyperliquid perps: price, funding, OI, volume, premium

async function logMarket(client, ts) {
  let raw;
  // Prefer cached data if fresh (avoid extra API call)
  if (window._rawMeta) {
    raw = window._rawMeta;
  } else {
    try {
      raw = await hlPost({ type: 'metaAndAssetCtxs' });
      window._rawMeta = raw;
    } catch (e) {
      return `market fetch failed: ${e.message}`;
    }
  }

  const coins = raw[0]?.universe || [];
  const ctxs  = raw[1]          || [];

  const rows = coins.map((coin, i) => {
    const c = ctxs[i] || {};
    const mark    = parseFloat(c.markPx    || 0);
    const oracle  = parseFloat(c.oraclePx  || 0);
    const prev    = parseFloat(c.prevDayPx || 0);
    const funding = parseFloat(c.funding   || 0);
    return {
      ts,
      coin:              coin.name,
      mark_price:        mark        || null,
      oracle_price:      oracle      || null,
      open_interest:     parseFloat(c.openInterest || 0) * mark || null,
      funding_rate_8h:   funding     || null,
      funding_apr:       funding * 3 * 365 * 100 || null,
      premium:           oracle > 0 ? (mark - oracle) / oracle : null,
      volume_24h:        parseFloat(c.dayNtlVlm || 0) || null,
      change_pct_24h:    prev > 0 ? (mark - prev) / prev * 100 : null,
    };
  }).filter(r => r.mark_price);

  if (!rows.length) return 'no market rows';
  const { error } = await client
    .from('market_snapshots')
    .upsert(rows, { onConflict: 'ts,coin', ignoreDuplicates: true });
  return error ? `market: ${error.message}` : null;
}

// ── Indicators ─────────────────────────────────────────────────────────────────
// F&G, BMSB, Pi Cycle, BTC price

async function logIndicators(client, ts) {
  const ind = window._indData;
  const btcPrice = window._ovData?.marketCtx?.BTC?.mark_price
    || parseFloat(window._rawMeta?.[1]?.[
        (window._rawMeta?.[0]?.universe || []).findIndex(c => c.name === 'BTC')
      ]?.markPx || 0)
    || null;

  const row = {
    ts,
    btc_price:        btcPrice,
    fear_greed:       ind?.fear_greed?.value              ?? null,
    fear_greed_label: ind?.fear_greed?.classification     ?? null,
    fear_greed_zone:  ind?.fear_greed?.zone               ?? null,
    bmsb_signal:      ind?.bmsb?.signal                   ?? null,
    bmsb_sma20w:      ind?.bmsb?.sma20w                   ?? null,
    bmsb_ema21w:      ind?.bmsb?.ema21w                   ?? null,
    pi_signal:        ind?.pi_cycle?.signal               ?? null,
    pi_proximity:     ind?.pi_cycle?.proximity            ?? null,
    pi_sma111:        ind?.pi_cycle?.sma111               ?? null,
    pi_sma350x2:      ind?.pi_cycle?.sma350x2             ?? null,
  };

  const { error } = await client
    .from('indicator_snapshots')
    .upsert([row], { onConflict: 'ts', ignoreDuplicates: true });
  return error ? `indicators: ${error.message}` : null;
}

// ── Portfolio + positions ──────────────────────────────────────────────────────

async function logPortfolio(client, ts) {
  const s   = window._ovData?.s;
  const pos = window._ovData?.positions || [];
  const mCtx = window._ovData?.marketCtx || {};
  if (!s) return 'no account state';

  const ms = s.marginSummary || {};
  const portRow = {
    ts,
    wallet:         currentWallet,
    account_value:  parseFloat(ms.accountValue       || 0) || null,
    unrealized_pnl: parseFloat(ms.totalUnrealizedPnl || 0) || null,
    margin_used:    parseFloat(ms.totalMarginUsed     || 0) || null,
    withdrawable:   parseFloat(s.withdrawable         || 0) || null,
    position_count: pos.length,
  };

  const { error: pe } = await client
    .from('portfolio_snapshots')
    .upsert([portRow], { onConflict: 'ts,wallet', ignoreDuplicates: true });
  if (pe) return `portfolio: ${pe.message}`;

  if (!pos.length) return null;

  const posRows = pos.map(p => {
    const size      = Math.abs(parseFloat(p.szi || 0));
    const entry     = parseFloat(p.entryPx || 0);
    const mark      = parseFloat(p.markPx  || mCtx[p.coin]?.mark_price || 0);
    const upnl      = parseFloat(p.unrealizedPnl || 0);
    const notional  = size * mark;
    const upnlPct   = entry > 0
      ? (p.side === 'short' ? (entry - mark) / entry : (mark - entry) / entry) * 100
      : null;

    return {
      ts,
      wallet:              currentWallet,
      coin:                p.coin,
      side:                p.side,
      size,
      entry_price:         entry  || null,
      mark_price:          mark   || null,
      unrealized_pnl:      upnl   || null,
      unrealized_pnl_pct:  upnlPct,
      leverage:            parseFloat(p.leverage?.value || p.leverage || 0) || null,
      funding_rate_8h:     mCtx[p.coin]?.funding_rate_8h ?? null,
      funding_apr:         mCtx[p.coin]?.funding_apr     ?? null,
      notional:            notional || null,
      cum_funding:         parseFloat(p.cum_funding || 0) || null,
      liquidation_price:   parseFloat(p.liquidation_price || 0) || null,
    };
  });

  const { error: poserr } = await client
    .from('position_snapshots')
    .upsert(posRows, { onConflict: 'ts,wallet,coin', ignoreDuplicates: true });
  return poserr ? `positions: ${poserr.message}` : null;
}

// ── Nansen ─────────────────────────────────────────────────────────────────────

async function logNansen(client, ts) {
  const flows = window._nansenData?.netflows;
  if (!flows?.length) return null;

  const rows = flows.map(item => ({
    ts,
    symbol:               item.token?.symbol               ?? null,
    chain:                item.token?.chain                 ?? null,
    netflow_1h:           item.netflow_usd_1h               ?? null,
    netflow_24h:          item.netflow_usd_24h              ?? null,
    netflow_7d:           item.netflow_usd_7d               ?? null,
    holder_count:         item.smart_money_holder_count     ?? null,
    price_change_24h_pct: item.price_change_24h_pct         ?? null,
  })).filter(r => r.symbol);

  if (!rows.length) return null;
  const { error } = await client
    .from('nansen_snapshots')
    .upsert(rows, { onConflict: 'ts,symbol', ignoreDuplicates: true });
  return error ? `nansen: ${error.message}` : null;
}

// ── Init & scheduling ─────────────────────────────────────────────────────────

function loggerInit() {
  if (!loggerConfigured()) return;
  // Fire 15 s after page load (give data time to load)
  setTimeout(loggerMaybeFire, 15000);
  // Check every 5 min
  if (_logTimer) clearInterval(_logTimer);
  _logTimer = setInterval(loggerMaybeFire, 300000);
}

// ── Status badge (topbar) ─────────────────────────────────────────────────────

function loggerSetStatus(state, msg, ts) {
  const dot = document.getElementById('logger-dot');
  const tip = document.getElementById('logger-tip');
  if (dot) {
    dot.className = `logger-dot ${state}`;
  }
  if (tip) {
    const lastTs = ts || localStorage.getItem(LOG_LAST_KEY);
    const lastNum = parseInt(lastTs || '0');
    const ago = lastNum ? Math.round((Date.now() - lastNum) / 60000) + 'm ago' : 'never';
    tip.textContent = `Logger: ${msg || state} · last ${ago}`;
  }
}

function loggerRefreshStatus() {
  if (!loggerConfigured()) {
    loggerSetStatus('off', 'not configured');
    return;
  }
  const last = parseInt(localStorage.getItem(LOG_LAST_KEY) || '0');
  if (!last) { loggerSetStatus('warn', 'no snapshots yet'); return; }
  const mins = Math.round((Date.now() - last) / 60000);
  if (mins < 65) loggerSetStatus('ok', `${mins}m ago`);
  else           loggerSetStatus('warn', `${mins}m ago — overdue`);
}

// ── Settings section (rendered inside Analytics Logger tab) ───────────────────

const LOGGER_SQL = `-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)

create table if not exists market_snapshots (
  id         bigserial primary key,
  ts         timestamptz not null,
  coin       text not null,
  mark_price        numeric,
  oracle_price      numeric,
  open_interest     numeric,
  funding_rate_8h   numeric,
  funding_apr       numeric,
  premium           numeric,
  volume_24h        numeric,
  change_pct_24h    numeric,
  unique(ts, coin)
);

create table if not exists indicator_snapshots (
  id              bigserial primary key,
  ts              timestamptz not null unique,
  btc_price       numeric,
  fear_greed      int,
  fear_greed_label text,
  fear_greed_zone  text,
  bmsb_signal     text,
  bmsb_sma20w     numeric,
  bmsb_ema21w     numeric,
  pi_signal       text,
  pi_proximity    numeric,
  pi_sma111       numeric,
  pi_sma350x2     numeric
);

create table if not exists portfolio_snapshots (
  id              bigserial primary key,
  ts              timestamptz not null,
  wallet          text not null,
  account_value   numeric,
  unrealized_pnl  numeric,
  margin_used     numeric,
  withdrawable    numeric,
  position_count  int,
  unique(ts, wallet)
);

create table if not exists position_snapshots (
  id                  bigserial primary key,
  ts                  timestamptz not null,
  wallet              text not null,
  coin                text not null,
  side                text,
  size                numeric,
  entry_price         numeric,
  mark_price          numeric,
  unrealized_pnl      numeric,
  unrealized_pnl_pct  numeric,
  leverage            numeric,
  funding_rate_8h     numeric,
  funding_apr         numeric,
  notional            numeric,
  cum_funding         numeric,
  liquidation_price   numeric,
  unique(ts, wallet, coin)
);

create table if not exists nansen_snapshots (
  id                    bigserial primary key,
  ts                    timestamptz not null,
  symbol                text not null,
  chain                 text,
  netflow_1h            numeric,
  netflow_24h           numeric,
  netflow_7d            numeric,
  holder_count          int,
  price_change_24h_pct  numeric,
  unique(ts, symbol)
);

-- Allow anonymous inserts (needed for browser writes)
alter table market_snapshots    disable row level security;
alter table indicator_snapshots disable row level security;
alter table portfolio_snapshots disable row level security;
alter table position_snapshots  disable row level security;
alter table nansen_snapshots    disable row level security;`;

function renderLoggerSettings() {
  const url    = localStorage.getItem(LOG_URL_KEY) || '';
  const key    = localStorage.getItem(LOG_KEY_KEY) || '';
  const last   = parseInt(localStorage.getItem(LOG_LAST_KEY) || '0');
  const ago    = last ? Math.round((Date.now() - last) / 60000) + ' min ago' : 'Never';
  const status = last
    ? (Date.now() - last < 65 * 60000 ? 'ok' : 'warn')
    : (loggerConfigured() ? 'warn' : 'off');

  return `<div class="log-setup">
    <div class="an-title">Data Logger Setup
      <span class="log-status-badge ${status}">${status === 'ok' ? 'ACTIVE' : status === 'warn' ? 'OVERDUE' : 'OFF'}</span>
    </div>

    <div class="log-step">
      <div class="log-step-num">1</div>
      <div class="log-step-body">
        <div class="log-step-title">Create tables in Supabase</div>
        <div class="log-step-desc">Open your Supabase project → SQL Editor → paste and run:</div>
        <div class="log-sql-wrap">
          <button class="log-copy-btn" onclick="loggerCopySql()">Copy SQL</button>
          <pre class="log-sql" id="logger-sql-pre">${LOGGER_SQL.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
        </div>
      </div>
    </div>

    <div class="log-step">
      <div class="log-step-num">2</div>
      <div class="log-step-body">
        <div class="log-step-title">Connect to your Supabase project</div>
        <div class="log-step-desc">Project URL and anon key are in Supabase → Settings → API.</div>
        <div class="log-fields">
          <div class="log-field">
            <label>Project URL</label>
            <input id="log-sb-url" type="text" value="${url}" placeholder="https://xyz.supabase.co">
          </div>
          <div class="log-field">
            <label>Anon Key (public)</label>
            <input id="log-sb-key" type="text" value="${key}" placeholder="eyJhbGciOiJIUzI1NiIs...">
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="log-save-btn" onclick="loggerSaveAndStart()">Save &amp; Start Logger</button>
          <button class="log-test-btn" onclick="loggerTestConnection()">Test Connection</button>
        </div>
        <div id="log-test-result" style="font-size:11px;margin-top:6px;color:var(--text-muted)"></div>
      </div>
    </div>

    <div class="log-status-row">
      <div class="log-stat">
        <div class="log-stat-label">Last snapshot</div>
        <div class="log-stat-val">${ago}</div>
      </div>
      <div class="log-stat">
        <div class="log-stat-label">Logs every</div>
        <div class="log-stat-val">1 hour</div>
      </div>
      <div class="log-stat">
        <div class="log-stat-label">Tables</div>
        <div class="log-stat-val">5 (market, indicators, portfolio, positions, nansen)</div>
      </div>
      <button class="log-now-btn" onclick="loggerFire(true).then(loggerRefreshStatus)">Log Now</button>
    </div>

    <div class="log-what">
      <div class="log-what-title">What gets logged each hour</div>
      <div class="log-what-grid">
        <div class="log-what-item"><strong>market_snapshots</strong> — all Hyperliquid perps: price, funding, OI, volume, premium</div>
        <div class="log-what-item"><strong>indicator_snapshots</strong> — BTC price, Fear &amp; Greed, BMSB signal + values, Pi Cycle proximity</div>
        <div class="log-what-item"><strong>portfolio_snapshots</strong> — account value, unrealised P&amp;L, margin used</div>
        <div class="log-what-item"><strong>position_snapshots</strong> — every open position: entry, mark, PnL%, leverage, liquidation distance, cum funding</div>
        <div class="log-what-item"><strong>nansen_snapshots</strong> — smart money flows per token (if Nansen configured)</div>
      </div>
    </div>
  </div>`;
}

function loggerCopySql() {
  navigator.clipboard.writeText(LOGGER_SQL).then(() => {
    const btn = document.querySelector('.log-copy-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy SQL', 2000); }
  });
}

function loggerSaveAndStart() {
  const url = (document.getElementById('log-sb-url')?.value || '').trim();
  const key = (document.getElementById('log-sb-key')?.value || '').trim();
  if (!url || !key) { alert('Enter both URL and anon key.'); return; }
  localStorage.setItem(LOG_URL_KEY, url);
  localStorage.setItem(LOG_KEY_KEY, key);
  _sbClient = null;
  loggerInit();
  loggerFire(true).then(() => {
    loggerRefreshStatus();
    document.getElementById('log-test-result').textContent = 'Saved and first snapshot triggered.';
  });
}

async function loggerTestConnection() {
  const url = (document.getElementById('log-sb-url')?.value || '').trim();
  const key = (document.getElementById('log-sb-key')?.value || '').trim();
  const res  = document.getElementById('log-test-result');
  if (!url || !key) { res.textContent = 'Enter URL and key first.'; return; }
  res.textContent = 'Testing…';
  try {
    const client = supabase.createClient(url, key);
    const { error } = await client.from('indicator_snapshots').select('id').limit(1);
    if (error) throw new Error(error.message);
    res.style.color = 'var(--green)';
    res.textContent = 'Connected — table found.';
  } catch (e) {
    res.style.color = 'var(--red)';
    res.textContent = 'Error: ' + e.message + (e.message.includes('does not exist') ? ' — run the SQL setup first.' : '');
  }
}
