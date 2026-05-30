// ── DeFiLlama — TVL, Stablecoin & Chain Monitor ──────────────────────────────
// Free, unlimited, no API key. Endpoints: api.llama.fi + stablecoins.llama.fi

const DFL_BASE   = 'https://api.llama.fi';
const DFL_STABLE = 'https://stablecoins.llama.fi';

let _dflData = null, _dflTs = 0;
const DFL_TTL = 5 * 60 * 1000;

async function loadDefi() {
  const el = document.getElementById('defi-content');
  if (!el) return;
  if (_dflData && Date.now() - _dflTs < DFL_TTL) { _renderDefi(); return; }
  if (!_dflData) el.innerHTML = loading();
  await _fetchDefi();
  _renderDefi();
}

async function _fetchDefi() {
  const [protosR, globalTvlR, stablesR, chainsR] = await Promise.allSettled([
    fetch(`${DFL_BASE}/protocols`).then(r => r.ok ? r.json() : Promise.reject(new Error('protocols ' + r.status))),
    fetch(`${DFL_BASE}/v2/historicalChainTvl`).then(r => r.ok ? r.json() : Promise.reject(new Error('globaltvl ' + r.status))),
    fetch(`${DFL_STABLE}/stablecoins?includePrices=true`).then(r => r.ok ? r.json() : Promise.reject(new Error('stables ' + r.status))),
    fetch(`${DFL_BASE}/v2/chains`).then(r => r.ok ? r.json() : Promise.reject(new Error('chains ' + r.status))),
  ]);

  _dflData = {
    protocols:  protosR.status  === 'fulfilled' ? protosR.value  : [],
    globalTvl:  globalTvlR.status === 'fulfilled' ? globalTvlR.value : [],
    stablecoins: stablesR.status === 'fulfilled' ? (stablesR.value?.peggedAssets || []) : [],
    chains:     chainsR.status  === 'fulfilled' ? chainsR.value  : [],
  };
  _dflTs = Date.now();
}

// ── Format helpers ────────────────────────────────────────────────────────────

function _dflFmt(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(a/1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `$${(a/1e9).toFixed(2)}B`;
  if (a >= 1e6)  return `$${(a/1e6).toFixed(1)}M`;
  if (a >= 1e3)  return `$${(a/1e3).toFixed(0)}K`;
  return `$${a.toFixed(0)}`;
}

function _dflPct(p) {
  if (p == null || isNaN(p)) return '<span class="muted">—</span>';
  return `<span class="${p >= 0 ? 'pos' : 'neg'}">${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span>`;
}

// ── Regime summary (plain-language interpretation) ────────────────────────────

function _dflRegimeSummary(totalTvl, tvlChange1d, totalStable, stables) {
  if (!totalTvl) return '';

  let regime, regimeColor;
  if (tvlChange1d == null)       { regime = 'UNKNOWN';     regimeColor = 'var(--text-faint)'; }
  else if (tvlChange1d > 5)      { regime = 'EXPANSION';   regimeColor = 'var(--pos)'; }
  else if (tvlChange1d > 1)      { regime = 'GROWING';     regimeColor = '#86efac'; }
  else if (tvlChange1d > -1)     { regime = 'STABLE';      regimeColor = 'var(--text-muted)'; }
  else if (tvlChange1d > -5)     { regime = 'COOLING';     regimeColor = '#fbbf24'; }
  else                           { regime = 'CONTRACTION'; regimeColor = 'var(--neg)'; }

  const usdt  = stables.find(s => s.symbol === 'USDT')?.circulating?.peggedUSD || 0;
  const usdc  = stables.find(s => s.symbol === 'USDC')?.circulating?.peggedUSD || 0;
  const usdcShare = totalStable > 0 ? (usdc / totalStable * 100).toFixed(1) : '—';
  const usdtShare = totalStable > 0 ? (usdt / totalStable * 100).toFixed(1) : '—';

  // Interpretation bullets
  const bullets = [];
  if (tvlChange1d != null) {
    if (tvlChange1d > 3)  bullets.push({ pos: true,  text: 'Capital flowing into DeFi — bullish on-chain activity' });
    else if (tvlChange1d < -3) bullets.push({ pos: false, text: 'TVL declining — capital exiting or price compression' });
    else                  bullets.push({ pos: null,  text: 'TVL stable — sideways capital allocation' });
  }
  if (totalStable > 80e9)  bullets.push({ pos: true,  text: `Large stablecoin supply (${_dflFmt(totalStable)}) — dry powder ready to deploy` });
  else if (totalStable < 20e9) bullets.push({ pos: false, text: `Low stablecoin supply — less buying power available` });

  return `<div class="defi-regime">
    <div class="defi-regime-header">
      <span class="defi-regime-badge" style="color:${regimeColor}">${regime}</span>
      <span class="defi-regime-meta">TVL ${_dflFmt(totalTvl)} ${tvlChange1d != null ? `(${tvlChange1d >= 0 ? '+' : ''}${tvlChange1d.toFixed(1)}% 24h)` : ''} · Stables ${_dflFmt(totalStable)} · USDT ${usdtShare}% / USDC ${usdcShare}%</span>
    </div>
    ${bullets.length ? `<div class="defi-regime-bullets">
      ${bullets.map(b => `<div class="defi-regime-bullet">
        <span class="${b.pos === true ? 'pos' : b.pos === false ? 'neg' : 'muted'}">${b.pos === true ? '▲' : b.pos === false ? '▼' : '–'}</span>
        <span>${b.text}</span>
      </div>`).join('')}
    </div>` : ''}
  </div>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function _renderDefi() {
  const el = document.getElementById('defi-content');
  if (!el || !_dflData) return;

  const { protocols, globalTvl, stablecoins, chains } = _dflData;
  const ts = new Date(_dflTs).toLocaleTimeString();

  // Totals
  const totalTvl    = chains.reduce((s, c) => s + (c.tvl || 0), 0);
  const lastTvl     = globalTvl.at?.(-1)?.totalLiquidityUSD;
  const prevTvl     = globalTvl.at?.(-2)?.totalLiquidityUSD;
  const tvlChange1d = (lastTvl && prevTvl && prevTvl > 0) ? ((lastTvl - prevTvl) / prevTvl * 100) : null;

  const topStables = [...stablecoins]
    .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
    .slice(0, 8);
  const totalStable = topStables.reduce((s, t) => s + (t.circulating?.peggedUSD || 0), 0);

  const topProtos = [...protocols]
    .filter(p => p.tvl > 0 && p.name)
    .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, 20);

  const topChains = [...chains]
    .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, 10);

  const activeProtos = protocols.filter(p => (p.tvl || 0) > 1e6).length;
  const activeChains = chains.filter(c => (c.tvl || 0) > 1e6).length;

  el.innerHTML = `
<div class="defi-wrap">
  <div class="defi-toolbar">
    <span style="font-weight:700;font-size:14px">DeFi Macro Dashboard</span>
    <span style="font-size:11px;color:var(--text-faint)">DeFiLlama · updated ${ts}</span>
    <button class="btn btn-ghost btn-sm" onclick="defiRefresh()" style="margin-left:auto">↺ Refresh</button>
  </div>

  ${_dflRegimeSummary(totalTvl, tvlChange1d, totalStable, topStables)}

  <div class="defi-kpi-strip">
    <div class="defi-kpi">
      <div class="defi-kpi-label">Total DeFi TVL</div>
      <div class="defi-kpi-value">${_dflFmt(totalTvl)}</div>
      <div class="defi-kpi-sub">${tvlChange1d != null ? _dflPct(tvlChange1d) + ' 24h' : 'no change data'}</div>
    </div>
    <div class="defi-kpi">
      <div class="defi-kpi-label">Stablecoin Supply</div>
      <div class="defi-kpi-value">${_dflFmt(totalStable)}</div>
      <div class="defi-kpi-sub">${topStables.length} assets tracked</div>
    </div>
    <div class="defi-kpi">
      <div class="defi-kpi-label">Active Protocols</div>
      <div class="defi-kpi-value">${activeProtos.toLocaleString()}</div>
      <div class="defi-kpi-sub">&gt;$1M TVL</div>
    </div>
    <div class="defi-kpi">
      <div class="defi-kpi-label">Active Chains</div>
      <div class="defi-kpi-value">${activeChains}</div>
      <div class="defi-kpi-sub">&gt;$1M TVL</div>
    </div>
  </div>

  <div class="defi-grid">
    <!-- Protocols table -->
    <div class="defi-section">
      <div class="defi-section-title">Top Protocols by TVL</div>
      <div class="defi-table-wrap">
        <table class="defi-table">
          <thead><tr>
            <th>#</th><th>Protocol</th><th>Category</th>
            <th class="num">TVL</th><th class="num">1d</th><th class="num">7d</th>
          </tr></thead>
          <tbody>
            ${topProtos.map((p, i) => `<tr>
              <td class="muted">${i+1}</td>
              <td style="font-weight:600">${p.name}</td>
              <td class="muted" style="font-size:11px">${p.category || '—'}</td>
              <td class="num">${_dflFmt(p.tvl)}</td>
              <td class="num">${_dflPct(p.change_1d)}</td>
              <td class="num">${_dflPct(p.change_7d)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="defi-right-col">
      <!-- Chain TVL -->
      <div class="defi-section">
        <div class="defi-section-title">Chain TVL Share</div>
        <div class="defi-chains">
          ${topChains.map((c, i) => {
            const pct = totalTvl > 0 ? c.tvl / totalTvl * 100 : 0;
            return `<div class="defi-chain-row">
              <div class="defi-chain-rank">${i+1}</div>
              <div class="defi-chain-name">${c.name}</div>
              <div class="defi-chain-bar-wrap">
                <div class="defi-chain-bar" style="width:${Math.min(pct * 2.5, 100)}%"></div>
              </div>
              <div class="defi-chain-tvl">${_dflFmt(c.tvl)}</div>
              <div class="defi-chain-pct muted">${pct.toFixed(1)}%</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Stablecoins -->
      <div class="defi-section" style="margin-top:14px">
        <div class="defi-section-title">Stablecoin Supply (Top 8)</div>
        <table class="defi-table">
          <thead><tr>
            <th>Asset</th><th class="num">Supply</th><th class="num">Share</th>
          </tr></thead>
          <tbody>
            ${topStables.map(s => {
              const cap   = s.circulating?.peggedUSD || 0;
              const share = totalStable > 0 ? cap / totalStable * 100 : 0;
              return `<tr>
                <td style="font-weight:600">${s.symbol || s.name}</td>
                <td class="num">${_dflFmt(cap)}</td>
                <td class="num muted">${share.toFixed(1)}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>`;
}

async function defiRefresh() {
  _dflData = null; _dflTs = 0;
  const el = document.getElementById('defi-content');
  if (el) el.innerHTML = loading();
  await _fetchDefi();
  _renderDefi();
}
