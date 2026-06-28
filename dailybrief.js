/* ============================================================
   dailybrief.js — Daily Hyperliquid Brief (on-chain · risks ·
   opportunities · news). Generated server-side every day by a
   GitHub Actions workflow (.github/workflows/daily-brief.yml,
   scripts/daily-brief.mjs) and read here from Supabase.
   ============================================================ */

'use strict';

const _DBR_URL = 'https://eiqlvbylkcmgvksrxqld.supabase.co';
const _DBR_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpcWx2Ynlsa2NtZ3Zrc3J4cWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTI4NjgsImV4cCI6MjA5NDUyODg2OH0.PcGDHYlajqwnZ7c3ZPtssG534kd3sKwE8aT1ROlFpo8';
const _dbrDb   = (window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(_DBR_URL, _DBR_KEY)
  : null;

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
  if (!_dbrDb) return;
  try {
    const { data } = await _dbrDb.from('daily_briefs').select('*').order('date', { ascending: false }).limit(30);
    if (data) _dbrBriefs = data;
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

function dbrToggleHistory(id) {
  if (_dbrExpanded.has(id)) _dbrExpanded.delete(id); else _dbrExpanded.add(id);
  _dbrRender();
}

function _dbrList(arr, cls) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return `<ul style="margin:4px 0 0;padding-left:18px;">${arr.map(x => `<li class="${cls}" style="margin-bottom:3px;">${_dbrEsc(x)}</li>`).join('')}</ul>`;
}

function _dbrCardHTML(b, isLatest) {
  const dateStr = b.date ? new Date(b.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const expanded = isLatest || _dbrExpanded.has(b.id);

  const body = `
    ${b.onchain_summary ? `<div style="margin:8px 0;font-size:13px;color:var(--text-muted);">${_dbrEsc(b.onchain_summary)}</div>` : ''}
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
    ${b.news_summary ? `<div style="font-size:13px;color:var(--text-muted);margin:8px 0;"><b style="color:var(--text);">News:</b> ${_dbrEsc(b.news_summary)}</div>` : ''}
    ${b.takeaway ? `<div style="font-style:italic;font-size:13px;color:var(--accent);margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">${_dbrEsc(b.takeaway)}</div>` : ''}
  `;

  return `
  <div class="note-card" style="margin-bottom:10px;">
    <div class="note-header" style="cursor:${isLatest ? 'default' : 'pointer'};" ${isLatest ? '' : `onclick="dbrToggleHistory('${_dbrEsc(b.id)}')"`}>
      ${isLatest ? '<span class="mvrv-zone-badge" style="background:var(--accent-subtle);color:var(--accent);">TODAY</span>' : ''}
      <span style="font-weight:700;color:var(--text);flex:1;min-width:120px;">${_dbrEsc(b.headline) || '(untitled)'}</span>
      <span style="font-size:11px;color:var(--text-faint);">${dateStr}</span>
      ${!isLatest ? `<span style="color:var(--text-muted);font-size:12px;">${expanded ? '▲' : '▼'}</span>` : ''}
    </div>
    ${expanded ? body : ''}
  </div>`;
}

function _dbrRender() {
  const el = document.getElementById('brief-content');
  if (!el) return;

  if (!_dbrDb) {
    el.innerHTML = '<div class="chat-empty" style="margin-top:60px;">⚠️ Supabase not connected.</div>';
    return;
  }

  const [latest, ...history] = _dbrBriefs;

  const genBar = `
  <div class="filter-bar" style="margin:0 0 12px;justify-content:space-between;">
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn btn-ghost btn-sm" onclick="dbrRefresh()">↺ Refresh</button>
      <button class="btn btn-primary btn-sm" onclick="dbrGenerateNow()">⚡ Generate Now</button>
      <span id="dbr-gen-status" style="font-size:11px;color:var(--text-muted);"></span>
    </div>
  </div>`;

  if (!latest) {
    el.innerHTML = genBar + `<div class="chat-empty" style="margin-top:30px;">No daily briefs yet. A GitHub Actions workflow generates one automatically at UTC midnight — or click "Generate Now".</div>`;
    return;
  }

  const historyHTML = history.length
    ? `<div style="font-size:11px;color:var(--text-faint);text-transform:uppercase;margin:16px 0 8px;">History</div>${history.map(b => _dbrCardHTML(b, false)).join('')}`
    : '';

  el.innerHTML = genBar + _dbrCardHTML(latest, true) + historyHTML;
}
