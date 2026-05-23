// ── Position Metadata Layer ───────────────────────────────────────────────────
// localStorage key: 'hype_pos_meta'
// schema: { [coin]: { intent, opened_at, thesis: { macro_phase, ta_level, ta_side, momentum_ok, notes }, stop_price } }

function pmLoad() {
  try { return JSON.parse(localStorage.getItem('hype_pos_meta') || '{}'); } catch { return {}; }
}
function pmSave(data) { localStorage.setItem('hype_pos_meta', JSON.stringify(data)); }
function pmGet(coin) { return pmLoad()[coin] || {}; }
function pmSet(coin, patch) {
  const data = pmLoad();
  data[coin] = Object.assign({}, data[coin] || {}, patch);
  pmSave(data);
}
function pmClearStale(activeCoins) {
  const data = pmLoad();
  let changed = false;
  for (const coin of Object.keys(data)) {
    if (!activeCoins.includes(coin)) { delete data[coin]; changed = true; }
  }
  if (changed) pmSave(data);
}

function pmFmtAge(opened_at) {
  if (!opened_at) return null;
  const ms = Date.now() - new Date(opened_at).getTime();
  if (ms < 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function posAgeBadge(coin) {
  const m = pmGet(coin);
  const intent = (m.intent || '').toUpperCase();
  const age = pmFmtAge(m.opened_at);
  const ageStr = age || '?';
  let stale = false;
  if (m.intent === 'scalp' && age) {
    const ms = Date.now() - new Date(m.opened_at).getTime();
    if (ms > 3 * 86400000) stale = true;
  }
  if (m.intent === 'swing' && age) {
    const ms = Date.now() - new Date(m.opened_at).getTime();
    if (ms > 45 * 86400000) stale = true;
  }
  const cls = stale ? 'pos-age-badge pos-age-stale' : 'pos-age-badge';
  return `<span class="${cls}">${ageStr}${intent ? ` <span class="pos-intent-chip">${intent}</span>` : ''}</span>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
let _pmCoin = null;
let _pmTab = 'intent';

function openPositionDetail(coin) {
  _pmCoin = coin;
  _pmTab = 'intent';
  _renderPmModal();
}

function _renderPmModal() {
  const existing = document.getElementById('pm-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'pm-modal';
  overlay.className = 'pos-modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = _pmModalHtml(_pmCoin, _pmTab);
  document.body.appendChild(overlay);
}

function _pmGetCtx(coin) {
  if (typeof _ovData !== 'undefined' && _ovData && _ovData.marketCtx) return _ovData.marketCtx[coin] || {};
  if (typeof _marketCtx !== 'undefined' && _marketCtx) return _marketCtx[coin] || {};
  return {};
}
function _pmGetPos(coin) {
  if (typeof _ovData !== 'undefined' && _ovData && _ovData.positions) return _ovData.positions.find(p => p.coin === coin) || null;
  return null;
}
function _pmFmtPrice(n) {
  if (typeof fmtPrice === 'function') return fmtPrice(n);
  if (!n) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', {maximumFractionDigits: 0});
  if (n >= 1) return '$' + n.toFixed(3);
  return '$' + n.toFixed(6);
}

function _pmModalHtml(coin, tab) {
  const m = pmGet(coin);
  const pos = _pmGetPos(coin);
  const ctx = _pmGetCtx(coin);

  return `<div class="pos-modal-box" onclick="event.stopPropagation()">
    <div class="pos-modal-header">
      <span class="pos-modal-title">${coin} Position</span>
      <button class="pos-close-btn" onclick="document.getElementById('pm-modal').remove()">✕</button>
    </div>
    <div class="pos-tabs">
      <button class="pos-tab${tab==='intent'?' active':''}" onclick="pmSwitchTab('intent')">Intent</button>
      <button class="pos-tab${tab==='thesis'?' active':''}" onclick="pmSwitchTab('thesis')">Thesis</button>
      <button class="pos-tab${tab==='risk'?' active':''}" onclick="pmSwitchTab('risk')">Risk</button>
      <button class="pos-tab${tab==='signal'?' active':''}" onclick="pmSwitchTab('signal')">Signal</button>
    </div>
    <div class="pos-tab-panel">
      ${tab === 'intent' ? _pmTabIntent(coin, m) : ''}
      ${tab === 'thesis' ? _pmTabThesis(coin, m, ctx) : ''}
      ${tab === 'risk'   ? _pmTabRisk(coin, m, pos, ctx) : ''}
      ${tab === 'signal' ? _pmTabSignal(coin) : ''}
    </div>
  </div>`;
}

function _pmTabIntent(coin, m) {
  const intents = ['scalp', 'swing', 'position'];
  const age = pmFmtAge(m.opened_at);
  const openedVal = m.opened_at ? new Date(m.opened_at).toISOString().slice(0,16) : '';
  return `
    <div class="pos-field-group">
      <div class="pos-field-label">Trade Type</div>
      <div class="intent-chips">
        ${intents.map(i => `<button class="intent-chip${(m.intent||'')=== i?' active':''}" onclick="pmSetIntent('${coin}','${i}')">${i.charAt(0).toUpperCase()+i.slice(1)}</button>`).join('')}
      </div>
    </div>
    <div class="pos-field-group">
      <div class="pos-field-label">Opened At</div>
      <div class="pos-field-row">
        <input class="pos-input" type="datetime-local" id="pm-opened-at" value="${openedVal}">
        <button class="pos-save-btn" onclick="pmSaveOpenedAt('${coin}')">Save</button>
      </div>
      ${age ? `<div class="pos-age-display">Open for ${age}</div>` : ''}
    </div>
    <div class="pos-field-group">
      <div class="pos-field-label">Notes</div>
      <textarea class="pos-textarea" id="pm-notes" rows="4" placeholder="Trade rationale, observations…">${(m.thesis && m.thesis.notes) || ''}</textarea>
      <button class="pos-save-btn" style="margin-top:6px" onclick="pmSaveNotes('${coin}')">Save Notes</button>
    </div>`;
}

function _pmTabThesis(coin, m, ctx) {
  const thesis = m.thesis || {};
  const macroPhases = ['Accumulation','Markup','Distribution','Markdown','Neutral'];
  const currentPhase = (typeof INTEL !== 'undefined' && INTEL && INTEL.macro && INTEL.macro.cycle_phase) || null;
  const currentPrice = ctx.mark_price || 0;
  const fundingApr = ctx.funding_apr || 0;

  const sigMacro = _sigCheckMacro(thesis, currentPhase);
  const sigTA    = _sigCheckTA(thesis, currentPrice);
  const sigMom   = _sigCheckMom(thesis, fundingApr);
  const validCount = [sigMacro, sigTA, sigMom].filter(s => s && s.ok === true).length;
  const totalSig = [sigMacro, sigTA, sigMom].filter(Boolean).length;

  return `
    <div class="thesis-recheck">
      <div class="thesis-recheck-header">${totalSig > 0 ? `${validCount}/${totalSig} signals still valid` : 'Save thesis to track signals'}</div>
      ${totalSig > 0 ? `
      <div class="thesis-signal ${sigMacro && sigMacro.ok === true ? 'sig-ok' : sigMacro && sigMacro.ok === false ? 'sig-fail' : ''}">
        <span class="sig-icon">${sigMacro && sigMacro.ok === true ? '✓' : sigMacro && sigMacro.ok === false ? '✗' : '?'}</span>
        <span class="sig-name">Macro</span>
        <span class="sig-detail">${sigMacro ? sigMacro.detail : 'Not set'}</span>
      </div>
      <div class="thesis-signal ${sigTA && sigTA.ok === true ? 'sig-ok' : sigTA && sigTA.ok === false ? 'sig-fail' : ''}">
        <span class="sig-icon">${sigTA && sigTA.ok === true ? '✓' : sigTA && sigTA.ok === false ? '✗' : '?'}</span>
        <span class="sig-name">TA</span>
        <span class="sig-detail">${sigTA ? sigTA.detail : 'Not set'}</span>
      </div>
      <div class="thesis-signal ${sigMom && sigMom.ok === true ? 'sig-ok' : sigMom && sigMom.ok === false ? 'sig-fail' : ''}">
        <span class="sig-icon">${sigMom && sigMom.ok === true ? '✓' : sigMom && sigMom.ok === false ? '✗' : '?'}</span>
        <span class="sig-name">Momentum</span>
        <span class="sig-detail">${sigMom ? sigMom.detail : 'Not set'}</span>
      </div>` : ''}
    </div>
    <div class="pos-field-group">
      <div class="pos-field-label">Entry Macro Phase</div>
      <select class="pos-input" id="pm-macro-phase">
        <option value="">-- select --</option>
        ${macroPhases.map(ph => `<option value="${ph}"${thesis.macro_phase===ph?' selected':''}>${ph}</option>`).join('')}
      </select>
      ${currentPhase ? `<div class="pos-field-hint">Current: ${currentPhase}</div>` : ''}
    </div>
    <div class="pos-field-group">
      <div class="pos-field-label">Key TA Level</div>
      <div class="pos-field-row">
        <input class="pos-input" type="number" id="pm-ta-level" placeholder="Price level" value="${thesis.ta_level||''}">
        <select class="pos-input" id="pm-ta-side" style="width:140px">
          <option value="above"${thesis.ta_side==='above'?' selected':''}>price above</option>
          <option value="below"${thesis.ta_side==='below'?' selected':''}>price below</option>
        </select>
      </div>
      ${currentPrice > 0 ? `<div class="pos-field-hint">Current price: ${_pmFmtPrice(currentPrice)}</div>` : ''}
    </div>
    <div class="pos-field-group">
      <div class="pos-field-label">Momentum at Entry</div>
      <div class="intent-chips">
        <button class="intent-chip${thesis.momentum_ok===true?' active':''}" onclick="pmSetMom('${coin}',true)">Strong ✓</button>
        <button class="intent-chip${thesis.momentum_ok===false?' active':''}" onclick="pmSetMom('${coin}',false)">Weak ✗</button>
      </div>
      ${fundingApr !== 0 ? `<div class="pos-field-hint">Current funding: ${fundingApr.toFixed(1)}% APR</div>` : ''}
    </div>
    <button class="pos-save-btn" style="margin-top:8px" onclick="pmSaveThesis('${coin}')">Save Thesis</button>`;
}

function _pmTabRisk(coin, m, pos, ctx) {
  const stopPrice = m.stop_price || '';
  const entryPrice = pos ? pos.entry_price : 0;
  const markPrice  = ctx.mark_price || (pos ? pos.mark_price : 0);
  const positionValue = pos ? pos.position_value : 0;
  const size       = pos ? pos.size : 0;
  const acctValue  = (typeof _ovData !== 'undefined' && _ovData && _ovData.s && _ovData.s.account_value) || 0;
  const fundingApr = ctx.funding_apr || 0;

  let metricsHtml = '';
  if (stopPrice && entryPrice > 0 && size > 0) {
    const sp = parseFloat(stopPrice);
    const dollarRisk = Math.abs(entryPrice - sp) * size;
    const pctAccount = acctValue > 0 ? (dollarRisk / acctValue * 100).toFixed(2) : '—';
    const stopDist   = markPrice > 0 ? (Math.abs(markPrice - sp) / markPrice * 100).toFixed(2) : '—';
    const dailyFunding = fundingApr / 100 / 365 * positionValue;
    const fundingBurnDays = dailyFunding > 0 ? (dollarRisk / dailyFunding).toFixed(1) : '∞';
    const burnWarn = parseFloat(fundingBurnDays) < 7;
    metricsHtml = `
      <div class="stop-metrics">
        <div class="stop-metric"><div class="stop-metric-label">Dollar Risk</div><div class="stop-metric-val neg">${fmt$(dollarRisk)}</div></div>
        <div class="stop-metric"><div class="stop-metric-label">% of Account</div><div class="stop-metric-val">${pctAccount}%</div></div>
        <div class="stop-metric"><div class="stop-metric-label">Stop Distance</div><div class="stop-metric-val">${stopDist}%</div></div>
        <div class="stop-metric"><div class="stop-metric-label">Funding Burn Days</div><div class="stop-metric-val ${burnWarn ? 'neg' : ''}">${fundingBurnDays}${burnWarn ? ' ⚠' : ''}</div></div>
      </div>
      ${burnWarn ? `<div class="pos-field-hint" style="color:var(--red)">Funding cost erases your risk budget in &lt;7 days — reconsider size or stop.</div>` : ''}`;
  }

  return `
    <div class="pos-field-group">
      <div class="pos-field-label">Stop Price</div>
      <div class="pos-field-row">
        <input class="pos-input" type="number" id="pm-stop-price" placeholder="Stop loss price" value="${stopPrice}">
        <button class="pos-save-btn" onclick="pmSaveStop('${coin}')">Set</button>
      </div>
      ${entryPrice > 0 ? `<div class="pos-field-hint">Entry: ${_pmFmtPrice(entryPrice)} · Mark: ${_pmFmtPrice(markPrice)}</div>` : ''}
    </div>
    ${metricsHtml}`;
}

function _pmTabSignal(coin) {
  setTimeout(() => {
    if (typeof loadModalSignal === 'function') loadModalSignal(coin);
  }, 0);
  return `<div id="pm-signal-body"><div class="loading" style="padding:20px"><div class="spinner"></div> Analysing ${coin}…</div></div>`;
}

// ── Signal checkers ───────────────────────────────────────────────────────────
function _sigCheckMacro(thesis, currentPhase) {
  if (!thesis.macro_phase) return null;
  if (!currentPhase) return { ok: null, detail: `Entry: ${thesis.macro_phase} — current phase unknown` };
  const ok = thesis.macro_phase.toLowerCase() === currentPhase.toLowerCase();
  return { ok, detail: `Entry: ${thesis.macro_phase} / Now: ${currentPhase}` };
}
function _sigCheckTA(thesis, currentPrice) {
  if (!thesis.ta_level) return null;
  const level = parseFloat(thesis.ta_level);
  if (!currentPrice || !level) return null;
  const side = thesis.ta_side || 'above';
  const ok = side === 'above' ? currentPrice > level : currentPrice < level;
  return { ok, detail: `${_pmFmtPrice(currentPrice)} ${ok ? '✓' : '✗'} ${side} ${_pmFmtPrice(level)}` };
}
function _sigCheckMom(thesis, fundingApr) {
  if (thesis.momentum_ok === undefined || thesis.momentum_ok === null) return null;
  const strong = fundingApr > 5;
  const ok = thesis.momentum_ok === true ? strong : !strong;
  return { ok, detail: `Entry ${thesis.momentum_ok ? 'strong' : 'weak'} / Now ${strong ? 'strong' : 'weak'} (${fundingApr.toFixed(1)}% APR)` };
}

// ── Action handlers ───────────────────────────────────────────────────────────
function pmSwitchTab(tab) {
  _pmTab = tab;
  _renderPmModal();
}

function pmSetIntent(coin, intent) {
  pmSet(coin, { intent });
  _renderPmModal();
}

function pmSetMom(coin, val) {
  const m = pmGet(coin);
  const thesis = Object.assign({}, m.thesis || {}, { momentum_ok: val });
  pmSet(coin, { thesis });
  _renderPmModal();
}

function pmSaveOpenedAt(coin) {
  const val = document.getElementById('pm-opened-at').value;
  if (!val) return;
  pmSet(coin, { opened_at: val });
  _renderPmModal();
}

function pmSaveNotes(coin) {
  const notes = document.getElementById('pm-notes').value;
  const m = pmGet(coin);
  const thesis = Object.assign({}, m.thesis || {}, { notes });
  pmSet(coin, { thesis });
  _showToast('Notes saved');
}

function pmSaveThesis(coin) {
  const macro_phase = document.getElementById('pm-macro-phase').value;
  const ta_level    = parseFloat(document.getElementById('pm-ta-level').value) || null;
  const ta_side     = document.getElementById('pm-ta-side').value;
  const m = pmGet(coin);
  const thesis = Object.assign({}, m.thesis || {}, { macro_phase: macro_phase || null, ta_level, ta_side });
  pmSet(coin, { thesis });
  _renderPmModal();
}

function pmSaveStop(coin) {
  const val = parseFloat(document.getElementById('pm-stop-price').value);
  if (!val || isNaN(val)) return;
  pmSet(coin, { stop_price: val });
  _renderPmModal();
}

function _showToast(msg) {
  let t = document.getElementById('pm-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'pm-toast';
    t.style.cssText = 'position:fixed;bottom:80px;right:16px;background:#1a1a1a;border:1px solid #383838;color:#e2e2e2;padding:8px 14px;border-radius:6px;font-size:12px;z-index:9999;transition:opacity .3s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2000);
}
