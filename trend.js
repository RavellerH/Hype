const TREND_COINS_DEFAULT = ['BTC','ETH','SOL','HYPE','SUI','AVAX','BNB','DOGE','PEPE','WIF'];
let _trendRunning = false;
window._trendLastScan = null;

function _trendADX(highs, lows, closes, p = 14) {
  if (closes.length < p + 1) return { adx: [], pdi: [], mdi: [] };
  const tr = [], dmP = [], dmM = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i], l = lows[i], ph = highs[i-1], pl = lows[i-1];
    tr.push(Math.max(h - l, Math.abs(h - closes[i-1]), Math.abs(l - closes[i-1])));
    const up = h - ph, dn = pl - l;
    dmP.push(up > dn && up > 0 ? up : 0);
    dmM.push(dn > up && dn > 0 ? dn : 0);
  }
  function wilder(arr, n) {
    let s = arr.slice(0, n).reduce((a, b) => a + b, 0);
    const out = new Array(n - 1).fill(null);
    out.push(s);
    for (let i = n; i < arr.length; i++) { s = s - s / n + arr[i]; out.push(s); }
    return out;
  }
  const atrW = wilder(tr, p), dpW = wilder(dmP, p), dmW = wilder(dmM, p);
  const pdi = [], mdi = [], dx = [];
  for (let i = 0; i < atrW.length; i++) {
    if (atrW[i] === null) { pdi.push(null); mdi.push(null); continue; }
    const pi = atrW[i] > 0 ? dpW[i] / atrW[i] * 100 : 0;
    const mi = atrW[i] > 0 ? dmW[i] / atrW[i] * 100 : 0;
    pdi.push(pi); mdi.push(mi);
    const sum = pi + mi;
    dx.push(sum > 0 ? Math.abs(pi - mi) / sum * 100 : 0);
  }
  const adxArr = [];
  const dxClean = dx.filter(v => v !== null);
  if (dxClean.length < p) return { adx: [], pdi, mdi };
  let adxVal = dxClean.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const pre = new Array(Math.max(0, pdi.length - dxClean.length + p - 1)).fill(null);
  adxArr.push(...pre, adxVal);
  for (let i = p; i < dxClean.length; i++) {
    adxVal = (adxVal * (p - 1) + dxClean[i]) / p;
    adxArr.push(adxVal);
  }
  return { adx: adxArr, pdi, mdi };
}

function _trendSupertrend(highs, lows, closes, period = 10, mult = 3) {
  const atr = iATR(highs, lows, closes, period);
  const out = [];
  let trend = 1, prevUp = 0, prevDn = 0;
  for (let i = 0; i < closes.length; i++) {
    const a = atr[i];
    if (a === null) { out.push(null); continue; }
    const mid = (highs[i] + lows[i]) / 2;
    let up = mid - mult * a;
    let dn = mid + mult * a;
    if (i > 0 && out[i-1] !== null) {
      up = Math.max(up, prevUp);
      dn = Math.min(dn, prevDn);
    }
    if (closes[i] > prevDn) trend = 1;
    else if (closes[i] < prevUp) trend = -1;
    prevUp = up; prevDn = dn;
    out.push({ trend, line: trend === 1 ? up : dn });
  }
  return out;
}

function _trendMarketStructure(candles) {
  if (!candles || candles.length < 20) return { structure: 'NEUTRAL', details: [], breakout: false };
  const highs = candles.map(c => parseFloat(c.h));
  const lows  = candles.map(c => parseFloat(c.l));
  const closes = candles.map(c => parseFloat(c.c));
  const n = closes.length;
  const slice = 20;
  const rH = highs.slice(-slice), rL = lows.slice(-slice);
  const pivH = [], pivL = [];
  for (let i = 2; i < rH.length - 2; i++) {
    if (rH[i] > rH[i-1] && rH[i] > rH[i-2] && rH[i] > rH[i+1] && rH[i] > rH[i+2]) pivH.push(rH[i]);
    if (rL[i] < rL[i-1] && rL[i] < rL[i-2] && rL[i] < rL[i+1] && rL[i] < rL[i+2]) pivL.push(rL[i]);
  }
  const details = [];
  let hhCount = 0, hlCount = 0, llCount = 0, lhCount = 0;
  for (let i = 1; i < pivH.length; i++) {
    if (pivH[i] > pivH[i-1]) { hhCount++; details.push('HH'); }
    else { lhCount++; details.push('LH'); }
  }
  for (let i = 1; i < pivL.length; i++) {
    if (pivL[i] > pivL[i-1]) { hlCount++; details.push('HL'); }
    else { llCount++; details.push('LL'); }
  }
  const atr = iATR(highs, lows, closes, 14);
  const atrNow = atr.at(-1) || 0;
  const atrEarly = (atr.slice(0, Math.floor(n / 4)).filter(Boolean).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(n / 4))) || atrNow || 1;
  const atrRatio = atrNow / atrEarly;
  const breakoutCandle = closes.at(-1) > Math.max(...highs.slice(-20, -1)) || closes.at(-1) < Math.min(...lows.slice(-20, -1));
  let structure;
  if (atrRatio < 0.65) structure = 'CONTRACTING';
  else if (atrRatio > 1.5) structure = 'EXPANDING';
  else if (hhCount >= 1 && hlCount >= 1 && hhCount + hlCount > lhCount + llCount) structure = 'UPTREND';
  else if (llCount >= 1 && lhCount >= 1 && llCount + lhCount > hhCount + hlCount) structure = 'DOWNTREND';
  else structure = 'NEUTRAL';
  return { structure, details: details.slice(-4), breakout: breakoutCandle };
}

function _trendRSIDivergence(closes, candles) {
  if (!closes || closes.length < 30 || !candles || candles.length < 30) return [];
  const rsi = iRSI(closes, 14).filter(v => v !== null);
  if (rsi.length < 10) return [];
  const results = [];
  const lb = Math.min(closes.length, rsi.length, 15);
  const recentCloses = closes.slice(-lb);
  const recentRsi    = rsi.slice(-lb);
  const priceMin = Math.min(...recentCloses), priceMax = Math.max(...recentCloses);
  const rsiMin   = Math.min(...recentRsi),   rsiMax   = Math.max(...recentRsi);
  const priceMinIdx = recentCloses.lastIndexOf(priceMin);
  const priceMaxIdx = recentCloses.lastIndexOf(priceMax);
  const rsiMinIdx   = recentRsi.lastIndexOf(rsiMin);
  const rsiMaxIdx   = recentRsi.lastIndexOf(rsiMax);
  if (priceMinIdx < lb - 3 && rsiMinIdx > priceMinIdx && rsiMin > 35) {
    results.push({ type: 'BULLISH', label: 'Bull div (RSI)', strength: rsiMin < 45 ? 'strong' : 'mild' });
  }
  if (priceMaxIdx < lb - 3 && rsiMaxIdx > priceMaxIdx && rsiMax < 65) {
    results.push({ type: 'BEARISH', label: 'Bear div (RSI)', strength: rsiMax > 55 ? 'strong' : 'mild' });
  }
  return results;
}

function _emaAlignment(closes) {
  if (closes.length < 20) return { label: 'N/A', bull: false };
  const ema20 = iEMA(closes, 20).at(-1);
  const ema50 = closes.length >= 50 ? iEMA(closes, 50).at(-1) : null;
  const price = closes.at(-1);
  if (price > ema20 && (ema50 === null || price > ema50) && (ema50 === null || ema20 > ema50)) return { label: 'BULL', bull: true };
  if (price < ema20 && (ema50 === null || price < ema50) && (ema50 === null || ema20 < ema50)) return { label: 'BEAR', bull: false };
  return { label: 'MIXED', bull: null };
}

function _adxLabel(adxVal) {
  if (adxVal === null || adxVal === undefined) return { label: '—', value: null };
  if (adxVal >= 40) return { label: 'STRONG', value: adxVal };
  if (adxVal >= 25) return { label: 'TREND',  value: adxVal };
  if (adxVal < 20)  return { label: 'RANGE',  value: adxVal };
  return { label: 'WEAK', value: adxVal };
}

async function _trendFetchOI(coin) {
  try {
    const raw = await hlPost({ type: 'metaAndAssetCtxs' });
    const universe = raw[0]?.universe || [];
    const ctxs = raw[1] || [];
    const idx = universe.findIndex(u => u.name === coin);
    if (idx === -1) return null;
    return parseFloat(ctxs[idx]?.openInterest || 0);
  } catch { return null; }
}

async function _analyzeCoin(coin) {
  const result = {
    coin,
    score: 0,
    tf: { '1h': null, '4h': null, '1d': null },
    rsiDiv: [],
    oi: null,
    oiDir: null,
    structure: 'NEUTRAL',
    error: false,
  };

  try {
    const [c1h, c4h, c1d, oiNow] = await Promise.allSettled([
      getCandles(coin, '1h', 7),
      getCandles(coin, '4h', 60),
      getCandles(coin, '1d', 200),
      _trendFetchOI(coin),
    ]);

    const candles = {
      '1h': c1h.status === 'fulfilled' ? c1h.value : [],
      '4h': c4h.status === 'fulfilled' ? c4h.value : [],
      '1d': c1d.status === 'fulfilled' ? c1d.value : [],
    };

    const oiVal = oiNow.status === 'fulfilled' ? oiNow.value : null;
    const oiKey = `trend_oi_${coin}`;
    if (oiVal !== null) {
      const prev = parseFloat(localStorage.getItem(oiKey) || '0');
      if (prev > 0) result.oiDir = oiVal > prev * 1.005 ? 'up' : oiVal < prev * 0.995 ? 'down' : 'flat';
      localStorage.setItem(oiKey, String(oiVal));
      result.oi = oiVal;
    }

    let totalScore = 0;

    for (const tf of ['1h', '4h', '1d']) {
      const cs = candles[tf];
      if (!cs || cs.length < 20) { result.tf[tf] = null; continue; }
      const highs  = cs.map(c => parseFloat(c.h));
      const lows   = cs.map(c => parseFloat(c.l));
      const closes = cs.map(c => parseFloat(c.c));

      const ema = _emaAlignment(closes);
      const adxData = _trendADX(highs, lows, closes, 14);
      const adxVal  = adxData.adx.length ? adxData.adx.filter(Boolean).at(-1) : null;
      const adxInfo = _adxLabel(adxVal);
      const stArr   = _trendSupertrend(highs, lows, closes, 10, 3);
      const stLast  = stArr.filter(Boolean).at(-1);
      const stDir   = stLast ? stLast.trend : 0;
      const ms      = _trendMarketStructure(cs);
      const rsiArr  = iRSI(closes, 14).filter(v => v !== null);
      const rsiVal  = rsiArr.length ? rsiArr.at(-1) : null;

      let tfBull = 0;
      if (ema.bull === true)  tfBull++;
      if (ema.bull === false) tfBull--;
      if (stDir === 1)  tfBull++;
      if (stDir === -1) tfBull--;
      if (ms.structure === 'UPTREND')   tfBull++;
      if (ms.structure === 'DOWNTREND') tfBull--;
      totalScore += tfBull;

      result.tf[tf] = { ema, adx: adxInfo, stDir, ms, rsiVal };

      if (tf === '1d') result.structure = ms.structure;
    }

    const candles4h = candles['4h'];
    if (candles4h && candles4h.length >= 30) {
      const closes4h = candles4h.map(c => parseFloat(c.c));
      result.rsiDiv = _trendRSIDivergence(closes4h, candles4h);
    }

    result.score = Math.max(-3, Math.min(3, Math.round(totalScore / 3)));
  } catch (e) {
    result.error = true;
    console.warn(`[trend] ${coin}:`, e.message);
  }

  return result;
}

function _scoreChip(score) {
  const colors = {
    '-3': 'var(--red)',
    '-2': '#f87171cc',
    '-1': '#fb923c',
    '0':  'var(--text-muted)',
    '1':  '#86efac',
    '2':  '#4ade80cc',
    '3':  'var(--green)',
  };
  const col = colors[String(score)] || 'var(--text-muted)';
  const sign = score > 0 ? '+' : '';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:var(--radius-pill);background:${col}22;color:${col};font-weight:700;font-size:12px;font-family:var(--mono)">${sign}${score}</span>`;
}

function _emaBadge(ema) {
  if (!ema) return '<span style="color:var(--text-muted)">—</span>';
  const col = ema.bull === true ? 'var(--green)' : ema.bull === false ? 'var(--red)' : 'var(--text-muted)';
  return `<span style="color:${col};font-size:11px;font-weight:600">${ema.label}</span>`;
}

function _stArrow(dir) {
  if (dir === 1)  return `<span style="color:var(--green)">↑</span>`;
  if (dir === -1) return `<span style="color:var(--red)">↓</span>`;
  return '<span style="color:var(--text-muted)">—</span>';
}

function _structAbbr(s) {
  const map = { UPTREND: 'UT', DOWNTREND: 'DT', CONTRACTING: 'CTR', EXPANDING: 'EXP', NEUTRAL: 'NEU' };
  const col = s === 'UPTREND' ? 'var(--green)' : s === 'DOWNTREND' ? 'var(--red)' : 'var(--text-muted)';
  return `<span style="color:${col};font-size:10px">${map[s] || '—'}</span>`;
}

function _tfCell(tf) {
  if (!tf) return '<td style="color:var(--text-muted);text-align:center">—</td>';
  const adxCol = tf.adx.value !== null ? (tf.adx.value >= 40 ? 'var(--green)' : tf.adx.value >= 25 ? 'var(--accent)' : 'var(--text-muted)') : 'var(--text-muted)';
  const adxStr = tf.adx.value !== null ? `<span style="color:${adxCol};font-size:10px;font-family:var(--mono)">${tf.adx.value.toFixed(0)}</span><span style="font-size:9px;color:var(--text-muted)"> ${tf.adx.label}</span>` : '<span style="color:var(--text-muted)">—</span>';
  const rsiCol = tf.rsiVal !== null ? (tf.rsiVal >= 70 ? 'var(--red)' : tf.rsiVal <= 30 ? 'var(--green)' : 'var(--text)') : 'var(--text-muted)';
  return `<td style="white-space:nowrap;vertical-align:middle;padding:6px 8px">
    <div style="display:flex;flex-direction:column;gap:2px;align-items:flex-start">
      <div style="display:flex;gap:5px;align-items:center">${_emaBadge(tf.ema)} ${_stArrow(tf.stDir)} ${_structAbbr(tf.ms.structure)}</div>
      <div style="display:flex;gap:5px;align-items:center">${adxStr}</div>
      ${tf.rsiVal !== null ? `<div style="font-size:10px;color:${rsiCol};font-family:var(--mono)">RSI ${tf.rsiVal.toFixed(0)}</div>` : ''}
    </div>
  </td>`;
}

function _rsiDivCell(divs) {
  if (!divs || divs.length === 0) return '<td style="color:var(--text-muted);text-align:center">—</td>';
  return '<td>' + divs.map(d => {
    const col = d.type === 'BULLISH' ? 'var(--green)' : 'var(--red)';
    const arrow = d.type === 'BULLISH' ? '🔺' : '🔻';
    return `<span style="color:${col};font-size:11px">${arrow} ${d.type === 'BULLISH' ? 'BULL' : 'BEAR'}</span>`;
  }).join('<br>') + '</td>';
}

function _oiCell(dir) {
  if (!dir || dir === 'flat') return '<td style="color:var(--text-muted);text-align:center">—</td>';
  const col = dir === 'up' ? 'var(--green)' : 'var(--red)';
  return `<td style="color:${col};text-align:center;font-size:14px">${dir === 'up' ? '↑' : '↓'}</td>`;
}

function _structureCell(s) {
  const col = s === 'UPTREND' ? 'var(--green)' : s === 'DOWNTREND' ? 'var(--red)' : 'var(--text-muted)';
  return `<td style="color:${col};font-size:11px;font-weight:600">${s}</td>`;
}

function _coinRowSpinner(coin) {
  return `<tr id="trend-row-${coin}" style="border-bottom:1px solid var(--border)">
    <td style="font-weight:700;color:var(--accent);padding:8px 10px">${coin}</td>
    <td colspan="8" style="color:var(--text-muted);font-size:11px;padding:8px">
      <span style="display:inline-flex;align-items:center;gap:6px">
        <span class="spinner" style="width:12px;height:12px;border-width:2px"></span> scanning…
      </span>
    </td>
  </tr>`;
}

function _coinRowData(r) {
  if (r.error) {
    return `<tr id="trend-row-${r.coin}" style="border-bottom:1px solid var(--border)">
      <td style="font-weight:700;color:var(--accent);padding:8px 10px">${r.coin}</td>
      <td colspan="8" style="color:var(--text-muted);font-size:11px;padding:8px">fetch error</td>
    </tr>`;
  }
  return `<tr id="trend-row-${r.coin}" style="border-bottom:1px solid var(--border)">
    <td style="font-weight:700;color:var(--accent);padding:8px 10px;white-space:nowrap">${r.coin}</td>
    <td style="text-align:center;padding:6px 8px">${_scoreChip(r.score)}</td>
    ${_tfCell(r.tf['1h'])}
    ${_tfCell(r.tf['4h'])}
    ${_tfCell(r.tf['1d'])}
    ${_rsiDivCell(r.rsiDiv)}
    ${_oiCell(r.oiDir)}
    ${_structureCell(r.structure)}
  </tr>`;
}

async function loadTrend() {
  if (_trendRunning) return;
  const el = document.getElementById('trend-content');
  if (!el) return;

  const savedCoins = localStorage.getItem('trend_coins');
  const defaultList = savedCoins ? savedCoins.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : TREND_COINS_DEFAULT;

  el.innerHTML = `
    <div style="padding:14px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <input id="trend-coin-input" type="text" value="${defaultList.join(', ')}"
        style="flex:1;min-width:220px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:5px 10px;color:var(--text);font-family:var(--mono);font-size:12px;outline:none"
        placeholder="BTC, ETH, SOL, ...">
      <button id="trend-scan-btn" onclick="window._trendScanNow()"
        style="background:var(--accent);color:#000;border:none;border-radius:var(--radius-md);padding:6px 16px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">
        Scan
      </button>
      <span id="trend-scan-time" style="font-size:11px;color:var(--text-muted)"></span>
    </div>
    <div id="trend-summary-row" style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted)">
      Ready — press Scan to start
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:680px">
        <thead>
          <tr style="border-bottom:1px solid var(--border-strong)">
            <th style="text-align:left;padding:8px 10px;font-size:11px;color:var(--text-muted);font-weight:600;white-space:nowrap">Coin</th>
            <th style="text-align:center;padding:8px 8px;font-size:11px;color:var(--text-muted);font-weight:600">Score</th>
            <th style="text-align:left;padding:8px 8px;font-size:11px;color:var(--text-muted);font-weight:600">1h</th>
            <th style="text-align:left;padding:8px 8px;font-size:11px;color:var(--text-muted);font-weight:600">4h</th>
            <th style="text-align:left;padding:8px 8px;font-size:11px;color:var(--text-muted);font-weight:600">1d</th>
            <th style="text-align:left;padding:8px 8px;font-size:11px;color:var(--text-muted);font-weight:600">RSI Div</th>
            <th style="text-align:center;padding:8px 8px;font-size:11px;color:var(--text-muted);font-weight:600">OI</th>
            <th style="text-align:left;padding:8px 8px;font-size:11px;color:var(--text-muted);font-weight:600">Structure</th>
          </tr>
        </thead>
        <tbody id="trend-tbody"></tbody>
      </table>
    </div>`;

  window._trendScanNow = async function() {
    if (_trendRunning) return;
    _trendRunning = true;
    const btn = document.getElementById('trend-scan-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
    const inputEl = document.getElementById('trend-coin-input');
    const rawInput = inputEl ? inputEl.value : '';
    const coins = rawInput.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (coins.length === 0) { _trendRunning = false; if (btn) { btn.disabled = false; btn.textContent = 'Scan'; } return; }
    localStorage.setItem('trend_coins', coins.join(','));

    const tbody = document.getElementById('trend-tbody');
    if (!tbody) { _trendRunning = false; return; }
    tbody.innerHTML = coins.map(_coinRowSpinner).join('');

    const results = [];
    for (const coin of coins) {
      const r = await _analyzeCoin(coin);
      results.push(r);
      const row = document.getElementById(`trend-row-${coin}`);
      if (row) row.outerHTML = _coinRowData(r);
    }

    window._trendLastScan = { ts: Date.now(), results };

    const bulls = results.filter(r => r.score > 0).length;
    const bears = results.filter(r => r.score < 0).length;
    const neutral = results.filter(r => r.score === 0).length;
    const bias = bulls > bears + 1 ? 'BULLISH' : bears > bulls + 1 ? 'BEARISH' : 'MIXED';
    const biasCol = bias === 'BULLISH' ? 'var(--green)' : bias === 'BEARISH' ? 'var(--red)' : 'var(--text-muted)';
    const summaryEl = document.getElementById('trend-summary-row');
    if (summaryEl) {
      summaryEl.innerHTML = `Market Bias: <strong style="color:${biasCol}">${bias}</strong> &nbsp;·&nbsp;
        <span style="color:var(--green)">${bulls} bullish</span> &nbsp;
        <span style="color:var(--red)">${bears} bearish</span> &nbsp;
        <span style="color:var(--text-muted)">${neutral} neutral</span>`;
    }

    const timeEl = document.getElementById('trend-scan-time');
    if (timeEl) timeEl.textContent = 'Scanned ' + new Date().toLocaleTimeString();
    if (btn) { btn.disabled = false; btn.textContent = 'Scan'; }
    setRefreshTime();
    _trendRunning = false;
  };
}

window.loadTrend = loadTrend;
