/* ============================================================
   kb.js — Knowledge Base: Wiki · Journal
   ============================================================ */

'use strict';

// ── Supabase init ─────────────────────────────────────────────
const _KB_URL  = 'https://eiqlvbylkcmgvksrxqld.supabase.co';
const _KB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpcWx2Ynlsa2NtZ3Zrc3J4cWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTI4NjgsImV4cCI6MjA5NDUyODg2OH0.PcGDHYlajqwnZ7c3ZPtssG534kd3sKwE8aT1ROlFpo8';
const _kbDb    = (window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(_KB_URL, _KB_KEY)
  : null;

// ── State ────────────────────────────────────────────────────
let _kbTab          = 'wiki';
let _kbWiki         = [];
let _kbTrades       = [];
let _kbWikiFilter   = 'all';
let _kbLoaded       = false;
let _activeEntryId  = null;  // trade currently showing entry questions
let _kbCloseId      = null;  // trade currently being closed
let _kbFormOpen     = false; // wiki add form toggle

// ── HTML escape ───────────────────────────────────────────────
function kbEsc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── ID generator ─────────────────────────────────────────────
function kbId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Toast ─────────────────────────────────────────────────────
function kbToast(msg, type = 'success') {
  const el = document.createElement('div');
  const bg = type === 'success' ? 'var(--green)' : type === 'error' ? 'var(--red)' : 'var(--accent)';
  el.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:99999;background:${bg};color:#fff;`
    + `padding:10px 18px;border-radius:var(--radius-md);font-size:13px;font-weight:600;`
    + `box-shadow:0 4px 16px rgba(0,0,0,.4);transition:opacity .3s;max-width:320px;line-height:1.4;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ── Conviction dots ───────────────────────────────────────────
function kbConvictionDots(n) {
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += `<span style="color:${i <= n ? 'var(--accent)' : 'var(--border)'};font-size:14px;">●</span>`;
  }
  return s;
}

// ── Data loading ──────────────────────────────────────────────
async function _kbLoadData() {
  if (!_kbDb) return;
  try {
    const [wr, tr] = await Promise.all([
      _kbDb.from('kb_wiki').select('*').order('created_at', { ascending: false }),
      _kbDb.from('kb_trades').select('*').order('created_at', { ascending: false })
    ]);
    if (wr.data) _kbWiki   = wr.data;
    if (tr.data) _kbTrades = tr.data;
  } catch (e) {
    console.warn('[KB] load error', e);
  }
}

async function loadKB() {
  const el = document.getElementById('kb-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  await _kbLoadData();
  _kbLoaded = true;
  renderKBShell();
}

// ── Shell ─────────────────────────────────────────────────────
function renderKBShell() {
  const el = document.getElementById('kb-content');
  if (!el) return;

  if (!_kbDb) {
    el.innerHTML = '<div class="chat-empty" style="margin-top:60px;">⚠️ Supabase not connected.</div>';
    return;
  }

  const openTrades   = _kbTrades.filter(t => t.status === 'OPEN'  || t.status === 'open');
  const closedTrades = _kbTrades.filter(t => t.status === 'CLOSED' || t.status === 'closed');
  const wins         = closedTrades.filter(t => (t.pnl_usd || 0) > 0).length;
  const winRate      = closedTrades.length ? Math.round(wins / closedTrades.length * 100) : 0;
  const totalPnl     = closedTrades.reduce((s, t) => s + (t.pnl_usd || 0), 0);
  const pnlClass     = totalPnl >= 0 ? 'pos' : 'neg';
  const pnlAbs       = (typeof fmt$ === 'function') ? fmt$(Math.abs(totalPnl)) : '$' + Math.abs(totalPnl).toFixed(2);
  const pnlStr       = (totalPnl >= 0 ? '+' : '-') + pnlAbs;

  const statsHTML = `
  <div class="ai-stat-strip">
    <div class="ai-stat-cell">
      <div class="ai-stat-label">Wiki Entries</div>
      <div class="ai-stat-val">${_kbWiki.length}</div>
    </div>
    <div class="ai-stat-cell">
      <div class="ai-stat-label">Open Trades</div>
      <div class="ai-stat-val">${openTrades.length}</div>
    </div>
    <div class="ai-stat-cell">
      <div class="ai-stat-label">Win Rate</div>
      <div class="ai-stat-val">${closedTrades.length ? winRate + '%' : '—'}</div>
    </div>
    <div class="ai-stat-cell">
      <div class="ai-stat-label">Total P&amp;L</div>
      <div class="ai-stat-val ${pnlClass}">${closedTrades.length ? pnlStr : '—'}</div>
    </div>
  </div>`;

  const tabBar = `
  <div class="filter-bar" style="margin:12px 0 0;">
    <button class="chip${_kbTab === 'wiki' ? ' chip-active' : ''}" onclick="kbSetTab('wiki')">Wiki</button>
    <button class="chip${_kbTab === 'journal' ? ' chip-active' : ''}" onclick="kbSetTab('journal')">Journal</button>
  </div>`;

  el.innerHTML = statsHTML + tabBar + '<div id="kb-tab-body"></div>';
  _kbRenderActiveTab();
}

function kbSetTab(tab) {
  _kbTab = tab;
  const el = document.getElementById('kb-tab-body');
  if (!el) { renderKBShell(); return; }
  _kbRenderActiveTab();
}

function _kbRenderActiveTab() {
  const el = document.getElementById('kb-tab-body');
  if (!el) return;
  if (_kbTab === 'wiki')    el.innerHTML = renderWikiTab();
  if (_kbTab === 'journal') el.innerHTML = renderJournalTab();
}

// ══════════════════════════════════════════════════════════════
//  WIKI TAB
// ══════════════════════════════════════════════════════════════

const _WIKI_CATS = ['concept','pattern','rule','playbook','lesson','brief'];
const _WIKI_CAT_COLORS = {
  concept:  '#3b82f6',
  pattern:  '#8b5cf6',
  rule:     '#f97316',
  playbook: '#22c55e',
  lesson:   '#eab308',
  brief:    '#50d2c1'
};

function renderWikiTab() {
  // category filter chips
  const filterChips = ['all', ..._WIKI_CATS].map(c =>
    `<button class="chip${_kbWikiFilter === c ? ' chip-active' : ''}" onclick="kbSetWikiFilter('${c}')">${c.charAt(0).toUpperCase() + c.slice(1)}</button>`
  ).join('');

  // add form — show by default if empty
  const showForm = _kbFormOpen || _kbWiki.length === 0;
  const addForm = `
  <div class="note-card note-add" style="margin-bottom:12px;">
    <div class="note-header" style="cursor:pointer;" onclick="kbToggleWikiForm()">
      <span style="font-weight:600;color:var(--accent);">+ New Wiki Entry</span>
      <span id="kb-wiki-form-toggle" style="color:var(--text-muted);font-size:12px;">${showForm ? '▲ collapse' : '▼ expand'}</span>
    </div>
    <div id="kb-wiki-form" style="display:${showForm ? 'block' : 'none'};padding-top:10px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <input class="input" id="kbwf-title" placeholder="Title" />
        <select class="input" id="kbwf-cat">
          ${_WIKI_CATS.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <input class="input" id="kbwf-coins" placeholder="Coins (BTC, ETH…)" />
        <input class="input" id="kbwf-tags"  placeholder="Tags (comma-sep)" />
      </div>
      <textarea class="input note-textarea" id="kbwf-content" placeholder="Content — leave empty and click AI Generate to auto-fill…" rows="5" style="width:100%;resize:vertical;"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-primary btn-sm" onclick="kbSaveWikiEntry()">📝 Save</button>
        <button class="btn btn-ghost btn-sm" id="kbwf-ai-btn" onclick="kbWikiAiGenerate()">🤖 AI Generate</button>
      </div>
    </div>
  </div>`;

  // filtered entries
  const filtered = _kbWikiFilter === 'all'
    ? _kbWiki
    : _kbWiki.filter(w => w.category === _kbWikiFilter);

  const cardsHTML = filtered.length
    ? filtered.map(w => _wikiCardHTML(w)).join('')
    : `<div class="chat-empty" style="margin-top:30px;">No wiki entries yet.</div>`;

  return `
  <div style="padding-top:8px;">
    <div class="filter-bar" style="margin-bottom:10px;">${filterChips}</div>
    ${addForm}
    <div id="kb-wiki-list">${cardsHTML}</div>
  </div>`;
}

function _wikiCardHTML(w) {
  const col     = _WIKI_CAT_COLORS[w.category] || 'var(--text-muted)';
  const coins   = Array.isArray(w.coins) ? w.coins : [];
  const tags    = Array.isArray(w.tags)  ? w.tags  : [];
  const refs    = Array.isArray(w.trade_refs) ? w.trade_refs : [];
  const dateStr = w.created_at
    ? new Date(typeof w.created_at === 'number' ? w.created_at : Number(w.created_at)).toLocaleDateString()
    : '';

  return `
  <div class="note-card" id="wcard-${kbEsc(w.id)}" style="margin-bottom:10px;">
    <div class="note-header" style="flex-wrap:wrap;gap:6px;">
      <span class="mvrv-zone-badge" style="background:${col}20;color:${col};border:1px solid ${col}40;">${kbEsc(w.category)}</span>
      ${w.source && w.source !== 'manual' ? `<span style="font-size:10px;background:var(--accent)20;color:var(--accent);border:1px solid var(--accent)40;padding:1px 5px;border-radius:3px;">AI</span>` : ''}
      <span style="font-weight:700;color:var(--text);flex:1;min-width:120px;">${kbEsc(w.title)}</span>
      <span style="font-size:11px;color:var(--text-faint);">${dateStr}</span>
    </div>
    ${w.summary ? `<div style="font-style:italic;color:var(--text-muted);font-size:13px;margin:4px 0 6px;">${kbEsc(w.summary)}</div>` : ''}
    <div id="wcontent-${kbEsc(w.id)}" style="display:none;white-space:pre-wrap;font-size:13px;color:var(--text-muted);margin-bottom:8px;">${kbEsc(w.content || '')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
      ${coins.map(c => `<span class="chip" style="font-size:10px;padding:2px 7px;background:var(--accent)15;color:var(--accent);">${kbEsc(c)}</span>`).join('')}
      ${tags.map(t  => `<span class="chip" style="font-size:10px;padding:2px 7px;">${kbEsc(t)}</span>`).join('')}
      ${refs.length ? `<span style="font-size:11px;color:var(--text-muted);">📓 ${refs.length} trade${refs.length > 1 ? 's' : ''}</span>` : ''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <button class="btn btn-ghost btn-sm" onclick="kbWikiToggleContent('${kbEsc(w.id)}')" id="wexp-${kbEsc(w.id)}">Expand</button>
      <button class="btn btn-ghost btn-sm" id="wenh-${kbEsc(w.id)}" onclick="kbWikiAiEnhance('${kbEsc(w.id)}')">🤖 AI Enhance</button>
      <button class="btn btn-ghost btn-sm" onclick="kbWikiLinkTradeToggle('${kbEsc(w.id)}')">🔗 Link Trade</button>
      <button class="btn btn-danger btn-sm" onclick="kbDeleteWikiEntry('${kbEsc(w.id)}')">Delete</button>
    </div>
    <div id="wlink-${kbEsc(w.id)}" style="display:none;margin-top:8px;"></div>
  </div>`;
}

function kbToggleWikiForm() {
  _kbFormOpen = !_kbFormOpen;
  const form = document.getElementById('kb-wiki-form');
  const tog  = document.getElementById('kb-wiki-form-toggle');
  if (form) form.style.display = _kbFormOpen ? 'block' : 'none';
  if (tog)  tog.textContent = _kbFormOpen ? '▲ collapse' : '▼ expand';
}

function kbSetWikiFilter(f) {
  _kbWikiFilter = f;
  _kbRenderActiveTab();
}

function kbWikiToggleContent(id) {
  const el  = document.getElementById('wcontent-' + id);
  const btn = document.getElementById('wexp-' + id);
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  if (btn) btn.textContent = open ? 'Collapse' : 'Expand';
}

async function kbSaveWikiEntry() {
  const title   = (document.getElementById('kbwf-title')?.value   || '').trim();
  const cat     = document.getElementById('kbwf-cat')?.value      || 'lesson';
  const coinsRaw= (document.getElementById('kbwf-coins')?.value   || '').trim();
  const tagsRaw = (document.getElementById('kbwf-tags')?.value    || '').trim();
  const content = (document.getElementById('kbwf-content')?.value || '').trim();

  if (!title) { kbToast('Title is required', 'error'); return; }

  const coins = coinsRaw ? coinsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const tags  = tagsRaw  ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean)  : [];
  const now   = Date.now();

  const entry = {
    id: kbId(), created_at: now, updated_at: now,
    title, category: cat, coins, tags, content,
    summary: '', trade_refs: [], source: 'manual', wiki_ids: []
  };

  const { error } = await _kbDb.from('kb_wiki').insert([entry]);
  if (error) { kbToast('Save failed: ' + error.message, 'error'); return; }

  _kbWiki.unshift(entry);
  _kbFormOpen = false;
  _kbRenderActiveTab();
  kbToast('Wiki entry saved');
}

async function kbDeleteWikiEntry(id) {
  if (!confirm('Delete this wiki entry?')) return;
  await _kbDb.from('kb_wiki').delete().eq('id', id);
  _kbWiki = _kbWiki.filter(w => w.id !== id);
  _kbRenderActiveTab();
  kbToast('Deleted');
}

function kbWikiLinkTradeToggle(wikiId) {
  const el = document.getElementById('wlink-' + wikiId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }

  const openTrades = _kbTrades.filter(t => t.status === 'OPEN' || t.status === 'open');
  if (!openTrades.length) {
    el.style.display = 'block';
    el.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">No open trades to link.</span>';
    return;
  }

  const opts = openTrades.map(t =>
    `<button class="chip" style="margin:2px;" onclick="kbWikiLinkTrade('${kbEsc(wikiId)}','${kbEsc(t.id)}')">${kbEsc(t.coin)} ${kbEsc(t.direction)}</button>`
  ).join('');

  el.style.display = 'block';
  el.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Link to trade:</div>${opts}`;
}

async function kbWikiLinkTrade(wikiId, tradeId) {
  const entry = _kbWiki.find(w => w.id === wikiId);
  if (!entry) return;
  const refs = Array.isArray(entry.trade_refs) ? [...entry.trade_refs] : [];
  if (!refs.includes(tradeId)) refs.push(tradeId);
  entry.trade_refs = refs;
  entry.updated_at = Date.now();
  await _kbDb.from('kb_wiki').update({ trade_refs: refs, updated_at: entry.updated_at }).eq('id', wikiId);

  const trade = _kbTrades.find(t => t.id === tradeId);
  if (trade) {
    const wids = Array.isArray(trade.wiki_ids) ? [...trade.wiki_ids] : [];
    if (!wids.includes(wikiId)) wids.push(wikiId);
    trade.wiki_ids = wids;
    await _kbDb.from('kb_trades').update({ wiki_ids: wids }).eq('id', tradeId);
  }

  kbToast('Trade linked');
  const el = document.getElementById('wlink-' + wikiId);
  if (el) el.style.display = 'none';
  _kbRenderActiveTab();
}

// ── Wiki AI ───────────────────────────────────────────────────
async function kbWikiAiGenerate() {
  const title   = (document.getElementById('kbwf-title')?.value   || '').trim();
  const cat     = document.getElementById('kbwf-cat')?.value      || 'lesson';
  const coinsRaw= (document.getElementById('kbwf-coins')?.value   || '').trim();
  const tagsRaw = (document.getElementById('kbwf-tags')?.value    || '').trim();

  if (!title) { kbToast('Enter a title first', 'error'); return; }

  const btn = document.getElementById('kbwf-ai-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

  try {
    const resp = await fetch(_apiBase() + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'wiki-generate', title, category: cat, coins: coinsRaw, tags: tagsRaw })
    });
    const data = await resp.json();
    if (data.title) {
      const titleEl = document.getElementById('kbwf-title');
      const contentEl = document.getElementById('kbwf-content');
      if (titleEl) titleEl.value = data.title;
      if (contentEl) contentEl.value = data.content || '';
      kbToast('AI content generated — review and save');
    } else {
      kbToast('AI generation failed', 'error');
    }
  } catch (e) {
    kbToast('AI error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI Generate'; }
  }
}

async function kbWikiAiEnhance(wikiId) {
  const entry = _kbWiki.find(w => w.id === wikiId);
  if (!entry) return;

  const btn = document.getElementById('wenh-' + wikiId);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enhancing…'; }

  try {
    const resp = await fetch(_apiBase() + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'wiki-enhance', title: entry.title, category: entry.category, content: entry.content })
    });
    const data = await resp.json();
    if (data.content) {
      entry.summary = data.summary || entry.summary;
      entry.content = data.content;
      entry.updated_at = Date.now();
      await _kbDb.from('kb_wiki').update({
        summary: entry.summary, content: entry.content, updated_at: entry.updated_at
      }).eq('id', wikiId);
      _kbRenderActiveTab();
      kbToast('Entry enhanced');
    } else {
      kbToast('AI enhance failed', 'error');
    }
  } catch (e) {
    kbToast('AI error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI Enhance'; }
  }
}

// ══════════════════════════════════════════════════════════════
//  JOURNAL TAB
// ══════════════════════════════════════════════════════════════

function renderJournalTab() {
  const open   = _kbTrades.filter(t => t.status === 'OPEN'   || t.status === 'open');
  const closed = _kbTrades.filter(t => t.status === 'CLOSED' || t.status === 'closed');
  const wins   = closed.filter(t => (t.pnl_usd || 0) > 0).length;
  const winRate = closed.length ? Math.round(wins / closed.length * 100) : 0;
  const totalPnl = closed.reduce((s, t) => s + (t.pnl_usd || 0), 0);
  const pnlClass = totalPnl >= 0 ? 'pos' : 'neg';
  const pnlAbs   = (typeof fmt$ === 'function') ? fmt$(Math.abs(totalPnl)) : '$' + Math.abs(totalPnl).toFixed(2);

  const summaryStrip = `
  <div class="ai-stat-strip" style="margin-bottom:14px;">
    <div class="ai-stat-cell"><div class="ai-stat-label">Open</div><div class="ai-stat-val">${open.length}</div></div>
    <div class="ai-stat-cell"><div class="ai-stat-label">Closed</div><div class="ai-stat-val">${closed.length}</div></div>
    <div class="ai-stat-cell"><div class="ai-stat-label">Win Rate</div><div class="ai-stat-val">${closed.length ? winRate + '%' : '—'}</div></div>
    <div class="ai-stat-cell"><div class="ai-stat-label">Total P&amp;L</div><div class="ai-stat-val ${pnlClass}">${closed.length ? (totalPnl >= 0 ? '+' : '-') + pnlAbs : '—'}</div></div>
  </div>`;

  const tradeForm = `
  <div class="note-card note-add" style="margin-bottom:14px;">
    <div class="note-header" style="cursor:pointer;" onclick="kbToggleTradeForm()">
      <span style="font-weight:600;color:var(--accent);">+ Log Trade</span>
      <span id="kb-trade-form-toggle" style="color:var(--text-muted);font-size:12px;">▼ expand</span>
    </div>
    <div id="kb-trade-form" style="display:none;padding-top:10px;">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
        <input  class="input" id="kbtf-coin"      placeholder="Coin (BTC)" />
        <select class="input" id="kbtf-direction">
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
        </select>
        <input  class="input" id="kbtf-timeframe" placeholder="Timeframe (4H)" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
        <input class="input" id="kbtf-entry" type="number" placeholder="Entry $" />
        <input class="input" id="kbtf-sl"    type="number" placeholder="Stop Loss $" />
        <input class="input" id="kbtf-tp"    type="number" placeholder="Take Profit $" />
        <input class="input" id="kbtf-size"  type="number" placeholder="Size USD" />
      </div>
      <input class="input" id="kbtf-setup" placeholder="Setup (e.g. Breakout, Retest, Funding harvest)" style="width:100%;margin-bottom:8px;" />
      <div style="margin-top:10px;">
        <button class="btn btn-primary btn-sm" onclick="kbSaveTrade()">📓 Log Trade</button>
      </div>
    </div>
  </div>`;

  let entryPanel = '';
  if (_activeEntryId) {
    const t = _kbTrades.find(x => x.id === _activeEntryId);
    if (t) entryPanel = _entryQuestionsHTML(t);
  }

  const openCards = open.length
    ? open.map(t => _openTradeCardHTML(t)).join('')
    : `<div style="color:var(--text-faint);font-size:13px;padding:8px 0;">No open trades.</div>`;

  const closedCards = closed.length
    ? closed.map(t => _closedTradeCardHTML(t)).join('')
    : `<div style="color:var(--text-faint);font-size:13px;padding:8px 0;">No closed trades yet.</div>`;

  return `
  <div style="padding-top:8px;">
    ${summaryStrip}
    ${tradeForm}
    ${entryPanel}
    <div style="margin-top:16px;">
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">Open Positions</div>
      <div id="kb-open-list">${openCards}</div>
    </div>
    <div style="margin-top:20px;">
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">Closed Positions</div>
      <div id="kb-closed-list">${closedCards}</div>
    </div>
  </div>`;
}

function _entryQuestionsHTML(t) {
  const conv = t.conviction || 0;
  const convChips = [1,2,3,4,5].map(n =>
    `<button class="chip${conv === n ? ' chip-active' : ''}" style="min-width:32px;" onclick="kbSetConviction(${n})">${n}</button>`
  ).join('');

  return `
  <div style="border-left:3px solid var(--accent);padding:14px 16px;background:var(--surface2);border-radius:var(--radius-md);margin-bottom:14px;">
    <div style="font-size:14px;font-weight:700;color:var(--accent);margin-bottom:12px;">🧠 Why did you enter this trade? <span style="color:var(--text-muted);font-size:12px;font-weight:400;">${kbEsc(t.coin)} ${kbEsc(t.direction)}</span></div>
    <div style="display:grid;gap:10px;">
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">1. What technical setup or signal triggered your entry?</div>
        <input class="input" id="eq-setup" value="${kbEsc(t.setup || '')}" placeholder="Setup / pattern name" style="width:100%;" />
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">2. In your own words, why will this trade work?</div>
        <textarea class="input" id="eq-thesis" rows="3" placeholder="Your thesis…" style="width:100%;resize:vertical;">${kbEsc(t.thesis || '')}</textarea>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">3. What would tell you this trade idea is WRONG (beyond just hitting stop)?</div>
        <textarea class="input" id="eq-invalidation" rows="2" placeholder="Invalidation scenario…" style="width:100%;resize:vertical;">${kbEsc(t.invalidation || '')}</textarea>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">4. How confident are you? 1–5</div>
        <div style="display:flex;gap:6px;" id="eq-conviction-wrap">${convChips}</div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">5. How long do you expect this to play out?</div>
        <input class="input" id="eq-timeline" value="${kbEsc(t.expected_tf || '')}" placeholder="e.g. 2-4 hours, end of week" style="width:100%;" />
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;">
      <button class="btn btn-primary btn-sm" onclick="kbSaveEntryAnswers('${kbEsc(t.id)}')">✅ Record Answers</button>
      <button class="btn btn-ghost btn-sm" onclick="kbCancelEntryQuestions()">Cancel</button>
    </div>
  </div>`;
}

let _selectedConviction = 3;
function kbSetConviction(n) {
  _selectedConviction = n;
  const wrap = document.getElementById('eq-conviction-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.chip').forEach((btn, i) => {
    btn.classList.toggle('chip-active', i + 1 === n);
  });
}

function kbCancelEntryQuestions() {
  _activeEntryId = null;
  _kbRenderActiveTab();
}

async function kbSaveEntryAnswers(tradeId) {
  const trade = _kbTrades.find(t => t.id === tradeId);
  if (!trade) return;

  const setup        = (document.getElementById('eq-setup')?.value        || '').trim();
  const thesis       = (document.getElementById('eq-thesis')?.value       || '').trim();
  const invalidation = (document.getElementById('eq-invalidation')?.value || '').trim();
  const conviction   = _selectedConviction;
  const expected_tf  = (document.getElementById('eq-timeline')?.value    || '').trim();

  const updates = { setup, thesis, invalidation, conviction, expected_tf, updated_at: Date.now() };
  const { error } = await _kbDb.from('kb_trades').update(updates).eq('id', tradeId);
  if (error) { kbToast('Save failed: ' + error.message, 'error'); return; }

  Object.assign(trade, updates);
  _activeEntryId = null;
  kbToast('Entry answers recorded');
  _kbRenderActiveTab();
}

function _openTradeCardHTML(t) {
  const dirColor   = t.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
  const entryFmt   = t.entry_price != null  ? '$' + Number(t.entry_price).toLocaleString()  : '—';
  const slFmt      = t.stop_loss   != null  ? '$' + Number(t.stop_loss).toLocaleString()    : '—';
  const tpFmt      = t.take_profit != null  ? '$' + Number(t.take_profit).toLocaleString()  : '—';
  const sizeFmt    = t.size_usd    != null  ? '$' + Number(t.size_usd).toLocaleString()     : '—';
  const dateStr    = t.created_at
    ? new Date(typeof t.created_at === 'number' ? t.created_at : Number(t.created_at)).toLocaleDateString()
    : '';
  const conv       = t.conviction || 0;
  const hasAnswers = t.thesis || t.invalidation;
  const isClosing  = _kbCloseId === t.id;

  const convDots = kbConvictionDots(conv);
  const closePanel = isClosing ? _closePanelHTML(t) : '';

  return `
  <div class="note-card" id="otcard-${kbEsc(t.id)}" style="margin-bottom:10px;">
    <div class="note-header">
      <span style="font-weight:700;font-size:15px;color:var(--text);">${kbEsc(t.coin || '—')}</span>
      <span class="mvrv-zone-badge" style="background:${dirColor}20;color:${dirColor};border:1px solid ${dirColor}40;margin-left:6px;">${kbEsc(t.direction || '')}</span>
      ${t.timeframe ? `<span style="font-size:11px;color:var(--text-muted);margin-left:6px;">${kbEsc(t.timeframe)}</span>` : ''}
      <span style="flex:1;"></span>
      <span style="font-size:11px;color:var(--text-faint);">${dateStr}</span>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);margin:6px 0;">
      <span>Entry: <b style="color:var(--text);">${entryFmt}</b></span>
      <span>SL: <b style="color:var(--red);">${slFmt}</b></span>
      <span>TP: <b style="color:var(--green);">${tpFmt}</b></span>
      <span>Size: <b style="color:var(--text);">${sizeFmt}</b></span>
    </div>
    ${t.setup   ? `<div style="font-size:12px;color:var(--text-muted);"><b>Setup:</b> ${kbEsc(t.setup)}</div>` : ''}
    ${t.thesis  ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;"><b>Thesis:</b> ${kbEsc(t.thesis.slice(0,120))}${t.thesis.length > 120 ? '…' : ''}</div>` : ''}
    ${conv ? `<div style="margin-top:6px;display:flex;align-items:center;gap:6px;"><span style="font-size:11px;color:var(--text-muted);">Conviction:</span>${convDots}</div>` : ''}
    ${!hasAnswers ? `<div style="margin-top:6px;"><span style="background:var(--yellow)20;color:var(--yellow);border:1px solid var(--yellow)40;border-radius:var(--radius-sm);font-size:11px;padding:2px 8px;cursor:pointer;" onclick="kbShowEntryQuestions('${kbEsc(t.id)}')">⚠️ Answer entry questions</span></div>` : ''}
    ${!isClosing ? `
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn btn-primary btn-sm" onclick="kbStartClose('${kbEsc(t.id)}')">Close Trade</button>
      ${!hasAnswers ? `<button class="btn btn-ghost btn-sm" onclick="kbShowEntryQuestions('${kbEsc(t.id)}')">✏️ Entry Q's</button>` : ''}
      <button class="btn btn-danger btn-sm" onclick="kbDeleteTrade('${kbEsc(t.id)}')">Delete</button>
    </div>` : ''}
    ${closePanel}
  </div>`;
}

function kbShowEntryQuestions(tradeId) {
  _activeEntryId = tradeId;
  _selectedConviction = (_kbTrades.find(t => t.id === tradeId)?.conviction) || 3;
  _kbRenderActiveTab();
  setTimeout(() => {
    const panel = document.querySelector('[style*="border-left:3px solid var(--accent)"]');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function kbStartClose(tradeId) {
  _kbCloseId = tradeId;
  _kbRenderActiveTab();
}

function _closePanelHTML(t) {
  return `
  <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:12px;">
    <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">📊 Close Trade — ${kbEsc(t.coin)} ${kbEsc(t.direction)}</div>
    <input class="input" id="kbcp-exit" type="number" placeholder="Exit Price $" style="width:100%;margin-bottom:8px;" />
    <div style="margin-bottom:8px;">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Did your thesis play out?</div>
      <div style="display:flex;gap:6px;" id="kbcp-thesis-wrap">
        <button class="chip" onclick="kbSetThesisResult('yes')" id="kbcp-yes">✅ Yes</button>
        <button class="chip" onclick="kbSetThesisResult('partly')" id="kbcp-partly">〰️ Partly</button>
        <button class="chip" onclick="kbSetThesisResult('no')" id="kbcp-no">❌ No</button>
      </div>
    </div>
    <textarea class="input" id="kbcp-review" rows="3" placeholder="What actually happened? (vs your original thesis)" style="width:100%;resize:vertical;margin-bottom:8px;"></textarea>
    <textarea class="input" id="kbcp-mistakes" rows="2" placeholder="What would you do differently?" style="width:100%;resize:vertical;margin-bottom:8px;"></textarea>
    <input class="input" id="kbcp-lesson" placeholder="One sentence lesson" style="width:100%;margin-bottom:10px;" />
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary btn-sm" onclick="kbConfirmClose('${kbEsc(t.id)}')">💾 Close &amp; Analyze</button>
      <button class="btn btn-ghost btn-sm" onclick="kbCancelClose()">Cancel</button>
    </div>
  </div>`;
}

let _thesisResult = '';
function kbSetThesisResult(val) {
  _thesisResult = val;
  ['yes','partly','no'].forEach(v => {
    const btn = document.getElementById('kbcp-' + v);
    if (btn) btn.classList.toggle('chip-active', v === val);
  });
}

function kbCancelClose() {
  _kbCloseId = null;
  _kbRenderActiveTab();
}

async function kbConfirmClose(tradeId) {
  const trade = _kbTrades.find(t => t.id === tradeId);
  if (!trade) return;

  const exitPrice = parseFloat(document.getElementById('kbcp-exit')?.value);
  if (!exitPrice) { kbToast('Exit price is required', 'error'); return; }

  const exit_review    = (document.getElementById('kbcp-review')?.value   || '').trim();
  const mistakes       = (document.getElementById('kbcp-mistakes')?.value || '').trim();
  const lessons        = (document.getElementById('kbcp-lesson')?.value   || '').trim();
  const thesis_correct = _thesisResult;

  let pnl_usd = null, pnl_pct = null;
  if (trade.entry_price && trade.size_usd) {
    pnl_usd = trade.direction === 'LONG'
      ? (exitPrice - trade.entry_price) / trade.entry_price * trade.size_usd
      : (trade.entry_price - exitPrice) / trade.entry_price * trade.size_usd;
    pnl_pct = pnl_usd / trade.size_usd * 100;
  } else if (trade.entry_price) {
    pnl_pct = trade.direction === 'LONG'
      ? (exitPrice - trade.entry_price) / trade.entry_price * 100
      : (trade.entry_price - exitPrice) / trade.entry_price * 100;
  }

  const now = Date.now();
  const updates = {
    status: 'CLOSED', exit_price: exitPrice,
    pnl_usd: pnl_usd != null ? parseFloat(pnl_usd.toFixed(4)) : null,
    pnl_pct: pnl_pct != null ? parseFloat(pnl_pct.toFixed(4)) : null,
    exit_review, mistakes, lessons, thesis_correct,
    updated_at: now
  };

  const { error } = await _kbDb.from('kb_trades').update(updates).eq('id', tradeId);
  if (error) { kbToast('Close failed: ' + error.message, 'error'); return; }

  Object.assign(trade, updates);
  _kbCloseId = null;
  _thesisResult = '';
  _kbRenderActiveTab();
  kbToast('Trade closed! Running AI analysis…', 'info');

  _analyzeTradeWithAI(trade);
}

async function _analyzeTradeWithAI(trade) {
  try {
    const resp = await fetch(_apiBase() + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'trade-analyze', trade })
    });
    const data = await resp.json();
    if (!data.assessment && !data.wiki_entry) {
      kbToast('AI analysis returned empty result', 'error');
      return;
    }

    if (data.assessment) {
      await _kbDb.from('kb_trades').update({ ai_analysis: data.assessment }).eq('id', trade.id);
      trade.ai_analysis = data.assessment;
    }

    if (data.wiki_entry) {
      const we = data.wiki_entry;
      const now = Date.now();
      const newEntry = {
        id: kbId(), created_at: now, updated_at: now,
        title:     we.title    || 'Lesson from ' + trade.coin,
        category:  we.category || 'lesson',
        summary:   we.summary  || '',
        content:   we.content  || '',
        tags:      we.tags     || [],
        coins:     we.coins    || [trade.coin],
        trade_refs: [trade.id],
        source:    'ai-trade',
        wiki_ids:  []
      };
      const { error: we_err } = await _kbDb.from('kb_wiki').insert([newEntry]);
      if (!we_err) {
        _kbWiki.unshift(newEntry);
        const wids = Array.isArray(trade.wiki_ids) ? [...trade.wiki_ids, newEntry.id] : [newEntry.id];
        trade.wiki_ids = wids;
        await _kbDb.from('kb_trades').update({ wiki_ids: wids }).eq('id', trade.id);
        kbToast('✅ Wiki lesson created: "' + newEntry.title + '"');
      } else {
        kbToast('AI analysis done (wiki save failed)', 'error');
      }
    }

    renderKBShell();
  } catch (e) {
    kbToast('AI analysis error: ' + e.message, 'error');
  }
}

function _closedTradeCardHTML(t) {
  const dirColor  = t.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
  const pnlClass  = (t.pnl_usd || 0) >= 0 ? 'pos' : 'neg';
  const pnlSign   = (t.pnl_usd || 0) >= 0 ? '+' : '-';
  const pnlAbs    = (typeof fmt$ === 'function') ? fmt$(Math.abs(t.pnl_usd || 0)) : '$' + Math.abs(t.pnl_usd || 0).toFixed(2);
  const pctStr    = t.pnl_pct != null ? ` (${t.pnl_pct >= 0 ? '+' : ''}${Number(t.pnl_pct).toFixed(2)}%)` : '';
  const entryFmt  = t.entry_price != null ? '$' + Number(t.entry_price).toLocaleString() : '—';
  const exitFmt   = t.exit_price  != null ? '$' + Number(t.exit_price).toLocaleString()  : '—';
  const dateStr   = t.created_at
    ? new Date(typeof t.created_at === 'number' ? t.created_at : Number(t.created_at)).toLocaleDateString()
    : '';

  const thesisIcon = t.thesis_correct === 'yes' ? '✅' : t.thesis_correct === 'partly' ? '〰️' : t.thesis_correct === 'no' ? '❌' : '';

  const linkedWiki = Array.isArray(t.wiki_ids) && t.wiki_ids.length
    ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">
        ${t.wiki_ids.map(wid => {
          const we = _kbWiki.find(w => w.id === wid);
          return we
            ? `<button class="chip" style="font-size:10px;padding:2px 8px;background:var(--accent)15;color:var(--accent);" onclick="kbJumpToWiki('${kbEsc(wid)}')">📖 ${kbEsc(we.title.slice(0,30))}</button>`
            : '';
        }).join('')}
      </div>`
    : '';

  const aiText = t.ai_analysis
    ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;border-left:2px solid var(--accent);padding-left:8px;">
        <span id="ai-preview-${kbEsc(t.id)}">${kbEsc(t.ai_analysis.slice(0, 150))}${t.ai_analysis.length > 150 ? '…' : ''}</span>
        ${t.ai_analysis.length > 150
          ? `<button class="btn btn-ghost btn-sm" style="margin-left:6px;" onclick="kbToggleAI('${kbEsc(t.id)}')" id="ai-toggle-${kbEsc(t.id)}">Show more</button>`
          : ''}
      </div>`
    : '';

  return `
  <div class="note-card" id="ctcard-${kbEsc(t.id)}" style="margin-bottom:10px;opacity:.92;">
    <div class="note-header">
      <span style="font-weight:700;font-size:14px;color:var(--text);">${kbEsc(t.coin || '—')}</span>
      <span class="mvrv-zone-badge" style="background:${dirColor}20;color:${dirColor};border:1px solid ${dirColor}40;margin-left:6px;">${kbEsc(t.direction || '')}</span>
      ${thesisIcon ? `<span style="margin-left:6px;font-size:13px;">${thesisIcon}</span>` : ''}
      <span style="flex:1;"></span>
      <span class="${pnlClass}" style="font-weight:600;">${pnlSign}${pnlAbs}${pctStr}</span>
      <span style="font-size:11px;color:var(--text-faint);margin-left:10px;">${dateStr}</span>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);margin:4px 0;">
      <span>Entry: <b style="color:var(--text);">${entryFmt}</b></span>
      <span>→ Exit: <b style="color:var(--text);">${exitFmt}</b></span>
      ${t.size_usd != null ? `<span>Size: <b>$${Number(t.size_usd).toLocaleString()}</b></span>` : ''}
    </div>
    ${t.exit_review ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${kbEsc(t.exit_review.slice(0,120))}${t.exit_review.length > 120 ? '…' : ''}</div>` : ''}
    ${aiText}
    ${linkedWiki}
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="btn btn-danger btn-sm" onclick="kbDeleteTrade('${kbEsc(t.id)}')">Delete</button>
    </div>
  </div>`;
}

function kbToggleAI(tradeId) {
  const trade = _kbTrades.find(t => t.id === tradeId);
  if (!trade || !trade.ai_analysis) return;
  const preview = document.getElementById('ai-preview-' + tradeId);
  const btn     = document.getElementById('ai-toggle-' + tradeId);
  if (!preview || !btn) return;
  const expanded = btn.textContent === 'Show less';
  if (expanded) {
    preview.textContent = trade.ai_analysis.slice(0, 150) + (trade.ai_analysis.length > 150 ? '…' : '');
    btn.textContent = 'Show more';
  } else {
    preview.textContent = trade.ai_analysis;
    btn.textContent = 'Show less';
  }
}

function kbJumpToWiki(wikiId) {
  _kbTab = 'wiki';
  _kbWikiFilter = 'all';
  const el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderWikiTab();
  setTimeout(() => {
    const card = document.getElementById('wcard-' + wikiId);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.style.outline = '2px solid var(--accent)';
      setTimeout(() => { card.style.outline = ''; }, 2000);
    }
  }, 100);
}

function kbToggleTradeForm() {
  const form = document.getElementById('kb-trade-form');
  const tog  = document.getElementById('kb-trade-form-toggle');
  if (!form) return;
  const hidden = form.style.display === 'none';
  form.style.display = hidden ? 'block' : 'none';
  if (tog) tog.textContent = hidden ? '▲ collapse' : '▼ expand';
}

async function kbSaveTrade() {
  const coin      = (document.getElementById('kbtf-coin')?.value      || '').trim().toUpperCase();
  const direction = document.getElementById('kbtf-direction')?.value  || 'LONG';
  const timeframe = (document.getElementById('kbtf-timeframe')?.value || '').trim();
  const entry     = parseFloat(document.getElementById('kbtf-entry')?.value)  || null;
  const sl        = parseFloat(document.getElementById('kbtf-sl')?.value)     || null;
  const tp        = parseFloat(document.getElementById('kbtf-tp')?.value)     || null;
  const size      = parseFloat(document.getElementById('kbtf-size')?.value)   || null;
  const setup     = (document.getElementById('kbtf-setup')?.value     || '').trim();

  if (!coin)  { kbToast('Coin is required', 'error'); return; }
  if (!entry) { kbToast('Entry price is required', 'error'); return; }

  const now = Date.now();
  const trade = {
    id: kbId(), created_at: now, updated_at: now,
    coin, direction, status: 'OPEN',
    entry_price: entry, exit_price: null,
    stop_loss: sl, take_profit: tp, size_usd: size,
    pnl_usd: null, pnl_pct: null,
    timeframe, setup,
    thesis: '', invalidation: '', conviction: 3, expected_tf: '',
    thesis_correct: '', exit_review: '', mistakes: '', lessons: '',
    ai_analysis: '', wiki_ids: [], tags: []
  };

  const { error } = await _kbDb.from('kb_trades').insert([trade]);
  if (error) { kbToast('Save failed: ' + error.message, 'error'); return; }

  _kbTrades.unshift(trade);
  _activeEntryId = trade.id;
  _selectedConviction = 3;
  kbToast('Trade logged! Answer entry questions below.');
  _kbRenderActiveTab();
}

async function kbDeleteTrade(id) {
  if (!confirm('Delete this trade?')) return;
  await _kbDb.from('kb_trades').delete().eq('id', id);
  _kbTrades = _kbTrades.filter(t => t.id !== id);
  _kbRenderActiveTab();
  kbToast('Trade deleted');
}

// ══════════════════════════════════════════════════════════════
//  NAVIGATION PATCH
// ══════════════════════════════════════════════════════════════
(function() {
  const _orig = window.navigate;
  if (!_orig) return;
  window.navigate = function(page) {
    _orig(page);
    if (page === 'kb') loadKB();
  };
})();
