let _indData = null, _indDataTs = 0;
const IND_TTL = 300000;

function calcSMA(arr, n) { return arr.slice(-n).reduce((a,b)=>a+b,0)/n; }
function calcEMA(arr, n) {
  const k = 2/(n+1);
  let ema = arr.slice(0, n).reduce((a,b)=>a+b,0)/n;
  for (let i = n; i < arr.length; i++) ema = arr[i]*k + ema*(1-k);
  return ema;
}

function parseFG(data) {
  if (!data?.data?.length) return null;
  const value = parseInt(data.data[0].value);
  const zone = value <= 24 ? 'EXTREME_FEAR' : value <= 39 ? 'FEAR' : value <= 59 ? 'NEUTRAL' : value <= 79 ? 'GREED' : 'EXTREME_GREED';
  const history = data.data.map(d => ({ t: parseInt(d.timestamp)*1000, v: parseInt(d.value) }));
  return { value, classification: data.data[0].value_classification, zone, history };
}

function parseBMSB(klines) {
  if (!Array.isArray(klines) || klines.length < 21) return null;
  const closes = klines.map(k => parseFloat(k[4]));
  const sma20w = calcSMA(closes, 20);
  const ema21w = calcEMA(closes, 21);
  const currentPrice = closes[closes.length-1];
  const signal = currentPrice > sma20w && currentPrice > ema21w ? 'BULL' : currentPrice < sma20w && currentPrice < ema21w ? 'BEAR' : 'NEUTRAL';
  return {
    sma20w, ema21w, currentPrice, signal,
    pctAboveSMA: ((currentPrice/sma20w-1)*100).toFixed(1),
    pctAboveEMA: ((currentPrice/ema21w-1)*100).toFixed(1),
  };
}

function parsePiCycle(klines) {
  if (!Array.isArray(klines) || klines.length < 350) return null;
  const closes = klines.map(k => parseFloat(k[4]));
  const sma111 = calcSMA(closes, 111);
  const sma350x2 = calcSMA(closes, 350) * 2;
  const proximity = (sma111 / sma350x2 * 100).toFixed(1);
  const signal = sma111 >= sma350x2 ? 'TOP' : parseFloat(proximity) > 85 ? 'WARNING' : 'NORMAL';
  return { sma111, sma350x2, proximity, signal, currentPrice: closes[closes.length-1] };
}

async function fetchIndicators() {
  if (_indData && Date.now() - _indDataTs < IND_TTL) return _indData;
  const [fgRes, weeklyRes, dailyRes] = await Promise.allSettled([
    fetch('https://api.alternative.me/fng/?limit=30').then(r => r.json()),
    fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=160').then(r => r.json()),
    fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=400').then(r => r.json()),
  ]);
  _indData = {
    fear_greed: fgRes.status === 'fulfilled' ? parseFG(fgRes.value) : null,
    bmsb: weeklyRes.status === 'fulfilled' ? parseBMSB(weeklyRes.value) : null,
    pi_cycle: dailyRes.status === 'fulfilled' ? parsePiCycle(dailyRes.value) : null,
    floors: { realized: 72000, balanced: 41000, cvdd: 45000, terminal: 290000 },
    fetched_at: Date.now(),
  };
  _indDataTs = Date.now();
  window._indData = _indData;
  return _indData;
}

function indSignalBadge(signal, cls) {
  return `<span class="ind-signal-badge ind-${cls||signal.toLowerCase()}">${signal}</span>`;
}

function fgBarColor(v) { return v >= 50 ? 'rgba(74,222,128,0.7)' : 'rgba(248,113,113,0.7)'; }

function renderFGSparkline(history, containerId) {
  if (!history || !window.Chart) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  const slice = history.slice(0, 30).reverse();
  const labels = slice.map(d => '');
  const values = slice.map(d => d.v);
  const colors = values.map(v => fgBarColor(v));
  new Chart(el, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false, min: 0, max: 100 },
      },
      animation: false,
    },
  });
}

function indCard(opts) {
  const { title, value, valueCls, signal, signalCls, detail, extra, sparkId } = opts;
  return `<div class="ind-card">
    <div class="ind-card-title">${title}</div>
    ${signal ? indSignalBadge(signal, signalCls) : ''}
    ${value !== undefined ? `<div class="ind-card-value ${valueCls||''}">${value}</div>` : ''}
    ${sparkId ? `<div class="ind-sparkline-wrap"><canvas id="${sparkId}" height="60"></canvas></div>` : ''}
    ${detail ? `<div class="ind-card-detail">${detail}</div>` : ''}
    ${extra || ''}
  </div>`;
}

async function loadIndicators() {
  const el = document.getElementById('indicators-content');
  if (!el) return;

  el.innerHTML = `<div class="loading"><div class="spinner"></div> Fetching indicators…</div>`;

  let ind;
  try {
    ind = await fetchIndicators();
  } catch(e) {
    el.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
    return;
  }

  const fg = ind.fear_greed;
  const bmsb = ind.bmsb;
  const pi = ind.pi_cycle;
  const floors = ind.floors;

  const fgValue = fg ? fg.value : null;
  const fgZone = fg ? fg.zone : null;
  const fgCls = fgZone === 'EXTREME_GREED' ? 'pos' : fgZone === 'EXTREME_FEAR' ? 'neg' : fgZone === 'GREED' ? 'pos' : fgZone === 'FEAR' ? 'neg' : 'muted';

  const bmsbSignal = bmsb ? bmsb.signal : '—';
  const piProx = pi ? pi.proximity + '%' : '—';

  const mvrvZ = (typeof _mvrvData !== 'undefined' && _mvrvData?.summary?.z_score)
    ? _mvrvData.summary.z_score.toFixed(2) : null;

  const stripHtml = `<div class="ind-strip">
    <div class="ind-chip">
      <span class="ind-label">F&G</span>
      <span class="${fgCls} mono">${fg ? fg.value : '—'}</span>
      ${fg ? `<span class="ind-badge ind-${fg.zone.toLowerCase()}">${fg.classification}</span>` : ''}
    </div>
    <div class="ind-chip">
      <span class="ind-label">BMSB</span>
      <span class="${bmsb ? (bmsb.signal==='BULL'?'pos':bmsb.signal==='BEAR'?'neg':'yellow') : 'muted'} mono">${bmsbSignal}</span>
      ${bmsb ? `<span class="ind-badge ind-${bmsb.signal.toLowerCase()}">${bmsb.signal}</span>` : ''}
    </div>
    <div class="ind-chip">
      <span class="ind-label">Pi Cycle</span>
      <span class="${pi ? (pi.signal==='TOP'?'neg':pi.signal==='WARNING'?'yellow':'pos') : 'muted'} mono">${piProx}</span>
      ${pi ? `<span class="ind-badge ind-${pi.signal.toLowerCase()}">${pi.signal}</span>` : ''}
    </div>
    <div class="ind-chip">
      <span class="ind-label">MVRV Z</span>
      <span class="mono">${mvrvZ || '—'}</span>
    </div>
  </div>`;

  const fgBarPct = fg ? fg.value : 0;
  const fgCard = indCard({
    title: 'Fear & Greed Index',
    value: fg ? fg.value : '—',
    valueCls: fgCls,
    signal: fg ? fg.zone.replace('_', ' ') : 'N/A',
    signalCls: fg ? fg.zone.toLowerCase() : 'neutral',
    sparkId: 'fg-sparkline',
    detail: fg ? `<div class="ind-bar-wrap"><div class="ind-bar-fill ind-fg-bar" style="width:100%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted)"><span>Extreme Fear</span><span>Extreme Greed</span></div>
      <div class="ind-bar-wrap" style="margin-top:2px"><div class="ind-bar-fill" style="width:${fgBarPct}%;background:${fgBarPct>=50?'var(--green)':'var(--red)'}"></div></div>` : 'Data unavailable',
  });

  const bmsbCard = indCard({
    title: 'Bull Market Support Band',
    signal: bmsb ? bmsb.signal : 'N/A',
    signalCls: bmsb ? bmsb.signal.toLowerCase() : 'neutral',
    detail: bmsb ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:6px">
        <div><div style="font-size:10px;color:var(--text-muted)">Price</div><div class="mono" style="font-size:12px;font-weight:600">$${Math.round(bmsb.currentPrice).toLocaleString()}</div></div>
        <div><div style="font-size:10px;color:var(--text-muted)">vs 20W SMA</div><div class="mono ${parseFloat(bmsb.pctAboveSMA)>=0?'pos':'neg'}" style="font-size:12px;font-weight:600">${bmsb.pctAboveSMA}%</div></div>
        <div><div style="font-size:10px;color:var(--text-muted)">20W SMA</div><div class="mono" style="font-size:12px">$${Math.round(bmsb.sma20w).toLocaleString()}</div></div>
        <div><div style="font-size:10px;color:var(--text-muted)">vs 21W EMA</div><div class="mono ${parseFloat(bmsb.pctAboveEMA)>=0?'pos':'neg'}" style="font-size:12px;font-weight:600">${bmsb.pctAboveEMA}%</div></div>
        <div><div style="font-size:10px;color:var(--text-muted)">21W EMA</div><div class="mono" style="font-size:12px">$${Math.round(bmsb.ema21w).toLocaleString()}</div></div>
      </div>` : 'Data unavailable',
  });

  const piProxNum = pi ? parseFloat(pi.proximity) : 0;
  const piCard = indCard({
    title: 'Pi Cycle Top Indicator',
    signal: pi ? pi.signal : 'N/A',
    signalCls: pi ? pi.signal.toLowerCase() : 'normal',
    detail: pi ? `
      <div style="margin-top:6px">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
          <span style="color:var(--text-muted)">Proximity to top</span>
          <span class="mono ${pi.signal==='TOP'?'neg':pi.signal==='WARNING'?'yellow':'pos'}">${pi.proximity}%</span>
        </div>
        <div class="ind-bar-wrap"><div class="ind-bar-fill" style="width:${piProxNum}%;background:${piProxNum>=100?'var(--red)':piProxNum>85?'var(--yellow)':'var(--green)'}"></div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px">
          <div><div style="font-size:10px;color:var(--text-muted)">111D SMA</div><div class="mono" style="font-size:12px">$${Math.round(pi.sma111).toLocaleString()}</div></div>
          <div><div style="font-size:10px;color:var(--text-muted)">350D SMA ×2</div><div class="mono" style="font-size:12px">$${Math.round(pi.sma350x2).toLocaleString()}</div></div>
        </div>
      </div>` : 'Data unavailable',
  });

  const mvrvCard = indCard({
    title: 'MVRV Z-Score',
    value: mvrvZ || '—',
    valueCls: mvrvZ ? (parseFloat(mvrvZ) > 7 ? 'neg' : parseFloat(mvrvZ) > 3 ? 'yellow' : parseFloat(mvrvZ) < 0 ? 'pos' : '') : 'muted',
    signal: mvrvZ ? (parseFloat(mvrvZ) > 7 ? 'OVERHEATED' : parseFloat(mvrvZ) > 3 ? 'ELEVATED' : parseFloat(mvrvZ) < 0 ? 'UNDERVALUED' : 'NORMAL') : 'N/A',
    signalCls: mvrvZ ? (parseFloat(mvrvZ) > 7 ? 'bear' : parseFloat(mvrvZ) > 3 ? 'warning' : parseFloat(mvrvZ) < 0 ? 'bull' : 'normal') : 'neutral',
    detail: mvrvZ ? 'From MVRV tab data' : 'Load MVRV tab first to populate',
  });

  const floorCards = `
    <div class="ind-floor-card">
      <div class="ind-floor-name">Realized Price</div>
      <div class="ind-floor-price">$${floors.realized.toLocaleString()}</div>
      <div class="ind-floor-desc">Mid floor — accumulation zone</div>
    </div>
    <div class="ind-floor-card">
      <div class="ind-floor-name">Balanced Price</div>
      <div class="ind-floor-price">$${floors.balanced.toLocaleString()}</div>
      <div class="ind-floor-desc">Deep floor — bear cycle low</div>
    </div>
    <div class="ind-floor-card">
      <div class="ind-floor-name">CVDD</div>
      <div class="ind-floor-price">$${floors.cvdd.toLocaleString()}</div>
      <div class="ind-floor-desc">Deep floor — bear cycle low</div>
    </div>
    <div class="ind-floor-card">
      <div class="ind-floor-name">Terminal Price</div>
      <div class="ind-floor-price">$${floors.terminal.toLocaleString()}</div>
      <div class="ind-floor-desc">Cycle top estimate</div>
    </div>`;

  const unavailCard = (name, desc) => `
    <div class="ind-card ind-unavail">
      <div class="ind-card-title">${name}</div>
      <div class="ind-card-detail">${desc}</div>
      <div style="margin-top:8px"><span class="ind-unavail-badge">Requires Glassnode/CryptoQuant</span></div>
    </div>`;

  el.innerHTML = `
    ${stripHtml}
    <div class="ind-section-title">MARKET REGIME</div>
    <div class="ind-grid">
      ${fgCard}
      ${bmsbCard}
    </div>
    <div class="ind-section-title">CYCLE POSITION</div>
    <div class="ind-grid">
      ${piCard}
      ${mvrvCard}
    </div>
    <div class="ind-section-title">PRICE FLOORS (BTC Reference)</div>
    <div class="ind-floor-grid">${floorCards}</div>
    <div style="padding:0 14px 10px;font-size:11px;color:var(--text-muted)">Floor values are approximations — update in INTEL config</div>
    <div class="ind-section-title">UNAVAILABLE (Requires Paid API)</div>
    <div class="ind-grid">
      ${unavailCard('Puell Multiple', 'Miner revenue relative to 365-day average — cycle top/bottom timing')}
      ${unavailCard('Hash Ribbons', 'Miner capitulation indicator — powerful buy signal after bear markets')}
      ${unavailCard('STH Realized Price', 'Short-term holder cost basis — key support/resistance level')}
    </div>
  `;

  if (fg?.history) {
    setTimeout(() => renderFGSparkline(fg.history, 'fg-sparkline'), 50);
  }
}
