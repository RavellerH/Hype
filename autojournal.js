// ── Auto-Journal Engine ───────────────────────────────────────────────────────
// Detects newly closed trades, creates enriched entries, generates AI lessons.
// Storage: localStorage (primary) + Supabase (when configured, same keys as Logger).

const AJ_KEY       = 'hype_autojournal_v1';
const AJ_SNAP_KEY  = 'hype_snapshots_v1';
const AJ_PAT_KEY   = 'hype_gh_pat';
const AJ_GIST_KEY  = 'hype_gh_gist_id';

const AJ_TAGS = ['Textbook', 'Disciplined', 'FOMO', 'Tilted'];
const AJ_TAG_STYLE = {
  Textbook:    { bg: 'rgba(74,222,128,0.15)',  fg: '#4ade80', border: 'rgba(74,222,128,0.35)' },
  Disciplined: { bg: 'rgba(56,189,248,0.15)',  fg: '#38bdf8', border: 'rgba(56,189,248,0.35)' },
  FOMO:        { bg: 'rgba(251,191,36,0.15)',  fg: '#fbbf24', border: 'rgba(251,191,36,0.35)' },
  Tilted:      { bg: 'rgba(248,113,113,0.15)', fg: '#f87171', border: 'rgba(248,113,113,0.35)' },
};

// ── Persistence ───────────────────────────────────────────────────────────────

function _ajLoad() {
  try {
    return JSON.parse(localStorage.getItem(AJ_KEY) || '{}');
  } catch { return {}; }
}

function _ajState() {
  const d = _ajLoad();
  return { entries: d.entries || [], last_check_ts: d.last_check_ts || 0, weekly_review: d.weekly_review || null };
}

function _ajSave(state) {
  try { localStorage.setItem(AJ_KEY, JSON.stringify(state)); } catch {}
}

function _ajLoadSnaps() {
  try { return JSON.parse(localStorage.getItem(AJ_SNAP_KEY) || '[]'); } catch { return []; }
}

function _ajSaveSnaps(snaps) {
  try { localStorage.setItem(AJ_SNAP_KEY, JSON.stringify(snaps.slice(-120))); } catch {} // keep 120 days
}

// ── Trade detection ───────────────────────────────────────────────────────────

function _ajId(t) { return `${t.coin}-${t.entry_time}`; }

async function journalAutoCheck() {
  if (!currentWallet) return;
  try {
    const rawFills = await getUserFills(currentWallet);
    const trades   = buildTrades(rawFills);
    const closed   = trades.filter(t => t.closed);

    const state   = _ajState();
    const knownIds = new Set(state.entries.map(e => e.id));
    const fresh    = closed.filter(t => !knownIds.has(_ajId(t)));

    if (fresh.length === 0) {
      state.last_check_ts = Date.now();
      _ajSave(state);
      return;
    }

    for (const t of fresh) {
      const entry = {
        id:         _ajId(t),
        coin:       t.coin,
        side:       t.side,
        entry_time: t.entry_time,
        exit_time:  t.exit_time,
        pnl:        t.pnl,
        fees:       t.fees,
        net_pnl:    t.net_pnl,
        hold_ms:    t.hold_ms,
        tag:        null,
        notes:      '',
        lesson:     null,
        created_at: Date.now(),
        source:     'auto',
      };
      state.entries.unshift(entry);

      // Non-blocking AI lesson
      _ajRequestLesson(entry, state);
    }

    state.last_check_ts = Date.now();
    _ajSave(state);
    _ajSyncSupabase(fresh.map(t => state.entries.find(e => e.id === _ajId(t))).filter(Boolean));

    if (currentPage === 'journal') loadJournal();
  } catch (e) {
    console.warn('[AutoJournal] check failed:', e.message);
  }
}

// ── Daily snapshot ────────────────────────────────────────────────────────────

async function journalDailySnapshot() {
  if (!currentWallet) return;
  const today = new Date().toISOString().slice(0, 10);
  const snaps = _ajLoadSnaps();
  if (snaps.some(s => s.date === today && s.type === 'daily')) return;

  try {
    const [state] = await Promise.all([getClearinghouseState(currentWallet)]);
    const positions    = parsePositions(state);
    const accountValue = parseFloat(state.marginSummary?.accountValue || 0);
    const unrealPnl    = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);

    snaps.push({
      type:           'daily',
      date:           today,
      ts:             Date.now(),
      account_value:  accountValue,
      unrealized_pnl: unrealPnl,
      open_positions: positions.length,
      positions:      positions.slice(0, 10).map(p => ({
        coin: p.coin,
        side: parseFloat(p.szi || 0) > 0 ? 'long' : 'short',
        pnl:  p.unrealizedPnl,
      })),
    });
    _ajSaveSnaps(snaps);
  } catch (e) {
    console.warn('[AutoJournal] snapshot failed:', e.message);
  }
}

function _ajScheduleDaily() {
  journalDailySnapshot(); // run on load in case today's snap is missing

  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 30, 0); // 00:00:30 next day
  setTimeout(() => {
    journalDailySnapshot();
    setInterval(journalDailySnapshot, 86400000);
  }, midnight - now);
}

// ── AI lesson per trade ───────────────────────────────────────────────────────

async function _ajRequestLesson(entry, state) {
  const apiKey = localStorage.getItem('claude_api_key') || '';
  const backend = (localStorage.getItem('nansen_backend_url') || '').trim();
  if (!apiKey && !backend) return;

  try {
    const holdH   = Math.round(entry.hold_ms / 3600000);
    const outcome = entry.net_pnl >= 0 ? 'WIN' : 'LOSS';
    const prompt  = `Crypto perps trader closed a ${entry.side.toUpperCase()} on ${entry.coin}. ${outcome}. Net P&L: $${entry.net_pnl.toFixed(2)}. Hold: ${holdH}h. Fees: $${entry.fees.toFixed(2)}.

Write ONE specific lesson in max 15 words. Direct and actionable, no generic advice. Just the lesson text, nothing else.`;

    const lesson = await _callClaude(prompt, apiKey, backend);
    if (!lesson?.trim()) return;

    const fresh = _ajState();
    const idx   = fresh.entries.findIndex(e => e.id === entry.id);
    if (idx >= 0) {
      fresh.entries[idx].lesson = lesson.trim().slice(0, 130);
      _ajSave(fresh);
      _ajSyncSupabase([fresh.entries[idx]]);
      const el = document.getElementById(`aj-lesson-${entry.id}`);
      if (el) { el.textContent = '💡 ' + fresh.entries[idx].lesson; el.style.display = ''; }
    }
  } catch (e) {
    console.warn('[AutoJournal] lesson failed:', e.message);
  }
}

// ── Weekly AI pattern review ──────────────────────────────────────────────────

async function journalWeeklyReview(force = false) {
  const apiKey  = localStorage.getItem('claude_api_key') || '';
  const backend = (localStorage.getItem('nansen_backend_url') || '').trim();
  if (!apiKey && !backend) return null;

  const state   = _ajState();
  const weekAgo = Date.now() - 7 * 86400000;

  if (!force && state.weekly_review) {
    if (Date.now() - (state.weekly_review.ts || 0) < 6 * 86400000) return state.weekly_review;
  }

  const weekEntries = state.entries.filter(e => (e.exit_time || 0) >= weekAgo);
  if (weekEntries.length < 2) return null;

  try {
    const wins    = weekEntries.filter(e => e.net_pnl > 0);
    const totalPnl = weekEntries.reduce((s, e) => s + e.net_pnl, 0);
    const tagCounts = {};
    for (const e of weekEntries.filter(e => e.tag)) tagCounts[e.tag] = (tagCounts[e.tag] || 0) + 1;
    const tagStr = Object.entries(tagCounts).map(([k, v]) => `${k}×${v}`).join(', ');

    const prompt = `Crypto trader's last 7 days (Hyperliquid perps):
- ${weekEntries.length} trades: ${wins.length}W / ${weekEntries.length - wins.length}L (${(wins.length/weekEntries.length*100).toFixed(0)}% WR)
- Net P&L: $${totalPnl.toFixed(2)}
- Trades: ${weekEntries.slice(0, 8).map(e => `${e.coin} ${e.side[0].toUpperCase()} ${e.net_pnl >= 0 ? '+' : ''}$${e.net_pnl.toFixed(0)}`).join(', ')}
${tagStr ? `- Self-tags: ${tagStr}` : ''}
${weekEntries.filter(e => e.lesson).length > 0 ? `- Lessons: ${weekEntries.filter(e => e.lesson).map(e => e.lesson).slice(0, 3).join(' | ')}` : ''}

Write 2-3 sentences: key pattern, one concrete rule to implement next week. Specific and data-driven. No generic advice.`;

    const text = await _callClaude(prompt, apiKey, backend);
    if (!text?.trim()) return null;

    const review = { text: text.trim(), ts: Date.now(), trade_count: weekEntries.length };
    state.weekly_review = review;
    _ajSave(state);
    return review;
  } catch (e) {
    console.warn('[AutoJournal] weekly review failed:', e.message);
    return null;
  }
}

// ── Tag / notes mutations ─────────────────────────────────────────────────────

function ajSetTag(id, tag) {
  const state = _ajState();
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  entry.tag = entry.tag === tag ? null : tag; // toggle off if same tag
  _ajSave(state);
  _ajSyncSupabase([entry]);
  const wrap = document.getElementById(`aj-entry-${id}`);
  if (wrap) wrap.outerHTML = _ajEntryHtml(entry);
}

function ajSaveNote(id) {
  const input = document.getElementById(`aj-note-${id}`);
  if (!input) return;
  const state = _ajState();
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  entry.notes = input.value;
  _ajSave(state);
  _ajSyncSupabase([entry]);
}

// ── Supabase sync ─────────────────────────────────────────────────────────────

async function _ajSyncSupabase(entries) {
  const client = (typeof sbClient === 'function') ? sbClient() : null;
  if (!client || !entries.length) return;
  try {
    await client.from('hype_journal').upsert(
      entries.map(e => ({ ...e, wallet: currentWallet })),
      { onConflict: 'id' }
    );
  } catch (e) {
    console.warn('[AutoJournal] Supabase sync:', e.message);
  }
}

// ── JSON export ────────────────────────────────────────────────────────────────

function journalExportJSON() {
  const state = _ajState();
  const snaps = _ajLoadSnaps();
  const payload = { entries: state.entries, snapshots: snaps, weekly_review: state.weekly_review, exported_at: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `hype-journal-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── GitHub Gist backup ────────────────────────────────────────────────────────

async function journalGistBackup(btnEl) {
  let token = localStorage.getItem(AJ_PAT_KEY)?.trim();
  if (!token) {
    token = prompt('GitHub Personal Access Token (needs "gist" scope):\n\nCreate at: github.com/settings/tokens/new?scopes=gist\n\nPaste token:');
    if (!token?.trim()) return;
    localStorage.setItem(AJ_PAT_KEY, token.trim());
    token = token.trim();
  }

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }

  try {
    const state   = _ajState();
    const snaps   = _ajLoadSnaps();
    const content = JSON.stringify({ entries: state.entries, snapshots: snaps, weekly_review: state.weekly_review, backup_ts: new Date().toISOString() }, null, 2);
    const fname   = 'hype-journal-backup.json';

    const existingId = localStorage.getItem(AJ_GIST_KEY);
    let resp;
    if (existingId) {
      resp = await fetch(`https://api.github.com/gists/${existingId}`, {
        method: 'PATCH',
        headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ files: { [fname]: { content } } }),
      });
    } else {
      resp = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ description: `Hype journal backup — ${currentWallet?.slice(0, 10)}`, public: false, files: { [fname]: { content } } }),
      });
    }

    if (resp.status === 401) { localStorage.removeItem(AJ_PAT_KEY); throw new Error('Token invalid — cleared, try again'); }
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);

    const data = await resp.json();
    localStorage.setItem(AJ_GIST_KEY, data.id);
    showToast(`Backup saved → ${data.html_url}`);
  } catch (e) {
    showToast(`Backup failed: ${e.message}`, 'error');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '☁ GitHub Backup'; }
  }
}

// ── Render helpers ────────────────────────────────────────────────────────────

function _ajEntryHtml(e) {
  const pnlCls = e.net_pnl >= 0 ? 'pos' : 'neg';
  const holdH  = Math.round((e.hold_ms || 0) / 3600000);
  const ts     = e.exit_time ? AJ_TAG_STYLE : {};

  const tagBtns = AJ_TAGS.map(t => {
    const active = e.tag === t;
    const s = AJ_TAG_STYLE[t];
    return `<button onclick="ajSetTag('${e.id}','${t}')" class="aj-tag-btn${active ? ' active' : ''}"
      style="border-color:${active ? s.border : 'var(--border)'};background:${active ? s.bg : 'transparent'};color:${active ? s.fg : 'var(--text-faint)'}">${t}</button>`;
  }).join('');

  const lessonHtml = e.lesson
    ? `<div class="aj-lesson" id="aj-lesson-${e.id}">💡 ${e.lesson}</div>`
    : `<div class="aj-lesson" id="aj-lesson-${e.id}" style="display:none"></div>`;

  return `<div class="aj-entry" id="aj-entry-${e.id}">
    <div class="aj-entry-head">
      <span class="aj-coin">${e.coin}</span>
      <span class="aj-side aj-side-${e.side}">${e.side.toUpperCase()}</span>
      <span class="${pnlCls} aj-pnl mono">${e.net_pnl >= 0 ? '+' : ''}$${e.net_pnl.toFixed(2)}</span>
      <span class="aj-hold muted">${holdH}h hold</span>
      <span class="aj-date muted" style="margin-left:auto">${typeof fmtDate === 'function' ? fmtDate(e.exit_time) : ''}</span>
    </div>
    <div class="aj-tags">${tagBtns}</div>
    ${lessonHtml}
    <div class="aj-note-row">
      <input id="aj-note-${e.id}" class="aj-note-input" value="${(e.notes || '').replace(/"/g, '&quot;')}"
        placeholder="Add notes…" onblur="ajSaveNote('${e.id}')" onkeydown="if(event.key==='Enter'){ajSaveNote('${e.id}');this.blur()}">
    </div>
  </div>`;
}

// ── Public: render the auto-journal panel (embedded in loadJournal) ───────────

async function renderAutoJournalPanel() {
  const state   = _ajState();
  const entries = state.entries.slice(0, 60);
  const wr      = state.weekly_review;
  const hasAI   = !!(localStorage.getItem('claude_api_key') || localStorage.getItem('nansen_backend_url'));
  const lastSnap = _ajLoadSnaps().filter(s => s.type === 'daily').at(-1);

  const weekReviewHtml = wr?.text ? `<div class="aj-weekly-review">
    <div class="aj-section-title">
      Weekly Pattern Review
      <span class="muted" style="font-weight:400;font-size:10px;margin-left:6px">${Math.floor((Date.now()-wr.ts)/86400000)}d ago · ${wr.trade_count} trades</span>
    </div>
    <div class="aj-review-text">${wr.text}</div>
  </div>` : '';

  const snapHtml = lastSnap ? `<div class="aj-snap-pill">
    📷 Last snapshot: ${lastSnap.date} · $${lastSnap.account_value.toLocaleString(undefined,{maximumFractionDigits:0})} account · ${lastSnap.open_positions} open
  </div>` : '';

  return `<div class="aj-panel">
    <div class="aj-toolbar">
      <div>
        <span style="font-weight:700;font-size:14px">Auto-Journal</span>
        <span class="muted" style="font-size:11px;margin-left:8px">${entries.length} entries</span>
      </div>
      <div class="aj-toolbar-btns">
        ${hasAI ? `<button class="btn btn-ghost btn-sm" onclick="ajRunWeeklyReview(this)">📊 Weekly Review</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="journalAutoCheck()">↺ Sync</button>
        <button class="btn btn-ghost btn-sm" onclick="journalExportJSON()">↓ Export</button>
        <button class="btn btn-ghost btn-sm" onclick="journalGistBackup(this)">☁ GitHub Backup</button>
      </div>
    </div>

    ${snapHtml}
    ${weekReviewHtml}

    ${!hasAI ? `<div class="aj-ai-notice">
      Add Claude API key in <strong>Analytics → AI Trade Debrief</strong> to enable auto-lessons and weekly reviews.
    </div>` : ''}

    <div id="aj-entries">
      ${entries.length === 0
        ? `<div class="aj-empty">No entries yet. Journal auto-populates as your trades close on Hyperliquid. <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="journalAutoCheck()">Sync now</button></div>`
        : entries.map(_ajEntryHtml).join('')}
    </div>
  </div>`;
}

async function ajRunWeeklyReview(btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }
  try {
    const review = await journalWeeklyReview(true);
    if (review?.text) {
      const el = document.querySelector('.aj-review-text');
      if (el) el.textContent = review.text;
      else loadJournal();
    }
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '📊 Weekly Review'; }
  }
}
