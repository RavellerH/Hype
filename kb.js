/* ============================================================
   kb.js — Knowledge Base: Notes · Journal · Search
   ============================================================ */

'use strict';

// ── globals ──────────────────────────────────────────────────
const _KB_SUPABASE_URL  = 'https://eiqlvbylkcmgvksrxqld.supabase.co';
const _KB_SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpcWx2Ynlsa2NtZ3Zrc3J4cWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTI4NjgsImV4cCI6MjA5NDUyODg2OH0.PcGDHYlajqwnZ7c3ZPtssG534kd3sKwE8aT1ROlFpo8';

let _kbNotes  = [];
let _kbTrades = [];
let _kbLoaded = false;
let _kbTab    = 'notes';    // 'notes' | 'journal' | 'search'
let _kbNoteFilter = 'all';  // type filter

// Close-trade modal state
let _kbCloseId = null;

// ── HTML escape ──────────────────────────────────────────────
function kbEsc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Supabase client (reuse window.supabase if available) ─────
function _kbSB() {
  if (window.supabase && window.supabase.from) return window.supabase;
  if (window.supabase && window.supabase.createClient) {
    return window.supabase.createClient(_KB_SUPABASE_URL, _KB_SUPABASE_KEY);
  }
  // fallback: supabase global from CDN
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    return supabase.createClient(_KB_SUPABASE_URL, _KB_SUPABASE_KEY);
  }
  return null;
}

let _kbSBClient = null;
function kbSB() {
  if (!_kbSBClient) {
    _kbSBClient = _kbSB();
  }
  return _kbSBClient;
}

// ── ID generator ─────────────────────────────────────────────
function kbId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Load all data ─────────────────────────────────────────────
async function kbLoadData() {
  const sb = kbSB();
  if (!sb) return;
  try {
    const [nr, tr] = await Promise.all([
      sb.from('kb_notes').select('*').order('created_at', { ascending: false }),
      sb.from('kb_trades').select('*').order('created_at', { ascending: false })
    ]);
    if (nr.data) _kbNotes  = nr.data;
    if (tr.data) _kbTrades = tr.data;
  } catch(e) {
    console.warn('[KB] load error', e);
  }
}

// ── Main entry point ─────────────────────────────────────────
async function loadKB() {
  const el = document.getElementById('kb-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';

  await kbLoadData();
  _kbLoaded = true;
  kbRender();
}

// ── Top-level render ─────────────────────────────────────────
function kbRender() {
  const el = document.getElementById('kb-content');
  if (!el) return;

  el.innerHTML = [
    kbStatsHTML(),
    kbSubTabBarHTML(),
    '<div id="kb-tab-body"></div>',
    kbCloseTModalHTML()
  ].join('');

  kbRenderTab();
}

// ── Stats strip ──────────────────────────────────────────────
function kbStatsHTML() {
  const openTrades  = _kbTrades.filter(t => t.status === 'open');
  const closedTrades = _kbTrades.filter(t => t.status === 'closed');
  const wins = closedTrades.filter(t => (t.pnl_usd || 0) > 0).length;
  const winRate = closedTrades.length ? Math.round(wins / closedTrades.length * 100) : 0;
  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl_usd || 0), 0);
  const pnlClass = totalPnl >= 0 ? 'pos' : 'neg';
  const pnlStr = (typeof fmt$ === 'function') ? fmt$(Math.abs(totalPnl)) : '$' + Math.abs(totalPnl).toFixed(2);

  return `
  <div class="ai-stat-strip">
    <div class="ai-stat-cell">
      <div class="ai-stat-label">Notes</div>
      <div class="ai-stat-val">${_kbNotes.length}</div>
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
      <div class="ai-stat-val ${pnlClass}">${closedTrades.length ? (totalPnl >= 0 ? '+' : '-') + pnlStr : '—'}</div>
    </div>
  </div>`;
}

// ── Sub-tab bar ───────────────────────────────────────────────
function kbSubTabBarHTML() {
  const tabs = [
    { id: 'notes',   label: 'Notes'   },
    { id: 'journal', label: 'Journal' },
    { id: 'search',  label: 'Search'  }
  ];
  const btns = tabs.map(t =>
    `<button class="chip${_kbTab === t.id ? ' chip-active' : ''}" onclick="kbSetTab('${t.id}')">${t.label}</button>`
  ).join('');
  return `<div class="filter-bar" style="margin:12px 0 0;">${btns}</div>`;
}

function kbSetTab(tab) {
  _kbTab = tab;
  kbRender();
}

// ── Tab router ───────────────────────────────────────────────
function kbRenderTab() {
  const el = document.getElementById('kb-tab-body');
  if (!el) return;
  if (_kbTab === 'notes')   el.innerHTML = kbNotesHTML();
  if (_kbTab === 'journal') el.innerHTML = kbJournalHTML();
  if (_kbTab === 'search')  el.innerHTML = kbSearchHTML();
}

// ══════════════════════════════════════════════════════════════
//  NOTES TAB
// ══════════════════════════════════════════════════════════════

const KB_NOTE_TYPES = ['strategy','setup','thesis','reference','note'];

function kbNotesHTML() {
  // type filter chips
  const filterChips = ['all', ...KB_NOTE_TYPES].map(t =>
    `<button class="chip${_kbNoteFilter === t ? ' chip-active' : ''}" onclick="kbSetNoteFilter('${t}')">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`
  ).join('');

  // add-note form
  const form = `
  <div class="note-card note-add" id="kb-note-form-wrap">
    <div class="note-header" style="cursor:pointer;" onclick="kbToggleNoteForm()">
      <span style="font-weight:600;color:var(--accent);">+ New Note</span>
      <span id="kb-note-form-toggle" style="color:var(--text-muted);font-size:12px;">▼ expand</span>
    </div>
    <div id="kb-note-form" style="display:none;padding-top:10px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <select class="input" id="kbf-type">
          ${KB_NOTE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <input class="input" id="kbf-title" placeholder="Title" />
      </div>
      <textarea class="input note-textarea" id="kbf-content" placeholder="Content…" rows="4" style="width:100%;resize:vertical;"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <input class="input" id="kbf-coins" placeholder="Coins (BTC, ETH…)" />
        <input class="input" id="kbf-tags" placeholder="Tags (comma-sep)" />
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer;">
          <input type="checkbox" id="kbf-pinned"> Pinned
        </label>
        <button class="btn btn-primary btn-sm" onclick="kbSaveNote()">Save Note</button>
      </div>
    </div>
  </div>`;

  // filter
  const filtered = _kbNoteFilter === 'all'
    ? _kbNotes
    : _kbNotes.filter(n => n.type === _kbNoteFilter);

  // pinned first
  const sorted = [
    ...filtered.filter(n => n.pinned),
    ...filtered.filter(n => !n.pinned)
  ];

  const noteCards = sorted.length
    ? sorted.map(n => kbNoteCardHTML(n)).join('')
    : `<div class="chat-empty" style="margin-top:40px;">No notes yet. Add one above.</div>`;

  return `
  <div class="notes-wrap">
    <div class="filter-bar" style="margin-bottom:10px;">${filterChips}</div>
    ${form}
    <div class="notes-list" style="margin-top:12px;">${noteCards}</div>
  </div>`;
}

function kbNoteCardHTML(n) {
  const typeColors = {
    strategy:  'var(--accent)',
    setup:     'var(--green)',
    thesis:    'var(--yellow)',
    reference: 'var(--text-muted)',
    note:      'var(--text-faint)'
  };
  const col = typeColors[n.type] || 'var(--text-muted)';
  const coins = Array.isArray(n.coins) ? n.coins.join(', ') : (n.coins || '');
  const tags  = Array.isArray(n.tags)  ? n.tags.join(', ')  : (n.tags  || '');
  const isLong = (n.content || '').length > 280;
  const previewContent = isLong
    ? kbEsc(n.content.slice(0, 280)) + '…'
    : kbEsc(n.content || '');

  const dateStr = n.created_at
    ? new Date(typeof n.created_at === 'number' ? n.created_at : Number(n.created_at)).toLocaleDateString()
    : '';

  return `
  <div class="note-card" id="kbc-${kbEsc(n.id)}">
    <div class="note-header">
      <span class="mvrv-zone-badge" style="background:${col}20;color:${col};border:1px solid ${col}40;">${kbEsc(n.type)}</span>
      ${n.pinned ? '<span style="color:var(--yellow);font-size:13px;">📌</span>' : ''}
      <span style="font-weight:600;color:var(--text);flex:1;padding:0 8px;">${kbEsc(n.title)}</span>
      ${coins ? `<span style="font-size:11px;color:var(--text-muted);">${kbEsc(coins)}</span>` : ''}
      <span style="font-size:11px;color:var(--text-faint);margin-left:8px;">${dateStr}</span>
    </div>
    <div class="note-body" id="kbc-body-${kbEsc(n.id)}">
      <div style="white-space:pre-wrap;font-size:13px;color:var(--text-muted);">${previewContent}</div>
      ${isLong ? `<button class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="kbExpandNote('${kbEsc(n.id)}')">Show more</button>` : ''}
      ${tags ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${tags.split(',').map(t=>`<span class="chip" style="font-size:10px;padding:2px 7px;">${kbEsc(t.trim())}</span>`).join('')}</div>` : ''}
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="btn btn-ghost btn-sm" onclick="kbTogglePin('${kbEsc(n.id)}')">${n.pinned ? 'Unpin' : 'Pin'}</button>
      <button class="btn btn-danger btn-sm" onclick="kbDeleteNote('${kbEsc(n.id)}')">Delete</button>
    </div>
  </div>`;
}

function kbToggleNoteForm() {
  const form = document.getElementById('kb-note-form');
  const tog  = document.getElementById('kb-note-form-toggle');
  if (!form) return;
  const hidden = form.style.display === 'none';
  form.style.display = hidden ? 'block' : 'none';
  if (tog) tog.textContent = hidden ? '▲ collapse' : '▼ expand';
}

function kbExpandNote(id) {
  const note = _kbNotes.find(n => n.id === id);
  if (!note) return;
  const bodyEl = document.getElementById('kbc-body-' + id);
  if (!bodyEl) return;
  const tags = Array.isArray(note.tags) ? note.tags.join(', ') : (note.tags || '');
  bodyEl.innerHTML = `
    <div style="white-space:pre-wrap;font-size:13px;color:var(--text-muted);">${kbEsc(note.content)}</div>
    <button class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="kbCollapseNote('${kbEsc(id)}')">Show less</button>
    ${tags ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${tags.split(',').map(t=>`<span class="chip" style="font-size:10px;padding:2px 7px;">${kbEsc(t.trim())}</span>`).join('')}</div>` : ''}
  `;
}

function kbCollapseNote(id) {
  const note = _kbNotes.find(n => n.id === id);
  if (!note) return;
  const bodyEl = document.getElementById('kbc-body-' + id);
  if (!bodyEl) return;
  const isLong = (note.content || '').length > 280;
  const previewContent = isLong
    ? kbEsc(note.content.slice(0, 280)) + '…'
    : kbEsc(note.content || '');
  const tags = Array.isArray(note.tags) ? note.tags.join(', ') : (note.tags || '');
  bodyEl.innerHTML = `
    <div style="white-space:pre-wrap;font-size:13px;color:var(--text-muted);">${previewContent}</div>
    ${isLong ? `<button class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="kbExpandNote('${kbEsc(id)}')">Show more</button>` : ''}
    ${tags ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${tags.split(',').map(t=>`<span class="chip" style="font-size:10px;padding:2px 7px;">${kbEsc(t.trim())}</span>`).join('')}</div>` : ''}
  `;
}

function kbSetNoteFilter(f) {
  _kbNoteFilter = f;
  kbRender();
}

async function kbSaveNote() {
  const type    = document.getElementById('kbf-type')?.value || 'note';
  const title   = (document.getElementById('kbf-title')?.value || '').trim();
  const content = (document.getElementById('kbf-content')?.value || '').trim();
  const coinsRaw = (document.getElementById('kbf-coins')?.value || '').trim();
  const tagsRaw  = (document.getElementById('kbf-tags')?.value || '').trim();
  const pinned   = document.getElementById('kbf-pinned')?.checked || false;

  if (!title) { alert('Title is required.'); return; }

  const coins = coinsRaw ? coinsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const tags  = tagsRaw  ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean)  : [];
  const now   = Date.now();

  const note = {
    id: kbId(),
    created_at: now,
    updated_at: now,
    type, title, content,
    coins, tags, pinned
  };

  const sb = kbSB();
  if (sb) {
    const { error } = await sb.from('kb_notes').insert([note]);
    if (error) { console.warn('[KB] insert note error', error); alert('Save failed: ' + error.message); return; }
  }

  _kbNotes.unshift(note);
  kbRender();
}

async function kbTogglePin(id) {
  const note = _kbNotes.find(n => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  note.updated_at = Date.now();
  const sb = kbSB();
  if (sb) await sb.from('kb_notes').update({ pinned: note.pinned, updated_at: note.updated_at }).eq('id', id);
  kbRender();
}

async function kbDeleteNote(id) {
  if (!confirm('Delete this note?')) return;
  const sb = kbSB();
  if (sb) await sb.from('kb_notes').delete().eq('id', id);
  _kbNotes = _kbNotes.filter(n => n.id !== id);
  kbRender();
}

// ══════════════════════════════════════════════════════════════
//  JOURNAL TAB
// ══════════════════════════════════════════════════════════════

function kbJournalHTML() {
  const open   = _kbTrades.filter(t => t.status === 'open');
  const closed = _kbTrades.filter(t => t.status === 'closed');

  // summary
  const wins = closed.filter(t => (t.pnl_usd || 0) > 0).length;
  const winRate = closed.length ? Math.round(wins / closed.length * 100) : 0;
  const totalPnl = closed.reduce((s, t) => s + (t.pnl_usd || 0), 0);
  const pnlStr = (typeof fmt$ === 'function') ? fmt$(Math.abs(totalPnl)) : '$' + Math.abs(totalPnl).toFixed(2);
  const pnlClass = totalPnl >= 0 ? 'pos' : 'neg';

  const summaryStrip = `
  <div class="ai-stat-strip" style="margin-bottom:14px;">
    <div class="ai-stat-cell"><div class="ai-stat-label">Open</div><div class="ai-stat-val">${open.length}</div></div>
    <div class="ai-stat-cell"><div class="ai-stat-label">Win Rate</div><div class="ai-stat-val">${closed.length ? winRate + '%' : '—'}</div></div>
    <div class="ai-stat-cell"><div class="ai-stat-label">Total P&amp;L</div><div class="ai-stat-val ${pnlClass}">${closed.length ? (totalPnl >= 0 ? '+' : '-') + pnlStr : '—'}</div></div>
    <div class="ai-stat-cell"><div class="ai-stat-label">Closed</div><div class="ai-stat-val">${closed.length}</div></div>
  </div>`;

  // add trade form
  const tradeForm = `
  <div class="note-card note-add" id="kb-trade-form-wrap">
    <div class="note-header" style="cursor:pointer;" onclick="kbToggleTradeForm()">
      <span style="font-weight:600;color:var(--accent);">+ Log Trade</span>
      <span id="kb-trade-form-toggle" style="color:var(--text-muted);font-size:12px;">▼ expand</span>
    </div>
    <div id="kb-trade-form" style="display:none;padding-top:10px;">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
        <input  class="input" id="kbtf-coin"        placeholder="Coin (BTC)" />
        <select class="input" id="kbtf-direction">
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
        </select>
        <input  class="input" id="kbtf-timeframe"   placeholder="Timeframe (4H)" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
        <input class="input" id="kbtf-entry"  type="number" placeholder="Entry $" />
        <input class="input" id="kbtf-sl"     type="number" placeholder="Stop Loss $" />
        <input class="input" id="kbtf-tp"     type="number" placeholder="Take Profit $" />
        <input class="input" id="kbtf-size"   type="number" placeholder="Size USD" />
      </div>
      <input class="input" id="kbtf-setup" placeholder="Setup (e.g. breakout, VWAP reclaim…)" style="width:100%;margin-bottom:8px;" />
      <textarea class="input note-textarea" id="kbtf-thesis" placeholder="Thesis / rationale…" rows="3" style="width:100%;resize:vertical;"></textarea>
      <div style="margin-top:10px;">
        <button class="btn btn-primary btn-sm" onclick="kbSaveTrade()">Log Trade</button>
      </div>
    </div>
  </div>`;

  const openCards = open.length
    ? open.map(t => kbTradeCardHTML(t, false)).join('')
    : `<div style="color:var(--text-faint);font-size:13px;padding:8px 0;">No open trades.</div>`;

  const closedCards = closed.length
    ? closed.map(t => kbTradeCardHTML(t, true)).join('')
    : `<div style="color:var(--text-faint);font-size:13px;padding:8px 0;">No closed trades.</div>`;

  return `
  <div>
    ${summaryStrip}
    ${tradeForm}
    <div style="margin-top:16px;">
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">Open Positions</div>
      ${openCards}
    </div>
    <div style="margin-top:20px;">
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">Closed Positions</div>
      ${closedCards}
    </div>
  </div>`;
}

function kbTradeCardHTML(t, isClosed) {
  const dirColor  = t.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
  const entryFmt  = t.entry_price  != null ? '$' + Number(t.entry_price).toLocaleString()  : '—';
  const slFmt     = t.stop_loss    != null ? '$' + Number(t.stop_loss).toLocaleString()    : '—';
  const tpFmt     = t.take_profit  != null ? '$' + Number(t.take_profit).toLocaleString()  : '—';
  const sizeFmt   = t.size_usd     != null ? '$' + Number(t.size_usd).toLocaleString()     : '—';
  const dateStr   = t.created_at
    ? new Date(typeof t.created_at === 'number' ? t.created_at : Number(t.created_at)).toLocaleDateString()
    : '';

  let pnlHTML = '';
  if (isClosed && t.pnl_usd != null) {
    const pnlClass = t.pnl_usd >= 0 ? 'pos' : 'neg';
    const sign = t.pnl_usd >= 0 ? '+' : '-';
    const pnlAbs = (typeof fmt$ === 'function') ? fmt$(Math.abs(t.pnl_usd)) : '$' + Math.abs(t.pnl_usd).toFixed(2);
    const pct = t.pnl_pct != null ? ` (${t.pnl_pct >= 0 ? '+' : ''}${Number(t.pnl_pct).toFixed(2)}%)` : '';
    pnlHTML = `<span class="${pnlClass}" style="font-weight:600;">${sign}${pnlAbs}${pct}</span>`;
  }

  const exitFmt = t.exit_price != null ? '$' + Number(t.exit_price).toLocaleString() : '';

  return `
  <div class="note-card" style="margin-bottom:10px;">
    <div class="note-header">
      <span style="font-weight:700;font-size:15px;color:var(--text);">${kbEsc(t.coin || '—')}</span>
      <span class="mvrv-zone-badge" style="background:${dirColor}20;color:${dirColor};border:1px solid ${dirColor}40;margin-left:8px;">${kbEsc(t.direction || '')}</span>
      ${t.timeframe ? `<span style="font-size:11px;color:var(--text-muted);margin-left:6px;">${kbEsc(t.timeframe)}</span>` : ''}
      <span style="flex:1;"></span>
      ${isClosed ? pnlHTML : ''}
      <span style="font-size:11px;color:var(--text-faint);margin-left:10px;">${dateStr}</span>
    </div>
    <div class="note-body" style="margin-top:6px;">
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);margin-bottom:6px;">
        <span>Entry: <b style="color:var(--text);">${entryFmt}</b></span>
        <span>SL: <b style="color:var(--red);">${slFmt}</b></span>
        <span>TP: <b style="color:var(--green);">${tpFmt}</b></span>
        <span>Size: <b style="color:var(--text);">${sizeFmt}</b></span>
        ${isClosed && exitFmt ? `<span>Exit: <b style="color:var(--text);">${exitFmt}</b></span>` : ''}
      </div>
      ${t.setup   ? `<div style="font-size:12px;color:var(--text-muted);"><b>Setup:</b> ${kbEsc(t.setup)}</div>` : ''}
      ${t.thesis  ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;"><b>Thesis:</b> ${kbEsc(t.thesis)}</div>` : ''}
      ${isClosed && t.mistakes ? `<div style="font-size:12px;color:var(--red);margin-top:3px;"><b>Mistakes:</b> ${kbEsc(t.mistakes)}</div>` : ''}
      ${isClosed && t.lessons  ? `<div style="font-size:12px;color:var(--green);margin-top:3px;"><b>Lessons:</b> ${kbEsc(t.lessons)}</div>` : ''}
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;">
      ${!isClosed ? `<button class="btn btn-primary btn-sm" onclick="kbOpenCloseModal('${kbEsc(t.id)}')">Close Trade</button>` : ''}
      <button class="btn btn-danger btn-sm" onclick="kbDeleteTrade('${kbEsc(t.id)}')">Delete</button>
    </div>
  </div>`;
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
  const setup     = (document.getElementById('kbtf-setup')?.value  || '').trim();
  const thesis    = (document.getElementById('kbtf-thesis')?.value || '').trim();

  if (!coin) { alert('Coin is required.'); return; }
  if (!entry) { alert('Entry price is required.'); return; }

  const now = Date.now();
  const trade = {
    id: kbId(),
    created_at: now,
    updated_at: now,
    coin, direction, status: 'open',
    entry_price: entry,
    exit_price: null,
    stop_loss: sl,
    take_profit: tp,
    size_usd: size,
    pnl_usd: null,
    pnl_pct: null,
    timeframe, setup, thesis,
    mistakes: '', lessons: '',
    tags: []
  };

  const sb = kbSB();
  if (sb) {
    const { error } = await sb.from('kb_trades').insert([trade]);
    if (error) { console.warn('[KB] insert trade error', error); alert('Save failed: ' + error.message); return; }
  }

  _kbTrades.unshift(trade);
  kbRender();
}

async function kbDeleteTrade(id) {
  if (!confirm('Delete this trade?')) return;
  const sb = kbSB();
  if (sb) await sb.from('kb_trades').delete().eq('id', id);
  _kbTrades = _kbTrades.filter(t => t.id !== id);
  kbRender();
}

// ── Close trade modal ─────────────────────────────────────────
function kbCloseTModalHTML() {
  return `
  <div id="kb-close-modal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;" onclick="kbCloseModalBg(event)">
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;width:min(440px,90vw);">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:16px;">Close Trade</div>
      <input  class="input" id="kbct-exit"     type="number" placeholder="Exit price $" style="width:100%;margin-bottom:8px;" />
      <textarea class="input note-textarea" id="kbct-mistakes" placeholder="Mistakes made…" rows="2" style="width:100%;margin-bottom:8px;resize:vertical;"></textarea>
      <textarea class="input note-textarea" id="kbct-lessons"  placeholder="Lessons learned…" rows="2" style="width:100%;margin-bottom:12px;resize:vertical;"></textarea>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn btn-ghost btn-sm" onclick="kbCloseModalHide()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="kbConfirmClose()">Confirm Close</button>
      </div>
    </div>
  </div>`;
}

function kbOpenCloseModal(id) {
  _kbCloseId = id;
  const modal = document.getElementById('kb-close-modal');
  if (!modal) return;
  const exitEl    = document.getElementById('kbct-exit');
  const mistEl    = document.getElementById('kbct-mistakes');
  const lessEl    = document.getElementById('kbct-lessons');
  if (exitEl) exitEl.value    = '';
  if (mistEl) mistEl.value    = '';
  if (lessEl) lessEl.value    = '';
  modal.style.display = 'flex';
}

function kbCloseModalHide() {
  const modal = document.getElementById('kb-close-modal');
  if (modal) modal.style.display = 'none';
  _kbCloseId = null;
}

function kbCloseModalBg(e) {
  if (e.target === document.getElementById('kb-close-modal')) kbCloseModalHide();
}

async function kbConfirmClose() {
  if (!_kbCloseId) return;
  const trade = _kbTrades.find(t => t.id === _kbCloseId);
  if (!trade) { kbCloseModalHide(); return; }

  const exitPrice = parseFloat(document.getElementById('kbct-exit')?.value);
  const mistakes  = (document.getElementById('kbct-mistakes')?.value || '').trim();
  const lessons   = (document.getElementById('kbct-lessons')?.value  || '').trim();

  if (!exitPrice) { alert('Exit price is required.'); return; }

  // P&L calculation
  let pnl_usd = null;
  let pnl_pct = null;
  if (trade.entry_price && trade.size_usd) {
    const qty = trade.size_usd / trade.entry_price;
    if (trade.direction === 'LONG') {
      pnl_usd = (exitPrice - trade.entry_price) * qty;
    } else {
      pnl_usd = (trade.entry_price - exitPrice) * qty;
    }
    pnl_pct = (pnl_usd / trade.size_usd) * 100;
  } else if (trade.entry_price) {
    if (trade.direction === 'LONG') {
      pnl_pct = ((exitPrice - trade.entry_price) / trade.entry_price) * 100;
    } else {
      pnl_pct = ((trade.entry_price - exitPrice) / trade.entry_price) * 100;
    }
  }

  const now = Date.now();
  const updates = {
    status: 'closed',
    exit_price: exitPrice,
    pnl_usd: pnl_usd != null ? parseFloat(pnl_usd.toFixed(4)) : null,
    pnl_pct: pnl_pct != null ? parseFloat(pnl_pct.toFixed(4)) : null,
    mistakes, lessons,
    updated_at: now
  };

  const sb = kbSB();
  if (sb) {
    const { error } = await sb.from('kb_trades').update(updates).eq('id', _kbCloseId);
    if (error) { alert('Update failed: ' + error.message); return; }
  }

  Object.assign(trade, updates);
  kbCloseModalHide();
  kbRender();
}

// ══════════════════════════════════════════════════════════════
//  SEARCH TAB
// ══════════════════════════════════════════════════════════════

function kbSearchHTML() {
  return `
  <div style="padding-top:8px;">
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <input class="input" id="kb-search-input" placeholder="Search notes, trades, intel…" style="flex:1;" oninput="kbRunSearch()" />
    </div>
    <div id="kb-search-results"><div class="chat-empty">Type to search across notes, trades and intel.</div></div>
  </div>`;
}

function kbRunSearch() {
  const query = (document.getElementById('kb-search-input')?.value || '').trim().toLowerCase();
  const el = document.getElementById('kb-search-results');
  if (!el) return;
  if (!query) {
    el.innerHTML = '<div class="chat-empty">Type to search across notes, trades and intel.</div>';
    return;
  }

  const results = [];

  // search notes
  for (const n of _kbNotes) {
    const haystack = [
      n.title || '',
      n.content || '',
      Array.isArray(n.tags) ? n.tags.join(' ') : (n.tags || '')
    ].join(' ').toLowerCase();
    if (haystack.includes(query)) {
      const snippet = kbSnippet(n.content || '', query);
      results.push({
        type: 'note',
        badge: n.type || 'note',
        title: n.title || '(untitled)',
        snippet,
        ts: n.created_at || 0
      });
    }
  }

  // search trades
  for (const t of _kbTrades) {
    const haystack = [
      t.coin || '',
      t.setup || '',
      t.thesis || '',
      t.lessons || '',
      t.mistakes || ''
    ].join(' ').toLowerCase();
    if (haystack.includes(query)) {
      const snippet = kbSnippet((t.setup || '') + ' ' + (t.thesis || ''), query);
      results.push({
        type: 'trade',
        badge: (t.direction || '') + ' ' + (t.status || ''),
        title: t.coin || '—',
        snippet,
        ts: t.created_at || 0
      });
    }
  }

  // search _intelLog if defined
  if (typeof _intelLog !== 'undefined' && Array.isArray(_intelLog)) {
    for (const item of _intelLog) {
      const haystack = [
        item.source || '',
        item.raw || '',
        item.text || '',
        item.summary || ''
      ].join(' ').toLowerCase();
      if (haystack.includes(query)) {
        const snippet = kbSnippet(item.raw || item.text || item.summary || '', query);
        results.push({
          type: 'intel',
          badge: 'intel',
          title: item.source || 'Intel',
          snippet,
          ts: item.ts || item.timestamp || 0
        });
      }
    }
  }

  // sort by date desc
  results.sort((a, b) => b.ts - a.ts);

  if (!results.length) {
    el.innerHTML = '<div class="chat-empty">No results found.</div>';
    return;
  }

  const badgeColors = {
    note:      'var(--text-muted)',
    strategy:  'var(--accent)',
    setup:     'var(--green)',
    thesis:    'var(--yellow)',
    reference: 'var(--text-muted)',
    intel:     'var(--yellow)',
    trade:     'var(--text-faint)'
  };

  el.innerHTML = results.map(r => {
    const col = badgeColors[r.badge] || badgeColors[r.type] || 'var(--text-muted)';
    const dateStr = r.ts ? new Date(typeof r.ts === 'number' ? r.ts : Number(r.ts)).toLocaleDateString() : '';
    return `
    <div class="note-card" style="margin-bottom:8px;">
      <div class="note-header">
        <span class="mvrv-zone-badge" style="background:${col}20;color:${col};border:1px solid ${col}40;font-size:10px;">${kbEsc(r.badge)}</span>
        <span style="font-weight:600;color:var(--text);flex:1;padding:0 8px;">${kbEsc(r.title)}</span>
        <span style="font-size:11px;color:var(--text-faint);">${dateStr}</span>
      </div>
      ${r.snippet ? `<div class="note-body" style="font-size:12px;color:var(--text-muted);white-space:pre-wrap;">${kbEsc(r.snippet)}</div>` : ''}
    </div>`;
  }).join('');
}

function kbSnippet(text, query, radius = 120) {
  if (!text) return '';
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, radius);
  const start = Math.max(0, idx - 60);
  const end   = Math.min(text.length, idx + query.length + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
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
