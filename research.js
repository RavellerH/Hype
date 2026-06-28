/* ============================================================
   research.js — Weekly Hyperliquid Research reports, aggregated
   from a week of daily briefs and generated server-side every
   Sunday by a GitHub Actions workflow. Meant to be publishable.
   ============================================================ */

'use strict';

const _WRS_URL = 'https://eiqlvbylkcmgvksrxqld.supabase.co';
const _WRS_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpcWx2Ynlsa2NtZ3Zrc3J4cWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTI4NjgsImV4cCI6MjA5NDUyODg2OH0.PcGDHYlajqwnZ7c3ZPtssG534kd3sKwE8aT1ROlFpo8';
const _wrsDb   = (window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(_WRS_URL, _WRS_KEY)
  : null;

let _wrsReports = [];
let _wrsLoaded  = false;
let _wrsOpenId  = null;

function _wrsEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadResearch() {
  const el = document.getElementById('research-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  await _wrsLoadData();
  _wrsLoaded = true;
  if (!_wrsOpenId && _wrsReports.length) _wrsOpenId = _wrsReports[0].id;
  _wrsRender();
}

async function _wrsLoadData() {
  if (!_wrsDb) return;
  try {
    const { data } = await _wrsDb.from('weekly_research').select('*').order('week_start', { ascending: false }).limit(26);
    if (data) _wrsReports = data;
  } catch (e) {
    console.warn('[Research] load error', e);
  }
}

function wrsRefresh() { loadResearch(); }

async function wrsGenerateNow() {
  const status = document.getElementById('wrs-gen-status');
  if (status) status.textContent = 'triggering…';
  try {
    const r = await fetch('/api/trigger-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: 'weekly-research.yml' }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `${r.status}`);
    if (status) status.textContent = 'triggered — fetching in 30s…';
    setTimeout(loadResearch, 30000);
  } catch (e) {
    if (status) status.textContent = `error: ${e.message}`;
  }
}

function wrsOpen(id) {
  _wrsOpenId = id;
  _wrsRender();
}

function _wrsList(arr, cls) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return `<ul style="margin:4px 0 0;padding-left:18px;">${arr.map(x => `<li class="${cls}" style="margin-bottom:3px;">${_wrsEsc(x)}</li>`).join('')}</ul>`;
}

function _wrsDetailHTML(r) {
  const range = r.week_start && r.week_end
    ? `${new Date(r.week_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(r.week_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : '';
  return `
  <div class="note-card">
    <div class="note-header">
      <span class="mvrv-zone-badge" style="background:var(--accent-subtle);color:var(--accent);">${_wrsEsc(range)}</span>
      <span style="font-weight:700;color:var(--text);flex:1;min-width:120px;font-size:15px;">${_wrsEsc(r.title) || '(untitled)'}</span>
    </div>
    ${r.summary ? `<div style="font-style:italic;color:var(--text-muted);font-size:13px;margin:6px 0;">${_wrsEsc(r.summary)}</div>` : ''}
    ${r.market_structure ? `<div style="margin-top:10px;"><div style="font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;">Market Structure</div><div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${_wrsEsc(r.market_structure)}</div></div>` : ''}
    ${r.onchain_trends ? `<div style="margin-top:10px;"><div style="font-size:11px;font-weight:700;color:var(--text);text-transform:uppercase;">On-Chain Trends</div><div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${_wrsEsc(r.onchain_trends)}</div></div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;">⚠ Risks</div>
        ${_wrsList(r.risks, 'neg')}
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;">◎ Opportunities</div>
        ${_wrsList(r.opportunities, 'pos')}
      </div>
    </div>
    ${r.outlook ? `<div style="font-style:italic;font-size:13px;color:var(--accent);margin-top:10px;border-top:1px solid var(--border);padding-top:8px;">${_wrsEsc(r.outlook)}</div>` : ''}
  </div>`;
}

function _wrsRender() {
  const el = document.getElementById('research-content');
  if (!el) return;

  if (!_wrsDb) {
    el.innerHTML = '<div class="chat-empty" style="margin-top:60px;">⚠️ Supabase not connected.</div>';
    return;
  }

  const genBar = `
  <div class="filter-bar" style="margin:0 0 12px;justify-content:space-between;">
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn btn-ghost btn-sm" onclick="wrsRefresh()">↺ Refresh</button>
      <button class="btn btn-primary btn-sm" onclick="wrsGenerateNow()">⚡ Generate This Week</button>
      <span id="wrs-gen-status" style="font-size:11px;color:var(--text-muted);"></span>
    </div>
  </div>`;

  if (!_wrsReports.length) {
    el.innerHTML = genBar + `<div class="chat-empty" style="margin-top:30px;">No weekly research published yet. It auto-generates every Sunday from the week's daily briefs — or click "Generate This Week".</div>`;
    return;
  }

  const listHTML = _wrsReports.map(r => {
    const active = r.id === _wrsOpenId;
    const range = r.week_start ? new Date(r.week_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    return `<button class="chip${active ? ' chip-active' : ''}" onclick="wrsOpen('${_wrsEsc(r.id)}')">${_wrsEsc(range)} — ${_wrsEsc((r.title || '').slice(0, 28))}</button>`;
  }).join('');

  const current = _wrsReports.find(r => r.id === _wrsOpenId) || _wrsReports[0];

  el.innerHTML = genBar +
    `<div class="filter-bar" style="margin-bottom:12px;flex-wrap:wrap;">${listHTML}</div>` +
    _wrsDetailHTML(current);
}
