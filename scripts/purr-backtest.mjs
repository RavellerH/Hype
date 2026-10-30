// PURR mNAV → HYPE backtest.
//
// Tests the thesis from docs/purr-mnav.md on daily data:
//   1. Lead/lag — does mNAV (level or change) predict HYPE's *forward* return,
//      or does it just follow HYPE's *past* return?
//   2. Zone buckets — HYPE forward returns conditional on the mNAV zone.
//   3. Rotation — accumulate HYPE below the low edge, trim above the high edge,
//      versus plain buy & hold. Scored in HYPE count and in USD.
//
// Input: CSV with at least `date,hype,mnav` (extra columns ignored). Sources:
//   - the bot worker's own log:  <bot-url>/purr-history  (grows one row a day)
//   - an export from purrmnav.com / Blockworks / your own sheet
// If `mnav` is missing but `purr,hype_holdings,shares[,cash,debt]` exist it is
// rebuilt as purr×shares / (hype×holdings + cash − debt).
//
// Usage:
//   node scripts/purr-backtest.mjs data.csv
//   node scripts/purr-backtest.mjs https://hype-bot.<you>.workers.dev/purr-history
//   node scripts/purr-backtest.mjs --demo            (synthetic data, smoke test)
// Options: --zones 0.95,1.05,1.20  --step 0.10  --fee 0.001  --horizons 1,5,10,20

import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [ZA, ZH, ZT] = opt('zones', '0.95,1.05,1.20').split(',').map(Number);
const STEP = +opt('step', '0.10');      // fraction of cash (buy) / HYPE (sell) per signal day
const FEE  = +opt('fee', '0.001');      // per-trade cost incl. slippage
const HZ   = opt('horizons', '1,5,10,20').split(',').map(Number);

// ── Load ──────────────────────────────────────────────────────────────────────

function parseCsv(txt) {
  const [head, ...lines] = txt.trim().split(/\r?\n/);
  const cols = head.split(',').map(c => c.trim().toLowerCase());
  return lines.filter(Boolean).map(l => {
    const v = l.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, c === 'date' ? v[i]?.trim() : +v[i]]));
  });
}

function demoRows(n = 400) {
  // Random-walk HYPE; mNAV mean-reverts around 1 with noise. With no built-in
  // edge the lead/lag stats should come out near zero — a sanity check.
  let hype = 40, m = 1, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  for (let i = 0; i < n; i++) {
    hype *= Math.exp(rnd() * 0.09);
    m = 1 + (m - 1) * 0.93 + rnd() * 0.08;
    out.push({ date: new Date(Date.UTC(2025, 9, 1) + i * 864e5).toISOString().slice(0, 10), hype, mnav: m });
  }
  return out;
}

async function load(src) {
  if (!src || src === '--demo') return demoRows();
  const txt = /^https?:/.test(src) ? await (await fetch(src)).text() : await readFile(src, 'utf8');
  return parseCsv(txt).map(r => {
    if (!(r.mnav > 0) && r.purr > 0 && r.shares > 0 && r.hype_holdings > 0) {
      r.mnav = (r.purr * r.shares) / (r.hype * r.hype_holdings + (r.cash || 0) - (r.debt || 0));
    }
    return r;
  }).filter(r => r.date && r.hype > 0 && r.mnav > 0).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function corr(x, y) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
// t-stat of a Pearson r; overlapping horizons inflate it, so we divide n by h.
const tStat = (r, n) => r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const f = (x, d = 3) => (x >= 0 ? ' ' : '') + x.toFixed(d);

// ── 1. Lead / lag ─────────────────────────────────────────────────────────────

function leadLag(rows) {
  const lh = rows.map(r => Math.log(r.hype));
  const lm = rows.map(r => Math.log(r.mnav));
  console.log('\n1) LEAD / LAG  (Pearson r, t ≈ adjusted for overlap)');
  console.log('   h    mNAV level→fwd HYPE   ΔmNAV(h)→fwd HYPE(h)   past HYPE(h)→ΔmNAV(h)');
  for (const h of HZ) {
    const lvl = [], fwd = [], dm = [], fwd2 = [], past = [], dm2 = [];
    for (let i = h; i + h < rows.length; i++) {
      lvl.push(lm[i]); fwd.push(lh[i + h] - lh[i]);
      dm.push(lm[i] - lm[i - h]); fwd2.push(lh[i + h] - lh[i]);
      past.push(lh[i] - lh[i - h]); dm2.push(lm[i] - lm[i - h]);
    }
    const n = lvl.length, ne = n / h;
    if (n < 10) continue;
    const a = corr(lvl, fwd), b = corr(dm, fwd2), c = corr(past, dm2);
    console.log(`   ${String(h).padStart(2)}   r=${f(a)} t=${f(tStat(a, ne), 1)}     r=${f(b)} t=${f(tStat(b, ne), 1)}      r=${f(c)} t=${f(tStat(c, ne), 1)}`);
  }
  // mNAV is pro-cyclical (PURR has beta > 1 to HYPE), so a low mNAV mostly means
  // "HYPE just fell". The real question: does mNAV add anything beyond that?
  console.log('\n   h    mNAV level→fwd HYPE, controlling for past HYPE(h) return (partial r)');
  for (const h of HZ) {
    const lvl = [], fwd = [], past = [];
    for (let i = h; i + h < rows.length; i++) { lvl.push(lm[i]); fwd.push(lh[i + h] - lh[i]); past.push(lh[i] - lh[i - h]); }
    if (lvl.length < 10) continue;
    const rxy = corr(lvl, fwd), rxz = corr(lvl, past), ryz = corr(fwd, past);
    const pr = (rxy - rxz * ryz) / Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
    console.log(`   ${String(h).padStart(2)}   partial r=${f(pr)} t=${f(tStat(pr, lvl.length / h), 1)}   (corr mNAV vs past HYPE ${f(rxz)})`);
  }
  console.log('\n   Leading indicator ⇒ level / partial columns negative & significant (|t|>2): low mNAV → higher fwd HYPE.');
  console.log('   Lagging indicator ⇒ only the last column is large: HYPE moves first, mNAV follows.');
}

// ── 2. Zone buckets ───────────────────────────────────────────────────────────

function zoneOf(m) { return m < ZA ? 'ACCUMULATE' : m < ZH ? 'HOLD' : m < ZT ? 'TRIM' : 'REDUCE'; }

function buckets(rows) {
  console.log(`\n2) HYPE FORWARD RETURN BY mNAV ZONE  (zones ${ZA}/${ZH}/${ZT})`);
  console.log('   zone          days   ' + HZ.map(h => `fwd${h}d`.padStart(9)).join(' ') + '   hit%(fwd' + HZ.at(-1) + 'd>0)');
  for (const z of ['ACCUMULATE', 'HOLD', 'TRIM', 'REDUCE']) {
    const idx = rows.map((r, i) => (zoneOf(r.mnav) === z ? i : -1)).filter(i => i >= 0);
    if (!idx.length) { console.log(`   ${z.padEnd(12)}     0`); continue; }
    const cells = HZ.map(h => {
      const v = idx.filter(i => i + h < rows.length).map(i => rows[i + h].hype / rows[i].hype - 1);
      return v.length ? pct(mean(v)).padStart(9) : '—'.padStart(9);
    });
    const H = HZ.at(-1);
    const last = idx.filter(i => i + H < rows.length).map(i => rows[i + H].hype / rows[i].hype - 1);
    const hit = last.length ? (last.filter(x => x > 0).length / last.length * 100).toFixed(0) + '%' : '—';
    console.log(`   ${z.padEnd(12)} ${String(idx.length).padStart(5)}   ${cells.join(' ')}   ${hit.padStart(6)}`);
  }
  const all = HZ.map(h => { const v = rows.slice(0, -h).map((r, i) => rows[i + h].hype / r.hype - 1); return pct(mean(v)).padStart(9); });
  console.log(`   ${'ALL DAYS'.padEnd(12)} ${String(rows.length).padStart(5)}   ${all.join(' ')}`);
}

// ── 3. Rotation vs buy & hold ─────────────────────────────────────────────────
// Both start with the same USD, half deployed into HYPE on day 0 for the
// rotation (it needs dry powder to accumulate), 100% for buy & hold.

function rotation(rows) {
  const p0 = rows[0].hype, start = 10000;
  let cash = start / 2, hype = (start / 2) / p0 * (1 - FEE), trades = 0;
  for (const r of rows) {
    const z = zoneOf(r.mnav);
    if (z === 'ACCUMULATE' && cash > 1) {
      const usd = cash * STEP * (r.mnav < ZA - 0.10 ? 2 : 1);   // double size on deep discount
      const spend = Math.min(cash, usd);
      hype += spend / r.hype * (1 - FEE); cash -= spend; trades++;
    } else if ((z === 'TRIM' || z === 'REDUCE') && hype > 0) {
      const q = hype * STEP * (z === 'REDUCE' ? 2 : 1);
      cash += q * r.hype * (1 - FEE); hype -= q; trades++;
    }
  }
  const pN = rows.at(-1).hype;
  const bhHype = start / p0 * (1 - FEE);
  const rotUsd = cash + hype * pN, bhUsd = bhHype * pN;
  const rotHypeEq = rotUsd / pN;
  console.log(`\n3) ROTATION vs BUY & HOLD  (${rows[0].date} → ${rows.at(-1).date}, step ${STEP * 100}% fee ${FEE * 100}%)`);
  console.log(`   HYPE  $${p0.toFixed(2)} → $${pN.toFixed(2)} (${pct(pN / p0 - 1)})`);
  console.log(`   buy & hold   $${bhUsd.toFixed(0).padStart(8)}   ${bhHype.toFixed(2)} HYPE`);
  console.log(`   rotation     $${rotUsd.toFixed(0).padStart(8)}   ${hype.toFixed(2)} HYPE + $${cash.toFixed(0)} cash = ${rotHypeEq.toFixed(2)} HYPE-eq   (${trades} trades)`);
  console.log(`   edge         ${pct(rotUsd / bhUsd - 1)} USD   ·   ${pct(rotHypeEq / bhHype - 1)} in HYPE terms`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const src = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) || (args.includes('--demo') ? '--demo' : null);
if (!src) { console.error('usage: node scripts/purr-backtest.mjs <csv|url|--demo>'); process.exit(1); }
const rows = await load(src);
if (rows.length < 30) { console.error(`only ${rows.length} usable rows — need ≥30 daily rows (date,hype,mnav)`); process.exit(1); }

const ms = rows.map(r => r.mnav);
console.log(`PURR mNAV backtest · ${rows.length} days · ${rows[0].date} → ${rows.at(-1).date}${src === '--demo' ? '  [SYNTHETIC DEMO]' : ''}`);
console.log(`mNAV min ${Math.min(...ms).toFixed(3)} · mean ${mean(ms).toFixed(3)} · max ${Math.max(...ms).toFixed(3)} · days <1.00x: ${ms.filter(m => m < 1).length}`);
leadLag(rows);
buckets(rows);
rotation(rows);
console.log('\nCorrelation ≠ causation; one cycle of data is a small sample. See docs/purr-mnav.md.');
