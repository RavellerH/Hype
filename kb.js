/* ============================================================
   kb.js — Knowledge Base: Wiki · Journal
   ============================================================ */

'use strict';

// ── Supabase init ─────────────────────────────────────────────
const _KB_URL = 'https://eiqlvbylkcmgvksrxqld.supabase.co';
const _KB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpcWx2Ynlsa2NtZ3Zrc3J4cWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTI4NjgsImV4cCI6MjA5NDUyODg2OH0.PcGDHYlajqwnZ7c3ZPtssG534kd3sKwE8aT1ROlFpo8';
const _kbDb = window.supabase ? window.supabase.createClient(_KB_URL, _KB_KEY) : null;

// ── State ─────────────────────────────────────────────────────
let _kbTab = 'wiki';
let _kbWiki = [];
let _kbTrades = [];
let _kbWikiFilter = 'all';
let _kbLoaded = false;
let _activeEntryId = null;   // trade currently showing entry questions
let _kbCloseTradeId = null;  // trade currently showing inline close panel
let _kbLinkDropId = null;    // wiki entry showing link-trade dropdown

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

// ── ID generator ──────────────────────────────────────────────
function kbId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Toast notification ────────────────────────────────────────
function kbToast(msg, type) {
  type = type || 'success';
  const colors = {
    success: { bg: 'var(--green)', text: '#000' },
    error:   { bg: 'var(--red)',   text: '#fff' },
    info:    { bg: 'var(--accent)',text: '#fff' }
  };
  const c = colors[type] || colors.success;
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:99999',
    'background:' + c.bg,
    'color:' + c.text,
    'padding:10px 18px',
    'border-radius:var(--radius-md)',
    'font-size:13px',
    'font-weight:600',
    'box-shadow:0 4px 20px rgba(0,0,0,.4)',
    'max-width:340px',
    'pointer-events:none',
    'opacity:1',
    'transition:opacity .4s'
  ].join(';');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.style.opacity = '0'; }, 2600);
  setTimeout(function() { el.remove(); }, 3100);
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

// ── Shell render ──────────────────────────────────────────────
function renderKBShell() {
  const el = document.getElementById('kb-content');
  if (!el) return;
  if (!_kbDb) {
    el.innerHTML = '<div class="chat-empty" style="margin-top:60px;">Supabase not connected.</div>';
    return;
  }
  el.innerHTML = kbStatsHTML() + kbSubTabBarHTML() + '<div id="kb-tab-body"></div>';
  kbRenderActiveTab();
}

function kbRenderActiveTab() {
  const el = document.getElementById('kb-tab-body');
  if (!el) return;
  if (_kbTab === 'wiki')    el.innerHTML = renderWikiTab();
  if (_kbTab === 'journal') el.innerHTML = renderJournalTab();
}

// ── Stats strip ───────────────────────────────────────────────
function kbStatsHTML() {
  const closed = _kbTrades.filter(function(t) { return t.status === 'closed'; });
  const open   = _kbTrades.filter(function(t) { return t.status === 'open'; });
  const wins   = closed.filter(function(t) { return (t.pnl_usd || 0) > 0; }).length;
  const winRate = closed.length ? Math.round(wins / closed.length * 100) : 0;
  const totalPnl = closed.reduce(function(s, t) { return s + (t.pnl_usd || 0); }, 0);
  const pnlClass = totalPnl >= 0 ? 'pos' : 'neg';
  const pnlAbs = (typeof fmt$ === 'function') ? fmt$(Math.abs(totalPnl)) : '$' + Math.abs(totalPnl).toFixed(2);
  const pnlSign = totalPnl >= 0 ? '+' : '-';
  return [
    '<div class="ai-stat-strip">',
    '  <div class="ai-stat-cell"><div class="ai-stat-label">Wiki Entries</div><div class="ai-stat-val">' + _kbWiki.length + '</div></div>',
    '  <div class="ai-stat-cell"><div class="ai-stat-label">Open Trades</div><div class="ai-stat-val">' + open.length + '</div></div>',
    '  <div class="ai-stat-cell"><div class="ai-stat-label">Win Rate</div><div class="ai-stat-val">' + (closed.length ? winRate + '%' : '—') + '</div></div>',
    '  <div class="ai-stat-cell"><div class="ai-stat-label">Total P&amp;L</div><div class="ai-stat-val ' + pnlClass + '">' + (closed.length ? pnlSign + pnlAbs : '—') + '</div></div>',
    '</div>'
  ].join('');
}

// ── Sub-tab bar ────────────────────────────────────────────────
function kbSubTabBarHTML() {
  var tabs = ['wiki', 'journal'];
  var labels = { wiki: 'Wiki', journal: 'Journal' };
  return '<div class="filter-bar" style="margin:12px 0 0;">' +
    tabs.map(function(t) {
      return '<button class="chip' + (_kbTab === t ? ' chip-active' : '') +
        '" onclick="kbSetTab(\'' + t + '\')">'+labels[t]+'</button>';
    }).join('') + '</div>';
}

function kbSetTab(tab) {
  _kbTab = tab;
  _activeEntryId = null;
  _kbCloseTradeId = null;
  renderKBShell();
}

// ══════════════════════════════════════════════════════════════
//  WIKI TAB
// ══════════════════════════════════════════════════════════════

var WIKI_CATS = ['concept', 'pattern', 'rule', 'playbook', 'lesson'];
var WIKI_CAT_COLORS = {
  concept:  'var(--accent)',
  pattern:  '#a855f7',
  rule:     'var(--yellow)',
  playbook: 'var(--green)',
  lesson:   '#f97316'
};

function renderWikiTab() {
  // category filter chips
  var filterChips = ['all'].concat(WIKI_CATS).map(function(c) {
    return '<button class="chip' + (_kbWikiFilter === c ? ' chip-active' : '') +
      '" onclick="kbSetWikiFilter(\'' + c + '\')">'+c.charAt(0).toUpperCase()+c.slice(1)+'</button>';
  }).join('');

  // add form
  var form = [
    '<div class="note-card note-add" style="margin-bottom:12px;">',
    '  <div class="note-header" style="cursor:pointer;" onclick="kbToggleWikiForm()">',
    '    <span style="font-weight:600;color:var(--accent);">+ New Wiki Entry</span>',
    '    <span id="kb-wiki-form-toggle" style="color:var(--text-muted);font-size:12px;">▼ expand</span>',
    '  </div>',
    '  <div id="kb-wiki-form" style="display:' + (_kbWiki.length === 0 ? 'block' : 'none') + ';padding-top:10px;">',
    '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">',
    '      <input class="input" id="kwf-title" placeholder="Title" />',
    '      <select class="input" id="kwf-cat">' +
         WIKI_CATS.map(function(c) { return '<option value="'+c+'">'+c.charAt(0).toUpperCase()+c.slice(1)+'</option>'; }).join('') +
    '      </select>',
    '    </div>',
    '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">',
    '      <input class="input" id="kwf-coins" placeholder="Coins (BTC, ETH)" />',
    '      <input class="input" id="kwf-tags"  placeholder="Tags (comma-sep)" />',
    '    </div>',
    '    <textarea class="input note-textarea" id="kwf-content" placeholder="Content (leave blank to AI-generate)…" rows="5" style="width:100%;resize:vertical;"></textarea>',
    '    <div style="display:flex;gap:8px;margin-top:10px;">',
    '      <button class="btn btn-primary btn-sm" onclick="kbSaveWiki()">&#128221; Save</button>',
    '      <button class="btn btn-ghost btn-sm" id="kwf-ai-btn" onclick="kbWikiAIGenerate()">&#129302; AI Generate</button>',
    '      <span id="kwf-ai-status" style="font-size:12px;color:var(--text-muted);align-self:center;"></span>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('');

  // filter entries
  var filtered = _kbWikiFilter === 'all'
    ? _kbWiki
    : _kbWiki.filter(function(w) { return w.category === _kbWikiFilter; });

  var cards = filtered.length
    ? filtered.map(function(w) { return kbWikiCardHTML(w); }).join('')
    : '<div class="chat-empty" style="margin-top:40px;">No wiki entries yet.</div>';

  return [
    '<div style="padding-top:8px;">',
    '  <div class="filter-bar" style="margin-bottom:10px;">' + filterChips + '</div>',
    form,
    '<div id="kb-wiki-list">' + cards + '</div>',
    '</div>'
  ].join('');
}

function kbWikiCardHTML(w) {
  var cat = w.category || 'lesson';
  var col = WIKI_CAT_COLORS[cat] || 'var(--text-muted)';
  var coins = Array.isArray(w.coins) ? w.coins : [];
  var tags  = Array.isArray(w.tags)  ? w.tags  : [];
  var trefs = Array.isArray(w.trade_refs) ? w.trade_refs : [];
  var dateStr = w.created_at
    ? new Date(typeof w.created_at === 'number' ? w.created_at : Number(w.created_at)).toLocaleDateString()
    : '';
  var openTrades = _kbTrades.filter(function(t) { return t.status === 'open'; });

  // link-trade dropdown
  var linkDropdown = '';
  if (_kbLinkDropId === w.id) {
    var tradeOpts = _kbTrades.length
      ? _kbTrades.map(function(t) {
          var already = trefs.indexOf(t.id) !== -1;
          return '<div style="padding:6px 10px;cursor:pointer;font-size:13px;color:' + (already ? 'var(--text-faint)' : 'var(--text)') + ';" ' +
            (already ? '' : 'onclick="kbLinkTradeToWiki(\'' + kbEsc(w.id) + '\',\'' + kbEsc(t.id) + '\')"') + '>' +
            kbEsc(t.coin) + ' ' + kbEsc(t.direction) + ' ' + (already ? '(linked)' : '') +
            '</div>';
        }).join('')
      : '<div style="padding:8px 10px;font-size:12px;color:var(--text-faint);">No trades logged yet.</div>';
    linkDropdown = '<div style="position:relative;display:inline-block;">' +
      '<div style="position:absolute;top:0;left:0;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);z-index:100;min-width:200px;max-height:180px;overflow-y:auto;">' +
      tradeOpts +
      '<div style="padding:6px 10px;cursor:pointer;font-size:11px;color:var(--text-faint);border-top:1px solid var(--border);" onclick="kbCloseLinkDrop()">Cancel</div>' +
      '</div></div>';
  }

  var expandId = 'kw-body-' + w.id;
  var summary = kbEsc(w.summary || '');
  var shortContent = (w.content || '').length > 300
    ? kbEsc((w.content || '').slice(0, 300)) + '…'
    : kbEsc(w.content || '');

  return [
    '<div class="note-card" id="kw-' + kbEsc(w.id) + '" style="margin-bottom:10px;">',
    '  <div class="note-header">',
    '    <span class="mvrv-zone-badge" style="background:' + col + '20;color:' + col + ';border:1px solid ' + col + '40;">' + kbEsc(cat) + '</span>',
    (w.source && w.source !== 'manual' ? '    <span style="font-size:10px;background:var(--accent)20;color:var(--accent);border:1px solid var(--accent)40;padding:1px 6px;border-radius:4px;margin-left:4px;">AI</span>' : ''),
    '    <span style="font-weight:700;font-size:14px;color:var(--text);flex:1;padding:0 8px;">' + kbEsc(w.title) + '</span>',
    '    <span style="font-size:11px;color:var(--text-faint);">' + dateStr + '</span>',
    '  </div>',
    summary ? '  <div style="font-size:12px;color:var(--text-muted);font-style:italic;margin:4px 0;">'+summary+'</div>' : '',
    '  <div id="'+expandId+'" style="display:none;">',
    '    <div style="white-space:pre-wrap;font-size:13px;color:var(--text);margin-top:6px;line-height:1.6;">'+kbEsc(w.content||'')+'</div>',
    '  </div>',
    coins.length ? '  <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">' + coins.map(function(c){return '<span class="chip" style="font-size:10px;padding:2px 7px;background:var(--accent)15;color:var(--accent);">'+kbEsc(c)+'</span>';}).join('') + '</div>' : '',
    tags.length  ? '  <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">' + tags.map(function(t){return '<span class="chip" style="font-size:10px;padding:2px 7px;">'+kbEsc(t)+'</span>';}).join('') + '</div>' : '',
    trefs.length ? '  <div style="font-size:11px;color:var(--text-faint);margin-top:4px;">&#128211; ' + trefs.length + ' trade' + (trefs.length !== 1 ? 's' : '') + '</div>' : '',
    '  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center;">',
    '    <button class="btn btn-ghost btn-sm" onclick="kbToggleWikiExpand(\'' + kbEsc(w.id) + '\')">&#128065; Expand</button>',
    '    <button class="btn btn-ghost btn-sm" id="kw-ai-enh-' + kbEsc(w.id) + '" onclick="kbWikiAIEnhance(\'' + kbEsc(w.id) + '\')">&#129302; AI Enhance</button>',
    '    <div style="position:relative;">',
    '      <button class="btn btn-ghost btn-sm" onclick="kbToggleLinkDrop(\'' + kbEsc(w.id) + '\')">&#128279; Link Trade</button>',
    linkDropdown,
    '    </div>',
    '    <button class="btn btn-danger btn-sm" onclick="kbDeleteWiki(\'' + kbEsc(w.id) + '\')">Delete</button>',
    '  </div>',
    '</div>'
  ].join('');
}

function kbToggleWikiForm() {
  var f = document.getElementById('kb-wiki-form');
  var t = document.getElementById('kb-wiki-form-toggle');
  if (!f) return;
  var hidden = f.style.display === 'none';
  f.style.display = hidden ? 'block' : 'none';
  if (t) t.textContent = hidden ? '▲ collapse' : '▼ expand';
}

function kbToggleWikiExpand(id) {
  var el = document.getElementById('kw-body-' + id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function kbSetWikiFilter(cat) {
  _kbWikiFilter = cat;
  renderKBShell();
}

function kbToggleLinkDrop(wikiId) {
  _kbLinkDropId = _kbLinkDropId === wikiId ? null : wikiId;
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderWikiTab();
}

function kbCloseLinkDrop() {
  _kbLinkDropId = null;
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderWikiTab();
}

async function kbLinkTradeToWiki(wikiId, tradeId) {
  var entry = _kbWiki.find(function(w) { return w.id === wikiId; });
  if (!entry) return;
  var refs = Array.isArray(entry.trade_refs) ? entry.trade_refs.slice() : [];
  if (refs.indexOf(tradeId) === -1) refs.push(tradeId);
  entry.trade_refs = refs;
  if (_kbDb) await _kbDb.from('kb_wiki').update({ trade_refs: refs }).eq('id', wikiId);
  _kbLinkDropId = null;
  kbToast('Trade linked to wiki entry.');
  renderKBShell();
}

async function kbSaveWiki() {
  var title   = (document.getElementById('kwf-title')?.value   || '').trim();
  var cat     = document.getElementById('kwf-cat')?.value      || 'lesson';
  var coinsRaw= (document.getElementById('kwf-coins')?.value   || '').trim();
  var tagsRaw = (document.getElementById('kwf-tags')?.value    || '').trim();
  var content = (document.getElementById('kwf-content')?.value || '').trim();
  if (!title) { alert('Title is required.'); return; }
  var coins = coinsRaw ? coinsRaw.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
  var tags  = tagsRaw  ? tagsRaw.split(',').map(function(s){return s.trim();}).filter(Boolean)  : [];
  var now = Date.now();
  var entry = {
    id: kbId(), created_at: now, updated_at: now,
    title: title, summary: '', content: content,
    category: cat, tags: tags, coins: coins,
    trade_refs: [], source: 'manual'
  };
  if (_kbDb) {
    var res = await _kbDb.from('kb_wiki').insert([entry]);
    if (res.error) { alert('Save failed: ' + res.error.message); return; }
  }
  _kbWiki.unshift(entry);
  kbToast('Wiki entry saved.');
  renderKBShell();
}

async function kbWikiAIGenerate() {
  var title   = (document.getElementById('kwf-title')?.value   || '').trim();
  var cat     = document.getElementById('kwf-cat')?.value      || 'lesson';
  var coinsRaw= (document.getElementById('kwf-coins')?.value   || '').trim();
  var tagsRaw = (document.getElementById('kwf-tags')?.value    || '').trim();
  if (!title) { alert('Enter a title first.'); return; }
  var statusEl = document.getElementById('kwf-ai-status');
  var btnEl    = document.getElementById('kwf-ai-btn');
  if (statusEl) statusEl.textContent = 'Generating…';
  if (btnEl) btnEl.disabled = true;
  try {
    var resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'wiki-generate', title: title, category: cat, coins: coinsRaw, tags: tagsRaw })
    });
    var data = await resp.json();
    if (data.content) {
      var ta = document.getElementById('kwf-content');
      if (ta) ta.value = data.content;
    } else if (data.error) {
      kbToast('AI error: ' + data.error, 'error');
    } else {
      // structured response
      var ta2 = document.getElementById('kwf-content');
      if (ta2 && data.content) ta2.value = data.content;
      if (ta2 && !data.content && data.summary) {
        ta2.value = (data.summary ? data.summary + '\n\n' : '') + (data.content || '');
      }
    }
    if (statusEl) statusEl.textContent = 'Done!';
    setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 2000);
  } catch (e) {
    kbToast('AI generate failed.', 'error');
    if (statusEl) statusEl.textContent = '';
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

async function kbWikiAIEnhance(wikiId) {
  var entry = _kbWiki.find(function(w) { return w.id === wikiId; });
  if (!entry) return;
  var btn = document.getElementById('kw-ai-enh-' + wikiId);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enhancing…'; }
  try {
    var resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'wiki-enhance', title: entry.title, category: entry.category, content: entry.content })
    });
    var data = await resp.json();
    if (data.error) { kbToast('AI error: ' + data.error, 'error'); return; }
    var updates = { updated_at: Date.now() };
    if (data.summary) { entry.summary = data.summary; updates.summary = data.summary; }
    if (data.content) { entry.content = data.content; updates.content = data.content; }
    if (_kbDb) await _kbDb.from('kb_wiki').update(updates).eq('id', wikiId);
    kbToast('Wiki entry enhanced!');
    renderKBShell();
  } catch (e) {
    kbToast('AI enhance failed.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '\u{1F916} AI Enhance'; }
  }
}

async function kbDeleteWiki(id) {
  if (!confirm('Delete this wiki entry?')) return;
  if (_kbDb) await _kbDb.from('kb_wiki').delete().eq('id', id);
  _kbWiki = _kbWiki.filter(function(w) { return w.id !== id; });
  kbToast('Deleted.', 'info');
  renderKBShell();
}

// ══════════════════════════════════════════════════════════════
//  JOURNAL TAB
// ══════════════════════════════════════════════════════════════

function kbConvictionDots(n) {
  n = parseInt(n) || 0;
  var out = '';
  for (var i = 1; i <= 5; i++) {
    out += '<span style="color:' + (i <= n ? 'var(--accent)' : 'var(--border)') + ';font-size:14px;">' + (i <= n ? '●' : '○') + '</span>';
  }
  return out;
}

function renderJournalTab() {
  var open   = _kbTrades.filter(function(t) { return t.status === 'open'; });
  var closed = _kbTrades.filter(function(t) { return t.status === 'closed'; });
  var wins   = closed.filter(function(t) { return (t.pnl_usd || 0) > 0; }).length;
  var winRate = closed.length ? Math.round(wins / closed.length * 100) : 0;
  var totalPnl = closed.reduce(function(s, t) { return s + (t.pnl_usd || 0); }, 0);
  var pnlClass = totalPnl >= 0 ? 'pos' : 'neg';
  var pnlAbs = (typeof fmt$ === 'function') ? fmt$(Math.abs(totalPnl)) : '$' + Math.abs(totalPnl).toFixed(2);
  var pnlSign = totalPnl >= 0 ? '+' : '-';

  var summary = [
    '<div class="ai-stat-strip" style="margin-bottom:14px;">',
    '<div class="ai-stat-cell"><div class="ai-stat-label">Open</div><div class="ai-stat-val">'+open.length+'</div></div>',
    '<div class="ai-stat-cell"><div class="ai-stat-label">Closed</div><div class="ai-stat-val">'+closed.length+'</div></div>',
    '<div class="ai-stat-cell"><div class="ai-stat-label">Win Rate</div><div class="ai-stat-val">'+(closed.length ? winRate+'%' : '—')+'</div></div>',
    '<div class="ai-stat-cell"><div class="ai-stat-label">Realized P&amp;L</div><div class="ai-stat-val '+pnlClass+'">'+(closed.length ? pnlSign+pnlAbs : '—')+'</div></div>',
    '</div>'
  ].join('');

  // log trade form
  var form = [
    '<div class="note-card note-add" style="margin-bottom:16px;">',
    '  <div class="note-header" style="cursor:pointer;" onclick="kbToggleTradeForm()">',
    '    <span style="font-weight:600;color:var(--accent);">+ Log Trade</span>',
    '    <span id="kb-trade-form-toggle" style="color:var(--text-muted);font-size:12px;">▼ expand</span>',
    '  </div>',
    '  <div id="kb-trade-form" style="display:none;padding-top:10px;">',
    '    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">',
    '      <input class="input" id="kjtf-coin" placeholder="Coin (BTC)" />',
    '      <select class="input" id="kjtf-dir"><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select>',
    '      <input class="input" id="kjtf-tf"   placeholder="Timeframe (4H)" />',
    '    </div>',
    '    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">',
    '      <input class="input" id="kjtf-entry" type="number" placeholder="Entry $" />',
    '      <input class="input" id="kjtf-sl"    type="number" placeholder="Stop Loss $" />',
    '      <input class="input" id="kjtf-tp"    type="number" placeholder="Take Profit $" />',
    '      <input class="input" id="kjtf-size"  type="number" placeholder="Size USD" />',
    '    </div>',
    '    <input class="input" id="kjtf-setup" placeholder="Setup name (e.g. Breakout, Retest, Funding harvest)" style="width:100%;margin-bottom:8px;" />',
    '    <div style="margin-top:10px;">',
    '      <button class="btn btn-primary btn-sm" onclick="kbLogTrade()">&#128211; Log Trade</button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('');

  // entry questions panel
  var entryPanel = '';
  if (_activeEntryId) {
    var t = _kbTrades.find(function(t) { return t.id === _activeEntryId; });
    if (t) entryPanel = kbEntryQuestionsHTML(t);
  }

  // open positions
  var openCards = open.length
    ? open.map(function(t) { return kbOpenTradeCardHTML(t); }).join('')
    : '<div style="color:var(--text-faint);font-size:13px;padding:8px 0;">No open trades.</div>';

  // closed positions
  var closedCards = closed.length
    ? closed.map(function(t) { return kbClosedTradeCardHTML(t); }).join('')
    : '<div style="color:var(--text-faint);font-size:13px;padding:8px 0;">No closed trades.</div>';

  return [
    '<div>',
    summary,
    form,
    entryPanel,
    '<div style="margin-top:16px;">',
    '  <div style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">Open Positions</div>',
    openCards,
    '</div>',
    '<div style="margin-top:20px;">',
    '  <div style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">Closed Positions</div>',
    closedCards,
    '</div>',
    '</div>'
  ].join('');
}

function kbEntryQuestionsHTML(t) {
  var sel = t._entryConviction || t.conviction || 0;
  var convChips = [1,2,3,4,5].map(function(n) {
    var active = parseInt(sel) === n;
    return '<button class="btn btn-sm" style="min-width:36px;background:' + (active ? 'var(--accent)' : 'var(--surface2)') +
      ';color:' + (active ? '#000' : 'var(--text)') + ';border:1px solid ' + (active ? 'var(--accent)' : 'var(--border)') +
      ';" onclick="kbSetEntryConviction(' + n + ')">' + n + '</button>';
  }).join('');

  return [
    '<div style="border-left:3px solid var(--accent);padding:14px 16px;background:var(--surface2);border-radius:var(--radius-md);margin-bottom:16px;">',
    '  <div style="font-size:14px;font-weight:700;color:var(--accent);margin-bottom:12px;">&#129504; Why did you enter this trade?</div>',
    '  <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px;">1. What technical setup or signal triggered your entry?</div>',
    '  <input class="input" id="keq-setup" placeholder="e.g. Breakout above resistance, VWAP reclaim…" style="width:100%;margin-bottom:10px;" value="'+kbEsc(t.setup||'')+'" />',
    '  <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px;">2. In your own words, why will this trade work?</div>',
    '  <textarea class="input note-textarea" id="keq-thesis" rows="3" placeholder="Your thesis…" style="width:100%;resize:vertical;margin-bottom:10px;">'+kbEsc(t.thesis||'')+'</textarea>',
    '  <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px;">3. What would tell you this trade idea is WRONG (beyond just hitting stop)?</div>',
    '  <textarea class="input note-textarea" id="keq-invalidation" rows="2" placeholder="Invalidation scenario…" style="width:100%;resize:vertical;margin-bottom:10px;">'+kbEsc(t.invalidation||'')+'</textarea>',
    '  <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">4. How confident are you? (1&#8211;5)</div>',
    '  <div style="display:flex;gap:6px;margin-bottom:10px;">' + convChips + '</div>',
    '  <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px;">5. How long do you expect this to play out?</div>',
    '  <input class="input" id="keq-tf" placeholder="e.g. 2-4 hours, end of week…" style="width:100%;margin-bottom:12px;" value="'+kbEsc(t.expected_tf||'')+'" />',
    '  <button class="btn btn-primary btn-sm" onclick="kbSaveEntryAnswers()" style="width:100%;">&#9989; Record Answers</button>',
    '</div>'
  ].join('');
}

var _entryConvictionVal = 0;
function kbSetEntryConviction(n) {
  _entryConvictionVal = n;
  // Update chip appearances in-place
  if (_activeEntryId) {
    var t = _kbTrades.find(function(t) { return t.id === _activeEntryId; });
    if (t) t._entryConviction = n;
  }
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderJournalTab();
}

async function kbSaveEntryAnswers() {
  if (!_activeEntryId) return;
  var t = _kbTrades.find(function(t) { return t.id === _activeEntryId; });
  if (!t) return;
  var setup       = (document.getElementById('keq-setup')?.value       || '').trim();
  var thesis      = (document.getElementById('keq-thesis')?.value      || '').trim();
  var invalidation= (document.getElementById('keq-invalidation')?.value|| '').trim();
  var conviction  = _entryConvictionVal || t._entryConviction || 0;
  var expected_tf = (document.getElementById('keq-tf')?.value          || '').trim();
  var updates = {
    setup: setup, thesis: thesis, invalidation: invalidation,
    conviction: parseInt(conviction) || 0, expected_tf: expected_tf,
    updated_at: Date.now()
  };
  if (_kbDb) await _kbDb.from('kb_trades').update(updates).eq('id', _activeEntryId);
  Object.assign(t, updates);
  _activeEntryId = null;
  _entryConvictionVal = 0;
  kbToast('Entry answers recorded.');
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderJournalTab();
}

function kbOpenTradeCardHTML(t) {
  var dirColor = t.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
  var entry  = t.entry_price  != null ? '$' + Number(t.entry_price).toLocaleString()  : '—';
  var sl     = t.stop_loss    != null ? '$' + Number(t.stop_loss).toLocaleString()    : '—';
  var tp     = t.take_profit  != null ? '$' + Number(t.take_profit).toLocaleString()  : '—';
  var size   = t.size_usd     != null ? '$' + Number(t.size_usd).toLocaleString()     : '—';
  var dateStr= t.created_at ? new Date(typeof t.created_at==='number'?t.created_at:Number(t.created_at)).toLocaleDateString() : '';
  var hasAnswered = !!(t.thesis || t.invalidation || t.conviction);
  var unansweredBadge = !hasAnswered
    ? '<span style="background:var(--yellow)20;color:var(--yellow);border:1px solid var(--yellow)40;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;" onclick="kbShowEntryQuestions(\'' + kbEsc(t.id) + '\')">⚠️ Answer entry questions</span>'
    : '';

  // close panel or close button
  var actionArea;
  if (_kbCloseTradeId === t.id) {
    actionArea = kbClosePanelHTML(t);
  } else {
    actionArea = [
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">',
      unansweredBadge,
      '<button class="btn btn-ghost btn-sm" onclick="kbShowEntryQuestions(\'' + kbEsc(t.id) + '\')">' + (hasAnswered ? '&#9999;&#65039; Edit Entry Notes' : '&#128211; Entry Notes') + '</button>',
      '<button class="btn btn-primary btn-sm" onclick="kbShowClosePanel(\'' + kbEsc(t.id) + '\')">Close Trade</button>',
      '<button class="btn btn-danger btn-sm" onclick="kbDeleteTrade(\'' + kbEsc(t.id) + '\')">Delete</button>',
      '</div>'
    ].join('');
  }

  return [
    '<div class="note-card" id="kjt-' + kbEsc(t.id) + '" style="margin-bottom:10px;">',
    '  <div class="note-header">',
    '    <span style="font-weight:700;font-size:15px;color:var(--text);">' + kbEsc(t.coin||'—') + '</span>',
    '    <span class="mvrv-zone-badge" style="background:'+dirColor+'20;color:'+dirColor+';border:1px solid '+dirColor+'40;margin-left:6px;">' + kbEsc(t.direction||'') + '</span>',
    t.timeframe ? '    <span style="font-size:11px;color:var(--text-muted);margin-left:6px;">' + kbEsc(t.timeframe) + '</span>' : '',
    '    <span style="flex:1;"></span>',
    '    <span style="font-size:11px;color:var(--text-faint);">' + dateStr + '</span>',
    '  </div>',
    '  <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);margin-top:6px;">',
    '    <span>Entry: <b style="color:var(--text);">'+entry+'</b></span>',
    '    <span>SL: <b style="color:var(--red);">'+sl+'</b></span>',
    '    <span>TP: <b style="color:var(--green);">'+tp+'</b></span>',
    '    <span>Size: <b style="color:var(--text);">'+size+'</b></span>',
    '  </div>',
    t.setup   ? '  <div style="font-size:12px;color:var(--text-muted);margin-top:4px;"><b>Setup:</b> ' + kbEsc(t.setup) + '</div>' : '',
    t.thesis  ? '  <div style="font-size:12px;color:var(--text-muted);margin-top:2px;"><b>Thesis:</b> ' + kbEsc(t.thesis.slice(0,120)) + (t.thesis.length>120?'…':'') + '</div>' : '',
    (t.conviction > 0) ? '  <div style="margin-top:4px;">' + kbConvictionDots(t.conviction) + '</div>' : '',
    actionArea,
    '</div>'
  ].join('');
}

function kbClosePanelHTML(t) {
  var thesisChips = ['yes','partly','no'].map(function(v) {
    var labels = { yes: '✅ Yes', partly: '〰️ Partly', no: '❌ No' };
    var sel = t._closingThesisCorrect === v;
    return '<button class="btn btn-sm" style="background:' + (sel ? 'var(--accent)' : 'var(--surface2)') +
      ';color:' + (sel ? '#000' : 'var(--text)') + ';border:1px solid ' + (sel ? 'var(--accent)' : 'var(--border)') +
      ';" onclick="kbSetThesisCorrect(\'' + kbEsc(t.id) + '\',\'' + v + '\')">' + labels[v] + '</button>';
  }).join('');

  return [
    '<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:10px;">',
    '  <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px;">&#128202; Close Trade — ' + kbEsc(t.coin) + ' ' + kbEsc(t.direction) + '</div>',
    '  <input class="input" id="kjcp-exit-'+kbEsc(t.id)+'" type="number" placeholder="Exit Price $" style="width:100%;margin-bottom:8px;" />',
    '  <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Did your thesis play out?</div>',
    '  <div style="display:flex;gap:6px;margin-bottom:10px;">' + thesisChips + '</div>',
    '  <textarea class="input note-textarea" id="kjcp-review-'+kbEsc(t.id)+'" rows="3" placeholder="What actually happened? Describe vs your original thesis…" style="width:100%;resize:vertical;margin-bottom:8px;"></textarea>',
    '  <textarea class="input note-textarea" id="kjcp-mistakes-'+kbEsc(t.id)+'" rows="2" placeholder="What would you do differently?" style="width:100%;resize:vertical;margin-bottom:8px;"></textarea>',
    '  <input class="input" id="kjcp-lesson-'+kbEsc(t.id)+'" placeholder="One sentence lesson…" style="width:100%;margin-bottom:10px;" />',
    '  <div style="display:flex;gap:8px;">',
    '    <button class="btn btn-primary btn-sm" onclick="kbConfirmCloseTrade(\'' + kbEsc(t.id) + '\')" id="kjcp-submit-' + kbEsc(t.id) + '">&#128190; Close &amp; Analyze</button>',
    '    <button class="btn btn-ghost btn-sm" onclick="kbCancelClosePanel()">Cancel</button>',
    '  </div>',
    '</div>'
  ].join('');
}

function kbSetThesisCorrect(tradeId, val) {
  var t = _kbTrades.find(function(t) { return t.id === tradeId; });
  if (t) t._closingThesisCorrect = val;
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderJournalTab();
}

function kbShowClosePanel(id) {
  _kbCloseTradeId = id;
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderJournalTab();
}

function kbCancelClosePanel() {
  _kbCloseTradeId = null;
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderJournalTab();
}

function kbShowEntryQuestions(id) {
  _activeEntryId = id;
  _entryConvictionVal = 0;
  var t = _kbTrades.find(function(t) { return t.id === id; });
  if (t) t._entryConviction = t.conviction || 0;
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderJournalTab();
}

async function kbConfirmCloseTrade(id) {
  var t = _kbTrades.find(function(t) { return t.id === id; });
  if (!t) return;
  var exitPrice = parseFloat(document.getElementById('kjcp-exit-'+id)?.value);
  if (!exitPrice) { alert('Exit price is required.'); return; }
  var exitReview = (document.getElementById('kjcp-review-'+id)?.value   || '').trim();
  var mistakes   = (document.getElementById('kjcp-mistakes-'+id)?.value || '').trim();
  var lessons    = (document.getElementById('kjcp-lesson-'+id)?.value   || '').trim();
  var thesisCorrect = t._closingThesisCorrect || '';

  // P&L calc
  var pnl_usd = null, pnl_pct = null;
  if (t.entry_price && t.size_usd) {
    pnl_usd = t.direction === 'LONG'
      ? (exitPrice - t.entry_price) / t.entry_price * t.size_usd
      : (t.entry_price - exitPrice) / t.entry_price * t.size_usd;
    pnl_pct = pnl_usd / t.size_usd * 100;
  } else if (t.entry_price) {
    pnl_pct = t.direction === 'LONG'
      ? (exitPrice - t.entry_price) / t.entry_price * 100
      : (t.entry_price - exitPrice) / t.entry_price * 100;
  }

  var now = Date.now();
  var updates = {
    status: 'closed', exit_price: exitPrice,
    pnl_usd: pnl_usd != null ? parseFloat(pnl_usd.toFixed(4)) : null,
    pnl_pct: pnl_pct != null ? parseFloat(pnl_pct.toFixed(4)) : null,
    exit_review: exitReview, mistakes: mistakes, lessons: lessons,
    thesis_correct: thesisCorrect, updated_at: now
  };

  var btn = document.getElementById('kjcp-submit-'+id);
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }

  if (_kbDb) {
    var res = await _kbDb.from('kb_trades').update(updates).eq('id', id);
    if (res.error) { alert('Update failed: ' + res.error.message); if (btn) { btn.disabled=false; btn.textContent='\u{1F4BE} Close & Analyze'; } return; }
  }
  Object.assign(t, updates);
  _kbCloseTradeId = null;

  // re-render immediately
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderJournalTab();

  // async AI analysis
  kbToast('Trade closed. Running AI analysis…', 'info');
  _analyzeTradeWithAI(t);
}

async function _analyzeTradeWithAI(trade) {
  try {
    var resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'trade-analyze', trade: trade })
    });
    var data = await resp.json();
    if (data.error) { kbToast('AI analysis error: ' + data.error, 'error'); return; }

    // save AI assessment to trade
    if (data.assessment && _kbDb) {
      await _kbDb.from('kb_trades').update({ ai_analysis: data.assessment }).eq('id', trade.id);
      var local = _kbTrades.find(function(t) { return t.id === trade.id; });
      if (local) local.ai_analysis = data.assessment;
    }

    // create wiki entry from lesson
    if (data.wiki_entry) {
      var we = data.wiki_entry;
      var now = Date.now();
      var wikiEntry = {
        id: kbId(), created_at: now, updated_at: now,
        title: we.title || 'Trade Lesson',
        summary: we.summary || '',
        content: we.content || '',
        category: we.category || 'lesson',
        tags: Array.isArray(we.tags) ? we.tags : [],
        coins: Array.isArray(we.coins) ? we.coins : (trade.coin ? [trade.coin] : []),
        trade_refs: [trade.id],
        source: 'ai-trade'
      };
      if (_kbDb) {
        var wikiRes = await _kbDb.from('kb_wiki').insert([wikiEntry]);
        if (!wikiRes.error) {
          _kbWiki.unshift(wikiEntry);
          // link wiki id back to trade
          var wikiIds = Array.isArray(trade.wiki_ids) ? trade.wiki_ids.concat([wikiEntry.id]) : [wikiEntry.id];
          await _kbDb.from('kb_trades').update({ wiki_ids: wikiIds }).eq('id', trade.id);
          var lt = _kbTrades.find(function(t) { return t.id === trade.id; });
          if (lt) lt.wiki_ids = wikiIds;
        }
      } else {
        _kbWiki.unshift(wikiEntry);
      }
      kbToast('✅ Wiki lesson created: "' + wikiEntry.title + '"');
    } else {
      kbToast('AI analysis complete.');
    }

    // re-render to show AI analysis
    var el = document.getElementById('kb-tab-body');
    if (el && _kbTab === 'journal') el.innerHTML = renderJournalTab();
  } catch (e) {
    console.warn('[KB] AI analysis error', e);
    kbToast('AI analysis failed: ' + e.message, 'error');
  }
}

function kbClosedTradeCardHTML(t) {
  var dirColor = t.direction === 'LONG' ? 'var(--green)' : 'var(--red)';
  var entry = t.entry_price != null ? '$' + Number(t.entry_price).toLocaleString() : '—';
  var exit  = t.exit_price  != null ? '$' + Number(t.exit_price).toLocaleString()  : '—';
  var dateStr = t.created_at ? new Date(typeof t.created_at==='number'?t.created_at:Number(t.created_at)).toLocaleDateString() : '';

  var pnlHTML = '';
  if (t.pnl_usd != null) {
    var pnlClass = t.pnl_usd >= 0 ? 'pos' : 'neg';
    var sign = t.pnl_usd >= 0 ? '+' : '-';
    var pnlAbs = (typeof fmt$ === 'function') ? fmt$(Math.abs(t.pnl_usd)) : '$' + Math.abs(t.pnl_usd).toFixed(2);
    var pct = t.pnl_pct != null ? ' (' + (t.pnl_pct >= 0 ? '+' : '') + Number(t.pnl_pct).toFixed(2) + '%)' : '';
    pnlHTML = '<span class="'+pnlClass+'" style="font-weight:600;">' + sign + pnlAbs + pct + '</span>';
  }

  var thesisIcon = { yes: '✅', partly: '〰️', no: '❌' }[t.thesis_correct] || '';

  var aiSnippet = '';
  if (t.ai_analysis) {
    var short = t.ai_analysis.length > 150 ? t.ai_analysis.slice(0,150) + '…' : t.ai_analysis;
    aiSnippet = '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-style:italic;background:var(--bg);border-radius:var(--radius-sm);padding:6px 8px;">' +
      '<b style="color:var(--accent);">&#129302; AI:</b> ' + kbEsc(short) +
      (t.ai_analysis.length > 150 ? ' <button class="btn btn-ghost btn-sm" style="font-size:10px;" onclick="kbExpandAI(\'' + kbEsc(t.id) + '\')" id="kj-ai-'+kbEsc(t.id)+'">more</button>' : '') +
      '</div>';
  }

  // linked wiki entries
  var wikiLinks = '';
  if (Array.isArray(t.wiki_ids) && t.wiki_ids.length) {
    var items = t.wiki_ids.map(function(wid) {
      var we = _kbWiki.find(function(w) { return w.id === wid; });
      if (!we) return '';
      return '<span style="cursor:pointer;color:var(--accent);text-decoration:underline;font-size:11px;" onclick="kbGoToWiki(\'' + kbEsc(wid) + '\')">' + kbEsc(we.title) + '</span>';
    }).filter(Boolean).join(', ');
    if (items) wikiLinks = '<div style="margin-top:4px;font-size:11px;color:var(--text-muted);">&#128279; Wiki: ' + items + '</div>';
  }

  return [
    '<div class="note-card" id="kjt-' + kbEsc(t.id) + '" style="margin-bottom:8px;opacity:.9;">',
    '  <div class="note-header">',
    '    <span style="font-weight:700;font-size:14px;color:var(--text);">' + kbEsc(t.coin||'—') + '</span>',
    '    <span class="mvrv-zone-badge" style="background:'+dirColor+'20;color:'+dirColor+';border:1px solid '+dirColor+'40;margin-left:6px;font-size:10px;">' + kbEsc(t.direction||'') + '</span>',
    t.timeframe ? '    <span style="font-size:10px;color:var(--text-muted);margin-left:4px;">' + kbEsc(t.timeframe) + '</span>' : '',
    '    <span style="flex:1;"></span>',
    pnlHTML,
    thesisIcon ? '    <span style="margin-left:8px;font-size:14px;">' + thesisIcon + '</span>' : '',
    '    <span style="font-size:11px;color:var(--text-faint);margin-left:8px;">' + dateStr + '</span>',
    '  </div>',
    '  <div style="display:flex;gap:12px;font-size:12px;color:var(--text-muted);margin-top:4px;">',
    '    <span>' + entry + ' → ' + exit + '</span>',
    t.setup ? '    <span><b>Setup:</b> ' + kbEsc(t.setup) + '</span>' : '',
    '  </div>',
    aiSnippet,
    wikiLinks,
    '  <div style="display:flex;gap:8px;margin-top:6px;">',
    '    <button class="btn btn-danger btn-sm" onclick="kbDeleteTrade(\'' + kbEsc(t.id) + '\')" style="font-size:10px;">Delete</button>',
    '  </div>',
    '</div>'
  ].join('');
}

function kbExpandAI(tradeId) {
  var t = _kbTrades.find(function(t) { return t.id === tradeId; });
  if (!t || !t.ai_analysis) return;
  var container = document.getElementById('kj-ai-' + tradeId);
  if (!container) return;
  var parent = container.closest ? container.closest('div[style*="italic"]') : null;
  if (parent) parent.innerHTML = '<b style="color:var(--accent);">&#129302; AI:</b> ' + kbEsc(t.ai_analysis);
}

function kbGoToWiki(wikiId) {
  _kbTab = 'wiki';
  _kbWikiFilter = 'all';
  renderKBShell();
  // Highlight the entry by scrolling to it after render
  setTimeout(function() {
    var el = document.getElementById('kw-' + wikiId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid var(--accent)';
      setTimeout(function() { el.style.outline = ''; }, 2000);
    }
  }, 100);
}

function kbToggleTradeForm() {
  var f = document.getElementById('kb-trade-form');
  var t = document.getElementById('kb-trade-form-toggle');
  if (!f) return;
  var hidden = f.style.display === 'none';
  f.style.display = hidden ? 'block' : 'none';
  if (t) t.textContent = hidden ? '▲ collapse' : '▼ expand';
}

async function kbLogTrade() {
  var coin      = (document.getElementById('kjtf-coin')?.value || '').trim().toUpperCase();
  var direction = document.getElementById('kjtf-dir')?.value  || 'LONG';
  var timeframe = (document.getElementById('kjtf-tf')?.value  || '').trim();
  var entry     = parseFloat(document.getElementById('kjtf-entry')?.value) || null;
  var sl        = parseFloat(document.getElementById('kjtf-sl')?.value)    || null;
  var tp        = parseFloat(document.getElementById('kjtf-tp')?.value)    || null;
  var size      = parseFloat(document.getElementById('kjtf-size')?.value)  || null;
  var setup     = (document.getElementById('kjtf-setup')?.value || '').trim();
  if (!coin)  { alert('Coin is required.'); return; }
  if (!entry) { alert('Entry price is required.'); return; }
  var now = Date.now();
  var trade = {
    id: kbId(), created_at: now, updated_at: now,
    coin: coin, direction: direction, status: 'open',
    entry_price: entry, exit_price: null,
    stop_loss: sl, take_profit: tp, size_usd: size,
    pnl_usd: null, pnl_pct: null,
    timeframe: timeframe, setup: setup,
    thesis: '', invalidation: '', conviction: 0, expected_tf: '',
    thesis_correct: '', exit_review: '', ai_analysis: '',
    mistakes: '', lessons: '', tags: [], wiki_ids: []
  };
  if (_kbDb) {
    var res = await _kbDb.from('kb_trades').insert([trade]);
    if (res.error) { alert('Save failed: ' + res.error.message); return; }
  }
  _kbTrades.unshift(trade);
  _activeEntryId = trade.id;
  _entryConvictionVal = 0;
  trade._entryConviction = 0;
  kbToast('Trade logged. Answer the entry questions below.');
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderJournalTab();
}

async function kbDeleteTrade(id) {
  if (!confirm('Delete this trade?')) return;
  if (_kbDb) await _kbDb.from('kb_trades').delete().eq('id', id);
  _kbTrades = _kbTrades.filter(function(t) { return t.id !== id; });
  if (_kbCloseTradeId === id) _kbCloseTradeId = null;
  if (_activeEntryId  === id) _activeEntryId  = null;
  kbToast('Trade deleted.', 'info');
  var el = document.getElementById('kb-tab-body');
  if (el) el.innerHTML = renderJournalTab();
}

// ══════════════════════════════════════════════════════════════
//  NAVIGATION PATCH
// ══════════════════════════════════════════════════════════════
(function() {
  var _orig = window.navigate;
  if (!_orig) return;
  window.navigate = function(page) {
    _orig(page);
    if (page === 'kb') loadKB();
  };
})();
