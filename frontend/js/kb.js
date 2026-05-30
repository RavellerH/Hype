// ── Knowledge Base — Notes & Trade Journal (Supabase-backed) ─────────────────

let _kbTab    = 'notes'; // 'notes' | 'trades'
let _kbNotes  = [];
let _kbTrades = [];
let _kbFilter = '';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function initKb() {
  _renderKbShell();
  _bindKbAuth();

  const user = await sbGetUser();
  if (user) {
    await _kbLoadAll();
    _subscribeKbRealtime();
  }
}

function _bindKbAuth() {
  sbOnAuthChange(async (event) => {
    if (event === 'SIGNED_IN') {
      await _kbLoadAll();
      _subscribeKbRealtime();
    }
    if (event === 'SIGNED_OUT') {
      _kbNotes  = [];
      _kbTrades = [];
      _renderKb();
    }
  });
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function _kbLoadAll() {
  await Promise.all([_kbLoadNotes(), _kbLoadTrades()]);
  _renderKb();
}

async function _kbLoadNotes() {
  const { data, error } = await sbFrom('kb_notes')
    .select('*')
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) { console.error('[KB] notes load:', error); return; }
  _kbNotes = data || [];
}

async function _kbLoadTrades() {
  const { data, error } = await sbFrom('kb_trades')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) { console.error('[KB] trades load:', error); return; }
  _kbTrades = data || [];
}

// ── Realtime ──────────────────────────────────────────────────────────────────

let _kbChannels = [];

function _subscribeKbRealtime() {
  _kbChannels.forEach(c => c.unsubscribe());
  _kbChannels = [
    sbSubscribe('kb_notes',  _onKbNotesChange),
    sbSubscribe('kb_trades', _onKbTradesChange),
  ];
}

function _onKbNotesChange({ eventType, new: row, old }) {
  if (eventType === 'INSERT')                          _kbNotes.unshift(row);
  if (eventType === 'UPDATE')                          _kbNotes = _kbNotes.map(n => n.id === row.id ? row : n);
  if (eventType === 'DELETE' && old?.id)               _kbNotes = _kbNotes.filter(n => n.id !== old.id);
  _renderKb();
}

function _onKbTradesChange({ eventType, new: row, old }) {
  if (eventType === 'INSERT')                          _kbTrades.unshift(row);
  if (eventType === 'UPDATE')                          _kbTrades = _kbTrades.map(t => t.id === row.id ? row : t);
  if (eventType === 'DELETE' && old?.id)               _kbTrades = _kbTrades.filter(t => t.id !== old.id);
  _renderKb();
}

// ── CRUD — Notes ──────────────────────────────────────────────────────────────

async function kbSaveNote(note) {
  const user = await sbRequireAuth();
  if (!user) return;
  const now = Date.now();
  const row  = { ...note, updated_at: now };
  if (!row.id) { row.id = crypto.randomUUID(); row.created_at = now; }

  const { error } = await sbFrom('kb_notes').upsert(row);
  if (error) { alert('Save failed: ' + error.message); }
}

async function kbDeleteNote(id) {
  if (!confirm('Delete this note?')) return;
  const { error } = await sbFrom('kb_notes').delete().eq('id', id);
  if (error) alert('Delete failed: ' + error.message);
}

async function kbPinNote(id, pinned) {
  await sbFrom('kb_notes').update({ pinned: !pinned, updated_at: Date.now() }).eq('id', id);
}

// ── CRUD — Trades ─────────────────────────────────────────────────────────────

async function kbSaveTrade(trade) {
  const user = await sbRequireAuth();
  if (!user) return;
  const now = Date.now();
  const row  = { ...trade, updated_at: now };
  if (!row.id) { row.id = crypto.randomUUID(); row.created_at = now; }

  const { error } = await sbFrom('kb_trades').upsert(row);
  if (error) { alert('Save failed: ' + error.message); }
}

async function kbDeleteTrade(id) {
  if (!confirm('Delete this trade log?')) return;
  const { error } = await sbFrom('kb_trades').delete().eq('id', id);
  if (error) alert('Delete failed: ' + error.message);
}

// ── Render ────────────────────────────────────────────────────────────────────

function _renderKbShell() {
  const page = document.getElementById('page-kb');
  if (!page) return;
  page.innerHTML = `
    <div class="kb-header">
      <div class="kb-tabs">
        <button class="kb-tab active" data-kbtab="notes" onclick="_kbSwitchTab('notes')">Notes</button>
        <button class="kb-tab" data-kbtab="trades" onclick="_kbSwitchTab('trades')">Trade Log</button>
      </div>
      <div class="kb-actions">
        <input class="kb-search" id="kb-search" type="text" placeholder="Search…" oninput="_kbSearch(this.value)">
        <button class="btn btn-sm btn-primary" id="kb-add-btn" onclick="_kbOpenEditor()">+ New</button>
      </div>
    </div>
    <div id="kb-body"></div>
    ${_kbEditorHtml()}
  `;
}

function _kbSwitchTab(tab) {
  _kbTab = tab;
  document.querySelectorAll('.kb-tab').forEach(b => b.classList.toggle('active', b.dataset.kbtab === tab));
  _renderKb();
}

function _kbSearch(q) {
  _kbFilter = q.toLowerCase();
  _renderKb();
}

function _renderKb() {
  const body = document.getElementById('kb-body');
  if (!body) return;
  if (_kbTab === 'notes')  body.innerHTML = _renderNotesList();
  if (_kbTab === 'trades') body.innerHTML = _renderTradesList();
}

function _filtered(items, fields) {
  if (!_kbFilter) return items;
  return items.filter(item =>
    fields.some(f => String(item[f] || '').toLowerCase().includes(_kbFilter))
  );
}

// ── Notes list ────────────────────────────────────────────────────────────────

function _renderNotesList() {
  const items = _filtered(_kbNotes, ['title', 'content', 'tags']);
  if (!items.length) return '<p class="kb-empty">No notes yet. Click "+ New" to add one.</p>';

  return items.map(n => {
    const tags   = (n.tags || []).map(t => `<span class="kb-tag">${t}</span>`).join('');
    const coins  = (n.coins || []).map(c => `<span class="kb-coin">${c}</span>`).join('');
    const pinned = n.pinned ? '<span class="kb-pin">📌</span>' : '';
    const date   = n.updated_at ? new Date(n.updated_at).toLocaleDateString() : '';
    return `
      <div class="kb-card ${n.pinned ? 'kb-pinned' : ''}" onclick="_kbOpenEditor('${n.id}')">
        <div class="kb-card-top">
          <span class="kb-card-title">${pinned}${_esc(n.title || 'Untitled')}</span>
          <span class="kb-card-date">${date}</span>
        </div>
        ${coins || tags ? `<div class="kb-card-meta">${coins}${tags}</div>` : ''}
        <p class="kb-card-preview">${_esc((n.content || '').slice(0, 140))}</p>
        <div class="kb-card-actions" onclick="event.stopPropagation()">
          <button class="btn btn-xs" onclick="kbPinNote('${n.id}', ${n.pinned})">${n.pinned ? 'Unpin' : 'Pin'}</button>
          <button class="btn btn-xs btn-danger" onclick="kbDeleteNote('${n.id}')">Delete</button>
        </div>
      </div>`;
  }).join('');
}

// ── Trades list ───────────────────────────────────────────────────────────────

function _renderTradesList() {
  const items = _filtered(_kbTrades, ['coin', 'setup', 'thesis', 'tags']);
  if (!items.length) return '<p class="kb-empty">No trade logs yet. Click "+ New" to add one.</p>';

  return `<div class="kb-table-wrap"><table class="kb-table">
    <thead><tr>
      <th>Coin</th><th>Dir</th><th>Status</th><th>Entry</th><th>Exit</th>
      <th>PnL</th><th>Setup</th><th>Actions</th>
    </tr></thead>
    <tbody>${items.map(t => {
      const pnl    = t.pnl_usd != null ? `$${Number(t.pnl_usd).toFixed(2)}` : '—';
      const pnlCls = t.pnl_usd > 0 ? 'pos' : t.pnl_usd < 0 ? 'neg' : '';
      return `<tr onclick="_kbOpenEditor('${t.id}', 'trade')" style="cursor:pointer">
        <td><strong>${_esc(t.coin)}</strong></td>
        <td>${_esc(t.direction)}</td>
        <td><span class="kb-status-${(t.status||'').toLowerCase()}">${_esc(t.status)}</span></td>
        <td>${t.entry_price != null ? Number(t.entry_price).toFixed(4) : '—'}</td>
        <td>${t.exit_price  != null ? Number(t.exit_price).toFixed(4)  : '—'}</td>
        <td class="${pnlCls}">${pnl}</td>
        <td>${_esc(t.setup || '—')}</td>
        <td onclick="event.stopPropagation()">
          <button class="btn btn-xs btn-danger" onclick="kbDeleteTrade('${t.id}')">Del</button>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

// ── Editor modal ──────────────────────────────────────────────────────────────

let _kbEditorId   = null;
let _kbEditorType = 'note';

function _kbEditorHtml() {
  return `
  <div class="kb-editor-backdrop hidden" id="kb-editor-backdrop" onclick="_kbCloseEditor()"></div>
  <div class="kb-editor hidden" id="kb-editor">
    <div class="kb-editor-header">
      <span id="kb-editor-title">New Note</span>
      <button class="btn btn-xs" onclick="_kbCloseEditor()">✕</button>
    </div>
    <div id="kb-editor-body"></div>
    <div class="kb-editor-footer">
      <button class="btn btn-sm btn-primary" onclick="_kbEditorSave()">Save</button>
      <button class="btn btn-sm" onclick="_kbCloseEditor()">Cancel</button>
    </div>
  </div>`;
}

function _kbOpenEditor(id = null, type = null) {
  _kbEditorId   = id;
  _kbEditorType = type || _kbTab === 'trades' ? 'trade' : 'note';
  const title   = document.getElementById('kb-editor-title');
  const body    = document.getElementById('kb-editor-body');
  if (!body) return;

  if (_kbEditorType === 'trade') {
    const t = id ? _kbTrades.find(x => x.id === id) : {};
    if (title) title.textContent = id ? 'Edit Trade Log' : 'New Trade Log';
    body.innerHTML = _tradeForm(t || {});
  } else {
    const n = id ? _kbNotes.find(x => x.id === id) : {};
    if (title) title.textContent = id ? 'Edit Note' : 'New Note';
    body.innerHTML = _noteForm(n || {});
  }

  document.getElementById('kb-editor')?.classList.remove('hidden');
  document.getElementById('kb-editor-backdrop')?.classList.remove('hidden');
}

function _kbCloseEditor() {
  document.getElementById('kb-editor')?.classList.add('hidden');
  document.getElementById('kb-editor-backdrop')?.classList.add('hidden');
  _kbEditorId = null;
}

async function _kbEditorSave() {
  if (_kbEditorType === 'trade') {
    const t = _collectTradeForm();
    if (_kbEditorId) t.id = _kbEditorId;
    await kbSaveTrade(t);
  } else {
    const n = _collectNoteForm();
    if (_kbEditorId) n.id = _kbEditorId;
    await kbSaveNote(n);
  }
  _kbCloseEditor();
}

function _noteForm(n) {
  return `
    <label class="kb-label">Title
      <input class="kb-input" id="kbf-title" type="text" value="${_esc(n.title || '')}">
    </label>
    <label class="kb-label">Type
      <select class="kb-input" id="kbf-type">
        ${['note','lesson','setup','risk','macro'].map(v =>
          `<option value="${v}" ${n.type===v?'selected':''}>${v}</option>`).join('')}
      </select>
    </label>
    <label class="kb-label">Coins (comma-separated)
      <input class="kb-input" id="kbf-coins" type="text" value="${(n.coins||[]).join(', ')}">
    </label>
    <label class="kb-label">Tags (comma-separated)
      <input class="kb-input" id="kbf-tags" type="text" value="${(n.tags||[]).join(', ')}">
    </label>
    <label class="kb-label">Content
      <textarea class="kb-input kb-textarea" id="kbf-content" rows="8">${_esc(n.content||'')}</textarea>
    </label>`;
}

function _collectNoteForm() {
  return {
    title:   document.getElementById('kbf-title')?.value.trim() || 'Untitled',
    type:    document.getElementById('kbf-type')?.value || 'note',
    coins:   _splitComma(document.getElementById('kbf-coins')?.value),
    tags:    _splitComma(document.getElementById('kbf-tags')?.value),
    content: document.getElementById('kbf-content')?.value || '',
  };
}

function _tradeForm(t) {
  const dirs = ['LONG','SHORT'];
  const stati = ['OPEN','CLOSED','CANCELLED'];
  return `
    <div class="kb-form-row">
      <label class="kb-label">Coin
        <input class="kb-input" id="kbf-coin" type="text" value="${_esc(t.coin||'')}">
      </label>
      <label class="kb-label">Direction
        <select class="kb-input" id="kbf-dir">
          ${dirs.map(d=>`<option value="${d}" ${t.direction===d?'selected':''}>${d}</option>`).join('')}
        </select>
      </label>
      <label class="kb-label">Status
        <select class="kb-input" id="kbf-status">
          ${stati.map(s=>`<option value="${s}" ${t.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="kb-form-row">
      <label class="kb-label">Entry Price
        <input class="kb-input" id="kbf-entry" type="number" step="any" value="${t.entry_price??''}">
      </label>
      <label class="kb-label">Exit Price
        <input class="kb-input" id="kbf-exit" type="number" step="any" value="${t.exit_price??''}">
      </label>
      <label class="kb-label">Size (USD)
        <input class="kb-input" id="kbf-size" type="number" step="any" value="${t.size_usd??''}">
      </label>
    </div>
    <div class="kb-form-row">
      <label class="kb-label">Stop Loss
        <input class="kb-input" id="kbf-sl" type="number" step="any" value="${t.stop_loss??''}">
      </label>
      <label class="kb-label">Take Profit
        <input class="kb-input" id="kbf-tp" type="number" step="any" value="${t.take_profit??''}">
      </label>
      <label class="kb-label">PnL (USD)
        <input class="kb-input" id="kbf-pnl" type="number" step="any" value="${t.pnl_usd??''}">
      </label>
    </div>
    <label class="kb-label">Timeframe
      <input class="kb-input" id="kbf-tf" type="text" value="${_esc(t.timeframe||'')}">
    </label>
    <label class="kb-label">Setup
      <input class="kb-input" id="kbf-setup" type="text" value="${_esc(t.setup||'')}">
    </label>
    <label class="kb-label">Thesis
      <textarea class="kb-input kb-textarea" id="kbf-thesis" rows="3">${_esc(t.thesis||'')}</textarea>
    </label>
    <label class="kb-label">Mistakes
      <textarea class="kb-input kb-textarea" id="kbf-mistakes" rows="2">${_esc(t.mistakes||'')}</textarea>
    </label>
    <label class="kb-label">Lessons
      <textarea class="kb-input kb-textarea" id="kbf-lessons" rows="2">${_esc(t.lessons||'')}</textarea>
    </label>
    <label class="kb-label">Tags (comma-separated)
      <input class="kb-input" id="kbf-tags" type="text" value="${(t.tags||[]).join(', ')}">
    </label>`;
}

function _collectTradeForm() {
  const num = id => { const v = document.getElementById(id)?.value; return v === '' ? null : Number(v); };
  return {
    coin:        document.getElementById('kbf-coin')?.value.trim().toUpperCase() || '',
    direction:   document.getElementById('kbf-dir')?.value || 'LONG',
    status:      document.getElementById('kbf-status')?.value || 'OPEN',
    entry_price: num('kbf-entry'),
    exit_price:  num('kbf-exit'),
    size_usd:    num('kbf-size') ?? 0,
    stop_loss:   num('kbf-sl'),
    take_profit: num('kbf-tp'),
    pnl_usd:     num('kbf-pnl'),
    pnl_pct:     null,
    timeframe:   document.getElementById('kbf-tf')?.value.trim() || '',
    setup:       document.getElementById('kbf-setup')?.value.trim() || '',
    thesis:      document.getElementById('kbf-thesis')?.value || '',
    mistakes:    document.getElementById('kbf-mistakes')?.value || '',
    lessons:     document.getElementById('kbf-lessons')?.value || '',
    tags:        _splitComma(document.getElementById('kbf-tags')?.value),
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _splitComma(s) {
  return (s || '').split(',').map(v => v.trim()).filter(Boolean);
}
