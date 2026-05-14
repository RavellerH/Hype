// ── Config ───────────────────────────────────────────────────────────────────
const HL = 'https://api.hyperliquid.xyz/info';
const DEFAULT_WALLET = '0x6e4c6da09f06690cc4db53d42ab539d3d4882015';
let currentWallet = localStorage.getItem('hype_wallet') || DEFAULT_WALLET;
let currentPage = 'overview';
let phaseInterval = '1h';
let activeNarrative = 'all';
let autoRefreshTimer = null;
let marketSortKey = 'volume'; // volume | oi | change | funding
let allMarketData = [];

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
  if (!candles||candles.length<10) return {phase:'NEUTRAL',confidence:0,price_trend:'flat',volume_trend:'neutral',range_compression:false,signals:['Not enough data'],score:0};
  const closes=candles.map(c=>parseFloat(c.c)),volumes=candles.map(c=>parseFloat(c.v)),highs=candles.map(c=>parseFloat(c.h)),lows=candles.map(c=>parseFloat(c.l));
  const n=candles.length,half=Math.floor(n/2),qtr=Math.max(Math.floor(n/4),1);
  const avg=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
  const pct=(avg(closes.slice(half))-avg(closes.slice(0,half)))/avg(closes.slice(0,half));
  const price_trend=pct>0.03?'up':pct<-0.03?'down':'flat';
  const vp=(avg(volumes.slice(-qtr))-avg(volumes.slice(0,qtr)))/avg(volumes.slice(0,qtr));
  const volume_trend=vp>0.2?'expanding':vp<-0.2?'contracting':'neutral';
  const fullRange=Math.max(...highs)-Math.min(...lows)||1;
  const range_compression=(Math.max(...highs.slice(-qtr))-Math.min(...lows.slice(-qtr)))/fullRange<0.35;
  const signals=[];let score=0;
  if(price_trend==='up'){score+=0.3;signals.push('Price trending up');}else if(price_trend==='down'){score-=0.3;signals.push('Price trending down');}else signals.push('Price flat / sideways');
  if(price_trend==='flat'&&volume_trend==='contracting'&&range_compression){score+=0.4;signals.push('Tight range + low volume → accumulation');}
  else if(price_trend==='up'&&volume_trend==='expanding'){score+=0.35;signals.push('Price up + expanding volume → markup');}
  else if(price_trend==='flat'&&volume_trend==='expanding'){score-=0.15;signals.push('Flat price + rising volume → distribution?');}
  else if(price_trend==='down'&&volume_trend==='expanding'){score-=0.4;signals.push('Price down + volume → markdown');}
  else if(price_trend==='down'&&volume_trend==='contracting'){score-=0.2;signals.push('Drying volume on downtrend → exhaustion');}
  if(range_compression) signals.push('Range compressed (breakout setup)');
  const avgVol=avg(volumes.slice(0,-1)),lastVol=volumes[volumes.length-1];
  if(lastVol>avgVol*2){signals.push(`Vol spike ${(lastVol/avgVol).toFixed(1)}x avg`);score+=closes[closes.length-1]>closes[closes.length-2]?0.1:-0.1;}
  score=Math.max(-1,Math.min(1,score));
  const phase=score>=0.55?'MARKUP':score>=0.2?'ACCUMULATION':score<=-0.55?'MARKDOWN':score<=-0.2?'DISTRIBUTION':'NEUTRAL';
  return {phase,confidence:+Math.min(Math.abs(score)+0.1*Math.min(n/50,1),1).toFixed(3),price_trend,volume_trend,range_compression,signals,score:+score.toFixed(4)};
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(page) {
  try {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nav-item,.bottom-nav-item').forEach(n=>n.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (!pageEl) return;
    pageEl.classList.add('active');
    document.querySelectorAll(`[data-page="${page}"]`).forEach(el=>el.classList.add('active'));
    currentPage = page;
    const loaders={overview:loadOverview,trades:loadTrades,funding:loadFunding,flows:loadFlows,markets:loadMarkets,phases:loadPhases,intel:typeof loadIntel!=='undefined'?loadIntel:null,watchlist:loadWatchlist};
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
    el.innerHTML=`
      <div class="section-header">
        <div class="section-title">Phase Detector</div>
        <div class="tabs">${['1h','4h','1d'].map(iv=>`<button class="tab ${phaseInterval===iv?'active':''}" onclick="loadPhases('${iv}')">${iv}</button>`).join('')}</div>
      </div>
      ${positions.length===0
        ?'<div class="empty-state">No open positions to analyze.</div>'
        :`<div id="phase-cards" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px"><div class="loading" style="grid-column:1/-1">${spinnerHtml()} Detecting…</div></div>`}
      <div class="card"><div class="card-title">Phase Key</div>
        <div style="display:flex;flex-direction:column;gap:7px;padding:2px 0">
          <span class="phase-badge phase-ACCUMULATION">🔵 Accumulation — quiet buying, tight range</span>
          <span class="phase-badge phase-MARKUP">🚀 Markup — uptrend with expanding volume</span>
          <span class="phase-badge phase-DISTRIBUTION">🟡 Distribution — topping, smart money exits</span>
          <span class="phase-badge phase-MARKDOWN">🔻 Markdown — downtrend with volume</span>
          <span class="phase-badge phase-NEUTRAL">⚪ Neutral — no clear signal</span>
        </div>
      </div>`;
    if(positions.length>0){
      const results=await Promise.allSettled(positions.map(async p=>{
        const candles=await getCandles(p.coin,phaseInterval,7);
        return {coin:p.coin,...detectPhase(candles)};
      }));
      const phases=results.map((r,i)=>r.status==='fulfilled'?r.value:{coin:positions[i].coin,phase:'NEUTRAL',confidence:0,signals:['fetch failed']});
      const pcards=document.getElementById('phase-cards');
      if(pcards) pcards.innerHTML=phases.map(phaseCard).join('');
    }
    setRefreshTime();
  }catch(e){el.innerHTML=err(e);}
}

function phaseCard(p){
  const icons={ACCUMULATION:'🔵',MARKUP:'🚀',DISTRIBUTION:'🟡',MARKDOWN:'🔻',NEUTRAL:'⚪'};
  const conf=Math.round((p.confidence||0)*100);
  return `<div class="card" style="margin-bottom:0">
    <div class="card-title">${p.coin}</div>
    <div style="margin-bottom:8px"><span class="phase-badge phase-${p.phase}">${icons[p.phase]||'⚪'} ${p.phase}</span></div>
    <div class="conf-bar"><span class="muted" style="font-size:10px">Confidence</span><span class="conf-val">${conf}%</span></div>
    <div class="progress-bar" style="margin-bottom:8px"><div class="progress-fill" style="width:${conf}%"></div></div>
    <div style="font-size:10px;color:var(--text-muted);margin-bottom:5px">Price: <b style="color:var(--text)">${p.price_trend}</b> · Vol: <b style="color:var(--text)">${p.volume_trend}</b></div>
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