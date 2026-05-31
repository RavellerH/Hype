// ── Trade Journal — Supabase-backed ───────────────────────────────────────────
//
// Run this SQL in your Supabase project to create the required table:
//
// create table hype_journal (
//   id text primary key default gen_random_uuid()::text,
//   ts bigint not null,
//   coin text not null,
//   side text not null,      -- 'long' | 'short'
//   entry_px numeric,
//   exit_px numeric,
//   size_usd numeric,
//   leverage integer default 1,
//   pnl numeric,
//   setup text,              -- 'SIGNAL' | 'REVERSAL' | 'TREND' | 'MANUAL'
//   notes text,
//   created_at timestamptz default now()
// );

const _J_TTL = 2 * 60 * 1000;
let _jTs = 0;
window._journalData = [];

// ── Entry point ───────────────────────────────────────────────────────────────

async function loadJournal() {
  const el = document.getElementById('journal-content');
  if (!el) return;

  const url = localStorage.getItem('hype_sb_url') || '';
  const key = localStorage.getItem('hype_sb_anon') || '';

  if (!url || !key) {
    el.innerHTML = _jSetupPanel();
    return;
  }

  if (_jTs && Date.now() - _jTs < _J_TTL && window._journalData.length >= 0) {
    _jRender(window._journalData);
    return;
  }

  el.innerHTML = loading();

  try {
    window._journalData = await _jFetch(url, key);
    _jTs = Date.now();
    _jRender(window._journalData);
  } catch (e) {
    el.innerHTML = `<div style="padding:20px;color:var(--red);font-size:13px">Failed to load journal: ${_jEsc(e.message)}</div>` + _jSettingsSection(url, key);
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function _jFetch(url, key) {
  const endpoint = url.replace(/\/$/, '') + '/rest/v1/hype_journal?order=ts.desc&limit=100';
  const resp = await fetch(endpoint, {
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
    }
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => resp.statusText);
    throw new Error('Supabase ' + resp.status + ': ' + txt);
  }
  return resp.json();
}

// ── Render ────────────────────────────────────────────────────────────────────

function _jRender(entries) {
  const el = document.getElementById('journal-content');
  if (!el) return;

  const url = localStorage.getItem('hype_sb_url') || '';
  const key = localStorage.getItem('hype_sb_anon') || '';

  // Stats
  const withPnl = entries.filter(e => e.pnl != null);
  const totalPnl = withPnl.reduce((s, e) => s + parseFloat(e.pnl), 0);
  const wins = withPnl.filter(e => parseFloat(e.pnl) > 0);
  const winRate = withPnl.length > 0 ? (wins.length / withPnl.length * 100).toFixed(1) : '0.0';
  const avgPnl = withPnl.length > 0 ? totalPnl / withPnl.length : 0;

  el.innerHTML = `
<div style="padding:12px 16px;max-width:900px">

  <!-- Stats header -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px" id="j-stat-grid">
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:4px">Total P&L</div>
      <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:${totalPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${_jFmtPnl(totalPnl)}</div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:4px">Win Rate</div>
      <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--text)">${winRate}%</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${wins.length}W / ${withPnl.length - wins.length}L</div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:4px">Total Trades</div>
      <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--text)">${entries.length}</div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:4px">Avg P&L / Trade</div>
      <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:${avgPnl >= 0 ? 'var(--green)' : 'var(--red)'}">${_jFmtPnl(avgPnl)}</div>
    </div>
  </div>

  <!-- Add Trade button -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button onclick="document.getElementById('j-add-form').style.display=document.getElementById('j-add-form').style.display==='none'?'block':'none'"
      style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:6px 14px;color:var(--text);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">
      + Add Trade
    </button>
  </div>

  <!-- Add Trade form -->
  <div id="j-add-form" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;margin-bottom:16px">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:12px">New Trade</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
      <div>
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);display:block;margin-bottom:3px">Coin</label>
        <input id="j-coin" type="text" placeholder="BTC" style="${_jInputStyle()}">
      </div>
      <div>
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);display:block;margin-bottom:3px">Side</label>
        <select id="j-side" style="${_jInputStyle()}">
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
      </div>
      <div>
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);display:block;margin-bottom:3px">Entry Price</label>
        <input id="j-entry-px" type="number" step="any" placeholder="0.00" style="${_jInputStyle()}">
      </div>
      <div>
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);display:block;margin-bottom:3px">Exit Price</label>
        <input id="j-exit-px" type="number" step="any" placeholder="0.00" style="${_jInputStyle()}">
      </div>
      <div>
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);display:block;margin-bottom:3px">Size (USD)</label>
        <input id="j-size" type="number" step="any" placeholder="1000" style="${_jInputStyle()}">
      </div>
      <div>
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);display:block;margin-bottom:3px">Leverage</label>
        <input id="j-leverage" type="number" step="1" min="1" value="1" style="${_jInputStyle()}">
      </div>
      <div>
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);display:block;margin-bottom:3px">Setup</label>
        <select id="j-setup" style="${_jInputStyle()}">
          <option value="SIGNAL">SIGNAL</option>
          <option value="REVERSAL">REVERSAL</option>
          <option value="TREND">TREND</option>
          <option value="MANUAL">MANUAL</option>
        </select>
      </div>
    </div>
    <div style="margin-top:10px">
      <label style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);display:block;margin-bottom:3px">Notes</label>
      <textarea id="j-notes" rows="2" placeholder="Trade rationale, observations…"
        style="${_jInputStyle()}resize:vertical;width:100%;min-height:52px"></textarea>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
      <button onclick="_jAddTrade('${_jEsc(url)}','${_jEsc(key)}')"
        style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:7px 18px;color:var(--text);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">
        Save Trade
      </button>
      <span id="j-form-msg" style="font-size:12px;color:var(--text-muted)"></span>
    </div>
  </div>

  <!-- Filter row -->
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    <input id="j-filter-coin" type="text" placeholder="Filter coin…" oninput="_jApplyFilters()"
      style="${_jInputStyle()}width:120px">
    <select id="j-filter-setup" onchange="_jApplyFilters()" style="${_jInputStyle()}width:130px">
      <option value="">All setups</option>
      <option value="SIGNAL">SIGNAL</option>
      <option value="REVERSAL">REVERSAL</option>
      <option value="TREND">TREND</option>
      <option value="MANUAL">MANUAL</option>
    </select>
    <span id="j-result-count" style="font-size:11px;color:var(--text-muted)"></span>
  </div>

  <!-- Table -->
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:16px">
    <div style="overflow-x:auto">
      <table id="j-table" style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="${_jThStyle()}">Date</th>
            <th style="${_jThStyle()}">Coin</th>
            <th style="${_jThStyle()}">Side</th>
            <th style="${_jThStyle()}text-align:right">Entry</th>
            <th style="${_jThStyle()}text-align:right">Exit</th>
            <th style="${_jThStyle()}text-align:right">P&L</th>
            <th style="${_jThStyle()}">Setup</th>
            <th style="${_jThStyle()}">Notes</th>
          </tr>
        </thead>
        <tbody id="j-tbody">
        </tbody>
      </table>
    </div>
  </div>

  ${_jSettingsSection(url, key)}

</div>

<style>
#j-stat-grid { }
@media(max-width:600px){ #j-stat-grid{ grid-template-columns:repeat(2,1fr) } }
@media(max-width:360px){ #j-stat-grid{ grid-template-columns:1fr } }
.j-row-notes { display:none;background:var(--surface2);padding:8px 12px;font-size:12px;color:var(--text-muted);border-top:1px solid var(--border) }
.j-row-notes.open { display:block }
</style>`;

  _jApplyFilters();
}

// ── Filter + table render ─────────────────────────────────────────────────────

function _jApplyFilters() {
  const coin  = (document.getElementById('j-filter-coin')?.value || '').trim().toUpperCase();
  const setup = document.getElementById('j-filter-setup')?.value || '';
  const tbody = document.getElementById('j-tbody');
  const counter = document.getElementById('j-result-count');
  if (!tbody) return;

  const all = window._journalData || [];
  const filtered = all.filter(e => {
    if (coin  && !(e.coin || '').toUpperCase().includes(coin)) return false;
    if (setup && e.setup !== setup) return false;
    return true;
  });

  if (counter) counter.textContent = filtered.length + ' trade' + (filtered.length !== 1 ? 's' : '');

  tbody.innerHTML = filtered.map((e, i) => {
    const pnl      = e.pnl != null ? parseFloat(e.pnl) : null;
    const entryFmt = e.entry_px != null ? '$' + Number(e.entry_px).toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:6}) : '—';
    const exitFmt  = e.exit_px  != null ? '$' + Number(e.exit_px).toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:6}) : '—';
    const isLong   = (e.side || '').toLowerCase() === 'long';
    const hasNotes = e.notes && e.notes.trim();
    const rowId    = 'j-notes-' + i;

    return `<tr style="border-bottom:1px solid var(--border);cursor:${hasNotes ? 'pointer' : 'default'}"
        ${hasNotes ? `onclick="var n=document.getElementById('${rowId}');n.classList.toggle('open')"` : ''}>
      <td style="${_jTdStyle()}font-size:11px;color:var(--text-muted);white-space:nowrap">${_jFmtDate(e.ts)}</td>
      <td style="${_jTdStyle()}font-weight:600;color:var(--text)">${_jEsc(e.coin || '—')}</td>
      <td style="${_jTdStyle()}">
        <span style="font-size:11px;font-weight:700;color:${isLong ? 'var(--green)' : 'var(--red)'}">
          ${isLong ? '▲' : '▼'} ${(e.side || '').toUpperCase()}
        </span>
      </td>
      <td style="${_jTdStyle()}text-align:right;font-family:var(--mono);font-size:12px">${entryFmt}</td>
      <td style="${_jTdStyle()}text-align:right;font-family:var(--mono);font-size:12px">${exitFmt}</td>
      <td style="${_jTdStyle()}text-align:right;font-family:var(--mono);font-size:12px">${pnl != null ? _jFmtPnl(pnl) : '—'}</td>
      <td style="${_jTdStyle()}">
        ${e.setup ? `<span style="font-size:10px;font-weight:700;letter-spacing:.05em;padding:2px 7px;border-radius:var(--radius-pill);background:var(--surface2);color:var(--text-muted)">${_jEsc(e.setup)}</span>` : '—'}
      </td>
      <td style="${_jTdStyle()}font-size:11px;color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${hasNotes ? _jEsc(e.notes.trim().slice(0, 60)) + (e.notes.length > 60 ? '…' : '') : ''}
      </td>
    </tr>
    ${hasNotes ? `<tr><td colspan="8" style="padding:0"><div id="${rowId}" class="j-row-notes">${_jEsc(e.notes.trim())}</div></td></tr>` : ''}`;
  }).join('');

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">No trades yet</td></tr>`;
  }
}

// ── Add trade ─────────────────────────────────────────────────────────────────

async function _jAddTrade(url, key) {
  const msg = document.getElementById('j-form-msg');
  if (msg) msg.textContent = 'Saving…';

  const coin     = (document.getElementById('j-coin')?.value || '').trim().toUpperCase();
  const side     = document.getElementById('j-side')?.value || 'long';
  const entryPx  = parseFloat(document.getElementById('j-entry-px')?.value || '0') || null;
  const exitPx   = parseFloat(document.getElementById('j-exit-px')?.value  || '0') || null;
  const sizeUsd  = parseFloat(document.getElementById('j-size')?.value     || '0') || null;
  const leverage = parseInt(document.getElementById('j-leverage')?.value   || '1', 10) || 1;
  const setup    = document.getElementById('j-setup')?.value  || 'MANUAL';
  const notes    = (document.getElementById('j-notes')?.value || '').trim();

  if (!coin) {
    if (msg) msg.textContent = 'Coin is required.';
    return;
  }

  // Auto-calculate PnL
  let pnl = null;
  if (entryPx && exitPx && sizeUsd && entryPx !== 0) {
    if (side === 'long') {
      pnl = (exitPx - entryPx) / entryPx * sizeUsd * leverage;
    } else {
      pnl = (entryPx - exitPx) / entryPx * sizeUsd * leverage;
    }
    pnl = parseFloat(pnl.toFixed(4));
  }

  const now = Date.now();
  const body = {
    id:       now.toString(),
    ts:       now,
    coin,
    side,
    entry_px: entryPx,
    exit_px:  exitPx,
    size_usd: sizeUsd,
    leverage,
    pnl,
    setup,
    notes:    notes || null,
  };

  try {
    const endpoint = url.replace(/\/$/, '') + '/rest/v1/hype_journal';
    const resp = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'apikey':        key,
        'Authorization': 'Bearer ' + key,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => resp.statusText);
      throw new Error('Supabase ' + resp.status + ': ' + txt);
    }

    // Clear form
    ['j-coin','j-entry-px','j-exit-px','j-size','j-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const lev = document.getElementById('j-leverage');
    if (lev) lev.value = '1';

    // Reset cache & reload
    _jTs = 0;
    if (msg) msg.textContent = 'Saved!';
    setTimeout(() => { if (msg) msg.textContent = ''; }, 2000);
    loadJournal();
  } catch (e) {
    if (msg) msg.textContent = 'Error: ' + e.message;
  }
}

// ── Setup panel (no credentials) ─────────────────────────────────────────────

function _jSetupPanel() {
  return `
<div style="padding:32px 20px;max-width:460px;margin:0 auto">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px">
    <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">Connect Supabase</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:18px;line-height:1.6">
      Your trade journal is stored in a Supabase table. Enter your project URL and anon key below to get started.
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div>
        <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);display:block;margin-bottom:4px">Supabase Project URL</label>
        <input id="j-setup-url" type="text" placeholder="https://xyz.supabase.co"
          style="${_jInputStyle()}width:100%">
      </div>
      <div>
        <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);display:block;margin-bottom:4px">Anon Key</label>
        <input id="j-setup-key" type="password" placeholder="eyJhbGciOiJIUzI1Ni…"
          style="${_jInputStyle()}width:100%">
        <div style="font-size:10px;color:var(--text-faint);margin-top:4px">The anon key is safe to use in the browser — it is read-only by default.</div>
      </div>
      <button onclick="_jSaveKeys()"
        style="background:var(--surface2);border:1px solid var(--border-strong);border-radius:var(--radius-md);padding:8px 20px;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font);margin-top:4px">
        Save &amp; Connect
      </button>
      <span id="j-setup-msg" style="font-size:12px;color:var(--text-muted)"></span>
    </div>
  </div>
</div>`;
}

// ── Settings section (shown at bottom of main view) ───────────────────────────

function _jSettingsSection(url, key) {
  return `
<div style="margin-bottom:8px">
  <details>
    <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-muted);padding:6px 0;list-style:none;display:flex;align-items:center;gap:6px">
      <span style="font-size:11px">&#9660;</span> Supabase Settings
    </summary>
    <div style="padding:12px 0;display:flex;flex-direction:column;gap:12px">
      <div>
        <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);display:block;margin-bottom:4px">Supabase Project URL</label>
        <div style="display:flex;gap:8px">
          <input id="j-settings-url" type="text" value="${_jEsc(url)}" placeholder="https://xyz.supabase.co"
            style="flex:1;${_jInputStyle()}">
          <button onclick="_jSaveKeys()" style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:7px 14px;color:var(--text);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font);white-space:nowrap">Save</button>
        </div>
      </div>
      <div>
        <label style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);display:block;margin-bottom:4px">Anon Key</label>
        <div style="display:flex;gap:8px">
          <input id="j-settings-key" type="password" value="${_jEsc(key)}" placeholder="eyJhbGciOiJIUzI1Ni…"
            style="flex:1;${_jInputStyle()}">
        </div>
        <div style="font-size:10px;color:var(--text-faint);margin-top:4px">Anon key is safe to use in browser — read-only by default.</div>
      </div>
    </div>
  </details>
</div>
<style>
details > summary::-webkit-details-marker { display:none }
</style>`;
}

// ── Save credentials ──────────────────────────────────────────────────────────

function _jSaveKeys() {
  // Support both setup panel IDs and settings section IDs
  const urlEl = document.getElementById('j-setup-url') || document.getElementById('j-settings-url');
  const keyEl = document.getElementById('j-setup-key') || document.getElementById('j-settings-key');

  const url = (urlEl?.value || '').trim();
  const key = (keyEl?.value || '').trim();

  if (url) localStorage.setItem('hype_sb_url', url);
  else localStorage.removeItem('hype_sb_url');

  if (key) localStorage.setItem('hype_sb_anon', key);
  else localStorage.removeItem('hype_sb_anon');

  const msg = document.getElementById('j-setup-msg');
  if (msg) { msg.textContent = 'Saved! Loading…'; }

  _jTs = 0;
  loadJournal();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _jEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _jFmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'number' ? ts : Number(ts));
  if (isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _jFmtPnl(n) {
  if (n == null || isNaN(n)) return '—';
  const color = n >= 0 ? 'var(--green)' : 'var(--red)';
  const sign  = n >= 0 ? '+' : '';
  const abs   = Math.abs(n);
  let formatted;
  if (abs >= 1e6)     formatted = '$' + (abs / 1e6).toFixed(2) + 'M';
  else if (abs >= 1e3) formatted = '$' + (abs / 1e3).toFixed(1) + 'K';
  else                 formatted = '$' + abs.toFixed(2);
  return `<span style="color:${color}">${sign}${formatted}</span>`;
}

function _jInputStyle() {
  return 'background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:7px 10px;color:var(--text);font-size:12px;font-family:var(--mono);outline:none;';
}

function _jThStyle() {
  return 'padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);white-space:nowrap;text-align:left;';
}

function _jTdStyle() {
  return 'padding:9px 10px;vertical-align:middle;';
}
