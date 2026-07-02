/**
 * signals.js — Senpi AI-inspired signal scanner
 *
 * Runs entirely in the browser against the public Hyperliquid API.
 * Reuses detectPhase(), iEMA(), iMACD(), iRSI() from app.js.
 *
 * For each coin shows:
 *   Confluence score 0-10 · Phase · Funding rate · Smart wallet count · Verdict
 * Expandable detail: every gate, phase evidence, skip reasons.
 */

const SIG_HL_URL    = 'https://api.hyperliquid.xyz/info';
const SIG_WATCH_COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'SUI', 'AVAX'];
const SIG_SMART_WALLETS = {
  'Abraxas Capital': '0x5b5d51203a0f9079f8aeb098a6523a13f298c060',
  'James Wynn':      '0x5078C2fBeA2b2aD61bc840Bc023E35Fce56BeDb6',
  'qwatio':          '0xf3F496C9486BE5924a93D67e98298733Bb47057c',
  'HLP Whale':       '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae',
};

// Config mirrors bot/config.py
const SIG_CONFIG = {
  MIN_PHASE_CONFIDENCE:  0.40,
  MIN_VOLUME_RATIO:      1.20,
  MIN_CONFLUENCE_SCORE:  5,
  MAX_LONG_FUNDING_RATE: 0.0020,  // 0.20% / 8h
  BTC_MACRO_GATE_PCT:    0.03,    // 3% hostile move blocks longs
};

// DSL tier reference (displayed in detail)
const SIG_DSL_TIERS = [
  { gain: 0.10, lock: 0.35, label: '+10% → SL locks 3.5%' },
  { gain: 0.20, lock: 0.55, label: '+20% → SL locks 11%' },
  { gain: 0.35, lock: 0.70, label: '+35% → SL locks 24.5%' },
];

let _sigRunning = false;
let _sigLastResults = null;
window._sigLastResults = null; // shared with analytics.js

// ── API helpers ───────────────────────────────────────────────────────────────

async function _sigPost(payload) {
  const r = await fetch(SIG_HL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`HL API ${r.status}`);
  return r.json();
}

async function _sigCandles(coin, interval, days) {
  const now = Date.now();
  try {
    return await _sigPost({
      type: 'candleSnapshot',
      req: { coin, interval, startTime: now - days * 86400_000, endTime: now },
    });
  } catch (e) {
    console.warn(`[signals] candles ${coin}/${interval}:`, e.message);
    return [];
  }
}

async function _sigMarketContexts() {
  try {
    const data = await _sigPost({ type: 'metaAndAssetCtxs' });
    const universe = data[0]?.universe || [];
    const ctxs     = data[1] || [];
    const out = {};
    universe.forEach((u, i) => {
      if (i < ctxs.length) {
        out[u.name] = {
          fundingRate:  parseFloat(ctxs[i].funding      || 0),
          openInterest: parseFloat(ctxs[i].openInterest || 0),
          markPx:       parseFloat(ctxs[i].markPx       || 0),
        };
      }
    });
    return out;
  } catch (e) {
    console.warn('[signals] marketCtxs:', e.message);
    return {};
  }
}

async function _sigWalletPositions() {
  const result = {};
  await Promise.all(
    Object.entries(SIG_SMART_WALLETS).map(async ([label, addr]) => {
      try {
        const state = await _sigPost({ type: 'clearinghouseState', user: addr });
        const positions = {};
        for (const p of (state.assetPositions || [])) {
          const pos = p.position;
          const sz  = parseFloat(pos.szi);
          if (sz === 0) continue;
          positions[pos.coin] = { side: sz > 0 ? 'long' : 'short', sz: Math.abs(sz), entry: parseFloat(pos.entryPx || 0) };
        }
        result[label] = positions;
      } catch (e) {
        console.warn(`[signals] wallet ${label}:`, e.message);
        result[label] = {};
      }
    })
  );
  return result;
}

// ── TA helpers ────────────────────────────────────────────────────────────────
// Uses iEMA / iMACD / iRSI defined in app.js

function _sigTA(candles, label) {
  const empty = { ok: false, emaBull: false, macdBull: false, rsiAbove: false, rsiVal: 50, volRatio: 1, reason: 'no data' };
  if (!candles || candles.length < 30) return empty;

  const closes  = candles.map(c => parseFloat(c.c));
  const volumes = candles.map(c => parseFloat(c.v));

  const ema20   = iEMA(closes, 20);
  const ema50   = closes.length >= 50 ? iEMA(closes, 50) : null;
  const emaBull = ema20.length > 0 && ema50?.length > 0 && ema20.at(-1) > ema50.at(-1);

  const { hist }  = iMACD(closes);
  const macdBull  = hist.length > 0 && hist.at(-1) > 0;

  const rsiArr   = iRSI(closes).filter(v => v !== null);
  const rsiVal   = +(rsiArr.at(-1) ?? 50).toFixed(1);
  const rsiAbove = rsiVal > 50;

  const q       = Math.max(4, Math.floor(volumes.length / 4));
  const avgV    = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const volRatio = +(avgV(volumes.slice(-q)) / Math.max(avgV(volumes.slice(0, q)), 1)).toFixed(2);

  const ok = label === '1h' ? (emaBull && macdBull && rsiAbove) : (macdBull && rsiAbove);
  return { ok, emaBull, macdBull, rsiAbove, rsiVal, volRatio, reason: '' };
}

// ── Confluence score (mirrors bot/main.py:compute_confluence_score) ───────────

function _sigScore(phaseConf, ta1h, ta15m, walletCount) {
  let s = 0;
  if (phaseConf >= 0.70) s += 3; else if (phaseConf >= 0.55) s += 2; else s += 1;
  if (ta1h.emaBull)  s += 1;
  if (ta1h.macdBull) s += 1;
  if (ta1h.rsiAbove) s += 1;
  if (ta15m.macdBull && ta15m.rsiAbove) s += 1;
  if (ta1h.volRatio >= 1.5) s += 1;
  if (walletCount >= 1) s += 1;
  if (walletCount >= 3) s += 1;
  return s; // max 10
}

function _sigSkipReasons(r) {
  const reasons = [];
  if (!r.btcGateOk)               reasons.push('BTC macro hostile');
  if (r.fundingBlock)              reasons.push('Funding crowded');
  if (r.phase !== 'ACCUMULATION')  reasons.push(`Phase: ${r.phase}`);
  else if (r.phaseConf < SIG_CONFIG.MIN_PHASE_CONFIDENCE)
                                   reasons.push(`Conf ${(r.phaseConf*100).toFixed(0)}%<40%`);
  if (!r.ta1h.emaBull)             reasons.push('1h EMA bear');
  if (!r.ta1h.macdBull)            reasons.push('1h MACD bear');
  if (!r.ta1h.rsiAbove)            reasons.push(`1h RSI ${r.ta1h.rsiVal}<50`);
  if (!r.ta15m.macdBull)           reasons.push('15m MACD bear');
  if (!r.ta15m.rsiAbove)           reasons.push(`15m RSI ${r.ta15m.rsiVal}<50`);
  if (r.ta1h.volRatio < SIG_CONFIG.MIN_VOLUME_RATIO)
                                   reasons.push(`Vol ${r.ta1h.volRatio}x<1.2`);
  if (r.walletLongs.length === 0)  reasons.push('No wallet signal');
  if (r.score > 0 && r.score < SIG_CONFIG.MIN_CONFLUENCE_SCORE)
                                   reasons.push(`Score ${r.score}/10<5`);
  return reasons;
}

// ── Long/Short ratio (Binance, free, no key) ──────────────────────────────────

async function _sigLongShortRatios(coins) {
  const result = {};
  const supported = coins.filter(c => ['BTC','ETH','SOL','BNB','XRP','DOGE','AVAX','MATIC'].includes(c));
  await Promise.allSettled(supported.map(async coin => {
    try {
      const r = await fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${coin}USDT&period=1h&limit=1`);
      if (!r.ok) return;
      const d = await r.json();
      if (d?.[0]) result[coin] = {
        longPct:  parseFloat(d[0].longAccount) * 100,
        shortPct: parseFloat(d[0].shortAccount) * 100,
        ratio:    parseFloat(d[0].longShortRatio),
      };
    } catch {}
  }));
  return result;
}

// ── Main scan ─────────────────────────────────────────────────────────────────

async function runSignalScan(coins) {
  // Parallel: market contexts + wallet positions + BTC 4h + L/S ratios
  const [marketCtxs, walletPositions, btcCandles, lsRatios] = await Promise.all([
    _sigMarketContexts(),
    _sigWalletPositions(),
    _sigCandles('BTC', '4h', 2),
    _sigLongShortRatios(coins),
  ]);

  // BTC macro gate
  let btcMove = 0, btcGateOk = true;
  if (btcCandles.length >= 2) {
    const cl = btcCandles.map(c => parseFloat(c.c));
    btcMove   = (cl.at(-1) / cl.at(-2)) - 1;
    btcGateOk = btcMove >= -SIG_CONFIG.BTC_MACRO_GATE_PCT;
  }

  const results = await Promise.all(coins.map(async coin => {
    try {
      const ctx         = marketCtxs[coin] || {};
      const fundingRate = ctx.fundingRate || 0;
      const fundingBlock = fundingRate > SIG_CONFIG.MAX_LONG_FUNDING_RATE;

      const [c4h, c1h, c15m] = await Promise.all([
        _sigCandles(coin, '4h', 60),
        _sigCandles(coin, '1h', 14),
        _sigCandles(coin, '15m', 3),
      ]);

      const phaseData = detectPhase(c4h);  // from app.js
      const ta1h      = _sigTA(c1h,  '1h');
      const ta15m     = _sigTA(c15m, '15m');

      const walletLongs = Object.entries(walletPositions)
        .filter(([, pos]) => pos[coin]?.side === 'long')
        .map(([label]) => label);

      const isAccum = phaseData.phase === 'ACCUMULATION';
      const score   = isAccum
        ? _sigScore(phaseData.confidence, ta1h, ta15m, walletLongs.length)
        : 0;

      const verdict = (
        btcGateOk &&
        !fundingBlock &&
        isAccum &&
        phaseData.confidence >= SIG_CONFIG.MIN_PHASE_CONFIDENCE &&
        ta1h.ok &&
        ta15m.ok &&
        ta1h.volRatio >= SIG_CONFIG.MIN_VOLUME_RATIO &&
        walletLongs.length >= 1 &&
        score >= SIG_CONFIG.MIN_CONFLUENCE_SCORE
      ) ? 'ENTRY' : 'SKIP';

      const ls = lsRatios[coin] || null;

      const r = {
        coin, verdict, score,
        phase:        phaseData.phase,
        phaseConf:    phaseData.confidence,
        phaseSignals: phaseData.signals || [],
        fundingRate, fundingBlock,
        oi:      ctx.openInterest || 0,
        markPx:  ctx.markPx || 0,
        walletLongs, walletPositions,
        ta1h, ta15m, btcGateOk, ls,
      };
      r.skipReasons = verdict === 'SKIP' ? _sigSkipReasons(r) : [];
      return r;
    } catch (e) {
      return { coin, verdict: 'ERROR', error: e.message, score: 0, phase: '—', phaseConf: 0, fundingRate: 0, fundingBlock: false, walletLongs: [], ta1h: {}, ta15m: {}, btcGateOk, skipReasons: [e.message] };
    }
  }));

  return { results, btcMove, btcGateOk };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const _SIG_PHASE_COLOR = { ACCUMULATION: '#50d2c1', MARKUP: '#4ade80', DISTRIBUTION: '#facc15', MARKDOWN: '#f87171', NEUTRAL: '#888' };

function _ck(ok) {
  return ok
    ? '<span style="color:var(--pos);font-weight:700">✓</span>'
    : '<span style="color:var(--neg);font-weight:700">✗</span>';
}

function _sigScoreColor(s) {
  return s >= 7 ? 'var(--pos)' : s >= 5 ? '#fbbf24' : 'var(--text-muted)';
}

function _sigScoreBar(score) {
  const filled = '█'.repeat(score);
  const empty  = '░'.repeat(10 - score);
  return `<span style="color:${_sigScoreColor(score)};font-family:monospace;font-size:10px;letter-spacing:1px">${filled}${empty}</span>`;
}

function renderSignalRow(r) {
  const verdictHtml = r.verdict === 'ENTRY'
    ? '<span style="color:var(--pos);font-weight:800;font-size:12px">▲ ENTRY</span>'
    : r.verdict === 'ERROR'
    ? '<span style="color:var(--neg);font-size:11px">ERR</span>'
    : '<span style="color:var(--text-muted);font-size:12px">— skip</span>';

  const phaseColor = _SIG_PHASE_COLOR[r.phase] || '#888';
  const fundColor  = r.fundingBlock ? 'var(--neg)' : 'var(--text-muted)';
  const walletHtml = r.walletLongs?.length
    ? `<span style="color:var(--pos);font-weight:700">${r.walletLongs.length}</span>`
    : '<span style="color:var(--text-faint)">0</span>';

  const lsHtml = r.ls
    ? (() => {
        const crowded = r.ls.ratio > 1.8;
        const cl = crowded ? 'neg' : r.ls.ratio < 0.8 ? 'pos' : 'muted';
        return `<span class="${cl}" title="Long ${r.ls.longPct.toFixed(1)}% / Short ${r.ls.shortPct.toFixed(1)}%">${r.ls.ratio.toFixed(2)}</span>`;
      })()
    : '<span style="color:var(--text-faint)">—</span>';

  return `
    <tr class="sig-row"
        onclick="sigToggleDetail('${r.coin}')"
        style="border-bottom:1px solid var(--border-faint,rgba(255,255,255,.06));cursor:pointer"
        onmouseover="this.style.background='var(--bg-hover,rgba(255,255,255,.04))'"
        onmouseout="this.style.background=''">
      <td style="padding:10px 6px;font-weight:700">${r.coin}</td>
      <td style="padding:10px 4px;text-align:center">
        <span style="font-weight:800;color:${_sigScoreColor(r.score)}">${r.score}</span><span style="color:var(--text-faint);font-size:10px">/10</span>
      </td>
      <td style="padding:10px 4px;text-align:center">
        <span style="color:${phaseColor};font-size:11px;font-weight:700">${r.phase}</span>
        <span style="color:var(--text-faint);font-size:10px"> ${(r.phaseConf*100).toFixed(0)}%</span>
      </td>
      <td style="padding:10px 4px;text-align:center;color:${fundColor};font-size:12px">
        ${r.fundingBlock ? '⚠ ' : ''}${(r.fundingRate*100).toFixed(3)}%
      </td>
      <td style="padding:10px 4px;text-align:center">${lsHtml}</td>
      <td style="padding:10px 4px;text-align:center">${walletHtml}</td>
      <td style="padding:10px 6px;text-align:right">${verdictHtml}</td>
    </tr>
    <tr id="sig-detail-${r.coin}" style="display:none">
      <td colspan="6" style="padding:0">
        ${renderSignalDetail(r)}
      </td>
    </tr>`;
}

function renderSignalDetail(r) {
  const isAccum = r.phase === 'ACCUMULATION';

  const walletRows = Object.entries(SIG_SMART_WALLETS).map(([label]) => {
    const pos = r.walletPositions?.[label]?.[r.coin];
    if (!pos) return `<span style="color:var(--text-faint)">${label}: —</span>`;
    const sideColor = pos.side === 'long' ? 'var(--pos)' : 'var(--neg)';
    return `<span style="color:${sideColor};font-weight:600">${label}: ${pos.side.toUpperCase()} ${pos.sz.toFixed(4)} @ ${pos.entry.toFixed(4)}</span>`;
  }).join('<br>');

  const dslHtml = SIG_DSL_TIERS.map(t =>
    `<span style="font-size:10px;color:var(--text-muted)">${t.label}</span>`
  ).join(' &nbsp;·&nbsp; ');

  return `
    <div style="background:var(--bg-deep,#111);padding:14px 16px 16px;margin-bottom:2px;
                border-left:3px solid ${r.verdict==='ENTRY'?'var(--pos)':'var(--border,rgba(255,255,255,.1))'}">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;font-size:12px">

        <div>
          <div class="sig-label">Phase (4h Wyckoff)</div>
          ${_ck(isAccum)} <span style="color:${_SIG_PHASE_COLOR[r.phase]||'#888'};font-weight:700">${r.phase}</span>
          &nbsp;<span style="color:var(--text-muted)">${(r.phaseConf*100).toFixed(0)}% confidence</span>
        </div>

        <div>
          <div class="sig-label">1h TA</div>
          ${_ck(r.ta1h.emaBull)} EMA20>50
          &nbsp;${_ck(r.ta1h.macdBull)} MACD
          &nbsp;${_ck(r.ta1h.rsiAbove)} RSI <span style="color:var(--text-muted)">${r.ta1h.rsiVal}</span>
        </div>

        <div>
          <div class="sig-label">15m Momentum</div>
          ${_ck(r.ta15m.macdBull)} MACD
          &nbsp;${_ck(r.ta15m.rsiAbove)} RSI <span style="color:var(--text-muted)">${r.ta15m.rsiVal}</span>
        </div>

        <div>
          <div class="sig-label">Volume</div>
          ${_ck(r.ta1h.volRatio >= SIG_CONFIG.MIN_VOLUME_RATIO)}
          <span style="color:var(--text-muted)">${r.ta1h.volRatio}× avg</span>
          ${r.ta1h.volRatio >= 1.5 ? ' <span style="color:var(--pos);font-size:10px">strong</span>' : ''}
        </div>

        <div>
          <div class="sig-label">Funding /8h</div>
          ${_ck(!r.fundingBlock)}
          <span style="color:${r.fundingBlock?'var(--neg)':'var(--text-muted)'}">${(r.fundingRate*100).toFixed(4)}%</span>
          ${r.fundingBlock ? ' <span style="color:var(--neg);font-size:10px">longs crowded</span>' : ''}
          <span style="color:var(--text-faint);font-size:10px"> (max 0.20%)</span>
        </div>

        <div>
          <div class="sig-label">BTC Macro Gate</div>
          ${_ck(r.btcGateOk)} ${r.btcGateOk ? 'OK' : 'Hostile to longs'}
        </div>

        <div>
          <div class="sig-label">Confluence Score</div>
          ${_sigScoreBar(r.score)}
          <span style="font-weight:800;color:${_sigScoreColor(r.score)};margin-left:6px">${r.score}/10</span>
          <span style="color:var(--text-faint);font-size:10px"> (min 5)</span>
        </div>

        <div>
          <div class="sig-label">OI / Mark Price</div>
          <span style="color:var(--text-muted)">
            $${r.oi > 1e6 ? (r.oi/1e6).toFixed(1)+'M' : r.oi > 1e3 ? (r.oi/1e3).toFixed(0)+'K' : r.oi.toFixed(0)}
            &nbsp;·&nbsp; $${r.markPx > 1000 ? r.markPx.toLocaleString(undefined,{maximumFractionDigits:0}) : r.markPx.toFixed(4)}
          </span>
        </div>
      </div>

      <!-- Smart wallets -->
      <div style="margin-top:12px">
        <div class="sig-label">Smart Wallets</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;font-size:12px;line-height:1.8">
          ${walletRows}
        </div>
      </div>

      <!-- Phase signals -->
      ${r.phaseSignals?.length ? `
        <div style="margin-top:12px">
          <div class="sig-label">Phase Evidence</div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.8;margin-top:4px">
            ${r.phaseSignals.slice(0, 6).map(s => `· ${s}`).join('<br>')}
          </div>
        </div>` : ''}

      <!-- Skip reasons -->
      ${r.skipReasons?.length ? `
        <div style="margin-top:12px">
          <div class="sig-label" style="color:var(--neg)">Skip Reasons</div>
          <div style="font-size:11px;color:var(--neg);margin-top:4px;line-height:1.8">
            ${r.skipReasons.map(s => `· ${s}`).join('<br>')}
          </div>
        </div>` : ''}

      <!-- DSL tiers reference -->
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-faint,rgba(255,255,255,.06))">
        <div class="sig-label">DSL Exit Tiers (if entered)</div>
        <div style="margin-top:4px">${dslHtml}</div>
      </div>
    </div>`;
}

function renderSignalsTable(results, btcMove, btcGateOk) {
  const gateEl = document.getElementById('sig-btc-gate');
  if (gateEl) {
    const ok = btcGateOk;
    gateEl.style.cssText = `display:block;margin-bottom:12px;padding:8px 14px;border-radius:7px;font-size:12px;font-weight:700;
      background:${ok?'rgba(74,222,128,.08)':'rgba(248,113,113,.10)'};
      color:${ok?'var(--pos)':'var(--neg)'};
      border:1px solid ${ok?'rgba(74,222,128,.25)':'rgba(248,113,113,.25)'}`;
    gateEl.innerHTML =
      `BTC Macro Gate: ${ok ? '✓ OK' : '✗ BLOCKED (hostile to longs)'}` +
      `&nbsp;·&nbsp; BTC 4h: <span style="font-weight:800">${btcMove >= 0 ? '+' : ''}${(btcMove*100).toFixed(2)}%</span>`;
  }

  const sorted = [...results].sort((a, b) => {
    if (a.verdict === 'ENTRY' && b.verdict !== 'ENTRY') return -1;
    if (b.verdict === 'ENTRY' && a.verdict !== 'ENTRY') return 1;
    return b.score - a.score;
  });

  const el = document.getElementById('sig-results');
  if (!el) return;
  el.innerHTML = `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:480px">
        <thead>
          <tr style="border-bottom:1px solid var(--border,rgba(255,255,255,.1));color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.06em">
            <th style="text-align:left;padding:8px 6px;font-weight:600">Coin</th>
            <th style="text-align:center;padding:8px 4px;font-weight:600">Score</th>
            <th style="text-align:center;padding:8px 4px;font-weight:600">Phase</th>
            <th style="text-align:center;padding:8px 4px;font-weight:600">Funding/8h</th>
            <th style="text-align:center;padding:8px 4px;font-weight:600" title="Binance L/S account ratio — >1.8 crowded longs">L/S</th>
            <th style="text-align:center;padding:8px 4px;font-weight:600">Wallets</th>
            <th style="text-align:right;padding:8px 6px;font-weight:600">Verdict</th>
          </tr>
        </thead>
        <tbody>${sorted.map(renderSignalRow).join('')}</tbody>
      </table>
    </div>
    <div style="margin-top:14px;font-size:11px;color:var(--text-faint);text-align:right">
      Click any row to expand full gate breakdown &nbsp;·&nbsp; Data: Hyperliquid public API
    </div>`;
}

function sigToggleDetail(coin) {
  const el = document.getElementById(`sig-detail-${coin}`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
}

// ── Page entry points ─────────────────────────────────────────────────────────

function loadSignals() {
  const el = document.getElementById('page-signals');
  if (!el) return;
  el.innerHTML = `
    <div style="max-width:920px;margin:0 auto;padding:20px 16px">
      <div style="margin-bottom:18px">
        <div style="font-size:17px;font-weight:800;margin-bottom:4px">Signal Scanner</div>
        <div style="font-size:12px;color:var(--text-muted)">
          Senpi AI-inspired confluence analysis &nbsp;·&nbsp; Phase + TA + Funding + Smart Wallets &nbsp;·&nbsp; Read-only, no trades executed
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <button id="sig-scan-btn" onclick="doSigScanAll()" style="
          padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;border:none;border-radius:7px;
          background:var(--accent,#50d2c1);color:#000;transition:opacity .15s">
          ▶ Scan 6 Coins
        </button>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="sig-custom-coin" placeholder="Any coin (e.g. LINK)"
            style="padding:7px 10px;background:var(--bg-card,#1a1a1a);border:1px solid var(--border,rgba(255,255,255,.12));
                   border-radius:6px;color:var(--text,#fff);font-size:13px;width:145px;outline:none"
            onkeydown="if(event.key==='Enter')doSigScanCustom()">
          <button onclick="doSigScanCustom()" style="
            padding:7px 12px;font-size:13px;cursor:pointer;border:1px solid var(--border,rgba(255,255,255,.15));
            border-radius:6px;background:var(--bg-card,#1a1a1a);color:var(--text,#fff)">
            Scan
          </button>
        </div>
        <span id="sig-last-scan" style="font-size:11px;color:var(--text-faint)"></span>
      </div>

      <div id="sig-btc-gate" style="display:none"></div>

      <div id="sig-results">
        <div style="color:var(--text-muted);font-size:13px;padding:20px 0">
          Press <strong>Scan 6 Coins</strong> to run the full confluence analysis.
          <br><span style="font-size:11px;color:var(--text-faint)">Fetches ~4h / 1h / 15m candles, funding rates, and smart wallet positions in parallel.</span>
        </div>
      </div>

      <style>
        .sig-label { color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;font-weight:600 }
      </style>
    </div>`;
}

async function doSigScanAll() {
  await _doSigScan(SIG_WATCH_COINS);
}

async function doSigScanCustom() {
  const input = document.getElementById('sig-custom-coin');
  const coin  = input?.value?.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
  if (!coin) return;
  await _doSigScan([coin]);
}

async function _doSigScan(coins) {
  if (_sigRunning) return;
  _sigRunning = true;

  const btn = document.getElementById('sig-scan-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = '⏳ Scanning…'; }

  const el = document.getElementById('sig-results');
  if (el) el.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:16px 0">
    Scanning ${coins.join(', ')}…
    <br><span style="font-size:11px;color:var(--text-faint)">Fetching candles, funding, and wallet positions…</span>
  </div>`;

  try {
    const { results, btcMove, btcGateOk } = await runSignalScan(coins);
    _sigLastResults = results;
    window._sigLastResults = results;
    renderSignalsTable(results, btcMove, btcGateOk);

    const ts = document.getElementById('sig-last-scan');
    if (ts) {
      const entryCount = results.filter(r => r.verdict === 'ENTRY').length;
      ts.textContent = `Scanned at ${new Date().toLocaleTimeString()} · ${entryCount} entry signal${entryCount !== 1 ? 's' : ''} found`;
    }
  } catch (e) {
    if (el) el.innerHTML = `<div style="color:var(--neg);font-size:13px;padding:12px">Scan failed: ${e.message}</div>`;
  } finally {
    _sigRunning = false;
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '▶ Scan 6 Coins'; }
  }
}
