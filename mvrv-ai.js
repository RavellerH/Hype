// ── MVRV + AI Knowledge Base (client-side, gh-pages) ────────────────────────

// ── MVRV ─────────────────────────────────────────────────────────────────────

const MVRV_ZONE_META = {
  OVERHEATED:  { label: 'Overheated',  cls: 'mvrv-zone-hot',     color: 'var(--red)',        desc: 'Price well above 90d avg — elevated risk' },
  BULLISH:     { label: 'Bullish',     cls: 'mvrv-zone-bull',    color: 'var(--yellow)',     desc: 'Above average — uptrend, watch for reversal' },
  NEUTRAL:     { label: 'Neutral',     cls: 'mvrv-zone-neutral', color: 'var(--text-muted)', desc: 'Near 90d avg — fair value range' },
  UNDERVALUED: { label: 'Undervalued', cls: 'mvrv-zone-under',   color: 'var(--green)',      desc: 'Below 90d avg — potential accumulation zone' },
};
const MVRV_COIN_NAMES = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', HYPE: 'Hyperliquid' };
const MVRV_CG_IDS     = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', HYPE: 'hyperliquid' };
const MVRV_ORDER      = ['BTC', 'ETH', 'SOL', 'HYPE'];

let _mvrvCache = null, _mvrvCacheTs = 0;

function _mvrvZone(r) {
  if (r >= 1.4)  return 'OVERHEATED';
  if (r >= 1.15) return 'BULLISH';
  if (r >= 0.85) return 'NEUTRAL';
  return 'UNDERVALUED';
}

async function fetchMVRVData() {
  if (_mvrvCache && Date.now() - _mvrvCacheTs < 300000) return _mvrvCache;
  const CG  = 'https://api.coingecko.com/api/v3';
  const ids = Object.values(MVRV_CG_IDS).join(',');
  let pricesNow = {};
  try {
    const r = await fetch(`${CG}/simple/price?ids=${ids}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`);
    pricesNow = await r.json();
  } catch(e) {}

  const coins = {};
  for (const [sym, cgId] of Object.entries(MVRV_CG_IDS)) {
    const now = pricesNow[cgId] || {};
    const currentPrice = now.usd || 0;
    const marketCap    = now.usd_market_cap || 0;
    const change24h    = now.usd_24h_change || 0;
    let chart = [], mvrv = 1.0, avg90d = currentPrice;
    try {
      const rh = await fetch(`${CG}/coins/${cgId}/market_chart?vs_currency=usd&days=90&interval=daily`);
      if (rh.ok) {
        const raw = (await rh.json()).prices || [];
        if (raw.length >= 10) {
          const tss = raw.map(p => p[0]), prices = raw.map(p => p[1]);
          avg90d = prices.reduce((a, b) => a + b, 0) / prices.length;
          mvrv   = prices[prices.length - 1] / avg90d;
          for (let i = 30; i < prices.length; i++) {
            const w = prices.slice(i - 30, i);
            const aw = w.reduce((a, b) => a + b, 0) / w.length;
            chart.push({ t: tss[i], v: +(prices[i] / aw).toFixed(4) });
          }
        }
      }
    } catch(e) {}
    coins[sym] = { symbol: sym, price: currentPrice, market_cap: marketCap,
      change_24h: +change24h.toFixed(2), mvrv: +mvrv.toFixed(4),
      avg_90d: +avg90d.toFixed(4), zone: _mvrvZone(mvrv), chart };
  }
  _mvrvCache   = { coins, source: 'CoinGecko · approx MVRV = price ÷ 90-day avg', updated: Math.floor(Date.now()/1000) };
  _mvrvCacheTs = Date.now();
  return _mvrvCache;
}

async function loadMVRV() {
  const el = document.getElementById('mvrv-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Fetching MVRV from CoinGecko…</div>';
  try { renderMVRV(await fetchMVRVData()); }
  catch(e) { el.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${e.message}</div>`; }
}

function mvrvSparkline(chart) {
  if (!chart || chart.length < 2) return '<span style="color:var(--text-faint);font-size:11px">—</span>';
  const vals = chart.map(p => p.v), W = 120, H = 36, pad = 3;
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 0.01;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = vals[vals.length-1] >= vals[0] ? 'var(--green)' : 'var(--red)';
  const baseY = Math.max(pad, Math.min(H - pad, pad + (1 - (1 - min) / range) * (H - pad * 2)));
  return `<svg width="${W}" height="${H}" style="display:block">
    <line x1="${pad}" y1="${baseY.toFixed(1)}" x2="${W-pad}" y2="${baseY.toFixed(1)}" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="3,3"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderMVRV(data) {
  const el = document.getElementById('mvrv-content');
  if (!el) return;
  const coins = data.coins || {};

  const stripHtml = `<div class="stat-strip">${MVRV_ORDER.map(sym => {
    const c = coins[sym]; if (!c) return `<div class="stat-cell"><div class="s-label">${sym}</div><div class="s-value">—</div></div>`;
    const meta = MVRV_ZONE_META[c.zone];
    return `<div class="stat-cell"><div class="s-label">${sym}</div><div class="s-value" style="color:${meta.color}">${c.mvrv.toFixed(3)}</div><div class="s-sub">${meta.label}</div></div>`;
  }).join('')}</div>`;

  const cards = MVRV_ORDER.map(sym => {
    const c = coins[sym]; if (!c) return `<div class="mvrv-card"><div class="muted">No data for ${sym}</div></div>`;
    const meta = MVRV_ZONE_META[c.zone];
    const chg = c.change_24h, chgCls = chg >= 0 ? 'pos' : 'neg', chgStr = (chg>=0?'+':'') + chg.toFixed(2) + '%';
    const mcStr = c.market_cap >= 1e9 ? '$'+(c.market_cap/1e9).toFixed(2)+'B' : c.market_cap >= 1e6 ? '$'+(c.market_cap/1e6).toFixed(0)+'M' : '—';
    return `<div class="mvrv-card">
      <div class="mvrv-card-header">
        <div><div class="mvrv-coin">${sym}</div><div class="mvrv-coin-name">${MVRV_COIN_NAMES[sym]||sym}</div></div>
        <span class="mvrv-zone-badge ${meta.cls}">${meta.label}</span>
      </div>
      <div class="mvrv-ratio" style="color:${meta.color}">${c.mvrv.toFixed(3)}</div>
      <div class="mvrv-ratio-label">MVRV Ratio</div>
      <div class="mvrv-sparkline">${mvrvSparkline(c.chart)}</div>
      <div class="mvrv-stats">
        <div class="mvrv-stat"><div class="mvrv-stat-label">Price</div><div class="mvrv-stat-val">${fmt$(c.price)}</div></div>
        <div class="mvrv-stat"><div class="mvrv-stat-label">24h</div><div class="mvrv-stat-val ${chgCls}">${chgStr}</div></div>
        <div class="mvrv-stat"><div class="mvrv-stat-label">90d Avg</div><div class="mvrv-stat-val">${fmt$(c.avg_90d)}</div></div>
        <div class="mvrv-stat"><div class="mvrv-stat-label">Mkt Cap</div><div class="mvrv-stat-val">${mcStr}</div></div>
      </div>
      <div class="mvrv-desc">${meta.desc}</div>
    </div>`;
  }).join('');

  const updatedStr = data.updated ? new Date(data.updated*1000).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  el.innerHTML = `
    ${stripHtml}
    <div class="filter-bar" style="justify-content:space-between">
      <span style="font-size:12px;color:var(--text-muted)">${data.source}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:var(--text-faint)">Updated ${updatedStr}</span>
        <button class="btn btn-ghost btn-sm" onclick="_mvrvCacheTs=0;loadMVRV()">↺ Refresh</button>
      </div>
    </div>
    <div class="mvrv-grid">${cards}</div>
    <div class="mvrv-legend">
      ${Object.entries(MVRV_ZONE_META).map(([,m])=>`<div class="mvrv-legend-item"><span class="mvrv-zone-badge ${m.cls}">${m.label}</span><span class="mvrv-legend-desc">${m.desc}</span></div>`).join('')}
      <div class="mvrv-legend-item" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;grid-column:1/-1">
        <span style="font-size:11px;color:var(--text-faint)">ⓘ Approx MVRV = Current Price ÷ 90-day rolling average. Not true on-chain realized cap. Chart shows 30-day rolling window.</span>
      </div>
    </div>`;
}

// ── AI Knowledge Base ─────────────────────────────────────────────────────────

let _aiSubTab = 'chat';
let _chatHistory = [];
let _aiNotes = JSON.parse(localStorage.getItem('hype_kb_notes') || '[]');

async function loadAI() {
  const el = document.getElementById('ai-content');
  if (!el) return;
  renderAIShell();
}

function renderAIShell() {
  const el = document.getElementById('ai-content');
  if (!el) return;
  const apiKey = localStorage.getItem('hype_anthropic_key') || '';
  el.innerHTML = `
    <div class="stat-strip">
      <div class="stat-cell"><div class="s-label">Notes</div><div class="s-value">${_aiNotes.length}</div><div class="s-sub">in browser</div></div>
      <div class="stat-cell"><div class="s-label">AI Engine</div><div class="s-value" style="color:${apiKey?'var(--green)':'var(--text-muted)'}">${apiKey?'Claude':'Off'}</div><div class="s-sub">${apiKey?'Anthropic':'add key below'}</div></div>
      <div class="stat-cell"><div class="s-label">Coins</div><div class="s-value">4</div><div class="s-sub">BTC ETH SOL HYPE</div></div>
      <div class="stat-cell"><div class="s-label">Data</div><div class="s-value">Live</div><div class="s-sub">CoinGecko</div></div>
    </div>
    <div class="filter-bar" style="flex-wrap:wrap;gap:6px">
      <div style="display:flex;gap:6px">
        ${['chat','graph','notes'].map(t=>`<button class="chip${_aiSubTab===t?' active':''}" onclick="setAITab('${t}')">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`).join('')}
      </div>
      <div class="filter-sep"></div>
      <input class="input" id="ai-key-input" placeholder="Anthropic API key (sk-ant-…)" type="password" value="${aiEsc(apiKey)}" style="max-width:220px;padding:3px 10px;height:28px;font-size:12px">
      <button class="btn btn-ghost btn-sm" onclick="saveAIKey()">Save Key</button>
    </div>
    <div id="ai-sub-content"></div>`;
  if (_aiSubTab === 'chat')  renderChatTab();
  if (_aiSubTab === 'graph') renderKGraph();
  if (_aiSubTab === 'notes') renderNotes();
}

function setAITab(tab) { _aiSubTab = tab; renderAIShell(); }

function saveAIKey() {
  const key = document.getElementById('ai-key-input')?.value?.trim();
  if (key) { localStorage.setItem('hype_anthropic_key', key); }
  else     { localStorage.removeItem('hype_anthropic_key'); }
  renderAIShell();
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function renderChatTab() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  const histHtml = _chatHistory.length === 0
    ? `<div class="chat-empty">Ask anything about market conditions, MVRV signals, or your notes.<br><br><span style="color:var(--text-faint)">Examples: &quot;What does MVRV &gt; 1.4 mean?&quot; · &quot;Summarize my notes&quot; · &quot;Is BTC overheated?&quot;</span></div>`
    : _chatHistory.map(m => m.role==='user'
        ? `<div class="chat-bubble user">${aiEsc(m.content)}</div>`
        : `<div class="chat-bubble assistant"><div class="chat-answer">${mdToHtml(m.content)}</div></div>`
      ).join('');
  el.innerHTML = `
    <div class="chat-wrap">
      <div class="chat-history" id="chat-history">${histHtml}</div>
      <div class="chat-input-row">
        <input class="input chat-input" id="chat-input" placeholder="Ask about crypto, MVRV, phases…" onkeydown="if(event.key==='Enter')sendChat()">
        <button class="btn btn-primary" onclick="sendChat()">Send</button>
        ${_chatHistory.length?`<button class="btn btn-ghost btn-sm" onclick="_chatHistory=[];renderChatTab()">Clear</button>`:''}
      </div>
    </div>`;
  const h = document.getElementById('chat-history');
  if (h) h.scrollTop = h.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const q = input?.value?.trim();
  if (!q) return;
  input.value = ''; input.disabled = true;
  _chatHistory.push({ role: 'user', content: q });
  renderChatTab();

  const apiKey = localStorage.getItem('hype_anthropic_key') || '';
  if (!apiKey) {
    _chatHistory.push({ role: 'assistant', content: '**No Anthropic API key set.** Enter your key in the field above and click Save Key.\n\nGet a free key at **console.anthropic.com**' });
    renderChatTab();
    if (input) input.disabled = false;
    return;
  }

  const notesCtx = _aiNotes.length ? 'Research notes:\n' + _aiNotes.map(n=>`[${n.title}]: ${n.content}`).join('\n\n') : '';
  const mvrvCtx  = _mvrvCache ? 'Latest MVRV:\n' + JSON.stringify(_mvrvCache.coins, null, 1).slice(0, 600) : '';
  const system   = `You are an AI assistant for the Hype crypto trading dashboard. Help analyze BTC, ETH, SOL, HYPE.\nMVRV zones: >1.4 overheated, 1.15-1.4 bullish, 0.85-1.15 neutral, <0.85 undervalued.\n${notesCtx}\n${mvrvCtx}\nBe concise.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey,
                 'anthropic-version': '2023-06-01', 'anthropic-dangerous-client-side-use': 'true' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system,
        messages: _chatHistory.map(m => ({ role: m.role, content: m.content })),
      }),
    });
    const d = await res.json();
    _chatHistory.push({ role: 'assistant', content: d.content?.[0]?.text || JSON.stringify(d.error || d) });
  } catch(e) {
    _chatHistory.push({ role: 'assistant', content: `Network error: ${e.message}` });
  }
  renderChatTab();
  if (input) input.disabled = false;
}

// ── Knowledge Graph ───────────────────────────────────────────────────────────

function renderKGraph() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  const W = el.clientWidth || 900, H = 520;
  const TC = { file:'#38bdf8', coin:'#4ade80', phase:'#fbbf24', indicator:'#818cf8', note:'#fb923c' };
  const TR = { file:9, coin:14, phase:9, indicator:7, note:7 };

  const rawNodes = [
    {id:'main.py',            label:'main.py',            type:'file'},
    {id:'phase_detector.py',  label:'phase_detector.py',  type:'file'},
    {id:'hyperliquid.py',     label:'hyperliquid.py',     type:'file'},
    {id:'knowledge_base.py',  label:'knowledge_base.py',  type:'file'},
    {id:'backtest.py',        label:'backtest.py',        type:'file'},
    {id:'phase_analyzer.py',  label:'phase_analyzer.py',  type:'file'},
    {id:'indicators.py',      label:'indicators.py',      type:'file'},
    {id:'app.js',             label:'app.js',             type:'file'},
    {id:'c:BTC',  label:'BTC',  type:'coin'}, {id:'c:ETH',  label:'ETH',  type:'coin'},
    {id:'c:SOL',  label:'SOL',  type:'coin'}, {id:'c:HYPE', label:'HYPE', type:'coin'},
    {id:'p:ACCUM',  label:'Accumulation',  type:'phase'}, {id:'p:MARKUP', label:'Markup',   type:'phase'},
    {id:'p:DIST',   label:'Distribution', type:'phase'}, {id:'p:DOWN',   label:'Markdown', type:'phase'},
    {id:'p:NEUT',   label:'Neutral',      type:'phase'},
    {id:'i:MVRV',   label:'MVRV',   type:'indicator'}, {id:'i:RSI',    label:'RSI',    type:'indicator'},
    {id:'i:MACD',   label:'MACD',   type:'indicator'}, {id:'i:EMA',    label:'EMA',    type:'indicator'},
    {id:'i:VOL',    label:'Volume', type:'indicator'},
  ];
  _aiNotes.forEach(n => rawNodes.push({ id: n.id, label: n.title.slice(0,14), type:'note' }));

  const rawLinks = [
    {s:'hyperliquid.py',s2:'c:BTC'}, {s:'hyperliquid.py',s2:'c:ETH'}, {s:'hyperliquid.py',s2:'c:SOL'}, {s:'hyperliquid.py',s2:'c:HYPE'},
    {s:'phase_detector.py',s2:'p:ACCUM'},{s:'phase_detector.py',s2:'p:MARKUP'},{s:'phase_detector.py',s2:'p:DIST'},{s:'phase_detector.py',s2:'p:DOWN'},{s:'phase_detector.py',s2:'p:NEUT'},
    {s:'indicators.py',s2:'i:RSI'},{s:'indicators.py',s2:'i:MACD'},{s:'indicators.py',s2:'i:EMA'},{s:'indicators.py',s2:'i:VOL'},
    {s:'i:MVRV',s2:'p:ACCUM'},{s:'i:MVRV',s2:'p:MARKUP'},{s:'i:RSI',s2:'p:DIST'},{s:'i:MACD',s2:'p:DOWN'},{s:'i:VOL',s2:'p:MARKUP'},
    {s:'main.py',s2:'phase_detector.py'},{s:'main.py',s2:'hyperliquid.py'},{s:'main.py',s2:'i:MVRV'},
    {s:'phase_analyzer.py',s2:'c:BTC'},{s:'phase_analyzer.py',s2:'c:ETH'},
    {s:'app.js',s2:'main.py'},{s:'knowledge_base.py',s2:'c:BTC'},{s:'knowledge_base.py',s2:'c:ETH'},
  ];

  const nodes = rawNodes.map(n => ({ ...n, x: W/2+(Math.random()-.5)*W*.7, y: H/2+(Math.random()-.5)*H*.6, vx:0, vy:0 }));
  const idMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const links = rawLinks.map(l => ({ source: idMap[l.s], target: idMap[l.s2] })).filter(l => l.source && l.target);

  const k = Math.sqrt(W * H / Math.max(nodes.length, 1)) * 0.85;
  for (let iter = 0; iter < 130; iter++) {
    for (const n of nodes) { n.fx = 0; n.fy = 0; }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const dx=nodes[i].x-nodes[j].x||.1, dy=nodes[i].y-nodes[j].y||.1;
        const d=Math.sqrt(dx*dx+dy*dy)||1, f=(k*k)/d;
        nodes[i].fx+=dx/d*f; nodes[i].fy+=dy/d*f; nodes[j].fx-=dx/d*f; nodes[j].fy-=dy/d*f;
      }
    }
    for (const l of links) {
      const dx=l.target.x-l.source.x, dy=l.target.y-l.source.y, d=Math.sqrt(dx*dx+dy*dy)||1, f=(d*d)/k*.09;
      l.source.fx+=dx/d*f; l.source.fy+=dy/d*f; l.target.fx-=dx/d*f; l.target.fy-=dy/d*f;
    }
    for (const n of nodes) {
      n.fx+=(W/2-n.x)*.014; n.fy+=(H/2-n.y)*.014;
      n.vx=(n.vx+n.fx)*.8; n.vy=(n.vy+n.fy)*.8;
      n.x=Math.max(18,Math.min(W-18,n.x+n.vx)); n.y=Math.max(18,Math.min(H-18,n.y+n.vy));
    }
  }

  const edges = links.map(l=>`<line x1="${l.source.x.toFixed(0)}" y1="${l.source.y.toFixed(0)}" x2="${l.target.x.toFixed(0)}" y2="${l.target.y.toFixed(0)}" stroke="#383838" stroke-width="1" opacity="0.5"/>`).join('');
  const nodesSvg = nodes.map(n=>{
    const c=TC[n.type]||'#6b7280', r=TR[n.type]||6;
    const lbl=(n.label||'').length>14?n.label.slice(0,13)+'…':n.label;
    return `<g onclick="kgClick(this)" data-label="${aiEsc(n.label)}" data-type="${n.type}" style="cursor:pointer">
      <circle cx="${n.x.toFixed(0)}" cy="${n.y.toFixed(0)}" r="${r}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="1.5"/>
      <text x="${n.x.toFixed(0)}" y="${(n.y+r+9).toFixed(0)}" fill="#6b7280" font-size="8.5" text-anchor="middle" font-family="monospace">${aiEsc(lbl)}</text>
    </g>`;
  }).join('');

  const legend = Object.entries(TC).map(([t,c])=>`<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted)"><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="1.5"/></svg>${t}</div>`).join('');
  el.innerHTML = `
    <svg width="${W}" height="${H}" style="display:block;background:var(--surface)">${edges}${nodesSvg}</svg>
    <div style="display:flex;gap:14px;flex-wrap:wrap;padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border)">${legend}<span style="margin-left:auto;font-size:11px;color:var(--text-faint)">${nodes.length} nodes · ${links.length} links</span></div>
    <div id="kg-detail" style="padding:10px 16px;background:var(--surface2);font-size:12px;color:var(--text-muted)">Click a node to see details</div>`;
}

function kgClick(el) {
  document.getElementById('kg-detail').innerHTML =
    `<strong style="color:var(--text)">${aiEsc(el.dataset.label)}</strong> <span style="background:var(--surface2);color:var(--text-muted);padding:1px 6px;border-radius:var(--radius-pill);font-size:10px;font-weight:600;margin-left:6px">${el.dataset.type}</span>`;
}

// ── Notes ─────────────────────────────────────────────────────────────────────

function renderNotes() {
  const el = document.getElementById('ai-sub-content');
  if (!el) return;
  const rows = _aiNotes.length === 0
    ? '<div class="chat-empty">No notes yet.</div>'
    : _aiNotes.map(n=>`
        <div class="note-card">
          <div class="note-header">
            <strong class="note-title">${aiEsc(n.title)}</strong>
            <span style="font-size:10px;color:var(--text-faint)">${n.created||''}</span>
            <button class="btn btn-danger btn-sm" onclick="deleteAINote('${aiEsc(n.id)}')">✕</button>
          </div>
          <div class="note-body">${aiEsc(n.content)}</div>
        </div>`).join('');
  el.innerHTML = `
    <div class="notes-wrap">
      <div class="note-add">
        <input class="input" id="ai-note-title" placeholder="Title" style="max-width:280px">
        <textarea class="input note-textarea" id="ai-note-content" placeholder="Research, thesis, observations…" rows="3"></textarea>
        <button class="btn btn-primary btn-sm" onclick="addAINote()">Add Note</button>
      </div>
      <div class="notes-list">${rows}</div>
    </div>`;
}

function addAINote() {
  const title   = document.getElementById('ai-note-title')?.value?.trim();
  const content = document.getElementById('ai-note-content')?.value?.trim();
  if (!title || !content) return;
  _aiNotes.unshift({ id:'note::'+Date.now(), title, content, created: new Date().toLocaleString() });
  localStorage.setItem('hype_kb_notes', JSON.stringify(_aiNotes));
  renderNotes();
}

function deleteAINote(id) {
  if (!confirm('Delete this note?')) return;
  _aiNotes = _aiNotes.filter(n => n.id !== id);
  localStorage.setItem('hype_kb_notes', JSON.stringify(_aiNotes));
  renderNotes();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function aiEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function mdToHtml(md) {
  return String(md||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code style="background:var(--surface2);padding:1px 4px;border-radius:3px;font-family:var(--mono);font-size:12px">$1</code>')
    .replace(/\n/g,'<br>');
}

// ── Patch navigate() to trigger loaders for new pages ────────────────────────

(function patchNavigate() {
  const _orig = window.navigate;
  if (!_orig) return;
  window.navigate = function(page) {
    _orig(page);
    if (page === 'mvrv') loadMVRV();
    if (page === 'ai')   loadAI();
  };
})();
