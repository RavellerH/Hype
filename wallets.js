// ── Wallets — read-only monitor for Rabby (EVM) and Phantom (Solana) addresses ─
// Public addresses only — nothing is signed, no wallet extension is connected.
// Sources (all keyless, CORS-enabled):
//   EVM:      Blockscout v2 per chain (native + ERC-20 balances with USD rates)
//   HyperEVM: rpc.hyperliquid.xyz/evm (native HYPE), priced from Hyperliquid mids
//   HL:       the same 0x address on Hyperliquid (perps equity + spot balances)
//   Solana:   JSON-RPC (SOL + SPL / Token-2022 accounts), priced via Jupiter Price v3
// Telegram alerts for these wallets run server-side in cloudflare/bot-worker.js
// (WATCH_WALLETS secret) — see docs/wallets.md.

const WAL_LIST_KEY  = 'hype_watch_wallets';     // [{ label, address, type: 'evm'|'sol', hl: bool }]
const WAL_RPC_KEY   = 'hype_solana_rpc';
const WAL_HIST_KEY  = 'hype_wallets_hist';      // [{ ts, total }]
const WAL_HIST_MAX  = 500;
const WAL_HIST_GAP  = 10 * 60 * 1000;           // at most one history point per 10 min
const WAL_POLL_MS   = 5 * 60 * 1000;
const WAL_MIN_USD   = 0.5;                      // hide dust below this

const WAL_EVM_CHAINS = [
  { id: 'eth',  name: 'Ethereum', api: 'https://eth.blockscout.com',      native: 'ETH'  },
  { id: 'base', name: 'Base',     api: 'https://base.blockscout.com',     native: 'ETH'  },
  { id: 'arb',  name: 'Arbitrum', api: 'https://arbitrum.blockscout.com', native: 'ETH'  },
  { id: 'op',   name: 'Optimism', api: 'https://optimism.blockscout.com', native: 'ETH'  },
  { id: 'pol',  name: 'Polygon',  api: 'https://polygon.blockscout.com',  native: 'POL'  },
  { id: 'gno',  name: 'Gnosis',   api: 'https://gnosis.blockscout.com',   native: 'xDAI' },
];
const WAL_HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';
// The official endpoint answers browser requests with 403, so keyless fallbacks
// that allow CORS go first. A personal RPC (Helius, QuickNode…) set in the tab wins.
const WAL_SOL_RPCS = [
  'https://solana-rpc.publicnode.com',
  'https://solana.api.onfinality.io/public',
  'https://api.mainnet-beta.solana.com',
];
const WAL_SOL_MINT = 'So11111111111111111111111111111111111111112';
const WAL_SPL_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
// Symbols for common mints — Jupiter's keyless price API returns prices, not names.
const WAL_SOL_SYMBOLS = {
  [WAL_SOL_MINT]: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: 'JTO',
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: 'PYTH',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: 'WIF',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 'mSOL',
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: 'JitoSOL',
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: 'bSOL',
  jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v: 'JupSOL',
  '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm': 'INF',
};

let _walPollId = null;
let _walData   = null;   // { ts, wallets: [{ label, address, type, total, assets[], errors[] }], total }
let _walBusy   = false;

// ── Storage ───────────────────────────────────────────────────────────────────

function _walList() {
  try { return JSON.parse(localStorage.getItem(WAL_LIST_KEY) || '[]'); } catch (_) { return []; }
}
function _walSaveList(list) { try { localStorage.setItem(WAL_LIST_KEY, JSON.stringify(list)); } catch (_) {} }
function _walRpcs() {
  let own = '';
  try { own = localStorage.getItem(WAL_RPC_KEY) || ''; } catch (_) {}
  return own ? [own, ...WAL_SOL_RPCS] : WAL_SOL_RPCS;
}
function _walHist() { try { return JSON.parse(localStorage.getItem(WAL_HIST_KEY) || '[]'); } catch (_) { return []; } }
function _walPushHist(total) {
  const h = _walHist();
  if (h.length && Date.now() - h.at(-1).ts < WAL_HIST_GAP) return;
  h.push({ ts: Date.now(), total });
  try { localStorage.setItem(WAL_HIST_KEY, JSON.stringify(h.slice(-WAL_HIST_MAX))); } catch (_) {}
}

function walAddrType(a) {
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return 'evm';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'sol';
  return null;
}
const _walShort = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
const _walEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Fetchers ──────────────────────────────────────────────────────────────────

// Blockscout instances throw transient 5xx (599 = upstream timeout) under load:
// retry twice with backoff before giving up on that chain.
async function _walJson(url, opts, tries = 3) {
  for (let i = 0; ; i++) {
    let r;
    try { r = await fetch(url, opts); }
    catch (e) { if (i + 1 >= tries) throw new Error(`${new URL(url).host} unreachable`); await new Promise(res => setTimeout(res, 800 * 2 ** i)); continue; }
    if (r.status === 404) return null;          // Blockscout: address never seen on this chain
    if (r.ok) return r.json();
    if ((r.status < 500 && r.status !== 429) || i + 1 >= tries) throw new Error(`${new URL(url).host} ${r.status}`);
    await new Promise(res => setTimeout(res, 800 * 2 ** i));
  }
}

async function _walEvmChain(addr, c) {
  const [info, toks] = await Promise.all([
    _walJson(`${c.api}/api/v2/addresses/${addr}`),
    _walJson(`${c.api}/api/v2/addresses/${addr}/token-balances`),
  ]);
  const out = [];
  const nat = info?.coin_balance ? Number(BigInt(info.coin_balance)) / 1e18 : 0;
  const natPx = +info?.exchange_rate || 0;
  if (nat > 0) out.push({ chain: c.name, symbol: c.native, amount: nat, price: natPx, usd: nat * natPx });
  for (const t of toks || []) {
    const tk = t.token || {};
    if (tk.type !== 'ERC-20') continue;
    const px = +tk.exchange_rate || 0;
    const dec = +tk.decimals || 0;
    if (!px || !t.value) continue;            // unpriced = mostly spam airdrops
    const amount = Number(BigInt(t.value)) / 10 ** dec;
    out.push({ chain: c.name, symbol: tk.symbol || '?', amount, price: px, usd: amount * px, contract: tk.address_hash || tk.address });
  }
  return out;
}

async function _walHyperEvm(addr, hypePx) {
  const r = await _walJson(WAL_HYPEREVM_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] }),
  });
  const amt = r?.result ? Number(BigInt(r.result)) / 1e18 : 0;
  return amt > 0 ? [{ chain: 'HyperEVM', symbol: 'HYPE', amount: amt, price: hypePx, usd: amt * hypePx }] : [];
}

// Spot pairs are mostly named "@123", so map base-token name → mid via the token table.
function _walSpotPx(spotMeta) {
  const px = {};
  const [meta, ctxs = []] = spotMeta || [];
  (meta?.universe || []).forEach((u, i) => {
    const p = +(ctxs[i]?.midPx || ctxs[i]?.markPx || 0);
    const base = meta.tokens?.[u.tokens?.[0]]?.name;
    if (p && base) px[base] = p;
  });
  return px;
}

async function _walHyperliquid(addr, spotMeta, mids) {
  const [state, spot] = await Promise.all([getClearinghouseState(addr), getSpotState(addr).catch(() => null)]);
  const s = parseAccountSummary(state);
  const perpUnr = parsePositions(state).reduce((a, p) => a + (p.unrealized_pnl || 0), 0);
  const spotPx = _walSpotPx(spotMeta);
  const out = (spot?.balances || []).map(b => {
    const amount = +b.total || 0;
    const price = b.coin === 'USDC' ? 1 : spotPx[b.coin] || +mids?.[b.coin] || 0;
    return { chain: 'Hyperliquid', symbol: b.coin, amount, price, usd: amount * price };
  }).filter(a => a.usd > 0);
  // Unified accounts already hold margin in spot USDC — only add unrealized PnL.
  const perp = s.isUnified ? perpUnr : s.account_value;
  if (Math.abs(perp) > 0.01) out.push({ chain: 'Hyperliquid', symbol: s.isUnified ? 'Perps uPnL' : 'Perps equity', amount: perp, price: 1, usd: perp });
  return out;
}

async function _walSolRpc(rpc, method, params) {
  const r = await fetch(rpc, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`solana rpc ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`solana rpc: ${j.error.message}`);
  return j.result;
}

// Returns raw holdings { mint → amount }; pricing happens once for all wallets.
async function _walSolHoldings(addr, rpc) {
  const [bal, ...accts] = await Promise.all([
    _walSolRpc(rpc, 'getBalance', [addr]),
    ...WAL_SPL_PROGRAMS.map(p => _walSolRpc(rpc, 'getTokenAccountsByOwner', [addr, { programId: p }, { encoding: 'jsonParsed' }])),
  ]);
  const h = {};
  const sol = (bal?.value || 0) / 1e9;
  if (sol > 0) h[WAL_SOL_MINT] = sol;
  for (const res of accts) {
    for (const a of res?.value || []) {
      const info = a.account?.data?.parsed?.info;
      const amt = +info?.tokenAmount?.uiAmount || 0;
      if (info?.mint && amt > 0) h[info.mint] = (h[info.mint] || 0) + amt;
    }
  }
  return h;
}

async function _walJupPrices(mints) {
  const px = {};
  for (let i = 0; i < mints.length; i += 50) {
    const ids = mints.slice(i, i + 50).join(',');
    try {
      const j = await _walJson(`https://lite-api.jup.ag/price/v3?ids=${ids}`);
      for (const [m, v] of Object.entries(j || {})) if (v?.usdPrice) px[m] = +v.usdPrice;
    } catch (e) { console.warn('[Wallets] jupiter:', e.message); }
  }
  return px;
}

async function walFetchAll() {
  const list = _walList();
  const evm = list.filter(w => w.type === 'evm');
  const sol = list.filter(w => w.type === 'sol');
  const [mids, spotMeta] = await Promise.all([
    hlPost({ type: 'allMids' }).catch(() => ({})),
    evm.some(w => w.hl !== false) ? getSpotMeta().catch(() => null) : null,
  ]);
  const hypePx = +mids?.HYPE || 0;

  const settle = async (w, jobs) => {
    const res = await Promise.allSettled(jobs.map(j => j.run()));
    const assets = [], errors = [];
    res.forEach((r, i) => r.status === 'fulfilled' ? assets.push(...r.value) : errors.push(`${jobs[i].name}: ${r.reason?.message || r.reason}`));
    return { ...w, assets, errors };
  };

  const evmOut = await Promise.all(evm.map(w => settle(w, [
    ...WAL_EVM_CHAINS.map(c => ({ name: c.name, run: () => _walEvmChain(w.address, c) })),
    { name: 'HyperEVM', run: () => _walHyperEvm(w.address, hypePx) },
    ...(w.hl !== false ? [{ name: 'Hyperliquid', run: () => _walHyperliquid(w.address, spotMeta, mids) }] : []),
  ])));

  const rpcs = _walRpcs();
  const solRaw = await Promise.all(sol.map(async w => {
    const tried = [];
    for (const rpc of rpcs) {
      try { return { w, h: await _walSolHoldings(w.address, rpc) }; }
      catch (e) { tried.push(`${new URL(rpc).host} ${e.message.replace(/^solana rpc:? ?/, '')}`); }
    }
    return { w, h: {}, err: `Solana: all RPCs failed (${tried.join('; ')}) — set your own RPC below` };
  }));
  const prices = await _walJupPrices([...new Set(solRaw.flatMap(s => Object.keys(s.h)))]);
  const solOut = solRaw.map(({ w, h, err }) => {
    const assets = [];
    let hidden = 0;
    for (const [mint, amount] of Object.entries(h)) {
      const price = prices[mint] || 0;
      if (!price) { hidden++; continue; }
      assets.push({ chain: 'Solana', symbol: WAL_SOL_SYMBOLS[mint] || _walShort(mint), amount, price, usd: amount * price, mint });
    }
    return { ...w, assets, errors: err ? [err] : [], hidden };
  });

  const wallets = [...evmOut, ...solOut].map(w => {
    w.assets = w.assets.filter(a => Math.abs(a.usd) >= WAL_MIN_USD).sort((a, b) => b.usd - a.usd);
    w.total = w.assets.reduce((s, a) => s + a.usd, 0);
    return w;
  });
  return { ts: Date.now(), wallets, total: wallets.reduce((s, w) => s + w.total, 0) };
}

// ── Polling ───────────────────────────────────────────────────────────────────

function stopWalletsPolling() { if (_walPollId) { clearInterval(_walPollId); _walPollId = null; } }

async function walRefresh() {
  if (_walBusy) return;
  _walBusy = true;
  const st = document.getElementById('wal-status');
  if (st) st.textContent = 'refreshing…';
  try {
    _walData = await walFetchAll();
    if (_walData.wallets.length) _walPushHist(_walData.total);
  } catch (e) {
    console.warn('[Wallets] refresh failed:', e.message);
  } finally {
    _walBusy = false;
    _walRender();
  }
}

async function loadWallets() {
  const el = document.getElementById('wallets-content');
  if (!el) return;
  stopWalletsPolling();
  if (!_walData) {
    el.innerHTML = '<div class="loading"><div class="spinner"></div> Reading wallets…</div>';
    await walRefresh();
  } else {
    _walRender();
    walRefresh();
  }
  _walPollId = setInterval(() => { if (currentPage === 'wallets' && !document.hidden) walRefresh(); }, WAL_POLL_MS);
}

// ── Wallet management ─────────────────────────────────────────────────────────

function walAdd() {
  const addr = document.getElementById('wal-addr')?.value.trim();
  const label = document.getElementById('wal-label')?.value.trim();
  const type = walAddrType(addr || '');
  const msg = document.getElementById('wal-form-msg');
  if (!type) { if (msg) msg.textContent = 'Not a valid EVM (0x…) or Solana address'; return; }
  const list = _walList();
  if (list.some(w => w.address.toLowerCase() === addr.toLowerCase())) { if (msg) msg.textContent = 'Already added'; return; }
  list.push({ label: label || (type === 'evm' ? 'Rabby' : 'Phantom'), address: addr, type, hl: true });
  _walSaveList(list);
  _walData = null;
  loadWallets();
}

function walRemove(addr) {
  if (!confirm(`Stop monitoring ${_walShort(addr)}?`)) return;
  _walSaveList(_walList().filter(w => w.address !== addr));
  _walData = null;
  loadWallets();
}

function walToggleHL(addr) {
  _walSaveList(_walList().map(w => w.address === addr ? { ...w, hl: w.hl === false } : w));
  _walData = null;
  loadWallets();
}

function walSaveRpc() {
  const v = document.getElementById('wal-rpc')?.value.trim();
  try { v ? localStorage.setItem(WAL_RPC_KEY, v) : localStorage.removeItem(WAL_RPC_KEY); } catch (_) {}
  _walData = null;
  loadWallets();
}

function walCopyBotConfig() {
  const v = _walList().map(w => `${w.label.replace(/[:,]/g, '')}:${w.address}`).join(',');
  navigator.clipboard?.writeText(v);
  const m = document.getElementById('wal-bot-msg');
  if (m) m.textContent = 'Copied — paste it into: npx wrangler secret put WATCH_WALLETS --config wrangler-bot.toml';
}

// ── Render ────────────────────────────────────────────────────────────────────

function _walSpark(hist) {
  if (hist.length < 2) return '';
  const v = hist.map(h => h.total), lo = Math.min(...v), hi = Math.max(...v), rng = hi - lo || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1) * 300).toFixed(1)},${(38 - (x - lo) / rng * 36).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 300 40" preserveAspectRatio="none" style="width:100%;height:40px;margin-top:8px">
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>`;
}

function _walStat(label, value, sub = '') {
  return `<div class="stat-card">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted)">${label}</div>
    <div style="font-size:18px;font-weight:700;margin-top:4px">${value}</div>
    ${sub ? `<div style="font-size:11px;margin-top:2px">${sub}</div>` : ''}
  </div>`;
}

function _walRender() {
  const el = document.getElementById('wallets-content');
  if (!el) return;
  const list = _walList();
  const d = _walData;

  const form = `<div class="card">
    <div class="card-title">Add a wallet — public address only, never a seed phrase or private key</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input class="input" id="wal-label" placeholder="Label (e.g. Rabby main)" style="flex:1;min-width:140px">
      <input class="input" id="wal-addr" placeholder="0x… (Rabby / EVM) or Solana address (Phantom)" style="flex:3;min-width:220px;font-family:var(--mono);font-size:11px">
      <button class="btn btn-primary btn-sm" onclick="walAdd()">+ Add</button>
    </div>
    <div id="wal-form-msg" style="font-size:11px;color:var(--red);margin-top:6px"></div>
  </div>`;

  if (!list.length) {
    el.innerHTML = `<div class="section-title" style="margin-bottom:10px">👛 Wallets — Rabby & Phantom</div>${form}
      <div class="card" style="font-size:12px;color:var(--text-muted)">No wallets yet. Add a Rabby (EVM) address to track Ethereum, Base, Arbitrum,
      Optimism, Polygon, Gnosis, HyperEVM and its Hyperliquid account; add a Phantom (Solana) address to track SOL and SPL tokens.</div>`;
    return;
  }

  const hist = _walHist();
  const prev = hist.length > 1 ? hist[0] : null;
  const chg = d && prev ? d.total - prev.total : null;
  const byChain = {};
  const byAsset = {};
  (d?.wallets || []).forEach(w => w.assets.forEach(a => {
    byChain[a.chain] = (byChain[a.chain] || 0) + a.usd;
    const k = a.symbol;
    byAsset[k] = byAsset[k] || { symbol: k, amount: 0, usd: 0, price: a.price };
    byAsset[k].amount += a.amount; byAsset[k].usd += a.usd;
  }));
  const chains = Object.entries(byChain).sort((a, b) => b[1] - a[1]);
  const top = Object.values(byAsset).sort((a, b) => b.usd - a.usd).slice(0, 12);

  const summary = d ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px">
    ${_walStat('Net worth', fmt$(d.total), chg != null ? `<span class="${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '+' : ''}${fmt$(chg)} since ${new Date(prev.ts).toLocaleDateString()}</span>` : '')}
    ${_walStat('Wallets', list.length, `${list.filter(w => w.type === 'evm').length} EVM · ${list.filter(w => w.type === 'sol').length} Solana`)}
    ${_walStat('Chains', chains.length, chains[0] ? `largest: ${chains[0][0]}` : '')}
    ${_walStat('Top asset', top[0]?.symbol || '—', top[0] ? fmt$(top[0].usd) : '')}
  </div>` : '';

  const chainBar = chains.length && d.total > 0 ? `<div class="card">
    <div class="card-title">By chain</div>
    ${chains.map(([c, v]) => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin:4px 0">
      <span style="width:80px;flex-shrink:0">${_walEsc(c)}</span>
      <div style="flex:1;height:8px;background:var(--bg);border-radius:4px;overflow:hidden"><div style="width:${Math.max(0, v / d.total * 100).toFixed(1)}%;height:100%;background:var(--accent)"></div></div>
      <span style="min-width:150px;text-align:right;font-family:var(--mono);white-space:nowrap">${fmt$(v)} · ${(v / d.total * 100).toFixed(1)}%</span>
    </div>`).join('')}
    ${_walSpark(hist)}
  </div>` : '';

  const walletCards = (d?.wallets || []).map(w => `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
      <div class="card-title" style="margin:0">${w.type === 'evm' ? '🦊' : '👻'} ${_walEsc(w.label)} <span style="font-family:var(--mono);font-size:11px;color:var(--text-faint)">${_walShort(w.address)}</span></div>
      <div style="font-size:11px;display:flex;gap:10px;align-items:center">
        <b>${fmt$(w.total)}</b>
        ${w.type === 'evm' ? `<label style="cursor:pointer"><input type="checkbox" ${w.hl !== false ? 'checked' : ''} onchange="walToggleHL('${w.address}')"> incl. Hyperliquid</label>` : ''}
        <a href="javascript:walRemove('${w.address}')" style="color:var(--red)">remove</a>
      </div>
    </div>
    ${w.assets.length ? `<div class="table-wrap"><table class="mobile-cards" style="margin-top:8px"><thead><tr><th>Asset</th><th>Chain</th><th style="text-align:right">Amount</th><th style="text-align:right">Price</th><th style="text-align:right">Value</th><th style="text-align:right">%</th></tr></thead><tbody>
      ${w.assets.map(a => `<tr><td><b>${_walEsc(a.symbol)}</b></td><td>${_walEsc(a.chain)}</td>
        <td style="text-align:right;font-family:var(--mono)">${a.amount.toLocaleString('en-US', { maximumFractionDigits: a.amount < 1 ? 6 : 2 })}</td>
        <td style="text-align:right;font-family:var(--mono)">${a.price >= 1 ? fmt$(a.price) : '$' + a.price.toPrecision(4)}</td>
        <td style="text-align:right;font-family:var(--mono)" class="${a.usd < 0 ? 'neg' : ''}">${fmt$(a.usd)}</td>
        <td style="text-align:right">${w.total > 0 ? (a.usd / w.total * 100).toFixed(1) : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div style="font-size:12px;color:var(--text-muted);margin-top:8px">No priced balances found.</div>'}
    ${w.hidden ? `<div style="font-size:10px;color:var(--text-faint);margin-top:4px">${w.hidden} unpriced token(s) hidden (likely spam or illiquid)</div>` : ''}
    ${w.errors.length ? `<div style="font-size:10px;color:var(--yellow, #e3b341);margin-top:4px">⚠ couldn't read: ${w.errors.map(_walEsc).join(' · ')} — total may be incomplete, retried automatically on next refresh</div>` : ''}
  </div>`).join('');

  const settings = `<div class="card">
    <div class="card-title">Settings & Telegram alerts</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12px">
      <span>Solana RPC</span>
      <input class="input" id="wal-rpc" value="${_walEsc(localStorage.getItem(WAL_RPC_KEY) || '')}" placeholder="optional — e.g. https://mainnet.helius-rpc.com/?api-key=… (free); default uses public RPCs" style="flex:1;min-width:220px;font-family:var(--mono);font-size:11px">
      <button class="btn btn-ghost btn-sm" onclick="walSaveRpc()">Save</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:12px">
      <button class="btn btn-ghost btn-sm" onclick="walCopyBotConfig()">Copy WATCH_WALLETS for the bot</button>
      <span id="wal-bot-msg" style="font-size:11px;color:var(--text-faint)">The bot worker checks these wallets hourly and alerts on big value moves and token in/outflows.</span>
    </div>
  </div>`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:4px">
      <span class="section-title">👛 Wallets — Rabby & Phantom</span>
      <span style="font-size:11px;color:var(--text-faint)"><span id="wal-status">${d ? `updated ${new Date(d.ts).toLocaleTimeString()}` : ''}</span> · <a href="javascript:walRefresh()" style="color:var(--accent)">↺ refresh</a></span>
    </div>
    ${summary}
    ${chainBar}
    ${walletCards}
    ${form}
    ${settings}`;
}
