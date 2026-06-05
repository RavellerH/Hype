// ── AI Page: Trade Staging + AI Chat ─────────────────────────────────────────
//
// Supabase table — run once in Supabase SQL Editor:
//
//   create table staged_trades (
//     id          uuid        default gen_random_uuid() primary key,
//     created_at  timestamptz default now(),
//     updated_at  timestamptz default now(),
//     coin        text        not null,
//     direction   text        not null,
//     entry_price numeric,
//     stop_loss   numeric,
//     take_profit numeric,
//     rationale   text,
//     tags        text,
//     status      text        default 'staged'
//   );
//   alter table staged_trades enable row level security;
//   create policy "anon_all" on staged_trades for all to anon using (true) with check (true);

const _STAGE_COINS = ['BTC','ETH','SOL','BNB','AVAX','ARB','OP','MATIC','DOGE','PEPE','WIF','BONK','SUI','APT','INJ','TIA','JUP','PYTH','W','SEI','STX','RUNE'];
const _STAGE_DIRS  = ['Long','Short','Spot Buy','Spot Sell'];

let _stageTrades   = [];
let _chatMsgs      = [];
let _chatLoading   = false;

// ── Supabase persistence ──────────────────────────────────────────────────────

async function _stageLoad() {
  if (!_db) return;
  try {
    const { data } = await _db.from('staged_trades').select('*').order('created_at', { ascending: false }).limit(100);
    if (data) _stageTrades = data;
  } catch {}
}

async function _stageInsert(trade) {
  if (_db) {
    const { data } = await _db.from('staged_trades').insert(trade).select().single();
    if (data) { _stageTrades.unshift(data); return; }
  }
  _stageTrades.unshift({ ...trade, id: crypto.randomUUID(), created_at: new Date().toISOString() });
}

async function _stageSetStatus(id, status) {
  if (_db) await _db.from('staged_trades').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  _stageTrades = _stageTrades.map(t => t.id === id ? { ...t, status } : t);
}

async function _stageDelete(id) {
  if (_db) await _db.from('staged_trades').delete().eq('id', id);
  _stageTrades = _stageTrades.filter(t => t.id !== id);
}

// ── Edge Function / AI Chat ───────────────────────────────────────────────────

function _edgeUrl() { return localStorage.getItem('hype_edge_fn_url') || ''; }

// ── Page entry ────────────────────────────────────────────────────────────────

async function loadAI() {
  const el = document.getElementById('ai-content');
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div> Loading…</div>`;
  await _stageLoad();
  el.innerHTML = _renderAIPage();
}

function _renderAIPage() {
  return `<div class="ai-layout"><div class="ai-left">${_renderStagePanel()}</div><div class="ai-right">${_renderChatPanel()}</div></div>`;
}

// ── Trade Staging ─────────────────────────────────────────────────────────────

function _renderStagePanel() {
  const active  = _stageTrades.filter(t => t.status === 'staged' || t.status === 'watching');
  const history = _stageTrades.filter(t => t.status === 'executed' || t.status === 'cancelled');
  return `
  <div class="stage-panel">
    <div class="stage-panel-header">Trade Staging</div>

    <div class="stage-form">
      <div class="stage-row">
        <div class="stage-field">
          <label class="form-label">Coin</label>
          <select class="input" id="sf-coin">
            ${_STAGE_COINS.map(c => `<option>${c}</option>`).join('')}
          </select>
        </div>
        <div class="stage-field">
          <label class="form-label">Direction</label>
          <select class="input" id="sf-dir">
            ${_STAGE_DIRS.map(d => `<option>${d}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="stage-row">
        <div class="stage-field">
          <label class="form-label">Entry $</label>
          <input class="input" id="sf-entry" type="number" step="any" placeholder="optional">
        </div>
        <div class="stage-field">
          <label class="form-label">Stop $</label>
          <input class="input" id="sf-sl" type="number" step="any" placeholder="optional">
        </div>
        <div class="stage-field">
          <label class="form-label">Target $</label>
          <input class="input" id="sf-tp" type="number" step="any" placeholder="optional">
        </div>
      </div>
      <div>
        <label class="form-label">Rationale</label>
        <textarea class="input" id="sf-rationale" rows="3" placeholder="Why are you staging this? What signals triggered it?" style="resize:vertical"></textarea>
      </div>
      <div>
        <label class="form-label">Tags</label>
        <input class="input" id="sf-tags" placeholder="breakout, funding reset, mvrv low…">
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:4px" onclick="stageTrade()">Stage Trade</button>
    </div>

    ${active.length ? `<div class="stage-section-lbl">Active (${active.length})</div><div class="stage-list">${active.map(_renderTradeCard).join('')}</div>` : ''}

    ${history.length ? `
    <details>
      <summary class="stage-section-lbl" style="cursor:pointer;list-style:none">
        <span>History (${history.length}) ▸</span>
      </summary>
      <div class="stage-list" style="margin-top:4px">${history.map(_renderTradeCard).join('')}</div>
    </details>` : ''}

    ${!_stageTrades.length ? `<div class="news-empty">No staged trades yet. Use the form above to track your next setup.</div>` : ''}
  </div>`;
}

function _renderTradeCard(t) {
  const dirCls  = (t.direction === 'Long' || t.direction === 'Spot Buy') ? 'pos' : 'neg';
  const stColor = { staged: 'var(--yellow)', watching: 'var(--accent)', executed: 'var(--green)', cancelled: 'var(--text-faint)' };
  const tags    = (t.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  const rr      = t.stop_loss && t.take_profit && t.entry_price
    ? Math.abs((t.take_profit - t.entry_price) / (t.entry_price - t.stop_loss)).toFixed(1)
    : null;
  const isActive = t.status === 'staged' || t.status === 'watching';
  return `
  <div class="trade-card${isActive ? '' : ' trade-card-dim'}">
    <div class="trade-card-head">
      <span style="font-weight:700;font-size:14px">${t.coin}</span>
      <span class="${dirCls}" style="font-weight:600;font-size:12px">${(t.direction || '').toUpperCase()}</span>
      <span style="color:${stColor[t.status]||'var(--text-faint)'};font-size:10px;text-transform:uppercase">${t.status}</span>
      <div style="margin-left:auto;display:flex;gap:3px">
        ${t.status === 'staged' ? `<button class="btn btn-ghost btn-sm" title="Watching" onclick="aiStatus('${t.id}','watching')">👁</button>` : ''}
        ${isActive ? `<button class="btn btn-ghost btn-sm" title="Executed" onclick="aiStatus('${t.id}','executed')">✓</button>` : ''}
        ${isActive ? `<button class="btn btn-ghost btn-sm" title="Cancel" onclick="aiStatus('${t.id}','cancelled')">✕</button>` : ''}
        <button class="btn btn-ghost btn-sm" title="Delete" onclick="aiDelete('${t.id}')">🗑</button>
      </div>
    </div>
    ${t.entry_price || t.stop_loss || t.take_profit ? `
    <div style="display:flex;gap:12px;margin-top:4px;font-size:11px;font-family:var(--mono)">
      ${t.entry_price ? `<span>Entry <strong>${(+t.entry_price).toLocaleString()}</strong></span>` : ''}
      ${t.stop_loss   ? `<span>SL <span class="neg">${(+t.stop_loss).toLocaleString()}</span></span>` : ''}
      ${t.take_profit ? `<span>TP <span class="pos">${(+t.take_profit).toLocaleString()}</span></span>` : ''}
      ${rr ? `<span>R:R <span style="color:var(--yellow)">${rr}x</span></span>` : ''}
    </div>` : ''}
    ${t.rationale ? `<div style="margin-top:6px;font-size:12px;color:var(--text-muted);line-height:1.55">${t.rationale}</div>` : ''}
    ${tags.length ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${tags.map(g => `<span class="news-tag">${g}</span>`).join('')}</div>` : ''}
    <div style="margin-top:6px;font-size:10px;color:var(--text-faint)">${new Date(t.created_at).toLocaleString()}</div>
  </div>`;
}

// ── AI Chat ───────────────────────────────────────────────────────────────────

function _renderChatPanel() {
  const url    = _edgeUrl();
  const active = !!url;
  return `
  <div class="chat-panel">
    <div class="chat-header">
      <span style="font-weight:600">AI Chat</span>
      <span style="font-size:11px;margin-left:6px;color:${active ? 'var(--green)' : 'var(--yellow)'}">${active ? '● Connected' : '● Not configured'}</span>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="toggleChatSetup()">⚙ Setup</button>
    </div>

    <div id="chat-setup" style="display:${active ? 'none' : 'block'};padding:12px 14px;background:var(--surface2);border-bottom:1px solid var(--border)">
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 8px">
        Your Anthropic API key stays secure in Supabase — never in the browser.<br>
        <strong>One-time setup:</strong>
      </p>
      <ol style="font-size:12px;color:var(--text-muted);margin:0 0 10px 16px;line-height:2">
        <li>Go to <strong>supabase.com</strong> → your project → <strong>Edge Functions</strong> → New Function → name it <code>claude-proxy</code></li>
        <li>Paste the code shown below, then deploy</li>
        <li>In Supabase → <strong>Settings → Secrets</strong> → add <code>ANTHROPIC_API_KEY</code> = your key</li>
        <li>Copy the function URL (e.g. <code>https://xxx.supabase.co/functions/v1/claude-proxy</code>) and paste below:</li>
      </ol>
      <div style="display:flex;gap:6px">
        <input class="input" id="edge-url-input" value="${url}" placeholder="https://xxx.supabase.co/functions/v1/claude-proxy" style="flex:1;font-size:11px;font-family:var(--mono)">
        <button class="btn btn-primary btn-sm" onclick="saveEdgeUrl()">Save</button>
      </div>
      <details style="margin-top:10px">
        <summary style="font-size:11px;cursor:pointer;color:var(--accent);margin-bottom:6px">Edge Function code (copy this)</summary>
        <pre class="chat-code-block" style="user-select:all">${_escHtml(_EDGE_FN)}</pre>
      </details>
    </div>

    <div class="chat-messages" id="chat-msgs">
      ${_chatMsgs.length
        ? _chatMsgs.map(_renderMsg).join('')
        : `<div style="padding:24px;text-align:center;color:var(--text-faint);font-size:13px">${active ? 'Ask me about your portfolio, market conditions, or trade ideas.' : 'Configure the Edge Function above to enable AI chat.'}</div>`
      }
    </div>

    <div class="chat-input-row">
      <textarea class="input" id="chat-input" rows="2" placeholder="Ask anything…" style="flex:1;resize:none" onkeydown="chatKey(event)" ${!active ? 'disabled' : ''}></textarea>
      <button class="btn btn-primary" id="chat-send" onclick="sendChat()" style="align-self:flex-end" ${!active ? 'disabled' : ''}>Send</button>
    </div>
  </div>`;
}

function _renderMsg(m) {
  const isUser = m.role === 'user';
  const body = m.content
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`(.+?)`/g,'<code style="background:var(--surface2);padding:1px 4px;border-radius:3px">$1</code>');
  return `
  <div class="chat-msg ${isUser ? 'chat-msg-user' : 'chat-msg-ai'}">
    <div class="chat-msg-lbl">${isUser ? 'You' : 'Claude'}</div>
    <div class="chat-msg-body">${body}</div>
  </div>`;
}

function _escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Edge Function template ────────────────────────────────────────────────────

const _EDGE_FN = `import Anthropic from "npm:@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { message, history = [] } = await req.json();
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];
    const res = await client.messages.create({
      model:      "claude-opus-4-8",
      max_tokens: 1024,
      system:     "You are a crypto trading analyst. Give concise, actionable insights about market conditions, trade setups, and portfolio positioning. Be direct.",
      messages,
    });
    return new Response(
      JSON.stringify({ reply: res.content[0]?.text || "" }),
      { headers: { "Content-Type": "application/json", ...cors } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
});`;

// ── Actions ───────────────────────────────────────────────────────────────────

async function stageTrade() {
  const coin      = document.getElementById('sf-coin')?.value;
  const direction = document.getElementById('sf-dir')?.value;
  const entry     = parseFloat(document.getElementById('sf-entry')?.value) || null;
  const sl        = parseFloat(document.getElementById('sf-sl')?.value)    || null;
  const tp        = parseFloat(document.getElementById('sf-tp')?.value)    || null;
  const rationale = document.getElementById('sf-rationale')?.value.trim() || '';
  const tags      = document.getElementById('sf-tags')?.value.trim()       || '';
  if (!coin || !direction) return;
  await _stageInsert({ coin, direction, entry_price: entry, stop_loss: sl, take_profit: tp, rationale, tags, status: 'staged' });
  document.getElementById('ai-content').innerHTML = _renderAIPage();
}

async function aiStatus(id, status) {
  await _stageSetStatus(id, status);
  document.getElementById('ai-content').innerHTML = _renderAIPage();
}

async function aiDelete(id) {
  if (!confirm('Delete this staged trade?')) return;
  await _stageDelete(id);
  document.getElementById('ai-content').innerHTML = _renderAIPage();
}

function toggleChatSetup() {
  const p = document.getElementById('chat-setup');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

function saveEdgeUrl() {
  const url = document.getElementById('edge-url-input')?.value.trim();
  if (url) localStorage.setItem('hype_edge_fn_url', url);
  else localStorage.removeItem('hype_edge_fn_url');
  document.getElementById('ai-content').innerHTML = _renderAIPage();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg   = input?.value.trim();
  if (!msg || _chatLoading) return;
  if (input) input.value = '';
  _chatMsgs.push({ role: 'user', content: msg });
  _chatLoading = true;
  _renderChatMsgs(true);
  const reply = await _callLLM('chat', msg, { history: _chatMsgs.slice(-12), maxTokens: 1024 });
  _chatMsgs.push({
    role: 'assistant',
    content: reply || 'LLM router unavailable — set hype_edge_fn_url in AI tab settings.',
  });
  _chatLoading = false;
  _renderChatMsgs(false);
}

function _renderChatMsgs(loading) {
  const el = document.getElementById('chat-msgs');
  if (!el) return;
  const spinner = `<div class="chat-msg chat-msg-ai"><div class="chat-msg-lbl">Claude</div><div class="chat-msg-body"><div class="spinner" style="width:14px;height:14px;border-width:2px"></div></div></div>`;
  el.innerHTML = _chatMsgs.map(_renderMsg).join('') + (loading ? spinner : '');
  el.scrollTop = el.scrollHeight;
}

function chatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}
