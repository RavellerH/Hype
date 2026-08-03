/* ============================================================
   insights.js — Daily Actionable Insight (position actions · new
   setups · macro regime). Generated server-side every day by a
   GitHub Actions workflow (.github/workflows/insights.yml,
   scripts/daily-insight.mjs via the llm-router Edge Function) and
   committed straight into the repo as insights/<date>.md +
   insights/index.json — no database, read here as a plain JSON file.
   ============================================================ */

'use strict';

const _INS_INDEX_URL = 'https://raw.githubusercontent.com/RavellerH/Hype/gh-pages/insights/index.json';

let _insReports = [];
let _insLoaded  = false;
let _insExpanded = new Set();

function _insEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadInsights() {
  const el = document.getElementById('insights-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  await _insLoadData();
  _insLoaded = true;
  _insRender();
}

async function _insLoadData() {
  try {
    const r = await fetch(`${_INS_INDEX_URL}?t=${Date.now()}`);
    if (r.ok) _insReports = await r.json();
  } catch (e) {
    console.warn('[Insight] load error', e);
  }
}

function insRefresh() { loadInsights(); }

// Shares the same backend-url override as dailybrief.js/research.js — all hit
// /api/trigger-workflow, which only exists on the Vercel deployment.
const _INS_BACKEND_KEY = 'hype_trigger_backend_url';

function _insBackendUrl() {
  return (localStorage.getItem(_INS_BACKEND_KEY) || '').replace(/\/$/, '');
}

function insSetBackend() {
  const cur = localStorage.getItem(_INS_BACKEND_KEY) || '';
  const url = prompt('Vercel app URL (only needed if this page is NOT already served from it), e.g. https://your-app.vercel.app:', cur);
  if (url === null) return;
  if (url.trim()) localStorage.setItem(_INS_BACKEND_KEY, url.trim());
  else localStorage.removeItem(_INS_BACKEND_KEY);
}

async function insGenerateNow() {
  const status = document.getElementById('ins-gen-status');
  if (status) status.textContent = 'triggering…';
  try {
    const r = await fetch(`${_insBackendUrl()}/api/trigger-workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: 'insights.yml' }),
    });
    if (!r.ok) {
      if (r.status === 405) throw new Error('405 — this page isn\'t served from your Vercel app. Click ⚙ and paste its URL.');
      throw new Error((await r.json().catch(() => ({})))?.error || `${r.status}`);
    }
    if (status) status.textContent = 'triggered — fetching in 30s…';
    setTimeout(loadInsights, 30000);
  } catch (e) {
    if (status) status.textContent = `error: ${e.message}`;
  }
}

function insToggleHistory(date) {
  if (_insExpanded.has(date)) _insExpanded.delete(date); else _insExpanded.add(date);
  _insRender();
}

const _INS_CONF_COLOR = { high: 'var(--green)', medium: 'var(--accent)', low: 'var(--red)' };
const _INS_REGIME_COLOR = { BUY: 'var(--green)', BULL: 'var(--green)', WAIT: 'var(--accent)', CAUTION: 'var(--red)', SELL: 'var(--red)' };
const _INS_ACTION_COLOR = { add: 'var(--green)', hold: 'var(--accent)', trim: 'var(--yellow, var(--accent))', tighten_stop: 'var(--yellow, var(--accent))', close: 'var(--red)' };

function _insConfBadge(c) {
  if (!c) return '';
  return `<span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${_INS_CONF_COLOR[c] || 'var(--text-muted)'};border:1px solid currentColor;border-radius:4px;padding:1px 5px;">${_insEsc(c)} confidence</span>`;
}

function _insRegimeBadge(r, score) {
  if (!r) return '';
  const color = _INS_REGIME_COLOR[r] || 'var(--text-muted)';
  return `<span style="font-size:10px;font-weight:700;color:${color};border:1px solid currentColor;border-radius:4px;padding:1px 5px;">${_insEsc(r)}${score != null ? ` ${score > 0 ? '+' : ''}${score}` : ''}</span>`;
}

function _insPositionActions(arr) {
  if (!Array.isArray(arr) || !arr.length) return '<div style="font-size:12px;color:var(--text-faint);">No open positions.</div>';
  return arr.map(a => {
    const color = _INS_ACTION_COLOR[a.action] || 'var(--text-muted)';
    return `<div style="margin-bottom:6px;padding:8px 10px;background:var(--surface2);border-radius:6px;border-left:3px solid ${color};">
      <div><b style="color:var(--text);">${_insEsc(a.coin)}</b> <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${color};">${_insEsc((a.action || '').replace('_', ' '))}</span></div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${_insEsc(a.reason)}</div>
    </div>`;
  }).join('');
}

const _INS_CONVICTION_COLOR = { high: 'var(--green)', medium: 'var(--accent)', low: 'var(--text-faint)' };

function _insNewSetups(arr) {
  if (!Array.isArray(arr) || !arr.length) return '<div style="font-size:12px;color:var(--text-faint);">No new setups flagged.</div>';
  return arr.map(s => {
    const color = s.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
    const convColor = _INS_CONVICTION_COLOR[s.conviction] || 'var(--text-faint)';
    return `<div style="margin-bottom:6px;padding:8px 10px;background:var(--surface2);border-radius:6px;border-left:3px solid ${color};">
      <div><b style="color:var(--text);">${_insEsc(s.coin)}</b> <span style="font-size:10px;font-weight:700;color:${color};">${_insEsc(s.direction)}</span>
      ${s.conviction ? `<span style="font-size:9px;font-weight:700;text-transform:uppercase;color:${convColor};border:1px solid currentColor;border-radius:3px;padding:0 4px;margin-left:4px;">${_insEsc(s.conviction)} conviction</span>` : ''}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${_insEsc(s.rationale)}</div>
    </div>`;
  }).join('');
}

function _insSection(title, icon, text) {
  if (!text) return '';
  return `<div style="margin-top:10px;"><div style="font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;">${icon} ${title}</div><div style="font-size:13px;color:var(--text-muted);margin-top:4px;line-height:1.5;">${_insEsc(text)}</div></div>`;
}

function _insList(arr, cls) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return `<ul style="margin:4px 0 0;padding-left:18px;">${arr.map(x => `<li class="${cls}" style="margin-bottom:3px;">${_insEsc(x)}</li>`).join('')}</ul>`;
}

function _insCardHTML(r, isLatest) {
  const dateStr = r.date ? new Date(r.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const expanded = isLatest || _insExpanded.has(r.date);

  const body = `
    ${_insSection('Market Analysis', '◆', r.market_analysis)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;">◎ Position Actions</div>
        <div style="margin-top:6px;">${_insPositionActions(r.position_actions)}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;">◈ New Setups</div>
        <div style="margin-top:6px;">${_insNewSetups(r.new_setups)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${_insSection('Sentiment', '☾', r.sentiment_summary)}
      ${_insSection('Money Flow', '⇄', r.money_flow_summary)}
    </div>
    ${_insSection('Signal Consensus', '≡', r.consensus_summary)}
    ${r.regime_note ? `<div style="font-size:13px;color:var(--text-muted);margin:8px 0;line-height:1.5;"><b style="color:var(--text);">Regime:</b> ${_insEsc(r.regime_note)}</div>` : ''}
    ${(r.risks || []).length ? `<div style="margin-top:8px;"><div style="font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;">⚠ Risks</div>${_insList(r.risks, 'neg')}</div>` : ''}
    ${r.takeaway ? `<div style="font-style:italic;font-size:13px;color:var(--accent);margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">${_insEsc(r.takeaway)}</div>` : ''}
    <div style="margin-top:8px;"><a href="https://github.com/RavellerH/Hype/blob/gh-pages/insights/${_insEsc(r.file)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--text-faint);">view source markdown ↗</a></div>
  `;

  return `
  <div class="note-card" style="margin-bottom:10px;">
    <div class="note-header" style="cursor:${isLatest ? 'default' : 'pointer'};" ${isLatest ? '' : `onclick="insToggleHistory('${_insEsc(r.date)}')"`}>
      ${isLatest ? '<span class="mvrv-zone-badge" style="background:var(--accent-subtle);color:var(--accent);">TODAY</span>' : ''}
      <span style="font-weight:700;color:var(--text);flex:1;min-width:120px;">${_insEsc(r.headline) || '(untitled)'}</span>
      ${_insRegimeBadge(r.regime_verdict, r.regime_score)}
      ${_insConfBadge(r.confidence)}
      <span style="font-size:11px;color:var(--text-faint);">${dateStr}</span>
      ${!isLatest ? `<span style="color:var(--text-muted);font-size:12px;">${expanded ? '▲' : '▼'}</span>` : ''}
    </div>
    ${expanded ? body : ''}
  </div>`;
}

function _insRender() {
  const el = document.getElementById('insights-content');
  if (!el) return;

  const genBar = `
  <div class="filter-bar" style="margin:0 0 12px;justify-content:space-between;">
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn btn-ghost btn-sm" onclick="insRefresh()">↺ Refresh</button>
      <button class="btn btn-primary btn-sm" onclick="insGenerateNow()">⚡ Generate Now</button>
      <button class="btn btn-ghost btn-sm" onclick="insSetBackend()" title="Set Vercel app URL — needed if this page isn't served from Vercel">⚙</button>
      <span id="ins-gen-status" style="font-size:11px;color:var(--text-muted);"></span>
    </div>
  </div>`;

  const [latest, ...history] = _insReports;

  if (!latest) {
    el.innerHTML = genBar + `<div class="chat-empty" style="margin-top:30px;">No daily insights yet. A GitHub Actions workflow generates one automatically each day (needs PRIMARY_WALLET configured as a repo secret) — or click "Generate Now".</div>`;
    return;
  }

  const historyHTML = history.length
    ? `<div style="font-size:11px;color:var(--text-faint);text-transform:uppercase;margin:16px 0 8px;">History</div>${history.map(r => _insCardHTML(r, false)).join('')}`
    : '';

  el.innerHTML = genBar + _insCardHTML(latest, true) + historyHTML;
}
