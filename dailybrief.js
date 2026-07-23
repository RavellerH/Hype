/* ============================================================
   dailybrief.js — Daily Hyperliquid Brief (on-chain · risks ·
   opportunities · news). Generated server-side every day by a
   GitHub Actions workflow (.github/workflows/daily-brief.yml,
   scripts/daily-brief.mjs via the llm-router Edge Function) and
   committed straight into the repo as briefs/<date>.md +
   briefs/index.json — no database, read here as a plain JSON file.
   ============================================================ */

'use strict';

const _DBR_INDEX_URL = 'https://raw.githubusercontent.com/RavellerH/Hype/gh-pages/briefs/index.json';
const _DBR_RAW_BASE  = 'https://raw.githubusercontent.com/RavellerH/Hype/gh-pages/briefs/';

let _dbrBriefs   = [];
let _dbrLoaded   = false;
let _dbrExpanded = new Set();
let _dbrFullOpen = new Set();   // files whose full markdown is expanded
const _dbrFullCache = {};       // file → markdown text

// ── Minimal markdown renderer (shared with research.js) ─────────────────────
// Escapes first, then supports: #–#### headings, **bold**, `code`, fenced
// code blocks, -/*/1. lists, --- rules, [links](https://…), paragraphs.

function _hypeMdEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _hypeMd(md) {
  const lines = _hypeMdEsc(md || '').split('\n');
  const out = [];
  let inList = false, inCode = false;
  const inline = t => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^```/.test(l.trim())) { inCode = !inCode; out.push(inCode ? '<pre class="hmd-pre">' : '</pre>'); continue; }
    if (inCode) { out.push(raw + '\n'); continue; }
    const li = l.match(/^\s*[-*]\s+(.*)/) || l.match(/^\s*\d+\.\s+(.*)/);
    if (li) { if (!inList) { out.push('<ul class="hmd-ul">'); inList = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { const lv = Math.min(h[1].length + 2, 6); out.push(`<h${lv} class="hmd-h">${inline(h[2])}</h${lv}>`); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr class="hmd-hr">'); continue; }
    if (!l.trim()) continue;
    out.push(`<p class="hmd-p">${inline(l)}</p>`);
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</pre>');
  return out.join('');
}

// Fetch + toggle the full markdown of a report; shared by brief & research
async function _hypeMdToggle(openSet, cache, baseUrl, file, rerender) {
  if (openSet.has(file)) { openSet.delete(file); rerender(); return; }
  openSet.add(file);
  rerender(); // shows "loading…" if not cached yet
  if (cache[file] == null) {
    try {
      const r = await fetch(baseUrl + encodeURIComponent(file));
      cache[file] = r.ok ? await r.text() : `*Failed to load (${r.status})*`;
    } catch (e) {
      cache[file] = `*Failed to load: ${e.message}*`;
    }
    rerender();
  }
}

function _hypeMdBlock(openSet, cache, file, toggleFn) {
  const isOpen = openSet.has(file);
  const btn = `<button class="btn btn-ghost btn-sm" onclick="${toggleFn}('${_dbrEsc(file)}')">${isOpen ? '▲ Hide full report' : '📄 Read full report'}</button>`;
  if (!isOpen) return `<div style="margin-top:8px;display:flex;gap:10px;align-items:center">${btn}</div>`;
  const body = cache[file] == null
    ? '<div class="loading" style="padding:14px"><div class="spinner"></div> Loading report…</div>'
    : `<div class="hmd-body">${_hypeMd(cache[file])}</div>`;
  return `<div style="margin-top:8px;display:flex;gap:10px;align-items:center">${btn}</div>${body}`;
}

function dbrToggleFull(file) {
  _hypeMdToggle(_dbrFullOpen, _dbrFullCache, _DBR_RAW_BASE, file, _dbrRender);
}

function _dbrEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadDailyBrief() {
  const el = document.getElementById('brief-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  await _dbrLoadData();
  _dbrLoaded = true;
  _dbrRender();
}

async function _dbrLoadData() {
  try {
    const r = await fetch(`${_DBR_INDEX_URL}?t=${Date.now()}`);
    if (r.ok) _dbrBriefs = await r.json();
  } catch (e) {
    console.warn('[Brief] load error', e);
  }
}

function dbrRefresh() { loadDailyBrief(); }

// /api/trigger-workflow only exists on the Vercel deployment, not on the
// GitHub Pages copy of this page — a relative fetch() 405s there since
// Pages rejects POST at the edge. Same fix as nansen.js's backend-url field.
const _DBR_BACKEND_KEY = 'hype_trigger_backend_url';

function _dbrBackendUrl() {
  return (localStorage.getItem(_DBR_BACKEND_KEY) || '').replace(/\/$/, '');
}

function dbrSetBackend() {
  const cur = localStorage.getItem(_DBR_BACKEND_KEY) || '';
  const url = prompt('Vercel app URL (only needed if this page is NOT already served from it), e.g. https://your-app.vercel.app:', cur);
  if (url === null) return;
  if (url.trim()) localStorage.setItem(_DBR_BACKEND_KEY, url.trim());
  else localStorage.removeItem(_DBR_BACKEND_KEY);
}

async function dbrGenerateNow() {
  const status = document.getElementById('dbr-gen-status');
  if (status) status.textContent = 'triggering…';
  try {
    const r = await fetch(`${_dbrBackendUrl()}/api/trigger-workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: 'daily-brief.yml' }),
    });
    if (!r.ok) {
      if (r.status === 405) throw new Error('405 — this page isn\'t served from your Vercel app. Click ⚙ and paste its URL.');
      throw new Error((await r.json().catch(() => ({})))?.error || `${r.status}`);
    }
    if (status) status.textContent = 'triggered — fetching in 30s…';
    setTimeout(loadDailyBrief, 30000);
  } catch (e) {
    if (status) status.textContent = `error: ${e.message}`;
  }
}

function dbrToggleHistory(date) {
  if (_dbrExpanded.has(date)) _dbrExpanded.delete(date); else _dbrExpanded.add(date);
  _dbrRender();
}

function _dbrList(arr, cls) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return `<ul style="margin:4px 0 0;padding-left:18px;">${arr.map(x => `<li class="${cls}" style="margin-bottom:3px;">${_dbrEsc(x)}</li>`).join('')}</ul>`;
}

const _DBR_CONF_COLOR = { high: 'var(--green)', medium: 'var(--accent)', low: 'var(--red)' };

function _dbrConfBadge(c) {
  if (!c) return '';
  return `<span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${_DBR_CONF_COLOR[c] || 'var(--text-muted)'};border:1px solid currentColor;border-radius:4px;padding:1px 5px;">${_dbrEsc(c)} confidence</span>`;
}

function _dbrCardHTML(b, isLatest) {
  const dateStr = b.date ? new Date(b.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const expanded = isLatest || _dbrExpanded.has(b.date);

  const body = `
    ${b.market_analysis ? `<div style="margin:8px 0;font-size:13px;color:var(--text-muted);line-height:1.5;">${_dbrEsc(b.market_analysis)}</div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0;">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;">⚠ Risks</div>
        ${_dbrList(b.risks, 'neg') || '<div style="font-size:12px;color:var(--text-faint);">none flagged</div>'}
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;">◎ Opportunities</div>
        ${_dbrList(b.opportunities, 'pos') || '<div style="font-size:12px;color:var(--text-faint);">none flagged</div>'}
      </div>
    </div>
    ${b.news_summary ? `<div style="font-size:13px;color:var(--text-muted);margin:8px 0;line-height:1.5;"><b style="color:var(--text);">News:</b> ${_dbrEsc(b.news_summary)}</div>` : ''}
    ${b.takeaway ? `<div style="font-style:italic;font-size:13px;color:var(--accent);margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">${_dbrEsc(b.takeaway)}</div>` : ''}
    ${b.file ? _hypeMdBlock(_dbrFullOpen, _dbrFullCache, b.file, 'dbrToggleFull') : ''}
    <div style="margin-top:8px;"><a href="https://github.com/RavellerH/Hype/blob/gh-pages/briefs/${_dbrEsc(b.file)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--text-faint);">view source on GitHub ↗</a></div>
  `;

  return `
  <div class="note-card" style="margin-bottom:10px;">
    <div class="note-header" style="cursor:${isLatest ? 'default' : 'pointer'};" ${isLatest ? '' : `onclick="dbrToggleHistory('${_dbrEsc(b.date)}')"`}>
      ${isLatest ? '<span class="mvrv-zone-badge" style="background:var(--accent-subtle);color:var(--accent);">TODAY</span>' : ''}
      <span style="font-weight:700;color:var(--text);flex:1;min-width:120px;">${_dbrEsc(b.headline) || '(untitled)'}</span>
      ${_dbrConfBadge(b.confidence)}
      <span style="font-size:11px;color:var(--text-faint);">${dateStr}</span>
      ${!isLatest ? `<span style="color:var(--text-muted);font-size:12px;">${expanded ? '▲' : '▼'}</span>` : ''}
    </div>
    ${expanded ? body : ''}
  </div>`;
}

function _dbrRender() {
  const el = document.getElementById('brief-content');
  if (!el) return;

  const genBar = `
  <div class="filter-bar" style="margin:0 0 12px;justify-content:space-between;">
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn btn-ghost btn-sm" onclick="dbrRefresh()">↺ Refresh</button>
      <button class="btn btn-primary btn-sm" onclick="dbrGenerateNow()">⚡ Generate Now</button>
      <button class="btn btn-ghost btn-sm" onclick="dbrSetBackend()" title="Set Vercel app URL — needed if this page isn't served from Vercel">⚙</button>
      <span id="dbr-gen-status" style="font-size:11px;color:var(--text-muted);"></span>
    </div>
  </div>`;

  const [latest, ...history] = _dbrBriefs;

  if (!latest) {
    el.innerHTML = genBar + `<div class="chat-empty" style="margin-top:30px;">No daily briefs yet. A GitHub Actions workflow generates one automatically at UTC midnight — or click "Generate Now".</div>`;
    return;
  }

  const historyHTML = history.length
    ? `<div style="font-size:11px;color:var(--text-faint);text-transform:uppercase;margin:16px 0 8px;">History</div>${history.map(b => _dbrCardHTML(b, false)).join('')}`
    : '';

  el.innerHTML = genBar + _dbrCardHTML(latest, true) + historyHTML;
}
