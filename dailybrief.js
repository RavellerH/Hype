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

let _dbrBriefs   = [];
let _dbrLoaded   = false;
let _dbrExpanded = new Set();

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

async function dbrGenerateNow() {
  const status = document.getElementById('dbr-gen-status');
  if (status) status.textContent = 'triggering…';
  try {
    const r = await fetch('/api/trigger-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: 'daily-brief.yml' }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `${r.status}`);
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
    <div style="margin-top:8px;"><a href="https://github.com/RavellerH/Hype/blob/gh-pages/briefs/${_dbrEsc(b.file)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--text-faint);">view source markdown ↗</a></div>
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
