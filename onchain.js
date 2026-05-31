const _OC_TTL = 3 * 60 * 1000;
let _ocTs = 0;
window._onchainData = {};

async function loadOnchain() {
  const el = document.getElementById('onchain-content');
  if (!el) return;
  if (_ocTs && Date.now() - _ocTs < _OC_TTL) { _ocRender(); return; }
  el.innerHTML = loading();
  await _ocFetch();
  _ocRender();
}

async function _ocFetch() {
  const cqKey = localStorage.getItem('hype_cryptoquant_key') || '';
  const cgKey = localStorage.getItem('hype_coinglass_key') || '';
  const cgH   = cgKey ? { 'coinglassSecret': cgKey } : {};

  const fetches = {
    bcStats:     fetch('https://blockchain.info/stats?format=json').then(r => r.ok ? r.json() : Promise.reject(new Error('bc ' + r.status))),
    mempool:     fetch('https://mempool.space/api/mempool').then(r => r.ok ? r.json() : Promise.reject(new Error('mempool ' + r.status))),
    fees:        fetch('https://mempool.space/api/v1/fees/recommended').then(r => r.ok ? r.json() : Promise.reject(new Error('fees ' + r.status))),
    hlMeta:      hlPost({ type: 'metaAndAssetCtxs' }),
    stablecoins: fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true').then(r => r.ok ? r.json() : Promise.reject(new Error('stable ' + r.status))),
    cgLiqBtc:    fetch('https://open-api.coinglass.com/public/v2/liquidation_ex_chart?ex=Binance&pair=BTCUSDT&interval=4h', { headers: cgH }).then(r => r.ok ? r.json() : Promise.reject(new Error('cg liq btc ' + r.status))),
    cgLiqEth:    fetch('https://open-api.coinglass.com/public/v2/liquidation_ex_chart?ex=Binance&pair=ETHUSDT&interval=4h', { headers: cgH }).then(r => r.ok ? r.json() : Promise.reject(new Error('cg liq eth ' + r.status))),
    cgOI:        fetch('https://open-api.coinglass.com/public/v2/openInterest', { headers: cgH }).then(r => r.ok ? r.json() : Promise.reject(new Error('cg oi ' + r.status))),
  };

  if (cqKey) {
    const cqH = { 'Authorization': 'Bearer ' + cqKey };
    fetches.cqReserve = fetch('https://api.cryptoquant.com/v1/btc/exchange-flows/reserve?window=day', { headers: cqH }).then(r => r.ok ? r.json() : Promise.reject(new Error('cq reserve ' + r.status)));
    fetches.cqMiner   = fetch('https://api.cryptoquant.com/v1/btc/flow-indicator/miner-to-exchange?window=day', { headers: cqH }).then(r => r.ok ? r.json() : Promise.reject(new Error('cq miner ' + r.status)));
  }

  const keys = Object.keys(fetches);
  const results = await Promise.allSettled(Object.values(fetches));
  const resolved = {};
  keys.forEach((k, i) => { resolved[k] = results[i].status === 'fulfilled' ? results[i].value : null; });

  const d = window._onchainData;

  d.bcStats = resolved.bcStats;
  d.mempool = resolved.mempool;
  d.fees    = resolved.fees;

  if (resolved.hlMeta) {
    const [meta, ctxs] = resolved.hlMeta;
    const coins = meta?.universe || [];
    d.hlOI = {};
    d.hlFunding = {};
    d.hlMark = {};
    coins.forEach((c, i) => {
      const ctx = ctxs?.[i];
      if (!ctx) return;
      d.hlOI[c.name]      = parseFloat(ctx.openInterest || 0);
      d.hlFunding[c.name] = parseFloat(ctx.funding || 0);
      d.hlMark[c.name]    = parseFloat(ctx.markPx || 0);
    });
  }

  if (resolved.stablecoins?.peggedAssets) {
    const assets = resolved.stablecoins.peggedAssets;
    const targets = ['USDT','USDC','DAI','USDe'];
    let total = 0, total7dAgo = 0;
    assets.forEach(a => {
      if (!targets.includes(a.symbol)) return;
      const circ = a.circulating?.peggedUSD || 0;
      total += circ;
      total7dAgo += (a.circulatingPrev7d?.peggedUSD || circ);
    });
    d.stableTotal = total;
    d.stable7dAgo = total7dAgo;
    d.stable7dChg = total7dAgo > 0 ? ((total - total7dAgo) / total7dAgo) * 100 : null;
  }

  // CoinGlass — liquidation clusters (free, no key)
  d.cgLiqBtc = _ocParseCGLiq(resolved.cgLiqBtc);
  d.cgLiqEth = _ocParseCGLiq(resolved.cgLiqEth);

  // CoinGlass — OI by exchange
  if (resolved.cgOI?.code === '0' && Array.isArray(resolved.cgOI?.data)) {
    d.cgOI = resolved.cgOI.data;
  } else {
    d.cgOI = null;
  }

  if (cqKey) {
    d.cqReserve = resolved.cqReserve ? _ocLatestCQ(resolved.cqReserve) : null;
    d.cqMiner   = resolved.cqMiner   ? _ocLatestCQ(resolved.cqMiner)   : null;
  }

  const prevBtcOi = parseFloat(localStorage.getItem('oc_btc_oi') || '0');
  const prevEthOi = parseFloat(localStorage.getItem('oc_eth_oi') || '0');
  if (d.hlOI?.BTC) localStorage.setItem('oc_btc_oi', d.hlOI.BTC);
  if (d.hlOI?.ETH) localStorage.setItem('oc_eth_oi', d.hlOI.ETH);
  d.prevBtcOi = prevBtcOi;
  d.prevEthOi = prevEthOi;

  _ocTs = Date.now();
}

function _ocParseCGLiq(resp) {
  if (!resp || resp.code !== '0') return null;
  const data = resp.data || {};
  return {
    longLiq24h:  parseFloat(data.longLiquidationUsd24h  || data.buyLiquidationUsd24h  || 0),
    shortLiq24h: parseFloat(data.shortLiquidationUsd24h || data.sellLiquidationUsd24h || 0),
    longs:       Array.isArray(data.buyList)  ? data.buyList  : [],
    shorts:      Array.isArray(data.sellList) ? data.sellList : [],
  };
}

function _ocLatestCQ(resp) {
  const data = resp?.data?.result || resp?.result || (Array.isArray(resp) ? resp : null);
  if (!Array.isArray(data) || !data.length) return null;
  return data[data.length - 1];
}

function _ocRender() {
  const el = document.getElementById('onchain-content');
  if (!el) return;
  const d = window._onchainData;
  const cqKey = localStorage.getItem('hype_cryptoquant_key') || '';
  const cgKey = localStorage.getItem('hype_coinglass_key') || '';

  const signals = _ocComputeSignals(d, cqKey);
  const bullCount = signals.filter(s => s === 'bull').length;
  const bearCount = signals.filter(s => s === 'bear').length;
  const total = signals.length;

  let regime, regimeColor, regimeBg;
  if (bullCount > bearCount + 1)        { regime = 'ACCUMULATION'; regimeColor = 'var(--green)'; regimeBg = 'var(--green-bg)'; }
  else if (bearCount > bullCount + 1)   { regime = 'DISTRIBUTION'; regimeColor = 'var(--red)';   regimeBg = 'var(--red-bg)'; }
  else if (bullCount === bearCount)     { regime = 'NEUTRAL';      regimeColor = 'var(--text-muted)'; regimeBg = 'var(--surface2)'; }
  else                                  { regime = 'WATCH';        regimeColor = 'var(--yellow)'; regimeBg = 'var(--yellow-bg)'; }

  el.innerHTML = `
<div style="padding:12px 16px;max-width:900px">

  <div style="background:${regimeBg};border:1px solid ${regimeColor};border-radius:var(--radius-lg);padding:14px 18px;margin-bottom:16px">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:4px">On-Chain Pulse</div>
    <div style="font-size:20px;font-weight:700;color:${regimeColor};letter-spacing:.04em">${regime}</div>
    <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${bullCount} bullish &nbsp;·&nbsp; ${bearCount} bearish &nbsp;·&nbsp; ${total - bullCount - bearCount} neutral &nbsp;·&nbsp; ${total} signals total</div>
  </div>

  ${_ocSectionNetwork(d)}
  ${_ocSectionFlow(d)}
  ${_ocSectionCoinGlass(d, cgKey)}
  ${cqKey ? _ocSectionCQ(d) : _ocSectionLocked('CryptoQuant', 'hype_cryptoquant_key', 'CryptoQuant API Key')}
  ${_ocSectionSettings()}

</div>`;
}

function _ocComputeSignals(d, cqKey) {
  const signals = [];

  if (d.fees?.fastestFee != null) {
    signals.push(d.fees.fastestFee < 20 ? 'bull' : d.fees.fastestFee > 80 ? 'bear' : 'neutral');
  }

  if (d.mempool?.count != null) {
    signals.push(d.mempool.count < 10000 ? 'bull' : d.mempool.count > 50000 ? 'bear' : 'neutral');
  }

  if (d.hlFunding?.BTC != null) {
    const f = d.hlFunding.BTC;
    signals.push(f < -0.0001 ? 'bull' : f > 0.0003 ? 'bear' : 'neutral');
  }

  if (d.stableTotal != null && d.stable7dChg != null) {
    signals.push(d.stable7dChg > 0.5 ? 'bull' : d.stable7dChg < -0.5 ? 'bear' : 'neutral');
  }

  if (d.hlOI?.BTC != null && d.prevBtcOi) {
    signals.push(d.hlOI.BTC > d.prevBtcOi * 1.02 ? 'bear' : d.hlOI.BTC < d.prevBtcOi * 0.98 ? 'bull' : 'neutral');
  }

  // CoinGlass liquidation bias — more shorts liquidated = squeeze up (bull signal)
  if (d.cgLiqBtc) {
    const { longLiq24h, shortLiq24h } = d.cgLiqBtc;
    if (longLiq24h > 0 || shortLiq24h > 0) {
      const ratio = shortLiq24h / (longLiq24h + shortLiq24h + 1);
      signals.push(ratio > 0.65 ? 'bull' : ratio < 0.35 ? 'bear' : 'neutral');
    }
  }

  if (cqKey && d.cqReserve) {
    const val  = parseFloat(d.cqReserve.reserve_usd || d.cqReserve.value || 0);
    const prev = parseFloat(d.cqReserve.reserve_usd_prev || d.cqReserve.prev || val);
    signals.push(val < prev ? 'bull' : val > prev ? 'bear' : 'neutral');
  }

  return signals;
}

function _ocSectionNetwork(d) {
  const bc = d.bcStats;
  const mp = d.mempool;
  const fe = d.fees;

  const fastFee   = fe?.fastestFee;
  const halfFee   = fe?.halfHourFee;
  const hourFee   = fe?.hourFee;
  const pending   = mp?.count;
  const hashRate  = bc?.hash_rate;
  const dailyTx   = bc?.n_tx;
  const dailyFees = bc?.total_fees_btc;
  const minsBetween = bc?.minutes_between_blocks;

  const feeLabel = fastFee == null ? _ocNA() : (fastFee > 80 ? _ocBadge('HIGH','red') : fastFee < 20 ? _ocBadge('LOW','green') : _ocBadge('NORMAL','blue'));
  const pendLabel = pending == null ? _ocNA() : (pending > 50000 ? _ocBadge('HIGH','red') : pending < 10000 ? _ocBadge('LOW','green') : _ocBadge('NORMAL','blue'));

  const hrVal   = hashRate  != null ? (hashRate / 1e18).toFixed(1) + ' EH/s' : '—';
  const txVal   = dailyTx   != null ? _ocNum(dailyTx) : '—';
  const feeVal  = dailyFees != null ? (dailyFees / 1e8).toFixed(4) + ' BTC' : '—';
  const blockT  = minsBetween != null ? minsBetween.toFixed(1) + ' min' : '—';
  const feeDisp = fastFee != null ? `${fastFee} sat/vB` : '—';
  const pendDisp = pending != null ? _ocNum(pending) : '—';

  return `
<div class="oc-section">
  <div class="oc-section-title">BTC Network Health</div>
  <div class="oc-grid2">
    ${_ocCard('Mempool Fee (fast)', feeDisp, feeLabel)}
    ${_ocCard('Pending Txs', pendDisp, pendLabel)}
    ${_ocCard('Hash Rate', hrVal, '')}
    ${_ocCard('Block Time', blockT, '')}
    ${_ocCard('Daily Txs', txVal, '')}
    ${_ocCard('Daily Fees', feeVal, _ocBadge('ACTIVITY','blue'))}
  </div>
  ${fe == null && bc == null && mp == null ? `<div style="color:var(--text-muted);font-size:12px;margin-top:8px">Network data unavailable</div>` : ''}
</div>`;
}

function _ocSectionFlow(d) {
  const stTotal = d.stableTotal;
  const st7d    = d.stable7dChg;
  const btcOI   = d.hlOI?.BTC;
  const ethOI   = d.hlOI?.ETH;
  const btcF    = d.hlFunding?.BTC;
  const ethF    = d.hlFunding?.ETH;
  const prevBtc = d.prevBtcOi;
  const prevEth = d.prevEthOi;

  const stDisp = stTotal != null ? _ocFmtBig(stTotal) : '—';
  const st7dDisp = st7d != null
    ? `<span style="color:${st7d >= 0 ? 'var(--green)' : 'var(--red)'};">${st7d >= 0 ? '+' : ''}${st7d.toFixed(2)}% 7d</span>`
    : '';
  const dryPowder = st7d != null ? (st7d > 0.5 ? _ocBadge('INFLOW','green') : st7d < -0.5 ? _ocBadge('OUTFLOW','red') : _ocBadge('STABLE','blue')) : _ocNA();

  const btcOIDisp  = btcOI != null ? _ocFmtBig(btcOI * (d.hlMark?.BTC || 0)) : '—';
  const ethOIDisp  = ethOI != null ? _ocFmtBig(ethOI * (d.hlMark?.ETH || 0)) : '—';

  const btcOITrend = btcOI && prevBtc ? (btcOI > prevBtc * 1.02 ? _ocBadge('RISING','red') : btcOI < prevBtc * 0.98 ? _ocBadge('FALLING','green') : _ocBadge('STABLE','blue')) : '';
  const ethOITrend = ethOI && prevEth ? (ethOI > prevEth * 1.02 ? _ocBadge('RISING','red') : ethOI < prevEth * 0.98 ? _ocBadge('FALLING','green') : _ocBadge('STABLE','blue')) : '';

  let fundLabel = _ocNA();
  let fundDisp = '—';
  if (btcF != null) {
    const pct = (btcF * 100).toFixed(4);
    fundDisp = `${btcF >= 0 ? '+' : ''}${pct}%`;
    if (btcF > 0.0003)       fundLabel = _ocBadge('HIGH','red');
    else if (btcF > 0.00005) fundLabel = _ocBadge('POSITIVE','yellow');
    else if (btcF < -0.0001) fundLabel = _ocBadge('NEGATIVE','green');
    else                     fundLabel = _ocBadge('NEUTRAL','blue');
  }

  return `
<div class="oc-section">
  <div class="oc-section-title">Flow Monitor</div>
  <div class="oc-grid2">
    ${_ocCard('Stablecoin Supply', stDisp + (st7dDisp ? ' <span style="font-size:10px;color:var(--text-muted)">USDT+USDC+DAI+USDe</span>' : ''), dryPowder, st7dDisp)}
    ${_ocCard('BTC Open Interest', btcOIDisp, btcOITrend)}
    ${_ocCard('ETH Open Interest', ethOIDisp, ethOITrend)}
    ${_ocCard('BTC Funding 8h', fundDisp, fundLabel)}
  </div>
</div>`;
}

function _ocSectionCoinGlass(d, cgKey) {
  const liqBtc = d.cgLiqBtc;
  const liqEth = d.cgLiqEth;
  const oi     = d.cgOI;

  // BTC liquidations
  let btcLongDisp = '—', btcShortDisp = '—', btcBias = _ocNA();
  if (liqBtc) {
    btcLongDisp  = _ocFmtBig(liqBtc.longLiq24h);
    btcShortDisp = _ocFmtBig(liqBtc.shortLiq24h);
    const total  = liqBtc.longLiq24h + liqBtc.shortLiq24h;
    if (total > 0) {
      const shortRatio = liqBtc.shortLiq24h / total;
      btcBias = shortRatio > 0.65 ? _ocBadge('SHORT SQUEEZE','green')
              : shortRatio < 0.35 ? _ocBadge('LONG FLUSH','red')
              : _ocBadge('BALANCED','blue');
    }
  }

  // ETH liquidations
  let ethLongDisp = '—', ethShortDisp = '—', ethBias = _ocNA();
  if (liqEth) {
    ethLongDisp  = _ocFmtBig(liqEth.longLiq24h);
    ethShortDisp = _ocFmtBig(liqEth.shortLiq24h);
    const total  = liqEth.longLiq24h + liqEth.shortLiq24h;
    if (total > 0) {
      const shortRatio = liqEth.shortLiq24h / total;
      ethBias = shortRatio > 0.65 ? _ocBadge('SHORT SQUEEZE','green')
              : shortRatio < 0.35 ? _ocBadge('LONG FLUSH','red')
              : _ocBadge('BALANCED','blue');
    }
  }

  // OI by exchange — show top 5 by USD value
  let oiRows = '';
  if (Array.isArray(oi) && oi.length) {
    const sorted = [...oi].sort((a, b) => (parseFloat(b.openInterestUsd || 0) - parseFloat(a.openInterestUsd || 0)));
    const top = sorted.slice(0, 5);
    const maxUSD = parseFloat(top[0]?.openInterestUsd || 0) || 1;
    oiRows = top.map(ex => {
      const name  = ex.exchangeName || '—';
      const usd   = parseFloat(ex.openInterestUsd || 0);
      const pct   = ((usd / maxUSD) * 100).toFixed(0);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px">
        <div style="width:70px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;font-size:10px">${name}</div>
        <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--blue);border-radius:3px"></div>
        </div>
        <div style="width:60px;text-align:right;font-family:var(--mono);color:var(--text)">${_ocFmtBig(usd)}</div>
      </div>`;
    }).join('');
  }

  const noData = !liqBtc && !liqEth && !oi;

  return `
<div class="oc-section">
  <div class="oc-section-title">CoinGlass · Liquidations &amp; OI</div>
  ${!cgKey ? `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px;font-size:12px;color:var(--text-muted)">Add a CoinGlass API key in Settings below to unlock liquidation &amp; OI data.</div>` : noData ? `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px;font-size:12px;color:var(--text-muted)">CoinGlass data unavailable — CORS may block browser requests. Data loads normally from the Telegram bot.</div>` : `
  <div class="oc-grid2">
    ${_ocCard('BTC Longs Liq 24h', btcLongDisp, btcBias)}
    ${_ocCard('BTC Shorts Liq 24h', btcShortDisp, '')}
    ${_ocCard('ETH Longs Liq 24h', ethLongDisp, ethBias)}
    ${_ocCard('ETH Shorts Liq 24h', ethShortDisp, '')}
  </div>
  ${oiRows ? `<div style="margin-top:14px">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:8px">OI by Exchange (Top 5)</div>
    ${oiRows}
  </div>` : ''}
  `}
</div>`;
}

function _ocSectionCQ(d) {
  const res   = d.cqReserve;
  const miner = d.cqMiner;

  let resDisp = '—', resLbl = _ocNA();
  if (res) {
    const val  = parseFloat(res.reserve_usd || res.value || 0);
    const prev = parseFloat(res.reserve_usd_prev || res.prev || val);
    resDisp = _ocFmtBig(val);
    resLbl  = val < prev * 0.999 ? _ocBadge('FALLING','green') : val > prev * 1.001 ? _ocBadge('RISING','red') : _ocBadge('STABLE','blue');
  }

  let minerDisp = '—', minerLbl = _ocNA();
  if (miner) {
    const v = parseFloat(miner.flow_total || miner.value || 0);
    minerDisp = _ocFmtBig(Math.abs(v)) + ' BTC';
    minerLbl  = v > 500 ? _ocBadge('HIGH','red') : v < 100 ? _ocBadge('LOW','green') : _ocBadge('NORMAL','blue');
  }

  return `
<div class="oc-section">
  <div class="oc-section-title">CryptoQuant Flows</div>
  <div class="oc-grid2">
    ${_ocCard('Exchange Reserve', resDisp, resLbl)}
    ${_ocCard('Miner-to-Exchange', minerDisp, minerLbl)}
  </div>
</div>`;
}

function _ocSectionLocked(name, lsKey, placeholder) {
  return `
<div class="oc-section">
  <div class="oc-section-title">${name}</div>
  <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px;font-size:12px;color:var(--text-muted)">
    Add a ${name} API key in Settings below to unlock this section.
  </div>
</div>`;
}

function _ocSectionSettings() {
  const cgKey = localStorage.getItem('hype_coinglass_key') || '';
  const cqKey = localStorage.getItem('hype_cryptoquant_key') || '';
  return `
<div class="oc-section">
  <details>
    <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-muted);padding:6px 0;list-style:none;display:flex;align-items:center;gap:6px">
      <span style="font-size:11px">&#9660;</span> API Key Settings
    </summary>
    <div style="padding:12px 0;display:flex;flex-direction:column;gap:12px">
      <div>
        <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);display:block;margin-bottom:4px">CoinGlass API Key</label>
        <div style="display:flex;gap:8px">
          <input id="oc-cg-key" type="password" value="${_ocEsc(cgKey)}" placeholder="Enter key…"
            style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:7px 10px;color:var(--text);font-size:12px;font-family:var(--mono);outline:none">
          <button onclick="_ocSaveKey('hype_coinglass_key','oc-cg-key')" class="btn btn-ghost btn-sm">Save</button>
        </div>
        <div style="font-size:10px;color:var(--text-faint);margin-top:4px">Free · unlocks liquidation clusters and OI by exchange</div>
      </div>
      <div>
        <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);display:block;margin-bottom:4px">CryptoQuant API Key</label>
        <div style="display:flex;gap:8px">
          <input id="oc-cq-key" type="password" value="${_ocEsc(cqKey)}" placeholder="Enter key…"
            style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:7px 10px;color:var(--text);font-size:12px;font-family:var(--mono);outline:none">
          <button onclick="_ocSaveKey('hype_cryptoquant_key','oc-cq-key')" class="btn btn-ghost btn-sm">Save</button>
        </div>
        <div style="font-size:10px;color:var(--text-faint);margin-top:4px">Optional · unlocks Exchange Reserve and Miner-to-Exchange flow data</div>
      </div>
    </div>
  </details>
</div>

<style>
.oc-section { margin-bottom:18px }
.oc-section-title { font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text-faint);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border) }
.oc-grid2 { display:grid;grid-template-columns:repeat(2,1fr);gap:8px }
@media(max-width:480px){ .oc-grid2{ grid-template-columns:1fr } }
.oc-card { background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;min-width:0 }
.oc-card-label { font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:4px }
.oc-card-value { font-size:16px;font-weight:700;color:var(--text);font-family:var(--mono);word-break:break-all }
.oc-card-sub { margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap }
.oc-badge { display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;padding:2px 7px;border-radius:var(--radius-pill) }
.oc-badge-green { background:var(--green-bg);color:var(--green) }
.oc-badge-red   { background:var(--red-bg);color:var(--red) }
.oc-badge-blue  { background:var(--blue-bg);color:var(--blue) }
.oc-badge-yellow{ background:var(--yellow-bg);color:var(--yellow) }
.oc-badge-muted { background:var(--surface2);color:var(--text-muted) }
details > summary::-webkit-details-marker { display:none }
</style>`;
}

function _ocSaveKey(lsKey, inputId) {
  const val = (document.getElementById(inputId)?.value || '').trim();
  if (val) localStorage.setItem(lsKey, val);
  else localStorage.removeItem(lsKey);
  _ocTs = 0;
  loadOnchain();
}

function _ocCard(label, value, badge, sub) {
  return `<div class="oc-card">
  <div class="oc-card-label">${label}</div>
  <div class="oc-card-value">${value}</div>
  <div class="oc-card-sub">${badge || ''}${sub ? `<span style="font-size:11px;color:var(--text-muted)">${sub}</span>` : ''}</div>
</div>`;
}

function _ocBadge(text, color) {
  return `<span class="oc-badge oc-badge-${color}">${text}</span>`;
}

function _ocNA() {
  return `<span class="oc-badge oc-badge-muted">—</span>`;
}

function _ocFmtBig(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return '$' + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9)  return '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6)  return '$' + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3)  return '$' + (a / 1e3).toFixed(0) + 'K';
  return '$' + a.toFixed(0);
}

function _ocNum(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

function _ocEsc(s) {
  return String(s || '').replace(/"/g, '&quot;');
}
