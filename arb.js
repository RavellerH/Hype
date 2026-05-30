// ── Funding Arb Scanner ───────────────────────────────────────────────────────

const BINANCE_PREMIUM = 'https://fapi.binance.com/fapi/v1/premiumIndex';
const BYBIT_TICKERS   = 'https://api.bybit.com/v5/market/tickers?category=linear';

let _arbData      = null;
let _arbTs        = 0;
const ARB_TTL     = 60 * 1000;
const ARB_THRESHOLD = 0.001;

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function loadArb() {
  const el = document.getElementById('arb-content');
  if (!el) return;
  if (_arbData && !_silentRefresh && Date.now() - _arbTs < ARB_TTL) { _renderArb(); return; }
  if (!_arbData) el.innerHTML = loading();
  await _fetchArb();
  _renderArb();
}

async function _fetchArb() {
  const [hlR, bnR, bbR] = await Promise.allSettled([
    getMetaAndAssetCtxs(),
    fetch(BINANCE_PREMIUM).then(r => r.ok ? r.json() : Promise.reject(new Error('Binance ' + r.status))),
    fetch(BYBIT_TICKERS).then(r => r.ok ? r.json() : Promise.reject(new Error('Bybit ' + r.status))),
  ]);

  let hlCoins = [];
  if (hlR.status === 'fulfilled') {
    const [meta, ctxs = []] = hlR.value;
    hlCoins = (meta?.universe || []).map((asset, i) => {
      const ctx = ctxs[i] || {};
      return {
        coin:   asset.name,
        rate:   parseFloat(ctx.funding || 0),
        markPx: parseFloat(ctx.markPx  || 0),
      };
    }).filter(c => c.coin);
  }

  const bnMap = {};
  if (bnR.status === 'fulfilled') {
    for (const item of (Array.isArray(bnR.value) ? bnR.value : [])) {
      const sym = item.symbol || '';
      if (sym.endsWith('USDT')) bnMap[sym.slice(0, -4)] = parseFloat(item.lastFundingRate || 0);
    }
  }

  const bbMap = {};
  if (bbR.status === 'fulfilled') {
    for (const item of (bbR.value?.result?.list || [])) {
      const sym = item.symbol || '';
      if (sym.endsWith('USDT')) bbMap[sym.slice(0, -4)] = parseFloat(item.fundingRate || 0);
    }
  }

  _arbData = { hlCoins, bnMap, bbMap };
  _arbTs   = Date.now();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fRate(r) {
  if (r == null || isNaN(r)) return '<span style="color:var(--text-faint)">—</span>';
  const sign = r >= 0 ? '+' : '';
  const cls  = r > ARB_THRESHOLD ? 'neg' : r < -ARB_THRESHOLD ? 'pos' : '';
  const val  = `${sign}${(r * 100).toFixed(4)}%`;
  return cls ? `<span class="${cls}">${val}</span>` : val;
}

function _fApy(r) {
  const apy = r * 3 * 365 * 100;
  const sign = apy >= 0 ? '+' : '';
  const cls  = Math.abs(r) > ARB_THRESHOLD ? (r > 0 ? 'neg' : 'pos') : 'muted';
  return `<span class="${cls}">${sign}${apy.toFixed(1)}%</span>`;
}

function _signal(r) {
  if (r < -ARB_THRESHOLD) return '<span class="arb-signal arb-earn">EARN</span>';
  if (r >  ARB_THRESHOLD) return '<span class="arb-signal arb-crowd">CROWDED</span>';
  return '<span class="arb-signal arb-neut">NEUTRAL</span>';
}

// ── Render ────────────────────────────────────────────────────────────────────

function _renderArb() {
  const el = document.getElementById('arb-content');
  if (!el) return;
  if (!_arbData) { el.innerHTML = err({ message: 'No data' }); return; }

  const ts = _arbTs ? `updated ${new Date(_arbTs).toLocaleTimeString()}` : '';
  el.innerHTML = `
  <div class="fund-toolbar">
    <span style="font-weight:600;font-size:13px">Funding Arb Scanner</span>
    <span style="font-size:11px;color:var(--text-faint);margin-left:4px">${ts}</span>
    <button class="btn btn-ghost btn-sm" onclick="arbRefresh()" style="margin-left:auto">↺ Refresh</button>
  </div>
  <div style="overflow:auto;flex:1">
    ${_renderCarryTable()}
    ${_renderBasisTable()}
  </div>`;
}

function _renderCarryTable() {
  const coins = [..._arbData.hlCoins].sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
  const rows  = coins.map(c => {
    const hi = Math.abs(c.rate) > ARB_THRESHOLD;
    return `<tr${hi ? ' class="arb-hi"' : ''}>
      <td style="font-weight:600">${c.coin}</td>
      <td class="num">${_fRate(c.rate)}</td>
      <td class="num">${_fApy(c.rate)}</td>
      <td style="text-align:right">${_signal(c.rate)}</td>
    </tr>`;
  }).join('');

  return `
  <div style="padding:10px 12px 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);border-bottom:1px solid var(--border)">
    HL Carry Scanner <span style="font-weight:400;font-size:10px;color:var(--text-faint)">(${coins.length} coins · sorted by |rate|)</span>
  </div>
  <table class="arb-table">
    <thead><tr>
      <th>Coin</th>
      <th class="num">8h Rate</th>
      <th class="num">Ann. APY</th>
      <th style="text-align:right">Signal</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-faint)">No data</td></tr>'}</tbody>
  </table>`;
}

function _renderBasisTable() {
  const { hlCoins, bnMap, bbMap } = _arbData;
  const cross = hlCoins.filter(c => bnMap[c.coin] != null || bbMap[c.coin] != null).map(c => ({
    coin:   c.coin,
    hl:     c.rate,
    bn:     bnMap[c.coin] ?? null,
    bb:     bbMap[c.coin] ?? null,
    spread: bnMap[c.coin] != null ? c.rate - bnMap[c.coin] : null,
  })).sort((a, b) => Math.abs(b.spread ?? 0) - Math.abs(a.spread ?? 0));

  const rows = cross.map(c => {
    const hi = c.spread != null && Math.abs(c.spread) > ARB_THRESHOLD;
    const spreadHtml = c.spread != null
      ? (() => {
          const sign = c.spread >= 0 ? '+' : '';
          const cls  = hi ? (c.spread > 0 ? 'neg' : 'pos') : '';
          const val  = `${sign}${(c.spread * 100).toFixed(4)}%`;
          return cls ? `<span class="${cls}" style="font-weight:600">${val}</span>` : val;
        })()
      : '<span style="color:var(--text-faint)">—</span>';
    return `<tr${hi ? ' class="arb-hi"' : ''}>
      <td style="font-weight:600">${c.coin}</td>
      <td class="num">${_fRate(c.hl)}</td>
      <td class="num">${_fRate(c.bn)}</td>
      <td class="num">${_fRate(c.bb)}</td>
      <td class="num">${spreadHtml}</td>
    </tr>`;
  }).join('');

  return `
  <div style="padding:10px 12px 4px;margin-top:16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);border-bottom:1px solid var(--border)">
    Cross-Exchange Basis <span style="font-weight:400;font-size:10px;color:var(--text-faint)">(${cross.length} coins · HL vs Binance/Bybit)</span>
  </div>
  <table class="arb-table">
    <thead><tr>
      <th>Coin</th>
      <th class="num">HL 8h</th>
      <th class="num">Binance 8h</th>
      <th class="num">Bybit 8h</th>
      <th class="num">Spread (HL−BN)</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-faint)">No cross-exchange data</td></tr>'}</tbody>
  </table>`;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function arbRefresh() {
  _arbData = null;
  _arbTs   = 0;
  const el = document.getElementById('arb-content');
  if (el) el.innerHTML = loading();
  await _fetchArb();
  _renderArb();
}
