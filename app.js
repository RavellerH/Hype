// ── Config ───────────────────────────────────────────────────────────────────
const HL = 'https://api.hyperliquid.xyz/info';
const HL_WS = 'wss://api.hyperliquid.xyz/ws';
const DEFAULT_WALLET = '0x6e4c6da09f06690cc4db53d42ab539d3d4882015';
let currentWallet = localStorage.getItem('hype_wallet') || DEFAULT_WALLET;
let currentPage = 'overview';
let phaseInterval = '1h';
let activeNarrative = 'all';
let autoRefreshTimer = null;
let marketSortKey = 'volume';
let allMarketData = [];

// ── WebSocket state ───────────────────────────────────────────────────────────
let ws = null;
let wsReconnectTimer = null;
let wsConnected = false;
let livePrices = {};
let livePrevDay = {};
let livePositions = [];
let priceHistory = {};
let priceAlerts = [];
let monitorActive = false;

const MONITOR_COINS = ['BTC','ETH','SOL','HYPE','SUI','AVAX','DOGE','WIF','PEPE','ARB','OP','INJ'];
const TA_COINS = ['BTC','ETH','SOL','HYPE'];
const PHASE_COINS = ['BTC','ETH','SOL','HYPE'];
let taCoin = 'BTC', taTf = '1h', taLoading = false, taOIPrev = {};

// Narrative groupings
const NARRATIVES = {
  all:     { label: '🌐 All', coins: null },
  featured:{ label: '⭐ Featured', coins: ['BTC','ETH','SOL','HYPE'] },
  l1:      { label: '⛓ L1s', coins: ['BTC','ETH','SOL','AVAX','SUI','APT','NEAR','SEI','INJ','TIA','ATOM'] },
  l2:      { label: '🔷 L2s', coins: ['ARB','OP','MATIC','STRK','MANTA','BLAST','SCROLL','ZK'] },
  defi:    { label: '🏦 DeFi', coins: ['UNI','AAVE','CRV','SNX','GMX','LDO','PENDLE','ENA','MKR','COMP','BAL','DYDX'] },
  meme:    { label: '🐸 Meme', coins: ['DOGE','SHIB','WIF','PEPE','BONK','FLOKI','NEIRO','MOODENG','PNUT','GOAT','MEME','BRETT'] },
  ai:      { label: '🤖 AI', coins: ['TAO','RNDR','FET','AGIX','OCEAN','WLD','ARKM','GRT'] },
  btceco:  { label: '🟠 BTC Eco', coins: ['ORDI','SATS','MUBI','RATS','TRAC'] },
  gaming:  { label: '🎮 Gaming', coins: ['AXS','IMX','GALA','SAND','MANA','ENJ','BEAM','RON'] },
};

// ── Hyperliquid API ───────────────────────────────────────────────────────────
async function hlPost(payload) {
  const r = await fetch(HL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  if (!r.ok) throw new Error(`HL API ${r.status}`);
  return r.json();
}
async function getClearinghouseState(w) { return hlPost({ type:'clearinghouseState', user:w }); }
async function getUserFills(w) { return hlPost({ type:'userFills', user:w }); }
async function getUserFunding(w, days=30) { return hlPost({ type:'userFunding', user:w, startTime:Date.now()-days*86400000 }); }
async function getLedgerUpdates(w, days=90) { return hlPost({ type:'userNonFundingLedgerUpdates', user:w, startTime:Date.now()-days*86400000 }); }
async function getMetaAndAssetCtxs() { return hlPost({ type:'metaAndAssetCtxs' }); }
async function getCandles(coin, interval='1h', days=7) {
  const endTime = Date.now();
  return hlPost({ type:'candleSnapshot', req:{ coin, interval, startTime:endTime-days*86400000, endTime } });
}
async function getOpenOrders(w) { return hlPost({ type:'openOrders', user:w }); }

// ── Parsers ───────────────────────────────────────────────────────────────────
function parsePositions(state) {
  return (state.assetPositions||[]).map(pos=>{
    const p=pos.position||{}; const szi=parseFloat(p.szi||0);
    if(szi===0) return null;
    const lev=p.leverage||{};
    return { coin:p.coin, side:szi>0?'long':'short', size:Math.abs(szi),
      entry_price:parseFloat(p.entryPx||0), unrealized_pnl:parseFloat(p.unrealizedPnl||0),
      leverage_type:lev.type||'cross', leverage_value:lev.value||1,
      liquidation_price:parseFloat(p.liquidationPx||0),
      margin_used:parseFloat(p.marginUsed||0), position_value:parseFloat(p.positionValue||0),
      cum_funding:parseFloat((p.cumFunding||{}).sinceOpen||0) };
  }).filter(Boolean);
}
function parseAccountSummary(state) {
  const m=state.marginSummary||{};
  return { account_value:parseFloat(m.accountValue||0), total_margin_used:parseFloat(m.totalMarginUsed||0),
    total_ntl_pos:parseFloat(m.totalNtlPos||0), withdrawable:parseFloat(state.withdrawable||0) };
}
function parseFills(fills) {
  return (fills||[]).map(f=>({time:f.time,coin:f.coin,side:f.side,price:parseFloat(f.px||0),size:parseFloat(f.sz||0),fee:parseFloat(f.fee||0),closed_pnl:parseFloat(f.closedPnl||0)})).sort((a,b)=>b.time-a.time);
}
function parseFunding(funding) {
  return (funding||[]).map(f=>({time:f.time,coin:(f.delta||{}).coin,funding_rate:parseFloat((f.delta||{}).fundingRate||0),usdc:parseFloat((f.delta||{}).usdc||0)})).sort((a,b)=>b.time-a.time);
}
function parseLedger(ledger) {
  return (ledger||[]).map(e=>{ const d=e.delta||{}; const usdc=parseFloat(d.usdc||0); return {time:e.time,type:d.type||'',usdc,direction:usdc>=0?'inflow':'outflow',hash:d.hash||''}; }).sort((a,b)=>b.time-a.time);
}

function parseMarketData([meta, assetCtxs]) {
  const universe = meta.universe || [];
  return universe.map((asset, i) => {
    const ctx = assetCtxs[i] || {};
    const markPx = parseFloat(ctx.markPx || ctx.midPx || 0);
    const prevPx = parseFloat(ctx.prevDayPx || markPx);
    const changePct = prevPx > 0 ? ((markPx - prevPx) / prevPx * 100) : 0;
    const oi = parseFloat(ctx.openInterest || 0);
    const oiUsd = oi * markPx;
    const volume = parseFloat(ctx.dayNtlVlm || 0);
    const funding = parseFloat(ctx.funding || 0);
    return {
      coin: asset.name,
      price: markPx,
      prev_price: prevPx,
      change_pct: changePct,
      oi: oi,
      oi_usd: oiUsd,
      volume: volume,
      funding: funding,
      funding_apr: funding * 3 * 365 * 100,
    };
  }).filter(d => d.price > 0);
}

// ── Phase Detector (Wyckoff) ──────────────────────────────────────────────────
function detectPhase(candles) {
  if (!candles||candles.length<20) return {phase:'NEUTRAL',confidence:0,price_trend:'flat',volume_trend:'neutral',range_compression:false,signals:['Not enough data'],score:0};
  const closes=candles.map(c=>parseFloat(c.c)),volumes=candles.map(c=>parseFloat(c.v));
  const highs=candles.map(c=>parseFloat(c.h)),lows=candles.map(c=>parseFloat(c.l));
  const n=candles.length, price=closes.at(-1);

  // EMA bias
  const ema20=iEMA(closes,20);
  const ema50=closes.length>=50?iEMA(closes,50):null;
  const e20=ema20.at(-1), e20p=ema20.at(-Math.min(6,n));
  const e50=ema50?ema50.at(-1):null, e50p=ema50?ema50.at(-Math.min(6,n)):null;
  const aboveE20=price>e20, aboveE50=ema50?price>e50:aboveE20;
  const e20Slope=(e20-e20p)/e20p;
  const e50Slope=e50&&e50p?(e50-e50p)/e50p:0;

  // Price change over last ~20% of period
  const lb=Math.max(5,Math.floor(n*0.2));
  const pctChg=(price-closes[n-lb-1])/(closes[n-lb-1]||1);

  // Volume: last quarter vs first quarter
  const q=Math.max(4,Math.floor(n/4));
  const avgV=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
  const volRatio=avgV(volumes.slice(-q))/Math.max(avgV(volumes.slice(0,q)),1);

  // ATR-based range compression
  const atrArr=iATR(highs,lows,closes,14);
  const atrNow=atrArr.at(-1)||0;
  const atrEarly=avgV(atrArr.slice(0,Math.floor(n/4)).filter(Boolean))||atrNow||1;
  const atrRatio=atrNow/atrEarly;
  const rangeCompressed=atrRatio<0.65;

  // RSI
  const rsiVal=iRSI(closes).filter(v=>v!==null).at(-1)||50;

  const signals=[];
  let score=0;

  // 1. EMA stack
  if(aboveE20&&aboveE50){score+=0.25;signals.push('Above EMA 20 & 50 — bullish structure');}
  else if(!aboveE20&&!aboveE50){score-=0.25;signals.push('Below EMA 20 & 50 — bearish structure');}
  else{score+=aboveE20?0.05:-0.05;signals.push('Mixed EMA alignment');}

  // 2. EMA slope
  if(e20Slope>0.004){score+=0.15;signals.push('EMA 20 rising — momentum building');}
  else if(e20Slope<-0.004){score-=0.15;signals.push('EMA 20 declining — momentum fading');}
  if(e50&&e50Slope>0.002){score+=0.08;}
  else if(e50&&e50Slope<-0.002){score-=0.08;}

  // 3. Recent price change
  if(pctChg>0.04){score+=0.2;signals.push(`Price +${(pctChg*100).toFixed(1)}% recent`);}
  else if(pctChg<-0.04){score-=0.2;signals.push(`Price ${(pctChg*100).toFixed(1)}% recent`);}
  else{signals.push(`Price flat (${(pctChg*100).toFixed(1)}%)`);}

  // 4. Volume vs trend
  const volTrend=volRatio>1.3?'expanding':volRatio<0.75?'contracting':'neutral';
  if(aboveE20&&volTrend==='expanding'){score+=0.2;signals.push(`Vol ${volRatio.toFixed(1)}x avg — expanding in uptrend (markup)`);}
  else if(!aboveE20&&volTrend==='expanding'){score-=0.2;signals.push(`Vol ${volRatio.toFixed(1)}x avg — expanding in downtrend (markdown)`);}
  else if(volTrend==='contracting'&&Math.abs(pctChg)<0.03){score+=0.2;signals.push('Low vol + tight range — accumulation zone');}
  else if(volTrend==='contracting'&&pctChg<-0.02){score-=0.1;signals.push('Shrinking vol on drop — exhaustion / base forming');}

  // 5. Range compression
  if(rangeCompressed){signals.push(`ATR at ${(atrRatio*100).toFixed(0)}% of avg — compressed (breakout watch)`);}

  // 6. RSI context
  if(rsiVal>70){signals.push(`RSI ${rsiVal.toFixed(0)} — overbought`);if(score>0.2)score-=0.1;}
  else if(rsiVal<30){signals.push(`RSI ${rsiVal.toFixed(0)} — oversold`);if(score<-0.2)score+=0.1;}
  else{signals.push(`RSI ${rsiVal.toFixed(0)}`);}

  score=Math.max(-1,Math.min(1,score));
  const phase=score>=0.45?'MARKUP':score>=0.12?'ACCUMULATION':score<=-0.45?'MARKDOWN':score<=-0.12?'DISTRIBUTION':'NEUTRAL';
  const price_trend=pctChg>0.03?'up':pctChg<-0.03?'down':'flat';
  return {phase,confidence:+Math.min(Math.abs(score)+0.05*Math.min(n/60,1),1).toFixed(3),price_trend,volume_trend:volTrend,range_compression:rangeCompressed,signals,score:+score.toFixed(4)};
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(page) {
  try {
    if (currentPage === 'monitor' && page !== 'monitor') disconnectWS();
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nav-item,.bottom-nav-item').forEach(n=>n.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (!pageEl) return;
    pageEl.classList.add('active');
    document.querySelectorAll(`[data-page="${page}"]`).forEach(el=>el.classList.add('active'));
    currentPage = page;
    const loaders={overview:loadOverview,trades:loadTrades,funding:loadFunding,flows:loadFlows,monitor:loadMonitor,markets:loadMarkets,phases:loadPhases,intel:typeof loadIntel!=='undefined'?loadIntel:null,watchlist:loadWatchlist};
    if(loaders[page]) loaders[page]();
  } catch(e) { console.error('navigate error:', e); }
}
function refreshAll(){navigate(currentPage);}

// ── Overview ──────────────────────────────────────────────────────────────────
async function loadOverview(){
  const el=document.getElementById('overview-content');
  el.innerHTML=loading();
  try{
    setStatus(true);
    const [state,orders]=await Promise.all([getClearinghouseState(currentWallet),getOpenOrders(currentWallet)]);
    const s=parseAccountSummary(state),positions=parsePositions(state);
    const totalUnr=positions.reduce((a,p)=>a+p.unrealized_pnl,0);
    el.innerHTML=`
      <div class="grid-4">
        <div class="stat-card"><div class="stat-label">Account Value</div><div class="stat-value">${fmt$(s.account_value)}</div><div class="stat-sub">Withdrawable ${fmt$(s.withdrawable)}</div></div>
        <div class="stat-card"><div class="stat-label">Notional</div><div class="stat-value">${fmt$(s.total_ntl_pos)}</div><div class="stat-sub">${positions.length} pos</div></div>
        <div class="stat-card"><div class="stat-label">Margin Used</div><div class="stat-value">${fmt$(s.total_margin_used)}</div><div class="stat-sub">${s.account_value>0?((s.total_margin_used/s.account_value)*100).toFixed(1):0}%</div></div>
        <div class="stat-card"><div class="stat-label">Unr. PnL</div><div class="stat-value ${totalUnr>=0?'pos':'neg'}">${fmt$(totalUnr)}</div></div>
      </div>
      <div class="card">
        <div class="card-title">Open Positions</div>
        ${positions.length===0?'<div class="empty-state">No open positions</div>':`
        <div class="table-wrap"><table>
          <thead><tr><th>Coin</th><th>Side</th><th>Size</th><th>Entry</th><th>Liq</th><th>PnL</th><th>Lev</th></tr></thead>
          <tbody>${positions.map(p=>`<tr>
            <td class="accent">${p.coin}</td>
            <td><span class="side-badge ${p.side}">${p.side==='long'?'L':'S'}</span></td>
            <td>${p.size}</td><td>${fmt$(p.entry_price)}</td>
            <td class="${p.liquidation_price>0?'neg':'muted'}">${p.liquidation_price>0?fmt$(p.liquidation_price):'—'}</td>
            <td class="${p.unrealized_pnl>=0?'pos':'neg'}">${fmt$(p.unrealized_pnl)}</td>
            <td class="muted">${p.leverage_value}x</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
      ${orders.length>0?`<div class="card"><div class="card-title">Open Orders (${orders.length})</div><div class="table-wrap"><table>
        <thead><tr><th>Coin</th><th>Side</th><th>Size</th><th>Limit</th></tr></thead>
        <tbody>${orders.map(o=>`<tr><td class="accent">${o.coin}</td><td><span class="side-badge ${o.side==='B'?'long':'short'}">${o.side==='B'?'B':'S'}</span></td><td>${o.sz}</td><td>${o.limitPx?fmt$(parseFloat(o.limitPx)):'—'}</td></tr>`).join('')}</tbody>
      </table></div></div>`:''}`;
    setRefreshTime();
  }catch(e){el.innerHTML=err(e);setStatus(false);}
}

// ── Trades ────────────────────────────────────────────────────────────────────
async function loadTrades(){
  const el=document.getElementById('trades-content');
  el.innerHTML=loading();
  try{
    const fills=parseFills(await getUserFills(currentWallet));
    const totalPnl=fills.reduce((a,f)=>a+f.closed_pnl,0);
    const wins=fills.filter(f=>f.closed_pnl>0).length,losses=fills.filter(f=>f.closed_pnl<0).length;
    el.innerHTML=`
      <div class="grid-4">
        <div class="stat-card"><div class="stat-label">Fills</div><div class="stat-value">${fills.length}</div></div>
        <div class="stat-card"><div class="stat-label">Realized PnL</div><div class="stat-value ${totalPnl>=0?'pos':'neg'}">${fmt$(totalPnl)}</div></div>
        <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value">${fills.length>0?(wins/fills.length*100).toFixed(1):0}%</div><div class="stat-sub">${wins}W / ${losses}L</div></div>
        <div class="stat-card"><div class="stat-label">Fees</div><div class="stat-value neg">−${fmt$(fills.reduce((a,f)=>a+f.fee,0))}</div></div>
      </div>
      <div class="card"><div class="card-title">Fill History</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Coin</th><th>Side</th><th>Price</th><th>Size</th><th>PnL</th></tr></thead>
          <tbody>${fills.slice(0,200).map(f=>`<tr>
            <td class="muted">${fmtTime(f.time)}</td><td class="accent">${f.coin}</td>
            <td><span class="side-badge ${f.side==='B'?'long':'short'}">${f.side==='B'?'B':'S'}</span></td>
            <td>${fmt$(f.price)}</td><td>${f.size}</td>
            <td class="${f.closed_pnl>=0?'pos':'neg'}">${f.closed_pnl!==0?fmt$(f.closed_pnl):'—'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    setRefreshTime();
  }catch(e){el.innerHTML=err(e);}
}

// ── Funding ───────────────────────────────────────────────────────────────────
async function loadFunding(){
  const el=document.getElementById('funding-content');
  el.innerHTML=loading();
  try{
    const funding=parseFunding(await getUserFunding(currentWallet,30));
    const totalUsdc=funding.reduce((a,f)=>a+f.usdc,0);
    const byCoin={};
    for(const f of funding){const c=f.coin||'?';byCoin[c]=(byCoin[c]||0)+f.usdc;}
    const coinRows=Object.entries(byCoin).sort((a,b)=>a[1]-b[1]);
    el.innerHTML=`
      <div class="grid-3">
        <div class="stat-card"><div class="stat-label">Total 30d</div><div class="stat-value ${totalUsdc>=0?'pos':'neg'}">${fmt$(totalUsdc)}</div><div class="stat-sub">+ received, − paid</div></div>
        <div class="stat-card"><div class="stat-label">Most Costly</div><div class="stat-value accent">${coinRows[0]?.[0]||'—'}</div><div class="stat-sub">${coinRows[0]?fmt$(coinRows[0][1]):''}</div></div>
        <div class="stat-card"><div class="stat-label">Coins</div><div class="stat-value">${coinRows.length}</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-title">By Coin</div><div class="table-wrap"><table>
          <thead><tr><th>Coin</th><th>USDC</th></tr></thead>
          <tbody>${coinRows.map(([c,u])=>`<tr><td class="accent">${c}</td><td class="${u>=0?'pos':'neg'}">${fmt$(u)}</td></tr>`).join('')}</tbody>
        </table></div></div>
        <div class="card"><div class="card-title">Recent</div><div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Coin</th><th>Rate</th><th>USDC</th></tr></thead>
          <tbody>${funding.slice(0,60).map(f=>`<tr>
            <td class="muted">${fmtTime(f.time)}</td><td class="accent">${f.coin||'?'}</td>
            <td class="${f.funding_rate>=0?'pos':'neg'}">${(f.funding_rate*100).toFixed(4)}%</td>
            <td class="${f.usdc>=0?'pos':'neg'}">${f.usdc.toFixed(4)}</td>
          </tr>`).join('')}</tbody>
        </table></div></div>
      </div>`;
    setRefreshTime();
  }catch(e){el.innerHTML=err(e);}
}

// ── My Flows ──────────────────────────────────────────────────────────────────
async function loadFlows(){
  const el=document.getElementById('flows-content');
  el.innerHTML=loading();
  try{
    const flows=parseLedger(await getLedgerUpdates(currentWallet,90));
    const totalIn=flows.filter(f=>f.usdc>0).reduce((a,f)=>a+f.usdc,0);
    const totalOut=flows.filter(f=>f.usdc<0).reduce((a,f)=>a+f.usdc,0);
    const net=totalIn+totalOut;
    el.innerHTML=`
      <div class="grid-3">
        <div class="stat-card"><div class="stat-label">Inflow 90d</div><div class="stat-value pos">${fmt$(totalIn)}</div></div>
        <div class="stat-card"><div class="stat-label">Outflow 90d</div><div class="stat-value neg">−${fmt$(Math.abs(totalOut))}</div></div>
        <div class="stat-card"><div class="stat-label">Net</div><div class="stat-value ${net>=0?'pos':'neg'}">${fmt$(net)}</div></div>
      </div>
      <div class="card"><div class="card-title">Flow History</div>
        ${flows.length===0?'<div class="empty-state">No deposit/withdrawal activity in 90 days</div>':`
        <div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Dir</th><th>Type</th><th>Amount</th></tr></thead>
          <tbody>${flows.map(f=>`<tr>
            <td class="muted">${fmtTime(f.time)}</td>
            <td><span class="side-badge ${f.direction==='inflow'?'long':'short'}">${f.direction==='inflow'?'↑':'↓'}</span></td>
            <td class="muted">${f.type}</td>
            <td class="${f.usdc>=0?'flow-in':'flow-out'}">${fmt$(Math.abs(f.usdc))}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>`;
    setRefreshTime();
  }catch(e){el.innerHTML=err(e);}
}

// ── Global Markets / Money Flows ──────────────────────────────────────────────
async function loadMarkets(){
  const el=document.getElementById('markets-content');
  el.innerHTML=loading();
  try{
    const raw=await getMetaAndAssetCtxs();
    allMarketData=parseMarketData(raw);
    renderMarkets();
    setRefreshTime();
  }catch(e){el.innerHTML=err(e);}
}

function renderMarkets(){
  const el=document.getElementById('markets-content');
  const data=filterByNarrative(allMarketData);
  const sorted=sortMarket(data);

  // Featured 4
  const featured=['BTC','ETH','SOL','HYPE'];
  const featuredData=featured.map(c=>allMarketData.find(d=>d.coin===c)).filter(Boolean);

  const totalOI=allMarketData.reduce((a,d)=>a+d.oi_usd,0);
  const totalVol=allMarketData.reduce((a,d)=>a+d.volume,0);
  const gainers=allMarketData.filter(d=>d.change_pct>0).length;
  const losers=allMarketData.filter(d=>d.change_pct<0).length;

  el.innerHTML=`
    <!-- Summary stats -->
    <div class="grid-3" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">Total OI</div><div class="stat-value">${fmtB(totalOI)}</div><div class="stat-sub">Open Interest</div></div>
      <div class="stat-card"><div class="stat-label">24h Volume</div><div class="stat-value">${fmtB(totalVol)}</div></div>
      <div class="stat-card"><div class="stat-label">Market</div><div class="stat-value"><span class="pos">${gainers}↑</span> <span class="neg">${losers}↓</span></div><div class="stat-sub">${allMarketData.length} assets</div></div>
    </div>

    <!-- Featured coins -->
    <div class="card-title" style="margin-bottom:8px">⭐ Featured</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px" class="market-featured">
      ${featuredData.map(d=>marketFeaturedCard(d)).join('')}
    </div>

    <!-- Narrative filter chips -->
    <div class="narrative-row">
      ${Object.entries(NARRATIVES).map(([key,n])=>`<button class="chip ${activeNarrative===key?'active':''}" onclick="setNarrative('${key}')">${n.label}</button>`).join('')}
    </div>

    <!-- Flow summary for filtered set -->
    ${flowSummaryBar(data)}

    <!-- Table -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">Market Data <span class="muted">(${data.length})</span></div>
        <div style="display:flex;gap:4px">
          ${['volume','oi','change','funding'].map(k=>`<button class="btn btn-ghost btn-sm ${marketSortKey===k?'btn-active-sort':''}" onclick="setSortKey('${k}')" style="${marketSortKey===k?'border-color:var(--accent);color:var(--accent)':''}">By ${k}</button>`).join('')}
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>#</th><th>Coin</th><th>Price</th><th>24h %</th>
          <th>OI (USD)</th><th>24h Vol</th><th>Funding/8h</th><th>Bias</th>
        </tr></thead>
        <tbody>${sorted.slice(0,100).map((d,i)=>marketRow(d,i+1)).join('')}</tbody>
      </table></div>
    </div>`;
}

function marketFeaturedCard(d){
  const chg=d.change_pct;
  return `<div class="market-card">
    <div class="market-card-row">
      <span class="market-card-coin accent">${d.coin}</span>
      <span class="change-pill ${chg>=0?'change-pos':'change-neg'}">${chg>=0?'+':''}${chg.toFixed(2)}%</span>
    </div>
    <div class="market-card-price">${fmtPrice(d.price)}</div>
    <div class="market-card-row" style="margin-top:4px">
      <span class="market-card-label">OI</span>
      <span class="market-card-val muted">${fmtB(d.oi_usd)}</span>
    </div>
    <div class="market-card-row">
      <span class="market-card-label">Vol 24h</span>
      <span class="market-card-val muted">${fmtB(d.volume)}</span>
    </div>
    <div class="market-card-row">
      <span class="market-card-label">Funding</span>
      <span class="${d.funding>=0?'pos':'neg'}" style="font-family:var(--mono);font-size:11px">${(d.funding*100).toFixed(4)}%</span>
    </div>
  </div>`;
}

function marketRow(d,rank){
  const chg=d.change_pct;
  const fr=d.funding;
  const frClass=Math.abs(fr)<0.001?'funding-neu':fr>=0?'funding-pos':'funding-neg';
  const bias=fr>0.005?'🟢 Longs':fr<-0.005?'🔴 Shorts':'⚪ Neutral';
  return `<tr>
    <td class="muted">${rank}</td>
    <td class="accent" style="font-weight:600">${d.coin}</td>
    <td>${fmtPrice(d.price)}</td>
    <td class="${chg>=0?'pos':'neg'}">${chg>=0?'+':''}${chg.toFixed(2)}%</td>
    <td>${fmtB(d.oi_usd)}</td>
    <td>${fmtB(d.volume)}</td>
    <td><span class="funding-pill ${frClass}">${(fr*100).toFixed(4)}%</span></td>
    <td style="font-size:11px">${bias}</td>
  </tr>`;
}

function flowSummaryBar(data){
  if(!data.length) return '';
  const gainers=data.filter(d=>d.change_pct>0);
  const losers=data.filter(d=>d.change_pct<0);
  const gVol=gainers.reduce((a,d)=>a+d.volume,0);
  const lVol=losers.reduce((a,d)=>a+d.volume,0);
  const total=gVol+lVol||1;
  const gPct=Math.round(gVol/total*100);
  const lPct=100-gPct;
  return `<div class="card" style="margin-bottom:14px">
    <div class="card-title">Money Flow (Volume Distribution)</div>
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px">
      <span class="pos">▲ ${gainers.length} gainers — ${fmtB(gVol)} (${gPct}%)</span>
      <span class="neg">▼ ${losers.length} losers — ${fmtB(lVol)} (${lPct}%)</span>
    </div>
    <div class="flow-bar">
      <div class="flow-bar-in" style="flex:${gPct}"></div>
      <div class="flow-bar-out" style="flex:${lPct}"></div>
    </div>
  </div>`;
}

function filterByNarrative(data){
  const n=NARRATIVES[activeNarrative];
  if(!n||!n.coins) return data;
  return data.filter(d=>n.coins.includes(d.coin));
}
function sortMarket(data){
  const k={volume:'volume',oi:'oi_usd',change:'change_pct',funding:'funding'}[marketSortKey]||'volume';
  return [...data].sort((a,b)=>Math.abs(b[k])-Math.abs(a[k]));
}
function setNarrative(key){
  activeNarrative=key;
  renderMarkets();
}
function setSortKey(key){
  marketSortKey=key;
  renderMarkets();
}

// ── Phase Detector ────────────────────────────────────────────────────────────
async function loadPhases(interval){
  if(interval) phaseInterval=interval;
  const el=document.getElementById('phases-content');
  el.innerHTML=loading();
  try{
    const state=await getClearinghouseState(currentWallet);
    const positions=parsePositions(state);
    const posCoinSet=new Set(positions.map(p=>p.coin));
    // Always show PHASE_COINS; append any open-position coins not in that list
    const allCoins=[...PHASE_COINS,...positions.map(p=>p.coin).filter(c=>!PHASE_COINS.includes(c))];
    const days={'1h':30,'4h':60,'1d':90}[phaseInterval]||30;

    el.innerHTML=`
      <div class="section-header">
        <div class="section-title">Phase Detector</div>
        <div class="tabs">${['1h','4h','1d'].map(iv=>`<button class="tab ${phaseInterval===iv?'active':''}" onclick="loadPhases('${iv}')">${iv}</button>`).join('')}</div>
      </div>
      <div id="phase-cards" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div class="loading" style="grid-column:1/-1">${spinnerHtml()} Analyzing ${allCoins.join(', ')} on ${phaseInterval}…</div>
      </div>
      <div class="card"><div class="card-title">Phase Key</div>
        <div style="display:flex;flex-direction:column;gap:7px;padding:2px 0">
          <span class="phase-badge phase-ACCUMULATION">🔵 Accumulation — quiet buying, tight range</span>
          <span class="phase-badge phase-MARKUP">🚀 Markup — uptrend with expanding volume</span>
          <span class="phase-badge phase-DISTRIBUTION">🟡 Distribution — topping, smart money exits</span>
          <span class="phase-badge phase-MARKDOWN">🔻 Markdown — downtrend with volume</span>
          <span class="phase-badge phase-NEUTRAL">⚪ Neutral — no clear signal</span>
        </div>
      </div>`;

    const results=await Promise.allSettled(allCoins.map(async coin=>{
      const candles=await getCandles(coin,phaseInterval,days);
      return {coin,hasPosition:posCoinSet.has(coin),...detectPhase(candles)};
    }));
    const phases=results.map((r,i)=>
      r.status==='fulfilled'?r.value:
      {coin:allCoins[i],hasPosition:posCoinSet.has(allCoins[i]),phase:'NEUTRAL',confidence:0,signals:['fetch failed']}
    );
    const pcards=document.getElementById('phase-cards');
    if(pcards) pcards.innerHTML=phases.map(phaseCard).join('');
    setRefreshTime();
  }catch(e){el.innerHTML=err(e);}
}

function phaseCard(p){
  const icons={ACCUMULATION:'🔵',MARKUP:'🚀',DISTRIBUTION:'🟡',MARKDOWN:'🔻',NEUTRAL:'⚪'};
  const conf=Math.round((p.confidence||0)*100);
  return `<div class="card" style="margin-bottom:0">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
      <div class="card-title" style="margin:0">${p.coin}</div>
      ${p.hasPosition?'<span style="font-size:9px;background:rgba(124,106,255,0.15);color:var(--accent);padding:2px 7px;border-radius:8px;font-weight:600">POSITION</span>':''}
    </div>
    <div style="margin-bottom:8px"><span class="phase-badge phase-${p.phase}">${icons[p.phase]||'⚪'} ${p.phase}</span></div>
    <div class="conf-bar"><span class="muted" style="font-size:10px">Confidence</span><span class="conf-val">${conf}%</span></div>
    <div class="progress-bar" style="margin-bottom:8px"><div class="progress-fill" style="width:${conf}%"></div></div>
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px">Price: <b style="color:var(--text)">${p.price_trend}</b> · Vol: <b style="color:var(--text)">${p.volume_trend}</b> · Score: <b style="color:var(--text)">${p.score}</b></div>
    <ul style="font-size:10px;color:var(--text-muted);padding-left:12px;line-height:1.7">${(p.signals||[]).map(s=>`<li>${s}</li>`).join('')}</ul>
  </div>`;
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
function getWatchlist(){try{return JSON.parse(localStorage.getItem('hype_watchlist')||'[]');}catch{return[];}}
function saveWatchlist(wl){localStorage.setItem('hype_watchlist',JSON.stringify(wl));}

async function loadWatchlist(){
  const el=document.getElementById('watchlist-content');
  const wallets=getWatchlist();
  el.innerHTML=`
    <div class="section-header"><div class="section-title">Wallet Watchlist</div></div>
    <div class="card" style="margin-bottom:14px"><div class="card-title">Add Wallet</div>
      <div class="input-group">
        <input class="input" id="add-addr" placeholder="0x… address">
        <input class="input" id="add-label" placeholder="Label (optional)">
        <button class="btn btn-primary" onclick="addWatchWallet()" style="width:100%">+ Add</button>
      </div>
    </div>
    <div id="wallet-list">${wallets.length===0?'<div class="empty-state">Add any Hyperliquid wallet address to start tracking it.</div>':'<div class="loading">'+spinnerHtml()+' Loading…</div>'}</div>`;
  if(wallets.length>0){
    const snaps=await Promise.allSettled(wallets.map(async w=>{
      const state=await getClearinghouseState(w.address);
      return {...w,summary:parseAccountSummary(state),positions:parsePositions(state)};
    }));
    document.getElementById('wallet-list').innerHTML=snaps.map((r,i)=>walletRow(r.status==='fulfilled'?r.value:{...wallets[i],error:true})).join('');
  }
}

function walletRow(w){
  const isPrimary=w.address.toLowerCase()===DEFAULT_WALLET.toLowerCase();
  const s=w.summary||{},positions=w.positions||[];
  const totalPnl=positions.reduce((a,p)=>a+p.unrealized_pnl,0);
  return `<div class="card" style="margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
      <div style="min-width:0">
        <div style="font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${w.label||w.address.slice(0,10)+'…'}
          ${isPrimary?'<span style="font-size:9px;background:rgba(124,106,255,0.15);color:var(--accent);padding:2px 7px;border-radius:8px">PRIMARY</span>':''}
        </div>
        <div class="muted" style="font-family:var(--mono);font-size:10px;margin-top:2px;word-break:break-all">${w.address}</div>
      </div>
      ${!isPrimary?`<button class="btn btn-danger btn-sm" style="flex-shrink:0;margin-left:8px" onclick="removeWatchWallet('${w.address}')">Remove</button>`:''}
    </div>
    ${w.error?'<div class="muted" style="font-size:12px">Failed to load</div>':`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div><div class="stat-label">Account Value</div><div style="font-family:var(--mono);font-size:13px">${fmt$(s.account_value||0)}</div></div>
      <div><div class="stat-label">Positions</div><div style="font-family:var(--mono);font-size:13px">${positions.length}</div></div>
      <div><div class="stat-label">Unr. PnL</div><div style="font-family:var(--mono);font-size:13px" class="${totalPnl>=0?'pos':'neg'}">${fmt$(totalPnl)}</div></div>
      <div><div class="stat-label">Coins</div><div style="font-family:var(--mono);font-size:11px">${positions.map(p=>p.coin).join(', ')||'—'}</div></div>
    </div>`}
  </div>`;
}

function addWatchWallet(){
  const addr=document.getElementById('add-addr').value.trim().toLowerCase();
  const label=document.getElementById('add-label').value.trim();
  if(!addr||!addr.startsWith('0x')){alert('Enter a valid 0x address');return;}
  const wl=getWatchlist();
  if(wl.find(w=>w.address===addr)){alert('Already in watchlist');return;}
  wl.push({address:addr,label:label||addr.slice(0,8)+'…',added_at:Date.now()});
  saveWatchlist(wl);loadWatchlist();
}
function removeWatchWallet(addr){
  if(!confirm('Remove?')) return;
  saveWatchlist(getWatchlist().filter(w=>w.address!==addr));loadWatchlist();
}

// ── Live Monitor + WebSocket ──────────────────────────────────────────────────
function connectWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try { ws = new WebSocket(HL_WS); } catch(e) { scheduleReconnect(); return; }
  ws.onopen = () => {
    wsConnected = true;
    ws.send(JSON.stringify({method:'subscribe', subscription:{type:'allMids'}}));
    setWSStatus(true);
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.channel === 'allMids' && msg.data && msg.data.mids) handleMids(msg.data.mids);
    } catch(_) {}
  };
  ws.onclose = () => { wsConnected = false; setWSStatus(false); if (monitorActive) scheduleReconnect(); };
  ws.onerror = () => { ws.close(); };
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => { wsReconnectTimer = null; if (monitorActive) connectWS(); }, 3000);
}

function disconnectWS() {
  monitorActive = false;
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (ws) { ws.close(); ws = null; }
  wsConnected = false;
  setWSStatus(false);
}

function setWSStatus(on) {
  const dot = document.getElementById('ws-status');
  if (dot) dot.className = 'status-dot' + (on ? '' : ' off');
  const badge = document.getElementById('monitor-live-badge');
  if (badge) { badge.textContent = on ? '🟢 LIVE' : '🔴 Reconnecting…'; badge.style.color = on ? 'var(--green)' : 'var(--red)'; }
}

function handleMids(mids) {
  for (const [coin, rawPrice] of Object.entries(mids)) {
    const price = parseFloat(rawPrice);
    if (!price) continue;
    const prev = livePrices[coin];
    livePrices[coin] = price;
    if (!priceHistory[coin]) priceHistory[coin] = [];
    priceHistory[coin].push(price);
    if (priceHistory[coin].length > 40) priceHistory[coin].shift();
    refreshPriceRow(coin, price, prev);
  }
  refreshLivePnL();
  checkPriceAlerts();
  const ts = document.getElementById('monitor-ts');
  if (ts) ts.textContent = new Date().toLocaleTimeString();
}

function refreshPriceRow(coin, price, prev) {
  const priceEl = document.getElementById('lp-' + coin);
  if (!priceEl) return;
  const dir = prev ? (price > prev ? 'up' : price < prev ? 'dn' : '') : '';
  priceEl.textContent = fmtPrice(price);
  if (dir) {
    priceEl.className = 'mono ' + (dir === 'up' ? 'pos ticker-flash-up' : 'neg ticker-flash-dn');
    setTimeout(() => { if (priceEl) priceEl.className = 'mono ' + (dir === 'up' ? 'pos' : 'neg'); }, 400);
  }
  const chgEl = document.getElementById('lc-' + coin);
  if (chgEl && livePrevDay[coin]) {
    const chg = ((price - livePrevDay[coin]) / livePrevDay[coin]) * 100;
    chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    chgEl.className = chg >= 0 ? 'pos' : 'neg';
  }
  const sparkEl = document.getElementById('lsp-' + coin);
  if (sparkEl && priceHistory[coin] && priceHistory[coin].length > 1) {
    sparkEl.innerHTML = sparkline(priceHistory[coin]);
  }
}

function refreshLivePnL() {
  for (const pos of livePositions) {
    const price = livePrices[pos.coin];
    if (!price) continue;
    const pnl = pos.side === 'long' ? (price - pos.entry_price) * pos.size : (pos.entry_price - price) * pos.size;
    const key = pos.coin + pos.side;
    const pnlEl = document.getElementById('lpnl-' + key);
    const nowEl = document.getElementById('lnow-' + key);
    if (pnlEl) { pnlEl.textContent = fmt$(pnl); pnlEl.className = pnl >= 0 ? 'pos mono' : 'neg mono'; }
    if (nowEl) { nowEl.textContent = fmtPrice(price); nowEl.className = 'mono'; }
  }
}

function sparkline(prices) {
  const W = 56, H = 18;
  const mn = Math.min(...prices), mx = Math.max(...prices), rng = mx - mn || 1;
  const pts = prices.map((p, i) => `${((i / (prices.length - 1)) * W).toFixed(1)},${(H - ((p - mn) / rng) * H).toFixed(1)}`).join(' ');
  const color = prices[prices.length - 1] >= prices[0] ? '#22c55e' : '#ef4444';
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function checkPriceAlerts() {
  let changed = false;
  for (const a of priceAlerts) {
    if (a.triggered) continue;
    const price = livePrices[a.coin];
    if (!price) continue;
    if ((a.above && price >= a.target) || (!a.above && price <= a.target)) {
      a.triggered = true;
      changed = true;
      logAlert(a.coin, a.above ? '▲ crossed above' : '▼ dropped below', a.target, price);
    }
  }
  if (changed) { saveAlerts(); renderActiveAlerts(); }
}

function logAlert(coin, desc, target, price) {
  const log = document.getElementById('alert-log');
  if (!log) return;
  const row = document.createElement('div');
  row.className = 'alert-log-row';
  row.innerHTML = `<span class="muted" style="font-size:10px">${new Date().toLocaleTimeString()}</span> <b>${coin}</b> ${desc} ${fmtPrice(target)} <span class="muted">(now ${fmtPrice(price)})</span>`;
  log.prepend(row);
  if (log.children.length > 30) log.removeChild(log.lastChild);
}

function saveAlerts() { try { localStorage.setItem('hype_alerts', JSON.stringify(priceAlerts)); } catch(_) {} }
function loadAlerts() { try { priceAlerts = JSON.parse(localStorage.getItem('hype_alerts') || '[]'); } catch(_) { priceAlerts = []; } }

function addAlert() {
  const coin = (document.getElementById('alert-coin').value || '').trim().toUpperCase();
  const dir  = document.getElementById('alert-dir').value;
  const tgt  = parseFloat(document.getElementById('alert-price').value);
  if (!coin || !tgt) return;
  priceAlerts.push({ id: Date.now(), coin, above: dir === 'above', target: tgt, triggered: false });
  saveAlerts();
  renderActiveAlerts();
  document.getElementById('alert-coin').value = '';
  document.getElementById('alert-price').value = '';
}

function deleteAlert(id) {
  priceAlerts = priceAlerts.filter(a => a.id !== id);
  saveAlerts();
  renderActiveAlerts();
}

function clearTriggered() {
  priceAlerts = priceAlerts.filter(a => !a.triggered);
  saveAlerts();
  renderActiveAlerts();
}

function renderActiveAlerts() {
  const el = document.getElementById('active-alerts');
  if (!el) return;
  const active = priceAlerts.filter(a => !a.triggered);
  const done   = priceAlerts.filter(a => a.triggered);
  el.innerHTML = active.length === 0 && done.length === 0
    ? '<div class="muted" style="font-size:12px">No alerts set</div>'
    : [
        ...active.map(a => `<div class="alert-row"><span class="accent mono">${a.coin}</span> <span class="muted">${a.above ? '▲ above' : '▼ below'}</span> <b>${fmtPrice(a.target)}</b><button class="btn btn-ghost btn-sm" onclick="deleteAlert(${a.id})" style="padding:0 6px;margin-left:auto">✕</button></div>`),
        ...done.map(a => `<div class="alert-row" style="opacity:0.45;text-decoration:line-through"><span class="accent mono">${a.coin}</span> ${a.above ? '▲' : '▼'} ${fmtPrice(a.target)} ✅</div>`),
      ].join('') + (done.length ? `<button class="btn btn-ghost btn-sm" onclick="clearTriggered()" style="margin-top:6px;font-size:11px">Clear triggered</button>` : '');
}

async function loadMonitor() {
  monitorActive = true;
  loadAlerts();
  const el = document.getElementById('monitor-content');

  // Fetch positions + prevDay prices concurrently
  let positions = [];
  try {
    const [state, meta] = await Promise.all([getClearinghouseState(currentWallet), getMetaAndAssetCtxs()]);
    positions = parsePositions(state);
    livePositions = positions;
    // Store prevDay prices for 24h % calc
    const universe = meta[0].universe;
    const ctxs = meta[1];
    universe.forEach((asset, i) => {
      const prev = parseFloat(ctxs[i].prevDayPx || 0);
      if (prev) livePrevDay[asset.name] = prev;
    });
  } catch(_) {}

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div><div class="section-title">⚡ Live Monitor</div><div class="muted" style="font-size:11px">WebSocket · Hyperliquid real-time feed</div></div>
      <div style="display:flex;align-items:center;gap:10px">
        <span id="monitor-live-badge" style="font-size:12px;font-weight:600;color:var(--red)">🔴 Connecting…</span>
        <span class="muted" style="font-size:11px"><span id="monitor-ts">—</span></span>
      </div>
    </div>

    ${positions.length > 0 ? `
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">📍 Positions · Live P&L</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Coin</th><th>Side</th><th>Size</th><th>Entry</th><th>Now</th><th>Live PnL</th><th>Lev</th></tr></thead>
        <tbody>${positions.map(p => {
          const key = p.coin + p.side;
          return `<tr>
            <td class="accent" style="font-weight:600">${p.coin}</td>
            <td><span class="side-badge ${p.side}">${p.side === 'long' ? 'L' : 'S'}</span></td>
            <td class="mono">${p.size}</td>
            <td class="mono">${fmtPrice(p.entry_price)}</td>
            <td id="lnow-${key}" class="mono">—</td>
            <td id="lpnl-${key}" class="mono muted">—</td>
            <td class="muted">${p.leverage_value}x</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>` : '<div class="card" style="margin-bottom:14px"><div class="muted" style="padding:10px;font-size:12px">No open positions · P&L tracker will appear here when you have positions</div></div>'}

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div class="card-title" style="margin:0">📈 Live Prices</div>
        <span class="muted" style="font-size:10px">Updates every tick via WebSocket</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Coin</th><th>Price</th><th>24h %</th><th style="width:64px">Trend</th></tr></thead>
        <tbody>${MONITOR_COINS.map(coin => `<tr>
          <td class="accent" style="font-weight:600">${coin}</td>
          <td id="lp-${coin}" class="mono">—</td>
          <td id="lc-${coin}" class="muted">—</td>
          <td id="lsp-${coin}" style="padding:0 6px 0 0"></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-title">🔔 Price Alerts</div>
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
        <input class="input" id="alert-coin" placeholder="BTC" style="width:72px;flex-shrink:0" oninput="this.value=this.value.toUpperCase()">
        <select class="input" id="alert-dir" style="width:90px;flex-shrink:0">
          <option value="above">▲ Above</option>
          <option value="below">▼ Below</option>
        </select>
        <input class="input" id="alert-price" placeholder="Price" type="number" style="width:110px;flex-shrink:0">
        <button class="btn btn-primary btn-sm" onclick="addAlert()">+ Set Alert</button>
      </div>
      <div id="active-alerts" style="margin-bottom:12px"></div>
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Alert Log</div>
      <div id="alert-log" style="display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto;font-size:12px">
        <span class="muted" style="font-size:11px">Alerts will appear here</span>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">📊 TA Signal Dashboard</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;gap:3px">
            ${['1h','4h'].map(tf=>`<button class="tab ta-tf-tab${taTf===tf?' active':''}" data-tf="${tf}" onclick="setTATf('${tf}')">${tf}</button>`).join('')}
          </div>
          <button class="btn btn-ghost btn-sm" onclick="refreshTA()" style="padding:3px 10px;font-size:11px">↻</button>
        </div>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:14px;flex-wrap:wrap">
        ${TA_COINS.map(c=>`<button class="tab ta-coin-tab${c===taCoin?' active':''}" data-coin="${c}" onclick="setTACoin('${c}')">${c}</button>`).join('')}
      </div>
      <div id="ta-content"><div class="loading">${spinnerHtml()} Loading…</div></div>
    </div>
  `;

  renderActiveAlerts();
  connectWS();
  refreshTA();
}

// ── TA Math ───────────────────────────────────────────────────────────────────
function iEMA(arr, p) {
  const k = 2/(p+1); let ema = arr[0];
  return arr.map(v => (ema = v*k + ema*(1-k)));
}
function iMACD(arr, f=12, s=26, sig=9) {
  const emaF = iEMA(arr, f), emaS = iEMA(arr, s);
  const macd = emaF.map((v,i) => v - emaS[i]);
  const signal = iEMA(macd, sig);
  return { macd, signal, hist: macd.map((v,i) => v - signal[i]) };
}
function iRSI(arr, p=14) {
  let gAvg=0, lAvg=0;
  for (let i=1; i<=p; i++) { const d=arr[i]-arr[i-1]; if(d>0) gAvg+=d; else lAvg-=d; }
  gAvg/=p; lAvg/=p;
  const out = new Array(p).fill(null);
  out.push(lAvg===0 ? 100 : 100-100/(1+gAvg/lAvg));
  for (let i=p+1; i<arr.length; i++) {
    const d=arr[i]-arr[i-1];
    gAvg=(gAvg*(p-1)+Math.max(d,0))/p; lAvg=(lAvg*(p-1)+Math.max(-d,0))/p;
    out.push(lAvg===0 ? 100 : 100-100/(1+gAvg/lAvg));
  }
  return out;
}
function iStoch(highs, lows, closes, k=14, d=3) {
  const kArr = closes.map((c,i) => {
    if (i<k-1) return null;
    const h=Math.max(...highs.slice(i-k+1,i+1)), l=Math.min(...lows.slice(i-k+1,i+1));
    return h===l ? 50 : (c-l)/(h-l)*100;
  });
  const dArr = kArr.map((v,i) => {
    if (v===null || i<k+d-2) return null;
    const sl=kArr.slice(i-d+1,i+1).filter(x=>x!==null);
    return sl.length===d ? sl.reduce((a,b)=>a+b)/d : null;
  });
  return { k: kArr, d: dArr };
}
function iBB(arr, p=20, mult=2) {
  return arr.map((v,i) => {
    if (i<p-1) return null;
    const sl=arr.slice(i-p+1,i+1), mid=sl.reduce((a,b)=>a+b)/p;
    const sd=Math.sqrt(sl.reduce((a,b)=>a+(b-mid)**2,0)/p);
    const upper=mid+mult*sd, lower=mid-mult*sd;
    return { upper, mid, lower, pctB:(v-lower)/(upper-lower), bw:(upper-lower)/mid*100 };
  });
}
function iATR(highs, lows, closes, p=14) {
  const tr=closes.map((c,i)=>i===0?highs[0]-lows[0]:Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));
  let atr=tr.slice(0,p).reduce((a,b)=>a+b)/p;
  const out=[...new Array(p-1).fill(null),atr];
  for(let i=p;i<tr.length;i++){atr=(atr*(p-1)+tr[i])/p;out.push(atr);}
  return out;
}
function iMoneyFlow(opens, closes, volumes, p=20) {
  let bSum=0, sSum=0;
  for(let i=Math.max(0,closes.length-p);i<closes.length;i++){
    if(closes[i]>=opens[i]) bSum+=volumes[i]; else sSum+=volumes[i];
  }
  const tot=bSum+sSum||1;
  return { buyPct:bSum/tot*100, sellPct:sSum/tot*100 };
}

// ── TA Signals ────────────────────────────────────────────────────────────────
function sigEMA(price, e20, e50, e200) {
  const a20=price>e20, a50=price>e50, a200=e200!==null?price>e200:null;
  let label, cls;
  if(a200===null){
    label=a20&&a50?'ABOVE EMA 20/50':!a20&&!a50?'BELOW EMA 20/50':'MIXED';
    cls=a20&&a50?'bull':!a20&&!a50?'bear':'neut';
  } else {
    if(a20&&a50&&a200){label='FULL BULL';cls='bull';}
    else if(!a20&&!a50&&!a200){label='FULL BEAR';cls='bear';}
    else if(a50&&a200){label='ABOVE 50/200';cls='bull';}
    else if(!a50&&!a200){label='BELOW 50/200';cls='bear';}
    else {label='MIXED';cls='neut';}
  }
  const p20=((price-e20)/e20*100).toFixed(2), p50=((price-e50)/e50*100).toFixed(2);
  return {label,cls,sub:`EMA20 ${p20>0?'+':''}${p20}% · EMA50 ${p50>0?'+':''}${p50}%`};
}
function sigMACD(hist, macd) {
  const h=hist.at(-1),hP=hist.at(-2),m=macd.at(-1);
  let label,cls;
  if(h>0&&hP<=0){label='BULLISH CROSS';cls='bull';}
  else if(h<0&&hP>=0){label='BEARISH CROSS';cls='bear';}
  else if(h>0&&h>hP){label='BULLISH EXPANDING';cls='bull';}
  else if(h>0){label='BULLISH FADING';cls='warn';}
  else if(h<0&&h<hP){label='BEARISH EXPANDING';cls='bear';}
  else if(h<0){label='BEARISH FADING';cls='warn';}
  else{label='NEUTRAL';cls='neut';}
  return {label,cls,sub:`Hist ${h>=0?'+':''}${h.toFixed(5)} · MACD ${m>=0?'+':''}${m.toFixed(5)}`};
}
function sigRSI(val) {
  let label,cls;
  if(val>=75){label='OVERBOUGHT';cls='warn';}
  else if(val>=60){label='BULLISH';cls='bull';}
  else if(val<=25){label='OVERSOLD';cls='info';}
  else if(val<=40){label='BEARISH';cls='bear';}
  else{label='NEUTRAL';cls='neut';}
  return {label,cls,sub:`RSI ${val.toFixed(1)}`};
}
function sigStoch(k,d) {
  let label,cls;
  if(k>=80&&d>=80){label='OVERBOUGHT';cls='warn';}
  else if(k<=20&&d<=20){label='OVERSOLD';cls='info';}
  else if(k>d&&k>50){label='BULLISH';cls='bull';}
  else if(k<d&&k<50){label='BEARISH';cls='bear';}
  else{label='NEUTRAL';cls='neut';}
  return {label,cls,sub:`K ${k.toFixed(1)} · D ${d.toFixed(1)}`};
}
function sigBB(bb) {
  let label,cls;
  if(bb.pctB>0.9){label='AT UPPER BAND';cls='warn';}
  else if(bb.pctB>0.6){label='UPPER HALF';cls='bull';}
  else if(bb.pctB<0.1){label='AT LOWER BAND';cls='info';}
  else if(bb.pctB<0.4){label='LOWER HALF';cls='bear';}
  else{label='MID BAND';cls='neut';}
  const sq=bb.bw<3;
  return {label,cls,sub:`%B ${(bb.pctB*100).toFixed(0)}% · BW ${bb.bw.toFixed(2)}%${sq?' · SQUEEZE':''}`};
}
function sigATR(atr,price) {
  const pct=atr/price*100;
  let label,cls;
  if(pct>4){label='HIGH VOLATILITY';cls='warn';}
  else if(pct>2){label='ELEVATED';cls='warn';}
  else if(pct<0.5){label='LOW VOLATILITY';cls='info';}
  else{label='NORMAL';cls='neut';}
  return {label,cls,sub:`ATR ${pct.toFixed(2)}% of price`};
}
function sigFunding(rate) {
  const pct=rate*100;
  let label,cls;
  if(pct>0.05){label='CROWDED LONG';cls='warn';}
  else if(pct>0.01){label='LONG BIASED';cls='bull';}
  else if(pct<-0.05){label='CROWDED SHORT';cls='info';}
  else if(pct<-0.01){label='SHORT BIASED';cls='bear';}
  else{label='NEUTRAL';cls='neut';}
  return {label,cls,sub:`${pct>=0?'+':''}${pct.toFixed(4)}%/8h`};
}
function sigOI(oi,prev) {
  const fmt=v=>v>=1e9?`$${(v/1e9).toFixed(2)}B`:v>=1e6?`$${(v/1e6).toFixed(1)}M`:`$${(v/1e3).toFixed(0)}K`;
  if(!prev) return {label:'OI '+fmt(oi),cls:'neut',sub:'no prev data'};
  const chg=(oi-prev)/prev*100;
  let label,cls;
  if(chg>3){label='RISING FAST';cls='bull';}
  else if(chg>1){label='RISING';cls='bull';}
  else if(chg<-3){label='FALLING FAST';cls='bear';}
  else if(chg<-1){label='FALLING';cls='bear';}
  else{label='STABLE';cls='neut';}
  return {label,cls,sub:`${fmt(oi)} (${chg>=0?'+':''}${chg.toFixed(1)}%)`};
}
function sigFlow(buyPct) {
  let label,cls;
  if(buyPct>65){label='STRONG BUY FLOW';cls='bull';}
  else if(buyPct>55){label='BUY FLOW';cls='bull';}
  else if(buyPct<35){label='STRONG SELL FLOW';cls='bear';}
  else if(buyPct<45){label='SELL FLOW';cls='bear';}
  else{label='BALANCED';cls='neut';}
  return {label,cls,sub:`Buy ${buyPct.toFixed(0)}% · Sell ${(100-buyPct).toFixed(0)}%`};
}

// ── TA Dashboard ──────────────────────────────────────────────────────────────
function setTACoin(coin) {
  taCoin = coin;
  document.querySelectorAll('.ta-coin-tab').forEach(t => t.classList.toggle('active', t.dataset.coin===coin));
  refreshTA();
}
function setTATf(tf) {
  taTf = tf;
  document.querySelectorAll('.ta-tf-tab').forEach(t => t.classList.toggle('active', t.dataset.tf===tf));
  refreshTA();
}

async function refreshTA() {
  if (taLoading) return;
  taLoading = true;
  const el = document.getElementById('ta-content');
  if (!el) { taLoading=false; return; }
  el.innerHTML = `<div class="loading">${spinnerHtml()} Fetching ${taCoin} ${taTf}…</div>`;
  try {
    const days = taTf==='4h' ? 60 : 15;
    const [candles, meta] = await Promise.all([getCandles(taCoin, taTf, days), getMetaAndAssetCtxs()]);
    const opens=candles.map(c=>parseFloat(c.o)), closes=candles.map(c=>parseFloat(c.c));
    const highs=candles.map(c=>parseFloat(c.h)), lows=candles.map(c=>parseFloat(c.l));
    const volumes=candles.map(c=>parseFloat(c.v));
    const price=closes.at(-1);

    const ema20=iEMA(closes,20), ema50=iEMA(closes,50);
    const ema200=closes.length>=200?iEMA(closes,200):null;
    const {hist,macd}=iMACD(closes);
    const rsiArr=iRSI(closes); const rsiVal=rsiArr.filter(v=>v!==null).at(-1);
    const {k:stochK,d:stochD}=iStoch(highs,lows,closes);
    const kVal=stochK.filter(v=>v!==null).at(-1), dVal=stochD.filter(v=>v!==null).at(-1);
    const bbArr=iBB(closes); const bb=bbArr.filter(v=>v!==null).at(-1);
    const atrArr=iATR(highs,lows,closes); const atr=atrArr.filter(v=>v!==null).at(-1);
    const mf=iMoneyFlow(opens,closes,volumes);

    const universe=meta[0].universe, ctxs=meta[1];
    const idx=universe.findIndex(a=>a.name===taCoin);
    const ctx=idx>=0?ctxs[idx]:{};
    const fundingRate=parseFloat(ctx.funding||0);
    const markPx=parseFloat(ctx.markPx||ctx.midPx||0);
    const oi=parseFloat(ctx.openInterest||0)*markPx;
    const prev=taOIPrev[taCoin+taTf]||null;
    taOIPrev[taCoin+taTf]=oi;

    el.innerHTML = renderTADash({
      ema: sigEMA(price, ema20.at(-1), ema50.at(-1), ema200?ema200.at(-1):null),
      macd: sigMACD(hist, macd),
      rsi: rsiVal!=null ? sigRSI(rsiVal) : null,
      stoch: kVal!=null&&dVal!=null ? sigStoch(kVal,dVal) : null,
      bb: bb ? sigBB(bb) : null,
      atr: atr ? sigATR(atr,price) : null,
      funding: sigFunding(fundingRate),
      oi: sigOI(oi,prev),
      mf: sigFlow(mf.buyPct)
    }, price);
  } catch(e) {
    el.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
  taLoading = false;
}

function taRow(icon, name, sig) {
  if (!sig) return '';
  return `<div class="ta-row"><div class="ta-row-label"><span>${icon}</span>${name}</div><div class="ta-sig ta-${sig.cls}"><span class="ta-badge">${sig.label}</span>${sig.sub?`<span class="ta-sub">${sig.sub}</span>`:''}</div></div>`;
}

function renderTADash(s, price) {
  return `
    <div class="ta-group"><div class="ta-gtitle">TREND</div>
      ${taRow('📏','EMA Bias',s.ema)}${taRow('〰️','MACD',s.macd)}</div>
    <div class="ta-group"><div class="ta-gtitle">MOMENTUM</div>
      ${taRow('⚡','RSI (14)',s.rsi)}${taRow('🔁','Stochastic',s.stoch)}</div>
    <div class="ta-group"><div class="ta-gtitle">VOLATILITY</div>
      ${taRow('🎯','Bollinger %B',s.bb)}${taRow('📐','ATR (14)',s.atr)}</div>
    <div class="ta-group ta-last"><div class="ta-gtitle">CRYPTO-NATIVE</div>
      ${taRow('💰','Funding',s.funding)}${taRow('📊','Open Interest',s.oi)}${taRow('🌊','Money Flow',s.mf)}</div>
    <div style="text-align:right;font-size:10px;color:var(--text-muted);padding-top:6px">${taCoin} · ${taTf} · ${fmtPrice(price)} · ${new Date().toLocaleTimeString()}</div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n){
  if(n===undefined||n===null) return '—';
  const abs=Math.abs(n),sign=n<0?'-':'';
  if(abs>=1e6) return sign+'$'+(abs/1e6).toFixed(2)+'M';
  if(abs>=1e3) return sign+'$'+abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return sign+'$'+abs.toFixed(2);
}
function fmtB(n){
  if(!n) return '—';
  if(n>=1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if(n>=1e6) return '$'+(n/1e6).toFixed(1)+'M';
  if(n>=1e3) return '$'+(n/1e3).toFixed(0)+'K';
  return '$'+n.toFixed(0);
}
function fmtPrice(n){
  if(!n) return '—';
  if(n>=1000) return '$'+n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
  if(n>=1) return '$'+n.toFixed(3);
  return '$'+n.toFixed(6);
}
function fmtTime(ms){
  if(!ms) return '—';
  const d=new Date(ms);
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
}
function setStatus(ok){document.getElementById('ws-status').className='status-dot'+(ok?'':' off');}
function setRefreshTime(){
  const el=document.getElementById('refresh-info');
  if(el){el.style.display='block';el.textContent='Updated '+new Date().toLocaleTimeString();}
  setStatus(true);
}
function spinnerHtml(){return '<div class="spinner" style="display:inline-block;vertical-align:middle"></div>';}
function loading(){return `<div class="loading">${spinnerHtml()} Loading…</div>`;}
function err(e){return `<div class="loading">Error: ${e.message}</div>`;}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  const wl=getWatchlist();
  if(!wl.find(w=>w.address===DEFAULT_WALLET.toLowerCase())){
    wl.unshift({address:DEFAULT_WALLET.toLowerCase(),label:'My Wallet',added_at:Date.now()});
    saveWatchlist(wl);
  }
  navigate('overview');
  autoRefreshTimer=setInterval(()=>navigate(currentPage),30000);
});