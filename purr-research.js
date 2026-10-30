// ── PURR Research — Hyperliquid Strategies (NASDAQ: PURR) mNAV vs. HYPE ───────
// Live card (bot worker /purr, shared with HL Pulse), a client-side mNAV
// calculator that works without the bot, and docs/purr-mnav.md rendered inline.

const PRR_DOC_URLS = [
  'docs/purr-mnav.md',
  'https://raw.githubusercontent.com/RavellerH/Hype/gh-pages/docs/purr-mnav.md',
];
const PRR_CALC_KEY = 'hype_purr_calc';
// Same defaults as PURR_* vars in cloudflare/wrangler-bot.toml — see the doc §1.
const PRR_DEFAULTS = { purr: 12.29, hype: 93.20, holdings: 38830000, shares: 329400000, cash: 133000000, debt: 0 };
const PRR_ZONES = [
  { max: 0.95,     id: 'ACCUMULATE', cls: 'pos', note: 'Below NAV — accumulate HYPE in tranches (2× size under 0.85x)' },
  { max: 1.05,     id: 'HOLD',       cls: '',    note: 'Near NAV — hold, no action in this band' },
  { max: 1.20,     id: 'TRIM',       cls: 'neg', note: 'Premium — trim part of the trading stack if HYPE trend weakens' },
  { max: Infinity, id: 'REDUCE',     cls: 'neg', note: 'High premium — reduce exposure, keep the staked core' },
];

let _prrDocHtml = null;

const _prrEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Minimal markdown → HTML (headings, lists, tables, code, quotes, links) ────

function _prrInline(t) {
  return _prrEsc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>');
}

function _prrMarkdown(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p style="line-height:1.6;margin:8px 0">${_prrInline(para.join(' '))}</p>`); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flush();
      const buf = [];
      while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]);
      out.push(`<pre style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;overflow-x:auto;font-size:11px;line-height:1.45">${_prrEsc(buf.join('\n'))}</pre>`);
    } else if (/^#{1,4} /.test(l)) {
      flush();
      const n = l.match(/^#+/)[0].length;
      const size = [0, 20, 16, 14, 13][n];
      out.push(`<div style="font-size:${size}px;font-weight:700;margin:${n <= 2 ? 22 : 14}px 0 6px;color:var(--text)">${_prrInline(l.replace(/^#+ /, ''))}</div>`);
    } else if (/^---+\s*$/.test(l)) {
      flush(); out.push('<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">');
    } else if (/^\|/.test(l)) {
      flush();
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(lines[i]);
      i--;
      const cells = r => r.replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim());
      const [head, , ...body] = rows;
      out.push(`<div class="table-wrap"><table class="mobile-cards" style="margin:8px 0"><thead><tr>${cells(head).map(c => `<th>${_prrInline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${cells(r).map(c => `<td>${_prrInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^> /.test(l)) {
      flush();
      const buf = [];
      for (; i < lines.length && /^> ?/.test(lines[i]); i++) buf.push(lines[i].replace(/^> ?/, ''));
      i--;
      out.push(`<div style="border-left:3px solid var(--accent);padding:6px 12px;margin:10px 0;color:var(--text);font-size:14px">${_prrInline(buf.join(' '))}</div>`);
    } else if (/^\s*(- |\d+\. )/.test(l)) {
      flush();
      const ordered = /^\s*\d+\. /.test(l);
      const items = [];
      for (; i < lines.length && (/^\s*(- |\d+\. )/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length)); i++) {
        if (/^\s*(- |\d+\. )/.test(lines[i])) items.push(lines[i].replace(/^\s*(- |\d+\. )/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
      }
      i--;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag} style="padding-left:20px;margin:6px 0;line-height:1.6">${items.map(x => `<li style="margin-bottom:3px">${_prrInline(x)}</li>`).join('')}</${tag}>`);
    } else if (!l.trim()) {
      flush();
    } else {
      para.push(l.trim());
    }
  }
  flush();
  return out.join('\n');
}

async function _prrLoadDoc() {
  for (const u of PRR_DOC_URLS) {
    try {
      const r = await fetch(`${u}?t=${Math.floor(Date.now() / 600000)}`);
      if (r.ok) return _prrMarkdown(await r.text());
    } catch (_) {}
  }
  return '<div style="color:var(--text-muted)">Could not load docs/purr-mnav.md — <a href="https://github.com/RavellerH/Hype/blob/gh-pages/docs/purr-mnav.md" target="_blank" rel="noopener" style="color:var(--accent)">read it on GitHub ↗</a></div>';
}

// ── Calculator ────────────────────────────────────────────────────────────────

function _prrCalcState() {
  try { return { ...PRR_DEFAULTS, ...JSON.parse(localStorage.getItem(PRR_CALC_KEY) || '{}') }; } catch (_) { return { ...PRR_DEFAULTS }; }
}

function prrCalc() {
  const v = {};
  for (const k of Object.keys(PRR_DEFAULTS)) v[k] = parseFloat(document.getElementById(`prr-${k}`)?.value) || 0;
  try { localStorage.setItem(PRR_CALC_KEY, JSON.stringify(v)); } catch (_) {}
  const out = document.getElementById('prr-calc-out');
  if (!out) return;
  if (!v.purr || !v.hype || !v.holdings || !v.shares) { out.innerHTML = '<span style="color:var(--text-muted)">Fill in all fields.</span>'; return; }
  const nav = v.holdings * v.hype + v.cash - v.debt;
  const navPs = nav / v.shares;
  const mnav = v.purr / navPs;
  const z = PRR_ZONES.find(z => mnav < z.max);
  const be = (v.purr * v.shares - v.cash + v.debt) / v.holdings;
  const prem = (mnav - 1) * 100;
  const cell = (k, val, sub = '') => `<div class="stat-card"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted)">${k}</div><div style="font-size:18px;font-weight:700;margin-top:4px">${val}</div>${sub ? `<div style="font-size:11px;margin-top:2px">${sub}</div>` : ''}</div>`;
  out.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">
      ${cell('mNAV', `${mnav.toFixed(3)}x`, `<span class="${z.cls}">${z.id}</span>`)}
      ${cell('Premium', `<span class="${prem >= 0 ? 'neg' : 'pos'}">${prem >= 0 ? '+' : ''}${prem.toFixed(2)}%</span>`)}
      ${cell('NAV / share', `$${navPs.toFixed(2)}`)}
      ${cell('HYPE / share', (v.holdings / v.shares).toFixed(4))}
      ${cell('1.00x at HYPE', `$${be.toFixed(2)}`, `now $${v.hype.toFixed(2)}`)}
    </div>
    <div style="font-size:12px;margin-top:8px;color:var(--text-muted)">${z.note}</div>`;
}

function prrCalcReset() {
  try { localStorage.removeItem(PRR_CALC_KEY); } catch (_) {}
  _prrRender();
  _prrFillHype();
}

async function _prrFillHype() {
  try {
    const mids = await hlPost({ type: 'allMids' });
    const px = +mids?.HYPE;
    const el = document.getElementById('prr-hype');
    if (px && el) { el.value = px.toFixed(2); prrCalc(); }
  } catch (_) {}
}

// ── Render ────────────────────────────────────────────────────────────────────

function _prrRender() {
  const el = document.getElementById('purr-content');
  if (!el) return;
  const s = _prrCalcState();
  const inp = (k, label, step) => `<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--text-muted);flex:1;min-width:130px">${label}
      <input class="input" id="prr-${k}" type="number" step="${step}" value="${s[k]}" oninput="prrCalc()" style="font-family:var(--mono);font-size:12px"></label>`;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:4px">
      <span class="section-title">🐱 PURR Research — mNAV as a HYPE rotation signal</span>
      <a href="https://github.com/RavellerH/Hype/blob/gh-pages/docs/purr-mnav.md" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent)">source ↗</a>
    </div>
    <div id="prr-live"></div>
    <div class="card">
      <div class="card-title">mNAV calculator — works without the bot</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${inp('purr', 'PURR price ($)', '0.01')}
        ${inp('hype', 'HYPE price ($) — live', '0.01')}
        ${inp('holdings', 'HYPE held', '1000')}
        ${inp('shares', 'Shares outstanding', '1000')}
        ${inp('cash', 'Cash ($)', '1000000')}
        ${inp('debt', 'Debt ($)', '1000000')}
      </div>
      <div style="font-size:10px;color:var(--text-faint);margin:6px 0 10px">PURR price: enter the latest quote (US market hours). Treasury defaults: 38.83M HYPE, $133M cash; share count is calibrated to purrmnav.com, not official — update after each filing.
        <a href="javascript:prrCalcReset()" style="color:var(--accent)">reset</a></div>
      <div id="prr-calc-out"></div>
    </div>
    <div class="card" id="prr-doc" style="font-size:13px;color:var(--text-muted)">${_prrDocHtml || '<div class="loading"><div class="spinner"></div> Loading research…</div>'}</div>`;
  prrCalc();
}

async function loadPurrResearch() {
  _prrRender();
  if (typeof _hlpLoadPurr === 'function') _hlpLoadPurr('prr-live');
  _prrFillHype();
  if (!_prrDocHtml) {
    _prrDocHtml = await _prrLoadDoc();
    const d = document.getElementById('prr-doc');
    if (d) d.innerHTML = _prrDocHtml;
  }
}
