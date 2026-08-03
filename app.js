// ── Config ───────────────────────────────────────────────────────────────────
// Use a Cloudflare Worker proxy URL for edge caching (set via Settings → Proxy URL)
const HL = localStorage.getItem('hype_proxy_url') || 'https://api.hyperliquid.xyz/info';
const HL_WS = 'wss://api.hyperliquid.xyz/ws';
const DEFAULT_WALLET = '0x6e4c6da09f06690cc4db53d42ab539d3d4882015';
let currentWallet = localStorage.getItem('hype_wallet') || DEFAULT_WALLET;
let currentPage = 'overview';
let phaseInterval = '1h';
let activeNarrative = 'all';
let autoRefreshTimer = null;
let _silentRefresh = false;
let _lastRefreshTs = 0;
const _SKIP_SILENT = new Set(['phases','monitor','journal','analytics','kb','mvrv','ai','capital']);
let marketSortKey = 'volume';
let allMarketData = [];
let _recentPnlHours = 24;
let _recentPnlOpen  = false;
// CoinGecko demo API key — get a free one at https://www.coingecko.com/en/api
// Set via the monitor settings panel (stored in localStorage)
let _cgDemoKey = localStorage.getItem('hype_cg_key') || '';

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

// ── Portfolio chart state ─────────────────────────────────────────────────────
let portfolioChart = null;
let chartCurrency = 'USD';
let usdToIdr = 0;

// ── Telegram state ────────────────────────────────────────────────────────────
let tgToken = localStorage.getItem('hype_tg_token') || '';
let tgChatId = localStorage.getItem('hype_tg_chat') || '';
let pnlThreshold = parseFloat(localStorage.getItem('hype_pnl_thr') || '0');
let livePnLSnapshot = {};   // coin+side → last PnL for milestone detection
let lastOrderIds = null;    // Set of oid strings for fill detection

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
async function getSpotState(w) { return hlPost({ type:'spotClearinghouseState', user:w }); }
async function getSpotMeta() { return hlPost({ type:'spotMetaAndAssetCtxs' }); }
async function getUserFills(w) { return hlPost({ type:'userFills', user:w }); }
async function getUserFunding(w, days=30) { return hlPost({ type:'userFunding', user:w, startTime:Date.now()-days*86400000 }); }
async function getLedgerUpdates(w, days=90) { return hlPost({ type:'userNonFundingLedgerUpdates', user:w, startTime:Date.now()-days*86400000 }); }
async function getMetaAndAssetCtxs() {
  const now = Date.now();
  if (getMetaAndAssetCtxs._cache && now - getMetaAndAssetCtxs._ts < 2*60*1000) return getMetaAndAssetCtxs._cache;
  const data = await hlPost({ type:'metaAndAssetCtxs' });
  getMetaAndAssetCtxs._cache = data; getMetaAndAssetCtxs._ts = now;
  return data;
}
const _candleCache = new Map();
async function getCandles(coin, interval='1h', days=7) {
  const key = `${coin}|${interval}|${days}`;
  const hit = _candleCache.get(key);
  if (hit && Date.now() - hit.ts < 5*60*1000) return hit.data;
  const endTime = Date.now();
  const data = await hlPost({ type:'candleSnapshot', req:{ coin, interval, startTime:endTime-days*86400000, endTime } });
  _candleCache.set(key, { data, ts: Date.now() });
  return data;
}
async function getOpenOrders(w) { return hlPost({ type:'openOrders', user:w }); }

// ── Shared CoinGecko cache (3-min TTL, shared by intel.js + fundamentals.js) ─
const _cgShared = { global: null, globalTs: 0, markets: null, marketsTs: 0 };
function _cgHeaders() {
  return _cgDemoKey ? { 'x-cg-demo-api-key': _cgDemoKey } : {};
}
async function getCGGlobal() {
  if (_cgShared.global && Date.now() - _cgShared.globalTs < 3*60*1000) return _cgShared.global;
  const r = await fetch('https://api.coingecko.com/api/v3/global', { headers: _cgHeaders() });
  if (!r.ok) throw new Error('CG global ' + r.status);
  _cgShared.global = (await r.json()).data;
  _cgShared.globalTs = Date.now();
  return _cgShared.global;
}
async function getCGMarkets() {
  if (_cgShared.markets && Date.now() - _cgShared.marketsTs < 3*60*1000) return _cgShared.markets;
  const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h,7d,30d', { headers: _cgHeaders() });
  if (!r.ok) throw new Error('CG markets ' + r.status);
  _cgShared.markets = await r.json();
  _cgShared.marketsTs = Date.now();
  return _cgShared.markets;
}

// Shared simple-price cache (replaces scattered per-module CG calls)
const _cgPriceCache = { data: null, ts: 0 };
async function getCGSimplePrices(ids = 'bitcoin,ethereum,solana') {
  if (_cgPriceCache.data && Date.now() - _cgPriceCache.ts < 3*60*1000) return _cgPriceCache.data;
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`, { headers: _cgHeaders() });
    if (!r.ok) throw new Error('CG price ' + r.status);
    _cgPriceCache.data = await r.json();
    _cgPriceCache.ts   = Date.now();
    return _cgPriceCache.data;
  } catch (e) {
    // Kraken fallback for BTC and ETH prices
    try {
      const kr = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD');
      if (!kr.ok) throw new Error('Kraken ' + kr.status);
      const kd = await kr.json();
      const result = {};
      if (kd.result?.XXBTZUSD) result.bitcoin = { usd: parseFloat(kd.result.XXBTZUSD.c[0]) };
      if (kd.result?.XETHZUSD) result.ethereum = { usd: parseFloat(kd.result.XETHZUSD.c[0]) };
      if (kd.result?.SOLUSD)   result.solana   = { usd: parseFloat(kd.result.SOLUSD.c[0]) };
      _cgPriceCache.data = result;
      _cgPriceCache.ts   = Date.now();
      return result;
    } catch { return _cgPriceCache.data || {}; }
  }
}

// ── Parsers ───────────────────────────────────────────────────────────────────
function parsePositions(state) {
  return (state.assetPositions||[]).map(pos=>{
    const p=pos.position||{}; const szi=parseFloat(p.szi||0);
    if(szi===0) return null;
    const lev=p.leverage||{};
    const posVal=parseFloat(p.positionValue||0), size=Math.abs(szi);
    return { coin:p.coin, side:szi>0?'long':'short', size,
      entry_price:parseFloat(p.entryPx||0),
      mark_price: size>0 ? posVal/size : parseFloat(p.entryPx||0),
      unrealized_pnl:parseFloat(p.unrealizedPnl||0),
      leverage_type:lev.type||'cross', leverage_value:lev.value||1,
      liquidation_price:parseFloat(p.liquidationPx||0),
      margin_used:parseFloat(p.marginUsed||0), position_value:posVal,
      cum_funding:parseFloat((p.cumFunding||{}).sinceOpen||0) };
  }).filter(Boolean);
}

function buildMarketCtx(raw) {
  if (!raw || !Array.isArray(raw)) return {};
  const [meta, ctxs=[]] = raw;
  const result = {};
  (meta?.universe||[]).forEach((asset,i)=>{
    const ctx=ctxs[i]||{}, name=asset.name||'';
    if (!name) return;
    const f=parseFloat(ctx.funding||0);
    result[name]={ funding_rate_8h:f, funding_apr:f*3*365*100, mark_price:parseFloat(ctx.markPx||0) };
  });
  return result;
}

function scorePosition(p, marketCtx) {
  let score=100; const flags=[], factors=[]; const isLong=p.side==='long';
  const markPx=p.mark_price>0?p.mark_price:(marketCtx[p.coin]?.mark_price||p.entry_price);
  const lev=p.leverage_value||1;
  // 1. Leverage
  let levDed=0, levDetail, levStatus='pass';
  if      (lev>15){levDed=25;levDetail=`${lev}× leverage is very high`;levStatus='fail';}
  else if (lev>10){levDed=15;levDetail=`${lev}× leverage is elevated`;levStatus='warn';}
  else if (lev>7) {levDed=8; levDetail=`${lev}× leverage`;levStatus='warn';}
  else            {levDetail=`${lev}× leverage — acceptable`;}
  score-=levDed; if(levDed)flags.push(levDetail);
  factors.push({name:'Leverage',status:levStatus,detail:levDetail,deduction:levDed});
  // 2. Cycle phase
  let phaseDed=0, phaseDetail, phaseStatus='pass';
  if(typeof INTEL!=='undefined'&&INTEL.macro){
    const phase=(INTEL.macro.cycle_phase||'').toLowerCase();
    if(phase){
      if      (isLong &&['distribution','markdown'].some(ph=>phase.includes(ph))){phaseDed=25;phaseDetail=`LONG in ${INTEL.macro.cycle_phase} phase`;phaseStatus='fail';}
      else if (!isLong&&['accumulation','markup'].some(ph=>phase.includes(ph)))  {phaseDed=25;phaseDetail=`SHORT in ${INTEL.macro.cycle_phase} phase`;phaseStatus='fail';}
      else{phaseDetail=`${p.side} aligns with ${INTEL.macro.cycle_phase} phase`;}
    }else{phaseDetail='Cycle phase not set';phaseStatus='na';}
  }else{phaseDetail='INTEL data unavailable';phaseStatus='na';}
  score-=phaseDed; if(phaseDed)flags.push(phaseDetail);
  factors.push({name:'Cycle Phase',status:phaseStatus,detail:phaseDetail,deduction:phaseDed});
  // 3. Macro posture
  let postureDed=0, postureDetail, postureStatus='pass';
  if(typeof INTEL!=='undefined'&&INTEL.macro){
    const posture=INTEL.macro.posture||'';
    if(posture){
      if      (isLong &&(posture==='SELL'||posture==='BEAR')){postureDed=15;postureDetail=`Macro posture is ${posture} — against long`;postureStatus='fail';}
      else if (!isLong&&(posture==='BUY' ||posture==='BULL')){postureDed=15;postureDetail=`Macro posture is ${posture} — against short`;postureStatus='fail';}
      else{postureDetail=`Macro posture: ${posture} — aligned`;}
    }else{postureDetail='Posture not set';postureStatus='na';}
  }else{postureDetail='INTEL data unavailable';postureStatus='na';}
  score-=postureDed; if(postureDed)flags.push(postureDetail);
  factors.push({name:'Macro Posture',status:postureStatus,detail:postureDetail,deduction:postureDed});
  // 4. Funding rate
  let fundDed=0, fundDetail, fundStatus='pass';
  const ctx=marketCtx[p.coin];
  if(ctx){
    const apr=ctx.funding_apr;
    if      (isLong &&apr> 15){fundDed=20;fundDetail=`Paying ${apr.toFixed(1)}% APR funding`;fundStatus='fail';}
    else if (isLong &&apr>  5){fundDed=10;fundDetail=`Paying ${apr.toFixed(1)}% APR funding`;fundStatus='warn';}
    else if (!isLong&&apr<-15){fundDed=20;fundDetail=`Paying ${Math.abs(apr).toFixed(1)}% APR funding`;fundStatus='fail';}
    else if (!isLong&&apr< -5){fundDed=10;fundDetail=`Paying ${Math.abs(apr).toFixed(1)}% APR funding`;fundStatus='warn';}
    else{const earn=isLong?apr<=0:apr>=0;fundDetail=earn?`Earning ${Math.abs(apr).toFixed(1)}% APR funding`:`Funding ${Math.abs(apr).toFixed(1)}% APR — neutral`;}
  }else{fundDetail='Funding data unavailable';fundStatus='na';}
  score-=fundDed; if(fundDed)flags.push(fundDetail);
  factors.push({name:'Funding Rate',status:fundStatus,detail:fundDetail,deduction:fundDed});
  // 5. MVRV zone
  let mvrvDed=0, mvrvDetail, mvrvStatus='pass';
  if(typeof _mvrvData!=='undefined'&&_mvrvData?.coins?.[p.coin]){
    const zone=_mvrvData.coins[p.coin].zone;
    if      (isLong &&zone==='OVERHEATED') {mvrvDed=15;mvrvDetail=`${p.coin} MVRV overheated — long risk`;mvrvStatus='fail';}
    else if (!isLong&&zone==='UNDERVALUED'){mvrvDed=15;mvrvDetail=`${p.coin} MVRV undervalued — short risk`;mvrvStatus='warn';}
    else{mvrvDetail=`${p.coin} MVRV zone: ${zone||'neutral'}`;}
  }else{mvrvDetail='MVRV data unavailable';mvrvStatus='na';}
  score-=mvrvDed; if(mvrvDed)flags.push(mvrvDetail);
  factors.push({name:'MVRV Zone',status:mvrvStatus,detail:mvrvDetail,deduction:mvrvDed});
  // 6. Smart money
  let smDed=0, smDetail, smStatus='pass';
  if(typeof INTEL!=='undefined'){
    const sm=(INTEL.macro?.cohorts||[]).find(c=>c.name==='Smart Money');
    if(sm){
      if      (isLong &&!sm.bull){smDed=10;smDetail='Smart money distributing — against long';smStatus='fail';}
      else if (!isLong&& sm.bull){smDed=10;smDetail='Smart money accumulating — against short';smStatus='fail';}
      else{smDetail=`Smart money ${sm.bull?'accumulating':'distributing'} — aligned`;}
    }else{smDetail='Smart money data unavailable';smStatus='na';}
  }else{smDetail='INTEL data unavailable';smStatus='na';}
  score-=smDed; if(smDed)flags.push(smDetail);
  factors.push({name:'Smart Money',status:smStatus,detail:smDetail,deduction:smDed});
  // 7. Liquidation proximity
  let liqDed=0, liqDetail, liqStatus='pass';
  if(p.liquidation_price>0&&markPx>0){
    const liqPct=isLong?(markPx-p.liquidation_price)/markPx*100:(p.liquidation_price-markPx)/markPx*100;
    if      (liqPct<5) {liqDed=25;liqDetail=`Liquidation ${liqPct.toFixed(1)}% away — critical`;liqStatus='fail';}
    else if (liqPct<10){liqDed=15;liqDetail=`Liquidation ${liqPct.toFixed(1)}% away — close`;liqStatus='warn';}
    else               {liqDetail=`Liquidation ${liqPct.toFixed(1)}% away — safe`;}
  }else{liqDetail='No liquidation risk (cross margin)';}
  score-=liqDed; if(liqDed)flags.push(liqDetail);
  factors.push({name:'Liq. Proximity',status:liqStatus,detail:liqDetail,deduction:liqDed});
  // 8. BMSB
  let bmsbDed=0,bmsbDetail,bmsbStatus='pass';
  if(window._indData?.bmsb){const b=window._indData.bmsb;if(isLong&&b.signal==='BEAR'){bmsbDed=15;bmsbDetail=`Price below BMSB — bear regime against long`;bmsbStatus='fail';}else if(isLong&&b.signal==='NEUTRAL'){bmsbDed=5;bmsbDetail=`Price at BMSB edge — weak support`;bmsbStatus='warn';}else if(!isLong&&b.signal==='BULL'){bmsbDed=10;bmsbDetail=`Price above BMSB — bull regime against short`;bmsbStatus='warn';}else{bmsbDetail=b.signal==='BULL'?`Price above BMSB — bull regime`:`Price below BMSB — bear regime`;}}else{bmsbDetail='BMSB data unavailable';bmsbStatus='na';}
  score-=bmsbDed;if(bmsbDed)flags.push(bmsbDetail);
  factors.push({name:'BMSB',status:bmsbStatus,detail:bmsbDetail,deduction:bmsbDed});
  // 9. Fear & Greed
  let fgDed=0,fgDetail,fgStatus='pass';
  if(window._indData?.fear_greed){const fg=window._indData.fear_greed;if(isLong&&fg.zone==='EXTREME_GREED'){fgDed=10;fgDetail=`F&G ${fg.value} — extreme greed, longs crowded`;fgStatus='warn';}else if(!isLong&&fg.zone==='EXTREME_FEAR'){fgDed=10;fgDetail=`F&G ${fg.value} — extreme fear, shorts crowded`;fgStatus='warn';}else{fgDetail=`F&G ${fg.value} (${fg.classification})`;}}else{fgDetail='F&G data unavailable';fgStatus='na';}
  score-=fgDed;if(fgDed)flags.push(fgDetail);
  factors.push({name:'Fear & Greed',status:fgStatus,detail:fgDetail,deduction:fgDed});
  // 10. Pi Cycle Top
  let piDed=0,piDetail,piStatus='pass';
  if(window._indData?.pi_cycle){const pi=window._indData.pi_cycle;if(isLong&&pi.signal==='TOP'){piDed=20;piDetail=`Pi Cycle Top fired — major distribution zone`;piStatus='fail';}else if(isLong&&pi.signal==='WARNING'){piDetail=`Pi Cycle ${pi.proximity}% to top — approaching distribution`;piStatus='warn';}else{piDetail=`Pi Cycle ${pi.proximity}% to top`;}}else{piDetail='Pi Cycle data unavailable';piStatus='na';}
  score-=piDed;if(piDed)flags.push(piDetail);
  factors.push({name:'Pi Cycle',status:piStatus,detail:piDetail,deduction:piDed});
  score=Math.max(0,Math.min(100,score));
  return { score, grade:score>=70?'OK':score>=40?'CAUTION':'RISKY',
    cls:score>=70?'health-ok':score>=40?'health-caution':'health-risky', flags, factors };
}

let _posHealthData={};
function showHealthModal(coin){
  const d=_posHealthData[coin]; if(!d)return;
  let modal=document.getElementById('health-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='health-modal';
    modal.className='health-modal-overlay';
    modal.innerHTML=`<div class="health-modal-box" onclick="event.stopPropagation()">
      <div class="health-modal-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span id="hm-coin" style="font-weight:700;font-size:16px"></span>
          <span id="hm-side" class="side-badge"></span>
        </div>
        <button class="hm-close" onclick="document.getElementById('health-modal').style.display='none'">×</button>
      </div>
      <div class="health-modal-score-row">
        <span id="hm-score" class="health-modal-big-score"></span>
        <div><span id="hm-grade" class="health-badge" style="font-size:13px;padding:4px 10px"></span>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">out of 100</div></div>
      </div>
      <div id="hm-factors"></div>
    </div>`;
    modal.onclick=()=>modal.style.display='none';
    document.body.appendChild(modal);
  }
  document.getElementById('hm-coin').textContent=d.coin;
  const sb=document.getElementById('hm-side');sb.textContent=d.side.toUpperCase();sb.className=`side-badge ${d.side}`;
  const sc=document.getElementById('hm-score');sc.textContent=d.score;sc.className=`health-modal-big-score ${d.cls}`;
  const gr=document.getElementById('hm-grade');gr.textContent=d.grade;gr.className=`health-badge ${d.cls}`;
  document.getElementById('hm-factors').innerHTML=d.factors.map(f=>{
    const icon=f.status==='pass'?'✓':f.status==='fail'?'✗':f.status==='warn'?'!':'—';
    const dedStr=f.deduction>0?`−${f.deduction}`:f.status==='pass'?'✓':'—';
    const dedCls=f.deduction>0?'hm-ded-neg':f.status==='pass'?'hm-ded-pos':'hm-ded-na';
    return`<div class="hm-factor">
      <div class="hm-factor-left"><span class="hm-icon hm-${f.status}">${icon}</span>
        <div><div class="hm-factor-name">${f.name}</div><div class="hm-factor-detail">${f.detail}</div></div>
      </div><div class="hm-ded ${dedCls}">${dedStr}</div></div>`;
  }).join('');
  modal.style.display='flex';
}

function riskSummaryHtml(positions, marketCtx) {
  if (!positions.length) return '';
  const scored=positions.map(p=>({...p,h:scorePosition(p,marketCtx)}));
  if (!scored.some(p=>p.h.grade!=='OK')) return '';
  const totalNtl=scored.reduce((a,p)=>a+(p.position_value||0),0);
  const portScore=totalNtl>0
    ?Math.round(scored.reduce((a,p)=>a+p.h.score*(p.position_value||0),0)/totalNtl)
    :Math.round(scored.reduce((a,p)=>a+p.h.score,0)/scored.length);
  const portCls=portScore>=70?'health-ok':portScore>=40?'health-caution':'health-risky';
  const allFlags=scored.sort((a,b)=>a.h.score-b.h.score)
    .flatMap(p=>p.h.flags.map(f=>`${p.coin} ${p.side.toUpperCase()}: ${f}`)).slice(0,4);
  return `<div class="risk-summary">
    <div class="risk-summary-left">
      <div class="risk-score-wrap">
        <div class="risk-score-big ${portCls}">${portScore}</div>
        <div class="risk-score-label">Portfolio<br>Health</div>
      </div>
      <div class="risk-chips">
        ${scored.map(p=>`<span class="health-chip ${p.h.cls}" title="${p.h.flags.join(' · ')||'No flags'}">${p.coin} <b>${p.h.score}</b></span>`).join('')}
      </div>
    </div>
    <div class="risk-flags">${allFlags.map(f=>`<div class="risk-flag-row">⚠ ${f}</div>`).join('')}</div>
  </div>`;
}
function parseAccountSummary(state) {
  // In unified accounts crossMarginSummary exists but its accountValue is 0 (no separate perp wallet).
  // Use marginSummary for per-stat display; isUnified flag controls totalPortfolio calc below.
  const isUnified = !!state.crossMarginSummary;
  const m = state.marginSummary || {};
  return { account_value:parseFloat(m.accountValue||0), total_margin_used:parseFloat(m.totalMarginUsed||0),
    total_ntl_pos:parseFloat(m.totalNtlPos||0), withdrawable:parseFloat(state.withdrawable||0), isUnified };
}
function parseFills(fills) {
  return (fills||[]).map(f=>({time:f.time,coin:f.coin,side:f.side,dir:f.dir||'',price:parseFloat(f.px||0),size:parseFloat(f.sz||0),fee:parseFloat(f.fee||0),closed_pnl:parseFloat(f.closedPnl||0)})).sort((a,b)=>b.time-a.time);
}

// Group raw Hyperliquid fills into trade spans (entry → exit).
// A trade is "closed" when the position netSize returns to zero.
function buildTrades(rawFills) {
  if (!Array.isArray(rawFills)) return [];
  const fills = rawFills.map(f => ({
    time: f.time, coin: f.coin, dir: f.dir || '',
    size: parseFloat(f.sz || 0), price: parseFloat(f.px || 0), fee: parseFloat(f.fee || 0),
    closed_pnl: parseFloat(f.closedPnl || 0),
  })).sort((a, b) => a.time - b.time);

  const byCoin = {};
  for (const f of fills) { if (!byCoin[f.coin]) byCoin[f.coin] = []; byCoin[f.coin].push(f); }

  const trades = [];
  for (const [coin, coinFills] of Object.entries(byCoin)) {
    let cur = null;
    const save = () => {
      if (!cur) return;
      const exit_time = cur.closes.length ? cur.closes.at(-1).time : null;
      const fees = [...cur.opens, ...cur.closes].reduce((s, f) => s + f.fee, 0);
      const pnl  = cur.closes.reduce((s, f) => s + f.closed_pnl, 0);
      const entrySize = cur.opens.reduce((s, f) => s + f.size, 0);
      const exitSize  = cur.closes.reduce((s, f) => s + f.size, 0);
      const avgEntry  = entrySize > 0 ? cur.opens.reduce((s, f) => s + f.size * f.price, 0) / entrySize : 0;
      const avgExit   = exitSize  > 0 ? cur.closes.reduce((s, f) => s + f.size * f.price, 0) / exitSize  : 0;
      trades.push({ coin, side: cur.side, entry_time: cur.entry_time, exit_time,
        avg_entry: avgEntry, avg_exit: avgExit, size: entrySize, fill_count: cur.opens.length + cur.closes.length,
        pnl, fees, net_pnl: pnl - fees,
        hold_ms: exit_time ? exit_time - cur.entry_time : null,
        closed: Math.abs(cur.netSize) < 0.0001 && cur.closes.length > 0 });
      cur = null;
    };
    for (const f of coinFills) {
      if (f.dir.startsWith('Open')) {
        if (!cur) cur = { side: f.dir.includes('Long') ? 'long' : 'short', entry_time: f.time, opens: [], closes: [], netSize: 0 };
        cur.opens.push(f); cur.netSize += f.size;
      } else if (f.dir.startsWith('Close') && cur) {
        cur.closes.push(f); cur.netSize -= f.size;
        if (Math.abs(cur.netSize) < 0.0001) save();
      }
    }
    save(); // flush any remaining open trade
  }
  return trades;
}
function parseFunding(funding) {
  return (funding||[]).map(f=>({time:f.time,coin:(f.delta||{}).coin,funding_rate:parseFloat((f.delta||{}).fundingRate||0),usdc:parseFloat((f.delta||{}).usdc||0)})).sort((a,b)=>b.time-a.time);
}
function parseLedger(ledger) {
  return (ledger||[]).map(e=>{ const d=e.delta||{}; const usdc=parseFloat(d.usdc||0); return {time:e.time,type:d.type||'',usdc,direction:usdc>=0?'inflow':'outflow',hash:d.hash||''}; }).sort((a,b)=>b.time-a.time);
}

// Spot fills have coin = "@N" (spot market index). Map @N → coin name via spot universe.
function buildSpotIndexMap(spotMetaAndCtxs) {
  const universe = (spotMetaAndCtxs?.[0]?.universe) || [];
  const map = {};
  universe.forEach((u, i) => { map['@'+i] = u.name.split('/')[0]; });
  return map;
}
function parseSpotBalances(state, spotMetaAndCtxs) {
  if (!state?.balances) return { balances:[], usdcBalance:0 };
  const [spotMeta, assetCtxs=[]] = spotMetaAndCtxs || [];
  const universe = spotMeta?.universe || [];
  const priceMap = {};
  universe.forEach((u, i) => {
    const px = parseFloat(assetCtxs[i]?.midPx || assetCtxs[i]?.markPx || 0);
    if (px) priceMap[u.name.split('/')[0]] = px;
  });
  const usdcEntry = state.balances.find(b => b.coin === 'USDC');
  const usdcBalance = parseFloat(usdcEntry?.total || 0);
  const balances = state.balances
    .filter(b => b.coin !== 'USDC' && parseFloat(b.total) > 0)
    .map(b => {
      const total = parseFloat(b.total);
      const entryNtl = parseFloat(b.entryNtl || 0);
      const avgEntry = total > 0 && entryNtl > 0 ? entryNtl / total : 0;
      const currentPrice = priceMap[b.coin] || 0;
      const value = currentPrice * total;
      const unrealizedPnl = currentPrice > 0 && avgEntry > 0 ? (currentPrice - avgEntry) * total : 0;
      const pnlPct = entryNtl > 0 ? unrealizedPnl / entryNtl * 100 : 0;
      return { coin:b.coin, total, hold:parseFloat(b.hold||0), avgEntry, entryNtl, currentPrice, unrealizedPnl, pnlPct, value };
    })
    .filter(b => b.value > 0.01 || b.entryNtl > 0)
    .sort((a,b) => b.value - a.value);
  return { balances, usdcBalance };
}
function tagFills(fills, spotIndexMap) {
  return (fills||[]).map(f => {
    const isSpot = f.coin.startsWith('@');
    return { ...f, isSpot, type: isSpot ? 'SPOT' : 'PERP', coin: isSpot ? (spotIndexMap[f.coin] || f.coin) : f.coin };
  });
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

  // EMAs
  const ema20=iEMA(closes,20);
  const ema50=closes.length>=50?iEMA(closes,50):null;
  const ema200=closes.length>=200?iEMA(closes,200):null;
  const e20=ema20.at(-1), e20p=ema20.at(-Math.min(6,n));
  const e50=ema50?ema50.at(-1):null, e50p=ema50?ema50.at(-Math.min(6,n)):null;
  const e200=ema200?ema200.at(-1):null;
  const aboveE20=price>e20, aboveE50=ema50?price>e50:aboveE20;
  const aboveE200=e200?price>e200:null;
  const e20Slope=(e20-e20p)/e20p;
  const e50Slope=e50&&e50p?(e50-e50p)/e50p:0;

  // Price change over last ~20% of period
  const lb=Math.max(5,Math.floor(n*0.2));
  const pctChg=(price-closes[n-lb-1])/(closes[n-lb-1]||1);

  // Volume: last quarter vs first quarter
  const q=Math.max(4,Math.floor(n/4));
  const avgV=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
  const volRatio=avgV(volumes.slice(-q))/Math.max(avgV(volumes.slice(0,q)),1);

  // ATR range compression
  const atrArr=iATR(highs,lows,closes,14);
  const atrNow=atrArr.at(-1)||0;
  const atrEarly=avgV(atrArr.slice(0,Math.floor(n/4)).filter(Boolean))||atrNow||1;
  const atrRatio=atrNow/atrEarly;
  const rangeCompressed=atrRatio<0.65;

  // RSI
  const rsiVal=iRSI(closes).filter(v=>v!==null).at(-1)||50;

  // MACD histogram
  const {hist:macdHist}=iMACD(closes);
  const mh=macdHist.at(-1), mhPrev=macdHist.at(-2);

  // Consecutive close direction (last 5 candles)
  const last5=closes.slice(-5);
  const consecUp=last5.every((c,i)=>i===0||c>=last5[i-1]);
  const consecDn=last5.every((c,i)=>i===0||c<=last5[i-1]);

  const signals=[];
  let score=0;
  let bullCount=0, bearCount=0;

  // 1. EMA stack (weight 0.25)
  if(aboveE20&&aboveE50){score+=0.25;bullCount++;signals.push('Above EMA 20 & 50 — bullish structure');}
  else if(!aboveE20&&!aboveE50){score-=0.25;bearCount++;signals.push('Below EMA 20 & 50 — bearish structure');}
  else{score+=aboveE20?0.05:-0.05;signals.push('Mixed EMA alignment');}

  // 2. EMA 200 long-term context (weight 0.12)
  if(aboveE200===true){score+=0.12;bullCount++;signals.push('Above EMA 200 — long-term bullish');}
  else if(aboveE200===false){score-=0.12;bearCount++;signals.push('Below EMA 200 — long-term bearish');}

  // 3. EMA slope (weight 0.15 + 0.08)
  if(e20Slope>0.004){score+=0.15;bullCount++;signals.push('EMA 20 rising — momentum building');}
  else if(e20Slope<-0.004){score-=0.15;bearCount++;signals.push('EMA 20 declining — momentum fading');}
  if(e50&&e50Slope>0.002){score+=0.08;bullCount++;}
  else if(e50&&e50Slope<-0.002){score-=0.08;bearCount++;}

  // 4. MACD histogram (weight 0.2)
  if(mh>0&&mh>mhPrev){score+=0.2;bullCount++;signals.push(`MACD expanding bullish (hist +${mh.toFixed(5)})`);}
  else if(mh>0){score+=0.08;signals.push(`MACD bullish fading (hist +${mh.toFixed(5)})`);}
  else if(mh<0&&mh<mhPrev){score-=0.2;bearCount++;signals.push(`MACD expanding bearish (hist ${mh.toFixed(5)})`);}
  else if(mh<0){score-=0.08;signals.push(`MACD bearish fading (hist ${mh.toFixed(5)})`);}

  // 5. RSI directional (weight 0.12)
  if(rsiVal>60){score+=0.12;bullCount++;signals.push(`RSI ${rsiVal.toFixed(0)} — bullish momentum`);}
  else if(rsiVal<40){score-=0.12;bearCount++;signals.push(`RSI ${rsiVal.toFixed(0)} — bearish momentum`);}
  else{signals.push(`RSI ${rsiVal.toFixed(0)} — neutral zone`);}
  if(rsiVal>75){score-=0.08;signals.push('RSI overbought — caution');}
  else if(rsiVal<25){score+=0.08;signals.push('RSI oversold — potential reversal');}

  // 6. Recent price change (weight 0.18)
  if(pctChg>0.04){score+=0.18;bullCount++;signals.push(`Price +${(pctChg*100).toFixed(1)}% recent`);}
  else if(pctChg<-0.04){score-=0.18;bearCount++;signals.push(`Price ${(pctChg*100).toFixed(1)}% recent`);}
  else{signals.push(`Price flat (${(pctChg*100).toFixed(1)}%)`);}

  // 7. Volume vs trend (weight 0.18)
  const volTrend=volRatio>1.3?'expanding':volRatio<0.75?'contracting':'neutral';
  if(aboveE20&&volTrend==='expanding'){score+=0.18;bullCount++;signals.push(`Vol ${volRatio.toFixed(1)}x avg — expanding in uptrend (markup)`);}
  else if(!aboveE20&&volTrend==='expanding'){score-=0.18;bearCount++;signals.push(`Vol ${volRatio.toFixed(1)}x avg — expanding in downtrend (markdown)`);}
  else if(volTrend==='contracting'&&Math.abs(pctChg)<0.03){score+=0.15;bullCount++;signals.push('Low vol + tight range — accumulation zone');}
  else if(volTrend==='contracting'&&pctChg<-0.02){score-=0.08;signals.push('Shrinking vol on drop — exhaustion / base');}

  // 8. Consecutive close direction (weight 0.1)
  if(consecUp){score+=0.1;bullCount++;signals.push('5 consecutive up closes — strong momentum');}
  else if(consecDn){score-=0.1;bearCount++;signals.push('5 consecutive down closes — strong selling');}

  // 9. Range compression bonus for accumulation
  if(rangeCompressed){
    signals.push(`ATR at ${(atrRatio*100).toFixed(0)}% of avg — compressed range`);
    if(Math.abs(score)<0.3){score+=0.08;signals.push('Coiling inside tight range — breakout approaching');}
  }

  // 10. Signal alignment bonus: when 5+ signals agree, boost confidence
  const agreement=Math.max(bullCount,bearCount);
  const alignBonus=agreement>=5?0.1:agreement>=4?0.06:agreement>=3?0.03:0;
  score=Math.max(-1,Math.min(1,score))*(1+alignBonus*(score>0?1:-1));

  score=Math.max(-1,Math.min(1,score));
  const phase=score>=0.45?'MARKUP':score>=0.12?'ACCUMULATION':score<=-0.45?'MARKDOWN':score<=-0.12?'DISTRIBUTION':'NEUTRAL';
  const price_trend=pctChg>0.03?'up':pctChg<-0.03?'down':'flat';
  const candleBonus=0.04*Math.min(n/60,1);
  return {phase,confidence:+Math.min(Math.abs(score)+candleBonus,1).toFixed(3),price_trend,volume_trend:volTrend,range_compression:rangeCompressed,signals,score:+score.toFixed(4)};
}

// ── Navigation ────────────────────────────────────────────────────────────────
function openDrawer() {
  document.getElementById('nav-drawer')?.classList.add('open');
  document.getElementById('nav-overlay')?.classList.add('open');
  document.getElementById('hamburger-btn')?.classList.add('open');
}
function closeDrawer() {
  document.getElementById('nav-drawer')?.classList.remove('open');
  document.getElementById('nav-overlay')?.classList.remove('open');
  document.getElementById('hamburger-btn')?.classList.remove('open');
}
function toggleDrawer() {
  const d = document.getElementById('nav-drawer');
  if (d?.classList.contains('open')) closeDrawer(); else openDrawer();
}
function initMobileTableLabels() {
  function labelTable(t) {
    const headers = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!headers.length) return;
    t.querySelectorAll('tbody tr').forEach(row =>
      [...row.querySelectorAll('td')].forEach((td, i) => { if (headers[i] && !td.dataset.label) td.dataset.label = headers[i]; })
    );
  }
  document.querySelectorAll('table.mobile-cards').forEach(labelTable);
  new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes)
      if (n.nodeType === 1) {
        n.querySelectorAll?.('table.mobile-cards').forEach(labelTable);
        if (n.matches?.('table.mobile-cards')) labelTable(n);
      }
  }).observe(document.body, { childList: true, subtree: true });
}

function navigate(page) {
  try {
    closeDrawer();
    if (currentPage === 'monitor' && page !== 'monitor') disconnectWS();
    if (currentPage === 'capital' && page !== 'capital' && typeof stopCapitalPolling === 'function') stopCapitalPolling();
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nav-item,.bottom-nav-item,.topbar-tab,.drawer-item').forEach(n=>n.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (!pageEl) return;
    pageEl.classList.add('active');
    document.querySelectorAll(`[data-page="${page}"]`).forEach(el=>el.classList.add('active'));
    currentPage = page;
    const loaders={overview:loadOverview,capital:typeof loadCapital!=='undefined'?loadCapital:null,trades:loadTrades,funding:loadFunding,flows:loadFlows,monitor:loadMonitor,markets:loadMarkets,phases:loadPhases,intel:typeof loadIntel!=='undefined'?loadIntel:null,watchlist:loadWatchlist,journal:typeof loadJournal!=='undefined'?loadJournal:null,indicators:typeof loadIndicators!=='undefined'?loadIndicators:null,smartmoney:typeof loadNansen!=='undefined'?loadNansen:null,analytics:typeof loadAnalytics!=='undefined'?loadAnalytics:null,signals:typeof loadSignals!=='undefined'?loadSignals:null,news:typeof loadNews!=='undefined'?loadNews:null,hlpulse:typeof loadHLPulse!=='undefined'?loadHLPulse:null,fundamentals:typeof loadFundamentals!=='undefined'?loadFundamentals:null,ai:typeof loadAI!=='undefined'?loadAI:null,arb:typeof loadArb!=='undefined'?loadArb:null,defi:typeof loadDefi!=='undefined'?loadDefi:null,kb:typeof loadKB!=='undefined'?loadKB:null,trend:typeof loadTrend!=='undefined'?loadTrend:null,onchain:typeof loadOnchain!=='undefined'?loadOnchain:null,heatmap:typeof loadHeatmap!=='undefined'?loadHeatmap:null,brief:typeof loadDailyBrief!=='undefined'?loadDailyBrief:null,insights:typeof loadInsights!=='undefined'?loadInsights:null,research:typeof loadResearch!=='undefined'?loadResearch:null};
    if(loaders[page]) loaders[page]();
  } catch(e) { console.error('navigate error:', e); }
}
function refreshAll(){navigate(currentPage);}

// ── Overview ──────────────────────────────────────────────────────────────────
let overviewTab = 'summary';
let _ovData = null; // cached for tab switching
let _spotEnriched = false;

// Lazily compute spot cost basis from fill history for tokens with no entryNtl
async function enrichSpotCostBasis() {
  const spotBals   = _ovData?.spotBals;
  const spotMetaRaw = _ovData?.spotMetaRaw;
  if (!spotBals?.some(b => b.avgEntry === 0 && b.total > 0.000001)) return;
  if (_spotEnriched) return;
  try {
    const spotIndexMap = buildSpotIndexMap(spotMetaRaw);
    const rawFills = await getUserFills(currentWallet);
    const spotFills = (rawFills || [])
      .filter(f => f.coin?.startsWith('@') && spotIndexMap[f.coin])
      .map(f => ({
        coin:  spotIndexMap[f.coin],
        buy:   f.side === 'B',
        size:  parseFloat(f.sz  || 0),
        price: parseFloat(f.px  || 0),
        time:  f.time || 0,
      }))
      .filter(f => f.size > 0 && f.price > 0)
      .sort((a, b) => a.time - b.time);

    // Average cost method per coin
    const h = {}; // { coin: { shares, cost } }
    for (const f of spotFills) {
      if (!h[f.coin]) h[f.coin] = { shares: 0, cost: 0 };
      const c = h[f.coin];
      if (f.buy) {
        c.cost   += f.size * f.price;
        c.shares += f.size;
      } else if (c.shares > 0) {
        const frac = Math.min(f.size / c.shares, 1);
        c.cost  *= (1 - frac);
        c.shares = Math.max(c.shares - f.size, 0);
      }
    }

    let changed = false;
    _ovData.spotBals = spotBals.map(b => {
      if (b.avgEntry > 0) return b;
      const c = h[b.coin];
      if (!c || c.shares < 1e-9) return b;
      const avgEntry = c.cost / c.shares;
      if (avgEntry <= 0) return b;
      const unrealizedPnl = (b.currentPrice - avgEntry) * b.total;
      const entryNtl = avgEntry * b.total;
      const pnlPct   = entryNtl > 0 ? unrealizedPnl / entryNtl * 100 : 0;
      changed = true;
      return { ...b, avgEntry, entryNtl, unrealizedPnl, pnlPct };
    });

    if (changed) {
      _spotEnriched = true;
      _ovData.spotUnrPnl = _ovData.spotBals.reduce((a, b) => a + b.unrealizedPnl, 0);
      _ovData.totalUnr   = _ovData.positions.reduce((a, p) => a + p.unrealized_pnl, 0) + _ovData.spotUnrPnl;
      if (['summary', 'spot'].includes(overviewTab)) renderOverviewTab();
    }
  } catch (e) {
    console.warn('[enrichSpot]', e);
  }
}

function setOverviewTab(tab) {
  overviewTab = tab;
  document.querySelectorAll('.ov-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  if (_ovData) renderOverviewTab();
}

function renderOverviewTab() {
  const el = document.getElementById('ov-tab-body');
  if (!el || !_ovData) return;
  const {s, positions, spotBals, usdcBalance, orders, totalPortfolio, spotTotalValue, spotUnrPnl, totalUnr, marketCtx={}} = _ovData;

  if (overviewTab === 'summary') {
    el.innerHTML = `
      <div class="grid-4" style="margin-bottom:14px">
        <div class="stat-card"><div class="stat-label">Total Portfolio</div><div class="stat-value">${fmt$(totalPortfolio)}</div><div class="stat-sub">Perp ${fmt$(s.account_value)} · Spot ${fmt$(spotTotalValue)}</div></div>
        <div class="stat-card"><div class="stat-label">Unr. PnL</div><div class="stat-value ${totalUnr>=0?'pos':'neg'}">${fmt$(totalUnr)}</div><div class="stat-sub">Perp ${fmt$(positions.reduce((a,p)=>a+p.unrealized_pnl,0))} · Spot ${fmt$(spotUnrPnl)}</div></div>
        <div class="stat-card"><div class="stat-label">Perp Margin Used</div><div class="stat-value">${fmt$(s.total_margin_used)}</div><div class="stat-sub">${s.account_value>0?((s.total_margin_used/s.account_value)*100).toFixed(1):0}% of perp acct</div></div>
        <div class="stat-card"><div class="stat-label">Withdrawable</div><div class="stat-value">${fmt$(s.withdrawable)}</div><div class="stat-sub">USDC spot ${fmt$(usdcBalance)}</div></div>
      </div>
      ${renderRecentPnLWidget(_ovData.recentFills||[])}
      <div class="card" style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
          <div class="card-title" style="margin:0">📈 Portfolio Growth — 7 Days</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <div style="display:flex;gap:2px">
              <button class="tab ch-mode-tab${chartMode==='all'?' active':''}" data-mode="all"  onclick="setChartMode('all',this)">All</button>
              <button class="tab ch-mode-tab${chartMode==='perp'?' active':''}" data-mode="perp" onclick="setChartMode('perp',this)">Perps</button>
              <button class="tab ch-mode-tab${chartMode==='spot'?' active':''}" data-mode="spot" onclick="setChartMode('spot',this)">Spot</button>
            </div>
            <div style="display:flex;gap:2px">
              <button class="tab ch-cur-tab${chartCurrency==='USD'?' active':''}" data-cur="USD" onclick="setChartCurrency('USD')">$ USD</button>
              <button class="tab ch-cur-tab${chartCurrency==='IDR'?' active':''}" data-cur="IDR" onclick="setChartCurrency('IDR')">Rp IDR</button>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap">
          <div><div class="stat-label" id="ch-mode-label">${chartMode==='perp'?'Perp acct':chartMode==='spot'?'Spot total':'Portfolio'}</div><div id="ch-cur" class="mono" style="font-size:15px;font-weight:600">—</div></div>
          <div><div class="stat-label">7d Change</div><div id="ch-chg" class="mono" style="font-size:13px">—</div></div>
          <div><div class="stat-label">7d %</div><div id="ch-pct" class="mono" style="font-size:13px">—</div></div>
          <div><div class="stat-label">Rate</div><div id="ch-rate" class="muted" style="font-size:11px">fetching…</div></div>
        </div>
        <div style="position:relative;height:160px"><canvas id="portfolio-chart"></canvas></div>
      </div>
      ${(()=>{
        if (!positions.length) return '';
        const perpPnl = positions.reduce((a,p)=>a+p.unrealized_pnl,0);
        return `<div class="card" style="margin-top:14px">
          <div class="card-title" style="margin-bottom:10px">Perp Positions (${positions.length}) <span class="${perpPnl>=0?'pos':'neg'} mono" style="font-weight:400;font-size:12px">${perpPnl>=0?'+':''}${fmt$(perpPnl)}</span></div>
          <div class="table-wrap"><table class="mobile-cards">
            <thead><tr><th>Coin</th><th>Side</th><th>Size</th><th>Entry</th><th>Now</th><th>PnL</th><th>PnL %</th></tr></thead>
            <tbody>${positions.map(p=>{
              const mark    = marketCtx[p.coin]?.mark_price || p.mark_price || 0;
              const pnlPct  = p.entry_price>0 ? p.unrealized_pnl/(p.size*p.entry_price)*100 : 0;
              return `<tr>
                <td class="accent" style="font-weight:600;cursor:pointer" onclick="openPositionDetail('${p.coin}')">${p.coin}</td>
                <td><span class="side-badge ${p.side}">${p.side==='long'?'LONG':'SHORT'}</span></td>
                <td class="mono">${p.size}</td>
                <td class="mono muted">${fmt$(p.entry_price)}</td>
                <td class="mono">${mark>0?fmtPrice(mark):'—'}</td>
                <td class="${p.unrealized_pnl>=0?'pos':'neg'} mono">${fmt$(p.unrealized_pnl)}</td>
                <td class="${pnlPct>=0?'pos':'neg'}">${pnlPct>=0?'+':''}${pnlPct.toFixed(2)}%</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
        </div>`;
      })()}
      ${(()=>{
        if (!spotBals.length) return '';
        const spotPnl = spotBals.reduce((a,b)=>a+b.unrealizedPnl,0);
        return `<div class="card" style="margin-top:14px">
          <div class="card-title" style="margin-bottom:10px">Spot Holdings (${spotBals.length}) ${spotPnl!==0?`<span class="${spotPnl>=0?'pos':'neg'} mono" style="font-weight:400;font-size:12px">${spotPnl>=0?'+':''}${fmt$(spotPnl)}</span>`:''}
          </div>
          <div class="table-wrap"><table class="mobile-cards">
            <thead><tr><th>Coin</th><th>Amount</th><th>Entry</th><th>Now</th><th>Value</th><th>PnL</th><th>PnL %</th></tr></thead>
            <tbody>${spotBals.map(b=>`<tr>
              <td class="accent" style="font-weight:600">${b.coin}</td>
              <td class="mono">${b.total.toLocaleString('en-US',{maximumFractionDigits:6})}</td>
              <td class="mono muted">${b.avgEntry>0?fmtPrice(b.avgEntry):'—'}</td>
              <td class="mono">${b.currentPrice>0?fmtPrice(b.currentPrice):'—'}</td>
              <td class="mono">${b.value>0?fmt$(b.value):'—'}</td>
              <td class="${b.unrealizedPnl>=0?'pos':'neg'} mono">${b.avgEntry>0?fmt$(b.unrealizedPnl):'—'}</td>
              <td class="${b.pnlPct>=0?'pos':'neg'}">${b.avgEntry>0?(b.pnlPct>=0?'+':'')+b.pnlPct.toFixed(2)+'%':'—'}</td>
            </tr>`).join('')}
            ${usdcBalance>0.01?`<tr>
              <td class="muted" style="font-weight:600">USDC</td>
              <td class="mono">${usdcBalance.toFixed(2)}</td>
              <td class="muted">—</td><td class="mono muted">$1.00</td>
              <td class="mono">${fmt$(usdcBalance)}</td>
              <td class="muted">—</td><td class="muted">—</td>
            </tr>`:''}
            </tbody>
          </table></div>
        </div>`;
      })()}`;
    requestAnimationFrame(() => renderPortfolioChart(totalPortfolio));
  }

  else if (overviewTab === 'perp') {
    el.innerHTML = `
      <div class="grid-4" style="margin-bottom:14px">
        <div class="stat-card"><div class="stat-label">Account Value</div><div class="stat-value">${fmt$(s.account_value)}</div><div class="stat-sub">Withdrawable ${fmt$(s.withdrawable)}</div></div>
        <div class="stat-card"><div class="stat-label">Notional</div><div class="stat-value">${fmt$(s.total_ntl_pos)}</div><div class="stat-sub">${positions.length} open</div></div>
        <div class="stat-card"><div class="stat-label">Margin Used</div><div class="stat-value">${fmt$(s.total_margin_used)}</div><div class="stat-sub">${s.account_value>0?((s.total_margin_used/s.account_value)*100).toFixed(1):0}%</div></div>
        <div class="stat-card"><div class="stat-label">Unr. PnL</div><div class="stat-value ${positions.reduce((a,p)=>a+p.unrealized_pnl,0)>=0?'pos':'neg'}">${fmt$(positions.reduce((a,p)=>a+p.unrealized_pnl,0))}</div></div>
      </div>
      ${riskSummaryHtml(positions, marketCtx)}
      <div class="card" style="margin-bottom:14px">
        <div class="card-title">Open Positions (${positions.length})</div>
        ${positions.length===0?'<div class="empty-state">No open perp positions</div>':`
        <div class="table-wrap"><table class="mobile-cards">
          <thead><tr><th>Coin</th><th>Side</th><th>Size</th><th>Entry</th><th>Now</th><th>Liq</th><th>PnL</th><th>PnL%</th><th>Lev</th><th>Age</th><th>Health</th></tr></thead>
          <tbody>${(()=>{_posHealthData={};return positions;})().map(p=>{const h=scorePosition(p,marketCtx);_posHealthData[p.coin]={coin:p.coin,side:p.side,...h};const markPx=marketCtx[p.coin]?.mark_price||p.mark_price||0;const pnlPct=p.entry_price>0?p.unrealized_pnl/(p.size*p.entry_price)*100:0;return`<tr>
            <td class="accent" style="font-weight:600;cursor:pointer" onclick="openPositionDetail('${p.coin}')">${p.coin}</td>
            <td><span class="side-badge ${p.side}">${p.side==='long'?'LONG':'SHORT'}</span></td>
            <td class="mono">${p.size}</td>
            <td class="mono muted">${fmt$(p.entry_price)}</td>
            <td class="mono">${markPx>0?fmtPrice(markPx):'—'}</td>
            <td class="${p.liquidation_price>0?'neg':'muted'} mono">${p.liquidation_price>0?fmt$(p.liquidation_price):'—'}</td>
            <td class="${p.unrealized_pnl>=0?'pos':'neg'} mono">${fmt$(p.unrealized_pnl)}</td>
            <td class="${pnlPct>=0?'pos':'neg'}">${pnlPct>=0?'+':''}${pnlPct.toFixed(2)}%</td>
            <td class="muted">${p.leverage_value}x</td>
            <td>${typeof posAgeBadge==='function'?posAgeBadge(p.coin):''}</td>
            <td><span class="health-badge ${h.cls}" style="cursor:pointer" onclick="showHealthModal('${p.coin}')"><span class="health-score">${h.score}</span> ${h.grade}</span></td>
          </tr>`;}).join('')}</tbody>
        </table></div>`}
      </div>
      ${orders.length>0?`<div class="card">
        <div class="card-title">Open Orders (${orders.length})</div>
        <div class="table-wrap"><table class="mobile-cards">
          <thead><tr><th>Coin</th><th>Side</th><th>Size</th><th>Limit</th></tr></thead>
          <tbody>${orders.map(o=>`<tr>
            <td class="accent">${o.coin}</td>
            <td><span class="side-badge ${o.side==='B'?'long':'short'}">${o.side==='B'?'BUY':'SELL'}</span></td>
            <td class="mono">${o.sz}</td>
            <td class="mono">${o.limitPx?fmt$(parseFloat(o.limitPx)):'—'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`:'<div class="card"><div class="empty-state">No open orders</div></div>'}
      ${renderOrderScenarios(positions, orders)}`;
  }

  else if (overviewTab === 'spot') {
    const totalSpotPnl = spotBals.reduce((a,b)=>a+b.unrealizedPnl,0);
    el.innerHTML = `
      <div class="grid-4" style="margin-bottom:14px">
        <div class="stat-card"><div class="stat-label">Spot Total Value</div><div class="stat-value">${fmt$(spotTotalValue)}</div><div class="stat-sub">${spotBals.length} tokens</div></div>
        <div class="stat-card"><div class="stat-label">USDC Balance</div><div class="stat-value">${fmt$(usdcBalance)}</div><div class="stat-sub">Available cash</div></div>
        <div class="stat-card"><div class="stat-label">Tokens Value</div><div class="stat-value">${fmt$(spotBals.reduce((a,b)=>a+b.value,0))}</div><div class="stat-sub">excl. USDC</div></div>
        <div class="stat-card"><div class="stat-label">Unr. PnL</div><div class="stat-value ${totalSpotPnl>=0?'pos':'neg'}">${fmt$(totalSpotPnl)}</div><div class="stat-sub">vs avg entry</div></div>
      </div>
      <div class="card">
        <div class="card-title">Spot Holdings</div>
        ${spotBals.length===0&&usdcBalance<0.01?'<div class="empty-state">No spot holdings</div>':`
        <div class="table-wrap"><table class="mobile-cards">
          <thead><tr><th>Coin</th><th>Amount</th><th>Avg Entry</th><th>Price Now</th><th>Value</th><th>PnL $</th><th>PnL %</th></tr></thead>
          <tbody>
            ${spotBals.map(b=>`<tr>
              <td class="accent" style="font-weight:600">${b.coin}</td>
              <td class="mono">${b.total.toLocaleString('en-US',{maximumFractionDigits:6})}</td>
              <td class="mono muted">${b.avgEntry>0?fmtPrice(b.avgEntry):'—'}</td>
              <td class="mono">${b.currentPrice>0?fmtPrice(b.currentPrice):'—'}</td>
              <td class="mono">${b.value>0?fmt$(b.value):'—'}</td>
              <td class="${b.unrealizedPnl>=0?'pos':'neg'} mono">${b.avgEntry>0?fmt$(b.unrealizedPnl):'—'}</td>
              <td class="${b.pnlPct>=0?'pos':'neg'}">${b.avgEntry>0?(b.pnlPct>=0?'+':'')+b.pnlPct.toFixed(2)+'%':'—'}</td>
            </tr>`).join('')}
            ${usdcBalance>0.01?`<tr>
              <td class="muted" style="font-weight:600">USDC</td>
              <td class="mono">${usdcBalance.toFixed(2)}</td>
              <td class="muted">—</td><td class="muted mono">$1.00</td>
              <td class="mono">${fmt$(usdcBalance)}</td>
              <td class="muted">—</td><td class="muted">—</td>
            </tr>`:''}
          </tbody>
        </table></div>`}
      </div>`;
  }
}

async function loadOverview(){
  const el=document.getElementById('overview-content');
  if(!_silentRefresh) el.innerHTML=loading();
  _spotEnriched = false;
  try{
    setStatus(true);
    const [state, orders, spotStateRaw, spotMetaRaw, perpMetaRaw, rawFillsOv] = await Promise.all([
      getClearinghouseState(currentWallet), getOpenOrders(currentWallet),
      getSpotState(currentWallet).catch(()=>null),
      getSpotMeta().catch(()=>null),
      getMetaAndAssetCtxs().catch(()=>null),
      getUserFills(currentWallet).catch(()=>null),
    ]);
    checkOrderFills(orders);
    const s = parseAccountSummary(state), positions = parsePositions(state);
    if (typeof pmClearStale === 'function') pmClearStale(positions.map(p => p.coin));
    const marketCtx = buildMarketCtx(perpMetaRaw);
    const {balances:spotBals, usdcBalance} = parseSpotBalances(spotStateRaw, spotMetaRaw);
    // Fill missing spot prices from perp mark price (HYPE and others may lack spot ctx price)
    spotBals.forEach(b => {
      if (b.currentPrice > 0) return;
      const px = livePrices[b.coin] || marketCtx[b.coin]?.mark_price || 0;
      if (!px) return;
      b.currentPrice = px;
      b.value = px * b.total;
      if (b.avgEntry > 0) {
        b.unrealizedPnl = (px - b.avgEntry) * b.total;
        b.pnlPct = b.entryNtl > 0 ? b.unrealizedPnl / b.entryNtl * 100 : 0;
      }
    });
    const spotTotalValue = spotBals.reduce((a,b)=>a+b.value,0) + usdcBalance;
    const spotUnrPnl = spotBals.reduce((a,b)=>a+b.unrealizedPnl,0);
    const perpUnrPnl = positions.reduce((a,p)=>a+p.unrealized_pnl,0);
    const totalUnr = perpUnrPnl + spotUnrPnl;
    // Unified: USDC lives in spot wallet (already in spotTotalValue); perp side only adds floating PnL
    // Legacy: separate perp wallet (account_value) + spot
    const totalPortfolio = s.isUnified
      ? spotTotalValue + perpUnrPnl
      : s.account_value + spotTotalValue;

    const spotIndexMapOv = buildSpotIndexMap(spotMetaRaw);
    const recentFills = rawFillsOv ? tagFills(parseFills(rawFillsOv), spotIndexMapOv) : [];
    _ovData = {s, positions, spotBals, usdcBalance, orders, totalPortfolio, spotTotalValue, spotUnrPnl, totalUnr, marketCtx, spotMetaRaw, recentFills};
    window._rawMeta = perpMetaRaw;
    if(typeof fetchIndicators==='function')fetchIndicators().catch(()=>{});
    enrichSpotCostBasis().catch(()=>{});

    el.innerHTML = `
      <div class="section-header" style="margin-bottom:14px">
        <div class="section-title">Portfolio</div>
        <div class="tabs">
          <button class="tab ov-tab${overviewTab==='summary'?' active':''}" data-tab="summary" onclick="setOverviewTab('summary')">📊 Summary</button>
          <button class="tab ov-tab${overviewTab==='perp'?' active':''}" data-tab="perp" onclick="setOverviewTab('perp')">⚡ Perp</button>
          <button class="tab ov-tab${overviewTab==='spot'?' active':''}" data-tab="spot" onclick="setOverviewTab('spot')">💎 Spot</button>
        </div>
      </div>
      <div id="ov-tab-body"></div>`;

    renderOverviewTab();
    setRefreshTime();
  }catch(e){if(!_silentRefresh){el.innerHTML=err(e);setStatus(false);}}
}

// ── Trades ────────────────────────────────────────────────────────────────────
let _tradesCoinFilter = '';
let _tradesSubTab = 'perp';
let _tradesWindow = 30;
let _tradesInsights = '';

function switchTradeTab(tab) {
  _tradesSubTab = tab;
  document.querySelectorAll('.trades-subtab-btn').forEach(b => {
    const on = b.dataset.tab === tab;
    b.style.background = on ? 'var(--accent)' : 'var(--surface2)';
    b.style.color = on ? '#fff' : 'var(--text-muted)';
    b.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
  });
  renderTradesTables();
}

function switchTradesWindow(days) {
  _tradesWindow = days;
  document.querySelectorAll('.tw-btn').forEach(b => {
    const on = +b.dataset.days === days;
    b.style.background = on ? 'var(--accent)' : 'var(--surface2)';
    b.style.color = on ? '#fff' : 'var(--text-muted)';
    b.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
  });
  if (window._tradesData) _renderTradesContent(window._tradesData.allPerpFills, window._tradesData.allSpotFills);
}

function _twFills(fills) {
  if (!_tradesWindow) return fills;
  const cutoff = Date.now() - _tradesWindow * 86400000;
  return fills.filter(f => f.time >= cutoff);
}

function renderTradesTables() {
  const wrap = document.getElementById('trades-table-wrap');
  if (!wrap || !window._tradesData) return;
  const { perpFills, spotFills } = window._tradesData;
  const q = (_tradesCoinFilter || '').toUpperCase().trim();
  const match = f => !q || f.coin.toUpperCase().includes(q);
  const isPerp = _tradesSubTab === 'perp';
  const fills = (isPerp ? perpFills : spotFills).filter(match);
  const shown = fills.slice(0, 100);
  wrap.innerHTML = `
    <div class="table-wrap"><table class="mobile-cards">
      <thead><tr>
        <th>Time</th><th>Coin</th><th>Side</th><th>Price</th>
        ${isPerp ? '<th>Size</th><th>PnL</th><th>Fee</th>' : '<th>Qty</th><th>Total</th><th>PnL</th><th>Fee</th>'}
      </tr></thead>
      <tbody>${shown.length===0
        ? `<tr><td colspan="${isPerp?7:8}" class="muted" style="text-align:center;padding:24px">No ${isPerp?'perp':'spot'} fills${q?' for '+q:''}</td></tr>`
        : shown.map(f=>`<tr>
          <td data-label="Time" class="muted">${fmtTime(f.time)}</td>
          <td data-label="Coin" class="accent" style="font-weight:600">${f.coin}</td>
          <td data-label="Side"><span class="side-badge ${f.side==='B'?'long':'short'}">${f.side==='B'?'BUY':'SELL'}</span></td>
          <td data-label="Price" class="mono">${fmtPrice(f.price)}</td>
          ${isPerp
            ? `<td data-label="Size" class="mono">${f.size}</td>
               <td data-label="PnL" class="${f.closed_pnl>0?'pos':f.closed_pnl<0?'neg':'muted'} mono">${f.closed_pnl!==0?fmt$(f.closed_pnl):'—'}</td>
               <td data-label="Fee" class="neg mono">${f.fee>0?'−'+fmt$(f.fee):'—'}</td>`
            : `<td data-label="Qty" class="mono">${f.size}</td>
               <td data-label="Total" class="mono">${fmt$(f.price*f.size)}</td>
               <td data-label="PnL" class="${f.closed_pnl>0?'pos':f.closed_pnl<0?'neg':'muted'} mono">${f.closed_pnl!==0?fmt$(f.closed_pnl):'—'}</td>
               <td data-label="Fee" class="neg mono">${f.fee>0?'−'+fmt$(f.fee):'—'}</td>`}
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${fills.length>100?`<div class="muted" style="text-align:center;padding:10px;font-size:11px">Showing 100 of ${fills.length} — filter by coin to narrow down</div>`:''}`;
}

function _tradeAnalyticsHtml(allPerpFills) {
  const perpFills = _twFills(allPerpFills);
  const closes = perpFills.filter(f => f.closed_pnl !== 0);
  if (closes.length < 2) return `<div style="font-size:11px;color:var(--text-muted);padding:4px 0 14px">Not enough closing fills in this period.</div>`;

  const wins = closes.filter(f => f.closed_pnl > 0);
  const losses = closes.filter(f => f.closed_pnl < 0);
  const grossWins = wins.reduce((s, f) => s + f.closed_pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, f) => s + f.closed_pnl, 0));
  const pf = grossLoss > 0 ? grossWins / grossLoss : null;
  const avgWin = wins.length ? grossWins / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  // Current streak (from most recent close)
  const sorted = [...closes].sort((a, b) => b.time - a.time);
  let streak = 0, streakWin = null;
  for (const f of sorted) {
    const w = f.closed_pnl > 0;
    if (streakWin === null) { streakWin = w; streak = 1; }
    else if (w === streakWin) streak++;
    else break;
  }

  // Max drawdown from equity peak
  const chron = [...closes].sort((a, b) => a.time - b.time);
  let cum = 0, peak = 0, maxDD = 0;
  for (const f of chron) {
    cum += f.closed_pnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }

  // Per-coin breakdown
  const byCoin = {};
  for (const f of closes) {
    if (!byCoin[f.coin]) byCoin[f.coin] = { pnl: 0, wins: 0, total: 0 };
    byCoin[f.coin].pnl += f.closed_pnl;
    byCoin[f.coin].total++;
    if (f.closed_pnl > 0) byCoin[f.coin].wins++;
  }
  const coinStats = Object.entries(byCoin)
    .map(([coin, s]) => ({ coin, ...s, wr: s.wins / s.total }))
    .sort((a, b) => b.pnl - a.pnl);
  const topCoins = coinStats.slice(0, 5);
  const worstCoins = [...coinStats].reverse().filter(c => c.pnl < 0).slice(0, 3);
  const worstNotInTop = worstCoins.filter(c => !topCoins.find(t => t.coin === c.coin));

  // Hour of day patterns (UTC)
  const byHour = {};
  for (const f of closes) {
    const h = new Date(f.time).getUTCHours();
    if (!byHour[h]) byHour[h] = { pnl: 0, total: 0 };
    byHour[h].pnl += f.closed_pnl; byHour[h].total++;
  }
  const hourEntries = Object.entries(byHour).sort((a, b) => +a[0] - +b[0]);
  const maxAbsHour = Math.max(...Object.values(byHour).map(h => Math.abs(h.pnl)), 1);

  // Day of week patterns
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDay = {};
  for (const f of closes) {
    const d = DAY_NAMES[new Date(f.time).getUTCDay()];
    if (!byDay[d]) byDay[d] = { pnl: 0, total: 0 };
    byDay[d].pnl += f.closed_pnl; byDay[d].total++;
  }
  const dayEntries = Object.entries(byDay).sort((a, b) => b[1].pnl - a[1].pnl);

  const cs  = `background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px`;
  const ls  = `font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:4px`;
  const tdS = `padding:5px 6px;font-size:11px;border-bottom:1px solid var(--border)`;
  const thS = `padding:4px 6px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint);border-bottom:1px solid var(--border);font-weight:500`;

  const pfColor     = pf === null ? 'var(--text)' : pf >= 1.5 ? 'var(--green)' : pf < 1 ? 'var(--red)' : 'var(--text)';
  const streakColor = streakWin ? 'var(--green)' : 'var(--red)';

  const coinRow = c => `<tr>
    <td style="${tdS};font-weight:600">${c.coin}</td>
    <td style="${tdS};text-align:center;color:var(--text-muted)">${c.total}</td>
    <td style="${tdS};text-align:right;font-family:var(--mono);color:${c.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${c.pnl >= 0 ? '+' : ''}${fmt$(c.pnl)}</td>
    <td style="${tdS};text-align:right;color:var(--text-muted)">${(c.wr * 100).toFixed(0)}%</td>
  </tr>`;

  return `
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:14px">
    <div style="${cs}">
      <div style="${ls}">Profit Factor</div>
      <div style="font-size:15px;font-weight:700;font-family:var(--mono);color:${pfColor}">${pf !== null ? pf.toFixed(2) : '—'}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${pf !== null ? (pf >= 1.5 ? 'Strong edge' : pf >= 1 ? 'Slight edge' : 'Losing edge') : 'no data'}</div>
    </div>
    <div style="${cs}">
      <div style="${ls}">Avg Win</div>
      <div style="font-size:15px;font-weight:700;font-family:var(--mono);color:var(--green)">${fmt$(avgWin)}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${wins.length} winning closes</div>
    </div>
    <div style="${cs}">
      <div style="${ls}">Avg Loss</div>
      <div style="font-size:15px;font-weight:700;font-family:var(--mono);color:var(--red)">${fmt$(avgLoss)}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${losses.length} losing closes</div>
    </div>
    <div style="${cs}">
      <div style="${ls}">Streak</div>
      <div style="font-size:15px;font-weight:700;font-family:var(--mono);color:${streakColor}">${streakWin ? 'W' : 'L'}${streak}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${streak} in a row</div>
    </div>
    <div style="${cs}">
      <div style="${ls}">Max Drawdown</div>
      <div style="font-size:15px;font-weight:700;font-family:var(--mono);color:${maxDD > 500 ? 'var(--red)' : 'var(--text)'}">${maxDD > 0 ? '−' + fmt$(maxDD) : '—'}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">from equity peak</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
    <div style="${cs}">
      <div style="${ls};margin-bottom:8px">Top Performers</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${thS}">Coin</th><th style="${thS};text-align:center">Closes</th>
          <th style="${thS};text-align:right">P&L</th><th style="${thS};text-align:right">WR</th>
        </tr></thead>
        <tbody>${topCoins.map(coinRow).join('')}</tbody>
      </table>
      ${worstNotInTop.length > 0 ? `
        <div style="${ls};margin:10px 0 6px">Worst Performers</div>
        <table style="width:100%;border-collapse:collapse">
          <tbody>${worstNotInTop.map(coinRow).join('')}</tbody>
        </table>` : ''}
    </div>

    <div style="${cs}">
      <div style="${ls};margin-bottom:8px">By Hour (UTC)</div>
      ${hourEntries.map(([h, d]) => {
        const barW = Math.round(Math.abs(d.pnl) / maxAbsHour * 80);
        const pos  = d.pnl >= 0;
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:10px;color:var(--text-muted);width:26px;font-family:var(--mono);flex-shrink:0">${String(h).padStart(2,'0')}h</span>
          <div style="width:${barW}px;min-width:2px;height:5px;background:${pos?'var(--green)':'var(--red)'};border-radius:2px;opacity:.75;flex-shrink:0"></div>
          <span style="font-size:10px;font-family:var(--mono);color:${pos?'var(--green)':'var(--red)'}">${pos?'+':''}${fmt$(d.pnl)}</span>
          <span style="font-size:10px;color:var(--text-muted)">(${d.total})</span>
        </div>`;
      }).join('')}
      <div style="${ls};margin:10px 0 6px">By Day</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${dayEntries.map(([day, d]) => `
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px 8px;text-align:center">
            <div style="font-size:11px;font-weight:600;color:var(--text)">${day}</div>
            <div style="font-size:10px;font-family:var(--mono);color:${d.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${d.pnl >= 0 ? '+' : ''}${fmt$(d.pnl)}</div>
            <div style="font-size:10px;color:var(--text-muted)">${d.total}×</div>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <div style="${cs};margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div style="${ls}">AI Insights</div>
      <button onclick="_tradesGenInsights(this)"
        style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px 12px;color:var(--text);font-size:11px;cursor:pointer;font-family:var(--font)">
        ✦ Generate
      </button>
    </div>
    <div id="trades-insights-text" style="font-size:12px;line-height:1.6;color:${_tradesInsights ? 'var(--text)' : 'var(--text-muted)'}">
      ${_tradesInsights || 'Click Generate to get AI analysis of your patterns, strengths, and specific improvements.'}
    </div>
  </div>`;
}

async function _tradesGenInsights(btn) {
  const d = window._tradesData;
  if (!d) return;
  const closes = _twFills(d.allPerpFills).filter(f => f.closed_pnl !== 0);
  if (closes.length < 3) return;
  btn.disabled = true; btn.textContent = '…';

  const wins = closes.filter(f => f.closed_pnl > 0);
  const losses = closes.filter(f => f.closed_pnl < 0);
  const totalPnl = closes.reduce((s, f) => s + f.closed_pnl, 0);
  const grossWins = wins.reduce((s, f) => s + f.closed_pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, f) => s + f.closed_pnl, 0));
  const pf = grossLoss > 0 ? (grossWins / grossLoss).toFixed(2) : 'N/A';

  const byCoin = {};
  for (const f of closes) {
    if (!byCoin[f.coin]) byCoin[f.coin] = { pnl: 0, total: 0, wins: 0 };
    byCoin[f.coin].pnl += f.closed_pnl; byCoin[f.coin].total++;
    if (f.closed_pnl > 0) byCoin[f.coin].wins++;
  }
  const coins = Object.entries(byCoin).map(([c, v]) => ({ coin: c, ...v })).sort((a, b) => b.pnl - a.pnl);

  const byHour = {};
  for (const f of closes) {
    const h = new Date(f.time).getUTCHours();
    if (!byHour[h]) byHour[h] = { pnl: 0 };
    byHour[h].pnl += f.closed_pnl;
  }
  const hSorted = Object.entries(byHour).sort((a, b) => b[1].pnl - a[1].pnl);

  const period = _tradesWindow === 0 ? 'all time' : `last ${_tradesWindow}d`;
  const prompt = `Hyperliquid perps trader, ${period}:
- ${closes.length} closes: ${wins.length}W/${losses.length}L (${(wins.length/closes.length*100).toFixed(0)}% WR)
- Net PnL: $${totalPnl.toFixed(0)}, Profit Factor: ${pf}
- Top coins: ${coins.slice(0, 3).map(c => `${c.coin} $${c.pnl.toFixed(0)} ${(c.wins/c.total*100).toFixed(0)}%WR`).join(', ')}
${coins.filter(c => c.pnl < 0).length ? `- Worst coins: ${coins.filter(c => c.pnl < 0).reverse().slice(0, 2).map(c => `${c.coin} $${c.pnl.toFixed(0)}`).join(', ')}` : ''}
${hSorted.length ? `- Best hour: ${hSorted[0][0]}:00 UTC ($${hSorted[0][1].pnl.toFixed(0)}), Worst: ${hSorted.at(-1)[0]}:00 UTC ($${hSorted.at(-1)[1].pnl.toFixed(0)})` : ''}

Write 3 specific, data-driven insights: what's working, what to stop, one concrete rule. Be direct, no generic advice.`;

  const el = document.getElementById('trades-insights-text');
  if (el) { el.style.color = 'var(--text-muted)'; el.textContent = 'Analyzing patterns…'; }

  const text = await _callLLM('synthesis', prompt, { maxTokens: 300 });
  _tradesInsights = text || '';
  if (el) {
    el.style.color = text ? 'var(--text)' : 'var(--text-muted)';
    el.textContent = text || 'Set hype_edge_fn_url in AI settings to enable insights.';
  }
  btn.disabled = false; btn.textContent = '✦ Refresh';
}

function _renderTradesContent(allPerpFills, allSpotFills) {
  const el = document.getElementById('trades-content');
  if (!el) return;
  const perpFills = _twFills(allPerpFills);
  const spotFills = _twFills(allSpotFills);
  window._tradesData.perpFills = perpFills;
  window._tradesData.spotFills = spotFills;

  const closes   = perpFills.filter(f => f.closed_pnl !== 0);
  const perpPnl  = closes.reduce((s, f) => s + f.closed_pnl, 0);
  const totalFees = perpFills.reduce((s, f) => s + f.fee, 0);
  const wins   = closes.filter(f => f.closed_pnl > 0).length;
  const losses = closes.filter(f => f.closed_pnl < 0).length;

  const windowBtns = [7, 30, 90, 0].map((days, i) => {
    const label = days === 0 ? 'All' : `${days}d`;
    const on = days === _tradesWindow;
    return `<button class="tw-btn" data-days="${days}" onclick="switchTradesWindow(${days})"
      style="padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};
      ${i === 0 ? 'border-radius:var(--radius-sm) 0 0 var(--radius-sm)' : i === 3 ? 'border-left:none;border-radius:0 var(--radius-sm) var(--radius-sm) 0' : 'border-left:none'};
      background:${on ? 'var(--accent)' : 'var(--surface2)'};color:${on ? '#fff' : 'var(--text-muted)'}">${label}</button>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-bottom:11px;border-bottom:1px solid var(--border);margin-bottom:12px">
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12px;align-items:center">
        <span class="muted">PnL <strong class="${perpPnl >= 0 ? 'pos' : 'neg'}">${fmt$(perpPnl)}</strong></span>
        <span class="muted">Win <strong>${wins + losses > 0 ? (wins / (wins + losses) * 100).toFixed(0) : 0}%</strong> <span style="font-size:10px">(${wins}W / ${losses}L)</span></span>
        <span class="muted">Fees <strong class="neg">−${fmt$(totalFees)}</strong></span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex">${windowBtns}</div>
        <input id="trades-search" type="text" placeholder="Filter coin…" value="${_tradesCoinFilter}"
          oninput="_tradesCoinFilter=this.value;renderTradesTables()"
          style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);padding:5px 10px;font-size:12px;outline:none;width:120px">
      </div>
    </div>
    <div id="trades-analytics-wrap">${_tradeAnalyticsHtml(allPerpFills)}</div>
    <div style="display:flex;margin-bottom:14px">
      ${['perp', 'spot'].map((t, i) => {
        const on = _tradesSubTab === t;
        return `<button class="trades-subtab-btn" data-tab="${t}" onclick="switchTradeTab('${t}')"
          style="padding:7px 18px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};
          ${i === 0 ? 'border-radius:var(--radius-sm) 0 0 var(--radius-sm)' : 'border-left:none;border-radius:0 var(--radius-sm) var(--radius-sm) 0'};
          background:${on ? 'var(--accent)' : 'var(--surface2)'};color:${on ? '#fff' : 'var(--text-muted)'}">
          ${t === 'perp' ? 'Perp' : 'Spot'} (${t === 'perp' ? perpFills.length : spotFills.length})</button>`;
      }).join('')}
    </div>
    <div id="trades-table-wrap"></div>`;

  renderTradesTables();
}

async function loadTrades() {
  const el = document.getElementById('trades-content');
  if (!_silentRefresh) el.innerHTML = loading();
  try {
    const [rawFills, spotMetaRaw] = await Promise.all([
      getUserFills(currentWallet),
      getSpotMeta().catch(() => null)
    ]);
    const spotIndexMap = buildSpotIndexMap(spotMetaRaw);
    const allFills = tagFills(parseFills(rawFills), spotIndexMap).sort((a, b) => b.time - a.time);
    const allPerpFills = allFills.filter(f => !f.isSpot);
    const allSpotFills = allFills.filter(f => f.isSpot);
    window._tradesData = { allPerpFills, allSpotFills, perpFills: [], spotFills: [] };
    _renderTradesContent(allPerpFills, allSpotFills);
    setRefreshTime();
  } catch (e) {
    if (!_silentRefresh) el.innerHTML = err(e);
  }
}

// ── Funding ───────────────────────────────────────────────────────────────────
let _fundingDays = 30;

async function loadFunding(){
  const el=document.getElementById('funding-content');
  if(!_silentRefresh) el.innerHTML=loading();
  try{
    const days = _fundingDays;
    const allFunding = parseFunding(await getUserFunding(currentWallet, Math.max(days, 90)));
    const cutoff = Date.now() - days * 86400000;
    const funding = allFunding.filter(f => f.time >= cutoff);

    const totalUsdc = funding.reduce((a,f)=>a+f.usdc,0);
    const byCoin = {};
    for(const f of funding){const c=f.coin||'?'; byCoin[c]=(byCoin[c]||0)+f.usdc;}
    const coinRows = Object.entries(byCoin).sort((a,b)=>a[1]-b[1]);
    const byDay = {};
    for(const f of funding){
      const day = new Date(f.time).toISOString().slice(0,10);
      byDay[day]=(byDay[day]||0)+f.usdc;
    }
    const dayRows = Object.entries(byDay).sort((a,b)=>a[0].localeCompare(b[0]));
    const badCoins = coinRows.filter(([,u])=>u<-0.5).slice(0,5);
    const topEarner = [...coinRows].reverse().find(([,u])=>u>0.5);

    el.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-bottom:11px;border-bottom:1px solid var(--border);margin-bottom:14px">
        <div style="font-size:12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">
          <span class="muted">Net <strong class="${totalUsdc>=0?'pos':'neg'}">${totalUsdc>=0?'+':''}${fmt$(totalUsdc)}</strong></span>
          ${topEarner?`<span class="muted">Earning <strong class="pos">${topEarner[0]}</strong></span>`:''}
          ${badCoins[0]?`<span class="muted">Costing <strong class="neg">${badCoins[0][0]}</strong></span>`:''}
        </div>
        <div style="display:flex;gap:4px">
          ${[7,30,90].map(d=>{const on=_fundingDays===d; return `<button onclick="_fundingDays=${d};loadFunding()"
            style="padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid ${on?'var(--accent)':'var(--border)'};border-radius:var(--radius-sm);background:${on?'var(--accent)':'var(--surface2)'};color:${on?'#fff':'var(--text-muted)'}">${d}d</button>`;}).join('')}
        </div>
      </div>
      ${badCoins.length>0?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${badCoins.map(([c,u])=>`<span style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.25);border-radius:20px;padding:4px 10px;font-size:11px;display:inline-flex;align-items:center;gap:6px">
          <span style="font-weight:700;color:var(--accent)">${c}</span>
          <span class="neg mono">${fmt$(u)}</span>
          <span class="muted">paid</span>
        </span>`).join('')}
      </div>`:''}
      <div class="card" style="margin-bottom:14px">
        <div style="height:100px;position:relative"><canvas id="funding-chart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">By Coin</div>
        <div class="table-wrap"><table class="mobile-cards">
          <thead><tr><th>Coin</th><th>Net USDC</th><th>Avg Rate</th></tr></thead>
          <tbody>${coinRows.map(([c,u])=>{
            const cf=funding.filter(f=>(f.coin||'?')===c);
            const avgRate=cf.length?cf.reduce((a,f)=>a+f.funding_rate,0)/cf.length:0;
            return `<tr>
              <td data-label="Coin" class="accent" style="font-weight:600">${c}</td>
              <td data-label="Net USDC" class="${u>=0?'pos':'neg'} mono">${u>=0?'+':''}${fmt$(u)}</td>
              <td data-label="Avg Rate" class="${avgRate>=0?'pos':'neg'} mono">${avgRate>=0?'+':''}${(avgRate*100).toFixed(3)}%</td>
            </tr>`;}).join('')}
          </tbody>
        </table></div>
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
        <div class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Recent Payments</div>
        <div class="table-wrap"><table class="mobile-cards">
          <thead><tr><th>Time</th><th>Coin</th><th>Rate</th><th>USDC</th></tr></thead>
          <tbody>${funding.slice(0,30).map(f=>`<tr>
            <td data-label="Time" class="muted">${fmtTime(f.time)}</td>
            <td data-label="Coin" class="accent">${f.coin||'?'}</td>
            <td data-label="Rate" class="${f.funding_rate>=0?'pos':'neg'} mono">${f.funding_rate>=0?'+':''}${(f.funding_rate*100).toFixed(3)}%</td>
            <td data-label="USDC" class="${f.usdc>=0?'pos':'neg'} mono">${f.usdc>=0?'+':''}${f.usdc.toFixed(3)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;

    setTimeout(()=>{
      const ctx = document.getElementById('funding-chart');
      if (!ctx) return;
      if (ctx._chart) ctx._chart.destroy();
      ctx._chart = new Chart(ctx, {
        type:'bar',
        data:{
          labels: dayRows.map(([d])=>d.slice(5)),
          datasets:[{
            data: dayRows.map(([,v])=>v),
            backgroundColor: dayRows.map(([,v])=>v>=0?'rgba(74,222,128,0.45)':'rgba(248,113,113,0.45)'),
            borderColor: dayRows.map(([,v])=>v>=0?'rgba(74,222,128,0.8)':'rgba(248,113,113,0.8)'),
            borderWidth:1, borderRadius:3,
          }]
        },
        options:{
          animation:false, responsive:true, maintainAspectRatio:false,
          plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt$(c.raw)}}},
          scales:{
            x:{ticks:{color:'var(--text-muted)',font:{size:9}},grid:{display:false}},
            y:{ticks:{color:'var(--text-muted)',font:{size:9},callback:v=>fmt$(v)},grid:{color:'var(--border)'}},
          },
        },
      });
    },50);
    setRefreshTime();
  }catch(e){if(!_silentRefresh)el.innerHTML=err(e);}
}

// ── My Flows ──────────────────────────────────────────────────────────────────
const _idrRateCache = {};

async function _fetchHistoricalIdrRates(dates) {
  const fallback = usdToIdr || 16000;
  const needed = [...new Set(dates)].filter(d => !_idrRateCache[d]);
  await Promise.all(needed.map(async date => {
    try {
      const r = await fetch(`https://api.frankfurter.app/${date}?from=USD&to=IDR`);
      const d = await r.json();
      _idrRateCache[date] = d.rates?.IDR || fallback;
    } catch { _idrRateCache[date] = fallback; }
  }));
}

async function loadFlows(){
  const el=document.getElementById('flows-content');
  if(!_silentRefresh) el.innerHTML=loading();
  try{
    const flows=parseLedger(await getLedgerUpdates(currentWallet,90));

    const dates = flows.map(f => new Date(f.time).toISOString().slice(0,10));
    await _fetchHistoricalIdrRates(dates);

    const getRate = date => _idrRateCache[date] || usdToIdr || 16000;
    const fmtIdr = (usd, rate) => {
      const v = usd * rate;
      const absV = Math.abs(v);
      const sign = usd >= 0 ? '+' : '−';
      if (absV >= 1e9) return sign + 'Rp ' + (absV/1e9).toFixed(1) + 'M';
      if (absV >= 1e6) return sign + 'Rp ' + (absV/1e6).toFixed(1) + 'jt';
      if (absV >= 1e3) return sign + 'Rp ' + (absV/1e3).toFixed(0) + 'rb';
      return sign + 'Rp ' + absV.toFixed(0);
    };
    const flowLabel = type => {
      const t = (type||'').toLowerCase();
      if (t.includes('deposit'))  return '⬇ Deposit';
      if (t.includes('withdraw')) return '⬆ Withdraw';
      if (t.includes('transfer')) return '⇄ Transfer';
      if (t.includes('liquidat')) return '⚡ Liquidation';
      return type || '—';
    };

    const totalIn=flows.filter(f=>f.usdc>0).reduce((a,f)=>a+f.usdc,0);
    const totalOut=flows.filter(f=>f.usdc<0).reduce((a,f)=>a+f.usdc,0);
    const net=totalIn+totalOut;
    let totalInIdr=0, totalOutIdr=0;
    for(const f of flows){
      const r=getRate(new Date(f.time).toISOString().slice(0,10));
      if(f.usdc>0) totalInIdr+=f.usdc*r; else totalOutIdr+=f.usdc*r;
    }

    const sorted = [...flows].sort((a,b)=>a.time-b.time);
    let running = 0;
    const withBal = sorted.map(f => { running+=f.usdc; return {...f, balance:running}; }).reverse();

    el.innerHTML=`
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;font-size:12px;padding-bottom:11px;border-bottom:1px solid var(--border);margin-bottom:14px">
        <span class="muted">In <strong class="pos">+${fmt$(totalIn)}</strong> <span style="font-size:10px;color:var(--text-muted)">(${fmtIdr(totalIn,totalInIdr/Math.max(totalIn,0.001))})</span></span>
        <span class="muted">Out <strong class="neg">−${fmt$(Math.abs(totalOut))}</strong> <span style="font-size:10px;color:var(--text-muted)">(${fmtIdr(totalOut,Math.abs(totalOutIdr)/Math.max(Math.abs(totalOut),0.001))})</span></span>
        <span class="muted">Net <strong class="${net>=0?'pos':'neg'}">${net>=0?'+':''}${fmt$(net)}</strong></span>
      </div>
      ${flows.length===0?'<div class="empty-state">No deposit/withdrawal activity in 90 days</div>':`
      <div class="card" style="margin-bottom:14px">
        <div class="table-wrap"><table class="mobile-cards">
          <thead><tr><th>Time</th><th>Type</th><th>USDC</th><th>IDR at time</th><th>Balance</th></tr></thead>
          <tbody>${withBal.map(f=>{
            const date=new Date(f.time).toISOString().slice(0,10);
            const txRate=getRate(date);
            return `<tr>
              <td data-label="Time" class="muted">${fmtTime(f.time)}</td>
              <td data-label="Type" style="font-size:12px">${flowLabel(f.type)}</td>
              <td data-label="USDC" class="${f.usdc>=0?'pos':'neg'} mono" style="font-weight:600">${f.usdc>=0?'+':'−'}${fmt$(Math.abs(f.usdc))}</td>
              <td data-label="IDR" class="${f.usdc>=0?'pos':'neg'} mono">${fmtIdr(f.usdc,txRate)}<br><span class="muted" style="font-size:9px">@${Math.round(txRate).toLocaleString('id-ID')}</span></td>
              <td data-label="Balance" class="mono muted">${fmt$(f.balance)}</td>
            </tr>`;}).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <div style="height:90px;position:relative"><canvas id="flows-chart"></canvas></div>
      </div>`}`;

    setTimeout(()=>{
      const ctx = document.getElementById('flows-chart');
      if (!ctx || flows.length===0) return;
      if (ctx._chart) ctx._chart.destroy();
      let cum=0;
      const pts = sorted.map(f=>{cum+=f.usdc;return cum;});
      ctx._chart = new Chart(ctx, {
        type:'line',
        data:{
          labels: sorted.map(f=>fmtTime(f.time)),
          datasets:[{
            data: pts,
            borderColor:'rgba(124,106,255,0.85)',
            backgroundColor:'rgba(124,106,255,0.1)',
            fill:true, tension:0.3,
            pointRadius: pts.length<25?3:0,
            borderWidth:2,
          }]
        },
        options:{
          animation:false, responsive:true, maintainAspectRatio:false,
          plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt$(c.raw)}}},
          scales:{
            x:{display:false},
            y:{ticks:{color:'var(--text-muted)',font:{size:9},callback:v=>fmt$(v)},grid:{color:'var(--border)'}},
          },
        },
      });
    },50);
    setRefreshTime();
  }catch(e){if(!_silentRefresh)el.innerHTML=err(e);}
}


// ── Global Markets / Money Flows ──────────────────────────────────────────────
async function loadMarkets(){
  const el=document.getElementById('markets-content');
  if(!_silentRefresh) el.innerHTML=loading();
  try{
    const raw=await getMetaAndAssetCtxs();
    allMarketData=parseMarketData(raw);
    renderMarkets();
    setRefreshTime();
  }catch(e){if(!_silentRefresh)el.innerHTML=err(e);}
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

  const indRow=(()=>{const ind=window._indData;if(!ind)return'';const fg=ind.fear_greed,bmsb=ind.bmsb;const fgCls=fg?(fg.value<30?'neg':fg.value>70?'pos':'muted'):'muted';const bmsbCls=bmsb?(bmsb.signal==='BULL'?'pos':bmsb.signal==='BEAR'?'neg':'yellow'):'muted';return`<div class="ind-strip" style="margin-bottom:14px">${fg?`<div class="ind-chip"><span class="ind-label">F&G</span><span class="${fgCls} mono">${fg.value}</span><span class="ind-badge ind-${fg.zone.toLowerCase()}">${fg.classification}</span></div>`:''}${bmsb?`<div class="ind-chip"><span class="ind-label">BMSB</span><span class="${bmsbCls} mono">${bmsb.signal}</span><span class="ind-badge ind-${bmsb.signal.toLowerCase()}">${bmsb.signal}</span></div>`:''}${ind.pi_cycle?`<div class="ind-chip"><span class="ind-label">Pi Cycle</span><span class="mono">${ind.pi_cycle.proximity}%</span><span class="ind-badge ind-${ind.pi_cycle.signal.toLowerCase()}">${ind.pi_cycle.signal}</span></div>`:''}</div>`;})();
  el.innerHTML=`${indRow}
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
      <div class="table-wrap"><table class="mobile-cards">
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

function marketBias(fr, chgPct) {
  let score = 0;
  // Funding rate (primary signal — 8h rate from HL)
  if      (fr >  0.001)   score += 3;  // >0.1%/8h — very crowded long
  else if (fr >  0.0003)  score += 2;  // >0.03%/8h — elevated long
  else if (fr >  0.00005) score += 1;  // >0.005%/8h — mild long
  else if (fr < -0.001)   score -= 3;
  else if (fr < -0.0003)  score -= 2;
  else if (fr < -0.00005) score -= 1;
  // Price momentum (secondary)
  if      (chgPct >  5)  score += 2;
  else if (chgPct >  2)  score += 1;
  else if (chgPct < -5)  score -= 2;
  else if (chgPct < -2)  score -= 1;
  if (score >=  4) return '🔥 Strong Bull';
  if (score >=  2) return '🟢 Bullish';
  if (score >=  1) return '🔵 Mild Bull';
  if (score <= -4) return '🔥 Strong Bear';
  if (score <= -2) return '🔴 Bearish';
  if (score <= -1) return '🟡 Mild Bear';
  return '⚪ Neutral';
}

function marketRow(d,rank){
  const chg=d.change_pct;
  const fr=d.funding;
  const frClass=Math.abs(fr)<0.001?'funding-neu':fr>=0?'funding-pos':'funding-neg';
  const bias=marketBias(fr, chg);
  return `<tr class="mkt-row-click" onclick="openMarketDetail('${d.coin}')">
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

// ── Market Detail Modal ───────────────────────────────────────────────────────
function closeMktDetail() {
  document.getElementById('mkt-detail-overlay').classList.remove('open');
}

async function openMarketDetail(coin) {
  const overlay = document.getElementById('mkt-detail-overlay');
  const inner   = document.getElementById('mkt-detail-inner');
  const d = allMarketData.find(x => x.coin === coin);
  if (!d) return;

  const chgCls = d.change_pct >= 0 ? 'pos' : 'neg';
  const chgStr = (d.change_pct >= 0 ? '+' : '') + d.change_pct.toFixed(2) + '%';

  inner.innerHTML = `
    <div class="mkt-modal-head">
      <div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:4px">
        <span class="mkt-modal-coin">${coin}</span>
        <span class="mkt-modal-price">${fmtPrice(d.price)}</span>
        <span class="mkt-modal-chg ${chgCls}">${chgStr}</span>
      </div>
      <button class="mkt-close" onclick="closeMktDetail()">✕</button>
    </div>
    <div class="mkt-modal-body" style="text-align:center;padding:40px 20px">${spinnerHtml()} Analyzing ${coin}…</div>`;
  overlay.classList.add('open');

  const [candlesRes, lsrRes, oiRes] = await Promise.allSettled([
    getCandles(coin, '1h', 7),
    typeof fetchBinanceLSR === 'function' ? fetchBinanceLSR(coin) : Promise.resolve(null),
    typeof fetchBinanceOI  === 'function' ? fetchBinanceOI(coin, '1h', 48) : Promise.resolve(null),
  ]);

  const candles = candlesRes.status === 'fulfilled' ? candlesRes.value : null;
  const lsr     = lsrRes.status    === 'fulfilled' ? lsrRes.value    : null;
  const oiHist  = oiRes.status     === 'fulfilled' ? oiRes.value     : null;

  inner.innerHTML = `
    <div class="mkt-modal-head">
      <div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:4px">
        <span class="mkt-modal-coin">${coin}</span>
        <span class="mkt-modal-price">${fmtPrice(d.price)}</span>
        <span class="mkt-modal-chg ${chgCls}">${chgStr}</span>
        <span style="margin-left:6px;font-size:12px">${marketBias(d.funding, d.change_pct)}</span>
      </div>
      <button class="mkt-close" onclick="closeMktDetail()">✕</button>
    </div>
    <div class="mkt-modal-body">
      ${_mktStats(d)}
      ${_mktPhase(candles)}
      ${_mktTA(candles, d)}
      ${_mktLSR(lsr)}
      ${_mktOI(oiHist, d)}
    </div>`;
}

function _mktStats(d) {
  const apr = (d.funding * 3 * 365 * 100).toFixed(1);
  const frSign = d.funding >= 0 ? '+' : '';
  return `<div class="mkt-stats-grid">
    <div class="mkt-stat"><div class="mkt-stat-label">OI (USD)</div><div class="mkt-stat-val">${fmtB(d.oi_usd)}</div></div>
    <div class="mkt-stat"><div class="mkt-stat-label">24h Volume</div><div class="mkt-stat-val">${fmtB(d.volume)}</div></div>
    <div class="mkt-stat"><div class="mkt-stat-label">Funding /8h</div><div class="mkt-stat-val ${d.funding>=0?'pos':'neg'}">${frSign}${(d.funding*100).toFixed(4)}%</div></div>
    <div class="mkt-stat"><div class="mkt-stat-label">Funding APR</div><div class="mkt-stat-val ${d.funding>=0?'pos':'neg'}">${frSign}${apr}%</div></div>
    <div class="mkt-stat"><div class="mkt-stat-label">Mark Price</div><div class="mkt-stat-val">${fmtPrice(d.price)}</div></div>
    <div class="mkt-stat"><div class="mkt-stat-label">Prev Close</div><div class="mkt-stat-val muted">${fmtPrice(d.prev_price)}</div></div>
  </div>`;
}

function _mktPhase(candles) {
  if (!candles || candles.length < 20) return `<div class="mkt-section">
    <div class="mkt-section-title">Phase Analysis (Wyckoff)</div>
    <div class="mkt-phase-box"><span class="muted" style="font-size:12px">Not enough candle data</span></div>
  </div>`;

  const p = detectPhase(candles);
  const confPct = Math.round(p.confidence * 100);
  const phaseColors = {ACCUMULATION:'#50d2c1',MARKUP:'#4ade80',DISTRIBUTION:'#facc15',MARKDOWN:'#f87171',NEUTRAL:'#666'};
  const col = phaseColors[p.phase] || '#666';
  return `<div class="mkt-section">
    <div class="mkt-section-title">Phase Analysis (Wyckoff · 1h · 7d)</div>
    <div class="mkt-phase-box">
      <div class="mkt-phase-row">
        <span class="phase-badge phase-${p.phase}" style="font-size:12px;padding:3px 10px">${p.phase}</span>
        <span class="muted" style="font-size:11px">Confidence: <span class="mono" style="color:${col}">${confPct}%</span></span>
      </div>
      <div class="mkt-conf-bar"><div class="mkt-conf-fill" style="width:${confPct}%;background:${col}"></div></div>
      <div class="mkt-signals-list">${p.signals.slice(0,6).map(s=>`<div class="mkt-signal-item">${s}</div>`).join('')}</div>
    </div>
  </div>`;
}

function _mktTA(candles, d) {
  if (!candles || candles.length < 20) return `<div class="mkt-section">
    <div class="mkt-section-title">Technical Analysis</div>
    <div class="muted" style="font-size:12px">Not enough candle data</div>
  </div>`;

  const closes  = candles.map(c => parseFloat(c.c));
  const highs   = candles.map(c => parseFloat(c.h));
  const lows    = candles.map(c => parseFloat(c.l));
  const ema20   = iEMA(closes, 20);
  const ema50   = closes.length >= 50 ? iEMA(closes, 50) : null;
  const ema200  = closes.length >= 200 ? iEMA(closes, 200) : null;
  const {macd, hist} = iMACD(closes);
  const rsiArr  = iRSI(closes);
  const bbArr   = iBB(closes);
  const stoch   = iStoch(highs, lows, closes);
  const atrArr  = iATR(highs, lows, closes);

  const price   = closes.at(-1);
  const e20     = ema20.at(-1);
  const e50     = ema50 ? ema50.at(-1) : null;
  const e200    = ema200 ? ema200.at(-1) : null;
  const rsiVal  = rsiArr.filter(v => v !== null).at(-1) || 50;
  const bbLast  = bbArr.filter(v => v !== null).at(-1);
  const stochK  = stoch.k.filter(v => v !== null).at(-1) || 50;
  const stochD  = stoch.d.filter(v => v !== null).at(-1) || 50;
  const atrLast = atrArr.filter(v => v !== null).at(-1) || 0;

  const rows = [
    ['EMA',     sigEMA(price, e20, e50, e200)],
    ['RSI',     sigRSI(rsiVal)],
    ['MACD',    sigMACD(hist, macd)],
    ...(bbLast ? [['BB',  sigBB(bbLast)]] : []),
    ['Stoch',   sigStoch(stochK, stochD)],
    ['ATR',     sigATR(atrLast, price)],
    ['Funding', sigFunding(d.funding)],
  ];

  return `<div class="mkt-section">
    <div class="mkt-section-title">Technical Signals (1h · 7d)</div>
    <div style="background:var(--surface2);border-radius:var(--radius);padding:6px 12px">
      ${rows.map(([name, s]) => `<div class="mkt-sig-row ta-${s.cls}">
        <span class="mkt-sig-name">${name}</span>
        <span class="ta-sig-badge">${s.label}</span>
        <span class="mkt-sig-sub">${s.sub}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function _mktLSR(lsr) {
  if (!lsr) return `<div class="mkt-section">
    <div class="mkt-section-title">Long / Short Ratio (Binance)</div>
    <div class="muted" style="font-size:12px">Not available for this coin</div>
  </div>`;

  const longPct  = lsr.longPct.toFixed(1);
  const shortPct = lsr.shortPct.toFixed(1);
  const bias     = lsr.longPct > 55 ? '🟢 Long dominant' : lsr.longPct < 45 ? '🔴 Short dominant' : '⚪ Balanced';
  return `<div class="mkt-section">
    <div class="mkt-section-title">Long / Short Ratio (Binance Global Accounts)</div>
    <div style="background:var(--surface2);border-radius:var(--radius);padding:10px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13px">${bias}</span>
        <span class="mono" style="font-size:11px;color:var(--text-faint)">Ratio ${lsr.ratio.toFixed(2)}</span>
      </div>
      <div class="mkt-lsr-bar">
        <div class="mkt-lsr-long" style="width:${lsr.longPct}%"></div>
        <div class="mkt-lsr-short" style="width:${lsr.shortPct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:11px">
        <span class="pos mono">Longs ${longPct}%</span>
        <span class="neg mono">Shorts ${shortPct}%</span>
      </div>
    </div>
  </div>`;
}

function _mktOI(oiHist, d) {
  if (!oiHist || !oiHist.length) return `<div class="mkt-section">
    <div class="mkt-section-title">Open Interest History (Binance)</div>
    <div class="muted" style="font-size:12px">Not available for this coin</div>
  </div>`;

  const vals    = oiHist.map(x => x.oi);
  const first   = vals[0], last = vals.at(-1);
  const oiChg   = first > 0 ? ((last - first) / first * 100) : 0;
  const oiChgCls= oiChg >= 0 ? 'pos' : 'neg';
  const stroke  = oiChg >= 0 ? 'var(--green)' : 'var(--red)';
  const fill    = oiChg >= 0 ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)';
  const spark   = typeof _svgSparkline === 'function'
    ? _svgSparkline(vals, stroke, fill, 600, 50)
    : '';

  return `<div class="mkt-section">
    <div class="mkt-section-title">Open Interest History — last 48h (Binance · 1h)</div>
    <div class="mkt-oi-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span class="muted" style="font-size:11px">OI now: <span class="mono">${fmtB(last)}</span></span>
        <span class="mono ${oiChgCls}" style="font-size:12px">${oiChg >= 0 ? '+' : ''}${oiChg.toFixed(1)}% over 48h</span>
      </div>
      ${spark}
    </div>
  </div>`;
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
  if(!_silentRefresh) el.innerHTML=loading();
  try{
    const state=await getClearinghouseState(currentWallet);
    const positions=parsePositions(state);
    const posCoinSet=new Set(positions.map(p=>p.coin));
    // Always show PHASE_COINS; append any open-position coins not in that list
    const allCoins=[...PHASE_COINS,...positions.map(p=>p.coin).filter(c=>!PHASE_COINS.includes(c))];
    // 1h: 14d (336 candles) is enough for Wyckoff + CVD; reduces payload vs old 30d/720 candles
    const days={'1h':14,'4h':30,'1d':90}[phaseInterval]||14;

    el.innerHTML=`
      <div class="section-header">
        <div class="section-title">Phase Detector</div>
        <div class="tabs">${['1h','4h','1d'].map(iv=>`<button class="tab ${phaseInterval===iv?'active':''}" onclick="loadPhases('${iv}')">${iv}</button>`).join('')}</div>
      </div>
      <div id="money-flow-wrap" style="margin-bottom:14px">${typeof renderMoneyFlowCard === 'function' ? renderMoneyFlowCard() : ''}</div>
      <div id="hype-intel-wrap" style="margin-bottom:14px">${typeof renderHYPECard === 'function' ? renderHYPECard() : ''}</div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-title" style="margin-bottom:10px">🔄 CVD + OI Market Scanner</div>
        <div id="cvd-oi-table"><div class="loading">${spinnerHtml()} Scanning ${allCoins.join(', ')}…</div></div>
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

    // Render placeholder cards immediately so the user sees coins appearing as data arrives
    const pcards=document.getElementById('phase-cards');
    if(pcards) pcards.innerHTML=allCoins.map(coin=>`
      <div id="pc-${coin}" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px;opacity:0.5">
        <div style="font-weight:700;color:var(--accent);margin-bottom:4px">${coin}</div>
        <div class="muted" style="font-size:11px">fetching…</div>
      </div>`).join('');

    const phases=new Array(allCoins.length);
    const [results, phaseMeta] = await Promise.all([
      Promise.allSettled(allCoins.map(async (coin,i)=>{
        const candles=await getCandles(coin,phaseInterval,days);
        const result={coin,hasPosition:posCoinSet.has(coin),candles,...detectPhase(candles)};
        phases[i]=result;
        // Update this coin's card as soon as its data is ready
        const cardEl=document.getElementById(`pc-${coin}`);
        if(cardEl) cardEl.outerHTML=phaseCard(result);
        return result;
      })),
      getMetaAndAssetCtxs().catch(()=>null),
    ]);
    // Fill any slots that errored
    results.forEach((r,i)=>{ if(!phases[i]) phases[i]=r.status==='fulfilled'?r.value:{coin:allCoins[i],hasPosition:posCoinSet.has(allCoins[i]),phase:'NEUTRAL',confidence:0,signals:['fetch failed']}; });

    // CVD+OI scanner
    const cvdEl=document.getElementById('cvd-oi-table');
    if(cvdEl && phaseMeta && typeof calcCVD==='function'){
      const universe=phaseMeta[0]?.universe||[], ctxs=phaseMeta[1]||[];
      const cvdRows=phases.map(ph=>{
        if(!ph.candles||!ph.candles.length) return null;
        const idx=universe.findIndex(a=>a.name===ph.coin);
        const rawCtx=idx>=0?ctxs[idx]:null;
        const markPx=rawCtx?parseFloat(rawCtx.markPx||rawCtx.midPx||0):0;
        const currentOI=rawCtx?parseFloat(rawCtx.openInterest||0)*markPx:0;
        const opens=ph.candles.map(c=>parseFloat(c.o));
        const closes=ph.candles.map(c=>parseFloat(c.c));
        const highs=ph.candles.map(c=>parseFloat(c.h));
        const lows=ph.candles.map(c=>parseFloat(c.l));
        const vols=ph.candles.map(c=>parseFloat(c.v));
        const cvdArr=calcCVD(opens,closes,highs,lows,vols);
        const lb=4;
        const recentCVD=cvdArr.at(-1)-(cvdArr.length>lb?cvdArr[cvdArr.length-1-lb]:0);
        const priceChg=closes.length>lb?(closes.at(-1)-closes[closes.length-1-lb])/closes[closes.length-1-lb]*100:0;
        // getPrevOI must be called BEFORE saveOIPoint to get a true "previous" value
        const prevOI=getPrevOI(ph.coin);
        if(currentOI>0) saveOIPoint(ph.coin,currentOI);
        const oiChgPct=(prevOI&&prevOI>0&&currentOI>0)?(currentOI-prevOI)/prevOI*100:null;
        const sig=sigCVDOI(priceChg,recentCVD,oiChgPct);
        return{coin:ph.coin,hasPosition:ph.hasPosition,price:closes.at(-1),priceChg,
               cvdUp:recentCVD>0,cvdArr,closes,currentOI,oiChgPct,sig,
               oiHistory:typeof _oiHistGet==='function'?(_oiHistGet()[ph.coin]||[]):[]};
      }).filter(Boolean);

      // Fetch Binance OI history in parallel and replace localStorage fallback when available
      if(typeof fetchBinanceOI==='function'){
        const oiTf = phaseInterval==='1d'?'1d':phaseInterval==='4h'?'4h':'1h';
        const oiLimit = phaseInterval==='1d'?90:phaseInterval==='4h'?60:60;
        const oiResults=await Promise.allSettled(cvdRows.map(r=>fetchBinanceOI(r.coin,oiTf,oiLimit)));
        oiResults.forEach((res,i)=>{
          if(res.status==='fulfilled'&&res.value?.length) cvdRows[i].oiHistory=res.value;
        });
      }

      // SVG sparklines render instantly — no Chart.js init cost
      cvdEl.innerHTML = renderCVDOITable(cvdRows) +
        (typeof renderCVDOICharts === 'function' ? renderCVDOICharts(cvdRows) : '');
      if(typeof loadMoneyFlowSignals==='function') loadMoneyFlowSignals(allCoins);
      if(typeof loadHYPEIntel==='function') loadHYPEIntel(phaseMeta);
    }

    setRefreshTime();
  }catch(e){if(!_silentRefresh)el.innerHTML=err(e);}
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
    checkPnLMilestone(key, pos.coin, pos.side, pnl);
  }
}

function checkPnLMilestone(key, coin, side, pnl) {
  if (!pnlThreshold || pnlThreshold <= 0) return;
  const prev = livePnLSnapshot[key];
  livePnLSnapshot[key] = pnl;
  if (prev === undefined) return;
  const prevBucket = Math.floor(prev / pnlThreshold);
  const nowBucket = Math.floor(pnl / pnlThreshold);
  if (nowBucket === prevBucket) return;
  const emoji = pnl >= 0 ? '🟢' : '🔴';
  sendTelegram(`${emoji} <b>P&L Milestone — ${coin} ${side.toUpperCase()}</b>\nP&L crossed ${fmt$(nowBucket * pnlThreshold)}\nCurrent: ${fmt$(pnl)} @ ${fmtPrice(livePrices[coin])}`);
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
      const dir = a.above ? '▲ crossed above' : '▼ dropped below';
      logAlert(a.coin, dir, a.target, price);
      sendTelegram(`🔔 <b>Price Alert — ${a.coin}</b>\n${dir} ${fmtPrice(a.target)}\nNow: ${fmtPrice(price)}`);
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
      <div class="table-wrap"><table class="mobile-cards">
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
      <div class="card-title">⚡ API Proxy (Cloudflare Worker)</div>
      <div class="muted" style="font-size:11px;margin-bottom:12px">Optional: paste your Cloudflare Worker URL for edge-cached API calls (faster in Indonesia). Leave blank to use Hyperliquid directly.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input class="input" id="proxy-url-input" placeholder="https://your-worker.your-user.workers.dev" value="${localStorage.getItem('hype_proxy_url')||''}" style="flex:1;font-family:var(--mono);font-size:11px">
        <button class="btn btn-primary btn-sm" onclick="saveProxyUrl()">Save</button>
        <button class="btn btn-ghost btn-sm" onclick="clearProxyUrl()">Clear</button>
      </div>
      <div id="proxy-status" style="font-size:11px;color:var(--text-muted);margin-top:6px">${localStorage.getItem('hype_proxy_url') ? '✓ Proxy active — reload page to apply' : 'Using direct Hyperliquid API'}</div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">🦎 CoinGecko Demo API Key</div>
      <div class="muted" style="font-size:11px;margin-bottom:12px">Free tier: get your key at <span style="color:var(--accent)">coingecko.com/en/api</span> → "Get Free API Key". Without a key the public endpoint is rate-limited and Fundamentals/Intel tabs may show empty data.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input class="input" id="cg-key-input" type="password" placeholder="CG-xxxxxxxxxxxxxxxxxxxx" value="${localStorage.getItem('hype_cg_key')||''}" style="flex:1;font-family:var(--mono);font-size:11px">
        <button class="btn btn-primary btn-sm" onclick="saveCGKey()">Save</button>
        <button class="btn btn-ghost btn-sm" onclick="clearCGKey()">Clear</button>
      </div>
      <div id="cg-key-status" style="font-size:11px;color:var(--text-muted);margin-top:6px">${localStorage.getItem('hype_cg_key') ? '✓ CoinGecko key active — 30 req/min, 10k/month' : 'No key — using unauthenticated public endpoint (may rate-limit)'}</div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">🔮 APIU Macro Proxy (Cloudflare Worker)</div>
      <div class="muted" style="font-size:11px;margin-bottom:12px">Optional: deploy <code>cloudflare/apiu-worker.js</code> to surface apiu.ai's BTC daily verdict + regime state as a second-opinion card in the Intel tab. The APIU key stays server-side as a Worker secret — paste only the worker URL here.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input class="input" id="apiu-proxy-url-input" placeholder="https://hype-apiu-proxy.your-user.workers.dev" value="${localStorage.getItem('hype_apiu_proxy_url')||''}" style="flex:1;font-family:var(--mono);font-size:11px">
        <button class="btn btn-primary btn-sm" onclick="saveApiuProxyUrl()">Save</button>
        <button class="btn btn-ghost btn-sm" onclick="clearApiuProxyUrl()">Clear</button>
      </div>
      <div id="apiu-proxy-status" style="font-size:11px;color:var(--text-muted);margin-top:6px">${localStorage.getItem('hype_apiu_proxy_url') ? '✓ APIU proxy active — card appears in Intel tab' : 'Not configured — no card shown in Intel tab'}</div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">📲 Telegram Notifications</div>
      <div class="muted" style="font-size:11px;margin-bottom:12px">Token stored in your browser only — never committed to code or sent anywhere except Telegram.</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div class="stat-label" style="margin-bottom:4px">Bot Token</div>
          <input class="input" id="tg-token-input" type="password" placeholder="Paste your bot token" value="${tgToken}" style="width:100%;font-family:var(--mono);font-size:11px">
        </div>
        <div>
          <div class="stat-label" style="margin-bottom:4px">Your Chat ID</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <input class="input" id="tg-chat-input" placeholder="e.g. 123456789" value="${tgChatId}" style="flex:1;min-width:120px;font-family:var(--mono)">
            <button class="btn btn-ghost btn-sm" onclick="getTGChatId()" style="white-space:nowrap">Auto-detect</button>
          </div>
          <div class="muted" style="font-size:10px;margin-top:4px">Send any message to your bot first, then click Auto-detect.</div>
        </div>
        <div>
          <div class="stat-label" style="margin-bottom:4px">P&L Milestone — Alert every $</div>
          <input class="input" id="tg-pnl-thr" type="number" placeholder="e.g. 500" value="${pnlThreshold||''}" style="width:130px">
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="saveTGSettings()">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="testTelegram()">Send Test</button>
          <span id="tg-status" style="font-size:11px;color:var(--text-muted)">${tgToken&&tgChatId?'✓ Configured':'Not configured'}</span>
        </div>
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
      <div style="display:flex;gap:4px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        ${TA_COINS.map(c=>`<button class="tab ta-coin-tab${c===taCoin?' active':''}" data-coin="${c}" onclick="setTACoin('${c}')">${c}</button>`).join('')}
        <input id="ta-custom-coin" class="input" type="text" placeholder="custom…" style="width:80px;height:24px;font-size:11px;padding:2px 6px" onkeydown="if(event.key==='Enter'){const v=this.value.trim().toUpperCase();if(v){setTACoin(v);this.value='';}}" title="Type any coin and press Enter">
      </div>
      <div id="ta-content"><div class="loading">${spinnerHtml()} Loading…</div></div>
    </div>
  `;

  renderActiveAlerts();
  connectWS();
  refreshTA();
}

// ── Portfolio Chart ───────────────────────────────────────────────────────────
let chartMode = 'all'; // 'all' | 'perp' | 'spot'
let _chartData = {};   // cached per-mode data
let _chartDataTs = 0;

function savePortfolioSnap(key, v) {
  try {
    const sk = key === 'all' ? 'hype_snaps' : 'hype_snaps_' + key;
    const snaps = JSON.parse(localStorage.getItem(sk) || '[]');
    const now = Date.now();
    if (snaps.length && now - snaps.at(-1).ts < 30 * 60 * 1000) return;
    snaps.push({ ts: now, v });
    const cut = now - 8 * 86400000;
    localStorage.setItem(sk, JSON.stringify(snaps.filter(s => s.ts >= cut)));
  } catch(_) {}
}
function getPortfolioSnaps(key) {
  try {
    const sk = key === 'all' ? 'hype_snaps' : 'hype_snaps_' + key;
    return JSON.parse(localStorage.getItem(sk) || '[]');
  } catch { return []; }
}


async function fetchIDRRate() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=IDR');
    const d = await r.json();
    usdToIdr = d.rates?.IDR || 0;
    const el = document.getElementById('ch-rate');
    if (el && usdToIdr) el.textContent = `1 USD = Rp ${Math.round(usdToIdr).toLocaleString('id-ID')}`;
  } catch(_) {}
}

function buildPortfolioHistory(currentValue, fills, funding, snaps) {
  const msDay = 86400000;
  const now = Date.now();
  const today = Math.floor(now / msDay) * msDay;

  const dailyPnL = {};
  for (const f of (fills || [])) {
    const d = Math.floor(f.time / msDay) * msDay;
    dailyPnL[d] = (dailyPnL[d] || 0) + (f.closed_pnl || 0);
  }
  for (const f of (funding || [])) {
    const d = Math.floor(f.time / msDay) * msDay;
    dailyPnL[d] = (dailyPnL[d] || 0) + (f.usdc || 0);
  }

  let startV = currentValue;
  for (let i = 0; i < 7; i++) startV -= (dailyPnL[today - i * msDay] || 0);
  startV = Math.max(0, startV);

  const daily = [];
  let v = startV;
  for (let i = 7; i >= 0; i--) {
    const ts = today - i * msDay;
    daily.push({ ts, v });
    if (i > 0) v += (dailyPnL[ts] || 0);
  }
  daily[daily.length - 1].v = currentValue;

  const recentSnaps = (snaps || []).filter(s => s.ts >= today - 2 * msDay);
  if (recentSnaps.length >= 3) {
    const base = daily.filter(p => p.ts < today - 2 * msDay);
    return [...base, ...recentSnaps.map(s => ({ ts: s.ts, v: s.v }))];
  }
  return daily;
}

function fmtChartValue(v) {
  if (chartCurrency === 'IDR') {
    const idr = v * (usdToIdr || 16000);
    return 'Rp ' + Math.round(idr).toLocaleString('id-ID');
  }
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setChartCurrency(cur) {
  chartCurrency = cur;
  document.querySelectorAll('.ch-cur-tab').forEach(t => t.classList.toggle('active', t.dataset.cur === cur));
  if (portfolioChart) updateChartLabels();
}

function setChartMode(mode, btn) {
  chartMode = mode;
  document.querySelectorAll('.ch-mode-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const lbl = document.getElementById('ch-mode-label');
  if (lbl) lbl.textContent = mode === 'perp' ? 'Perp acct' : mode === 'spot' ? 'Spot total' : 'Portfolio';
  const d = _chartData[mode];
  if (!d?.pts?.length) return;
  _drawPortfolioChart(d.pts, d.current);
  updateChartLabels();
}

function updateChartLabels() {
  if (!portfolioChart) return;
  const rate = chartCurrency === 'IDR' ? (usdToIdr || 16000) : 1;
  const raw = portfolioChart._rawPts;
  portfolioChart.data.datasets[0].data = raw.map(p => +(p.v * rate).toFixed(2));
  portfolioChart.options.scales.y.ticks.callback = v =>
    chartCurrency === 'IDR' ? 'Rp ' + (v / 1e6).toFixed(1) + 'M' : '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(0));
  portfolioChart.update('none');
  const cur = portfolioChart._modeCurrentValue ?? raw.at(-1)?.v ?? 0;
  const start = raw[0]?.v || cur;
  const chg = cur - start, pct = start > 0 ? chg / start * 100 : 0;
  const $el = id => document.getElementById(id);
  if ($el('ch-cur')) $el('ch-cur').textContent = fmtChartValue(cur);
  if ($el('ch-chg')) { $el('ch-chg').textContent = (chg >= 0 ? '+' : '') + fmtChartValue(Math.abs(chg)); $el('ch-chg').className = chg >= 0 ? 'pos mono' : 'neg mono'; }
  if ($el('ch-pct')) { $el('ch-pct').textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'; $el('ch-pct').className = pct >= 0 ? 'pos mono' : 'neg mono'; }
}

function _drawPortfolioChart(pts, currentValue) {
  const ctx = document.getElementById('portfolio-chart');
  if (!ctx || !window.Chart || !pts?.length) return;
  if (portfolioChart) { portfolioChart.destroy(); portfolioChart = null; }

  const rate  = chartCurrency === 'IDR' ? (usdToIdr || 16000) : 1;
  const isUp  = pts.at(-1).v >= pts[0].v;
  const color = isUp ? '#22c55e' : '#ef4444';
  const bg    = isUp ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';
  const labels = pts.map(p => {
    const d = new Date(p.ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + (pts.length > 10 ? ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '');
  });
  const values = pts.map(p => +(p.v * rate).toFixed(2));

  portfolioChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data: values, borderColor: color, backgroundColor: bg, fill: true, tension: 0.35, pointRadius: pts.length <= 10 ? 3 : 0, pointHoverRadius: 5, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: c => fmtChartValue(c.raw / rate),
          title: items => labels[items[0].dataIndex]
        }}
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#666', maxRotation: 0, maxTicksLimit: 7, font: { size: 10 } } },
        y: { position: 'right', grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#666', font: { size: 10 }, callback: v => chartCurrency === 'IDR' ? 'Rp ' + (v/1e6).toFixed(1)+'M' : '$' + (v >= 1000 ? (v/1000).toFixed(1)+'K' : v.toFixed(0)) } }
      }
    }
  });
  portfolioChart._rawPts = pts;
  portfolioChart._modeCurrentValue = currentValue;
}

async function renderPortfolioChart(totalPortfolio) {
  const perpValue = _ovData?.s?.account_value ?? totalPortfolio;
  const spotValue = _ovData?.spotTotalValue   ?? 0;

  savePortfolioSnap('all',  totalPortfolio);
  savePortfolioSnap('perp', perpValue);
  savePortfolioSnap('spot', spotValue);
  fetchIDRRate();

  if (_chartData.all && !_silentRefresh && Date.now() - _chartDataTs < 60000) {
    const d = _chartData[chartMode];
    if (d?.pts?.length) { _drawPortfolioChart(d.pts, d.current); updateChartLabels(); }
    return;
  }

  let taggedFills = _ovData?.recentFills || [], funding = [];
  try {
    if (!taggedFills.length) {
      const rawFills = await getUserFills(currentWallet);
      const spotIndexMap = buildSpotIndexMap(_ovData?.spotMetaRaw);
      taggedFills = tagFills(parseFills(rawFills), spotIndexMap);
    }
    funding = await getUserFunding(currentWallet, 7).then(parseFunding).catch(() => []);
  } catch(_) {}

  const perpFills = taggedFills.filter(f => !f.isSpot);
  const spotFills = taggedFills.filter(f =>  f.isSpot);

  _chartData = {
    all:  { pts: buildPortfolioHistory(totalPortfolio, taggedFills, funding,  getPortfolioSnaps('all')),  current: totalPortfolio },
    perp: { pts: buildPortfolioHistory(perpValue,      perpFills,   funding,  getPortfolioSnaps('perp')), current: perpValue },
    spot: { pts: buildPortfolioHistory(spotValue,      spotFills,   [],       getPortfolioSnaps('spot')), current: spotValue },
  };
  _chartDataTs = Date.now();

  const d = _chartData[chartMode];
  if (!d?.pts?.length) return;
  _drawPortfolioChart(d.pts, d.current);
  updateChartLabels();
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!tgToken || !tgChatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgChatId, text, parse_mode: 'HTML' })
    });
    return r.ok;
  } catch(_) { return false; }
}

async function getTGChatId() {
  const tokenEl = document.getElementById('tg-token-input');
  const tok = tokenEl ? tokenEl.value.trim() : tgToken;
  if (!tok) { tgSetStatus('Enter your bot token first', false); return; }
  tgSetStatus('Fetching…', null);
  try {
    const r = await fetch(`https://api.telegram.org/bot${tok}/getUpdates`);
    const data = await r.json();
    if (!data.ok) { tgSetStatus('Invalid token', false); return; }
    const updates = data.result || [];
    if (!updates.length) { tgSetStatus('No messages found — send your bot any message first, then retry', null); return; }
    const last = updates[updates.length - 1];
    const chat = (last.message || last.edited_message || last.channel_post || {}).chat;
    if (!chat) { tgSetStatus('Could not read chat — try sending /start to your bot', null); return; }
    tgChatId = String(chat.id);
    localStorage.setItem('hype_tg_chat', tgChatId);
    const chatEl = document.getElementById('tg-chat-input');
    if (chatEl) chatEl.value = tgChatId;
    tgSetStatus(`✓ Chat ID detected: ${tgChatId} (${chat.first_name || chat.username || 'you'})`, true);
  } catch(e) { tgSetStatus('Error: ' + e.message, false); }
}

function saveProxyUrl() {
  const url = (document.getElementById('proxy-url-input')?.value || '').trim();
  if (url) {
    localStorage.setItem('hype_proxy_url', url);
    document.getElementById('proxy-status').textContent = '✓ Proxy saved — reload page to apply';
  } else {
    clearProxyUrl();
  }
}

function clearProxyUrl() {
  localStorage.removeItem('hype_proxy_url');
  if (document.getElementById('proxy-url-input')) document.getElementById('proxy-url-input').value = '';
  document.getElementById('proxy-status').textContent = 'Cleared — using direct Hyperliquid API (reload to apply)';
}

function saveApiuProxyUrl() {
  const url = (document.getElementById('apiu-proxy-url-input')?.value || '').trim();
  if (url) {
    localStorage.setItem('hype_apiu_proxy_url', url);
    if (typeof _apiuData !== 'undefined') _apiuData = null; // force refetch on next Intel load
    document.getElementById('apiu-proxy-status').textContent = '✓ APIU proxy saved — card appears in Intel tab';
  } else {
    clearApiuProxyUrl();
  }
}

function clearApiuProxyUrl() {
  localStorage.removeItem('hype_apiu_proxy_url');
  if (typeof _apiuData !== 'undefined') _apiuData = null;
  if (document.getElementById('apiu-proxy-url-input')) document.getElementById('apiu-proxy-url-input').value = '';
  document.getElementById('apiu-proxy-status').textContent = 'Cleared — no card shown in Intel tab';
}

function saveCGKey() {
  const key = (document.getElementById('cg-key-input')?.value || '').trim();
  if (key) {
    _cgDemoKey = key;
    localStorage.setItem('hype_cg_key', key);
    _cgShared.global = null; _cgShared.markets = null; // bust cache so next fetch uses the key
    document.getElementById('cg-key-status').textContent = '✓ Key saved — CoinGecko will use demo tier (30 req/min)';
  } else {
    clearCGKey();
  }
}
function clearCGKey() {
  _cgDemoKey = '';
  localStorage.removeItem('hype_cg_key');
  if (document.getElementById('cg-key-input')) document.getElementById('cg-key-input').value = '';
  document.getElementById('cg-key-status').textContent = 'Cleared — using unauthenticated public endpoint';
}

function saveTGSettings() {
  const tok = (document.getElementById('tg-token-input')?.value || '').trim();
  const chat = (document.getElementById('tg-chat-input')?.value || '').trim();
  const thr = parseFloat(document.getElementById('tg-pnl-thr')?.value || '0');
  tgToken = tok; tgChatId = chat; pnlThreshold = thr;
  localStorage.setItem('hype_tg_token', tok);
  localStorage.setItem('hype_tg_chat', chat);
  localStorage.setItem('hype_pnl_thr', thr || '0');
  tgSetStatus('Settings saved ✓', true);
}

async function testTelegram() {
  saveTGSettings();
  const ok = await sendTelegram('🔔 <b>Hype Dashboard</b>\n\nTest notification — Telegram alerts are working! ✅\n\nYou\'ll receive:\n• Price alert triggers\n• P&L milestones\n• Order fills');
  tgSetStatus(ok ? '✅ Test message sent!' : '❌ Failed — check token & chat ID', ok);
}

function tgSetStatus(msg, ok) {
  const el = document.getElementById('tg-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok === true ? 'var(--green)' : ok === false ? 'var(--red)' : 'var(--text-muted)';
}

async function checkOrderFills(newOrders) {
  if (lastOrderIds === null) { lastOrderIds = new Set(newOrders.map(o => o.oid)); return; }
  const newSet = new Set(newOrders.map(o => o.oid));
  for (const oid of lastOrderIds) {
    if (!newSet.has(oid)) {
      sendTelegram(`⚡ <b>Order Filled / Cancelled</b>\nOrder ID ${oid} is no longer open.\nCheck your positions on Hype Dashboard.`);
    }
  }
  lastOrderIds = newSet;
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

function iADX(highs, lows, closes, p=14) {
  if (highs.length < p+2) return { adx:[], pdi:[], mdi:[] };
  const tr=[], pDM=[], mDM=[];
  for (let i=1; i<highs.length; i++) {
    const h=highs[i]-highs[i-1], l=lows[i-1]-lows[i];
    pDM.push(h>l&&h>0?h:0);
    mDM.push(l>h&&l>0?l:0);
    tr.push(Math.max(highs[i]-lows[i],Math.abs(highs[i]-closes[i-1]),Math.abs(lows[i]-closes[i-1])));
  }
  const ws=(arr)=>{
    const out=[arr.slice(0,p).reduce((a,b)=>a+b,0)];
    for(let i=p;i<arr.length;i++) out.push(out.at(-1)-out.at(-1)/p+arr[i]);
    return out;
  };
  const aTR=ws(tr), sPDM=ws(pDM), sMDM=ws(mDM);
  const pdi=sPDM.map((v,i)=>aTR[i]?100*v/aTR[i]:0);
  const mdi=sMDM.map((v,i)=>aTR[i]?100*v/aTR[i]:0);
  const dx=pdi.map((v,i)=>{const s=v+mdi[i];return s?100*Math.abs(v-mdi[i])/s:0;});
  const adx=ws(dx);
  return {adx, pdi, mdi};
}

function iSupertrend(highs, lows, closes, period=10, mult=3) {
  const atr=iATR(highs,lows,closes,period);
  const out=[];
  let trend=1, prevUpper=Infinity, prevLower=-Infinity;
  for (let i=0; i<closes.length; i++) {
    if (!atr[i]) { out.push(null); continue; }
    const mid=(highs[i]+lows[i])/2;
    let upper=mid+mult*atr[i];
    let lower=mid-mult*atr[i];
    if (out.length>0 && out.at(-1)) {
      lower=Math.max(lower,prevLower);
      upper=Math.min(upper,prevUpper);
    }
    if (closes[i]>prevUpper) trend=1;
    else if (closes[i]<prevLower) trend=-1;
    prevUpper=upper; prevLower=lower;
    out.push({trend, upper, lower, line:trend===1?lower:upper});
  }
  return out;
}

function detectMarketStructure(candles, lb=5) {
  if (candles.length < lb*2+2) return {structure:'NEUTRAL',details:[],breakout:null,swingHighs:[],swingLows:[]};
  const highs=candles.map(c=>parseFloat(c.h));
  const lows=candles.map(c=>parseFloat(c.l));
  const closes=candles.map(c=>parseFloat(c.c));
  const sH=[], sL=[];
  for (let i=lb; i<candles.length-lb; i++) {
    if (highs.slice(i-lb,i).every(h=>h<=highs[i])&&highs.slice(i+1,i+lb+1).every(h=>h<=highs[i])) sH.push({i,price:highs[i]});
    if (lows.slice(i-lb,i).every(l=>l>=lows[i])&&lows.slice(i+1,i+lb+1).every(l=>l>=lows[i])) sL.push({i,price:lows[i]});
  }
  let structure='NEUTRAL', details=[];
  if (sH.length>=2&&sL.length>=2) {
    const hh=sH.at(-1).price>sH.at(-2).price, hl=sL.at(-1).price>sL.at(-2).price;
    const lh=sH.at(-1).price<sH.at(-2).price, ll=sL.at(-1).price<sL.at(-2).price;
    if (hh&&hl){structure='UPTREND';details=['HH','HL'];}
    else if (lh&&ll){structure='DOWNTREND';details=['LH','LL'];}
    else if (hh&&ll){structure='EXPANDING';details=['HH','LL'];}
    else if (lh&&hl){structure='CONTRACTING';details=['LH','HL'];}
  }
  const cur=closes.at(-1);
  let breakout=null;
  if (sH.at(-1)&&cur>sH.at(-1).price&&structure!=='UPTREND') breakout={type:'BULLISH_BREAK',level:sH.at(-1).price};
  else if (sL.at(-1)&&cur<sL.at(-1).price&&structure!=='DOWNTREND') breakout={type:'BEARISH_BREAK',level:sL.at(-1).price};
  return {structure,details,breakout,swingHighs:sH,swingLows:sL};
}

function detectRSIDivergence(closes, candles, p=14) {
  const rsi=iRSI(closes,p);
  const divs=[];
  const priceH=[], priceL=[];
  for (let i=3; i<closes.length-3; i++) {
    if (rsi[i]===null) continue;
    if (closes.slice(i-3,i).every(c=>c<=closes[i])&&closes.slice(i+1,i+4).every(c=>c<=closes[i])) priceH.push({i,price:closes[i],rsi:rsi[i]});
    if (closes.slice(i-3,i).every(c=>c>=closes[i])&&closes.slice(i+1,i+4).every(c=>c>=closes[i])) priceL.push({i,price:closes[i],rsi:rsi[i]});
  }
  if (priceH.length>=2) {
    const [a,b]=[priceH.at(-2),priceH.at(-1)];
    if (b.price>a.price&&b.rsi<a.rsi&&b.rsi>55) divs.push({type:'BEARISH',label:'Price HH / RSI LH',strength:b.rsi>68?'STRONG':'MEDIUM'});
  }
  if (priceL.length>=2) {
    const [a,b]=[priceL.at(-2),priceL.at(-1)];
    if (b.price<a.price&&b.rsi>a.rsi&&b.rsi<45) divs.push({type:'BULLISH',label:'Price LL / RSI HL',strength:b.rsi<32?'STRONG':'MEDIUM'});
  }
  return divs;
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
    const universe=meta[0].universe, ctxs=meta[1];
    const idx=universe.findIndex(a=>a.name===taCoin);
    const rawCtx=idx>=0?ctxs[idx]:null;
    const ta = await buildFullTA(taCoin, taTf, candles, rawCtx);
    el.innerHTML = renderTARec(ta);
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
// ── Order Scenario Analysis ───────────────────────────────────────────────────
const HL_TAKER_FEE = 0.00035; // 0.035% taker fee

function renderOrderScenarios(positions, orders) {
  if (!orders || !orders.length) return '';

  const posMap = {};
  (positions || []).forEach(p => { posMap[p.coin] = p; });

  const rows = [];
  orders.forEach(o => {
    const pos = posMap[o.coin];
    if (!pos) return;

    const orderSide = o.side === 'B' ? 'buy' : 'sell';
    const isReduce = (pos.side === 'long' && orderSide === 'sell') ||
                     (pos.side === 'short' && orderSide === 'buy');
    if (!isReduce) return;

    const execPx = parseFloat(o.limitPx || o.triggerPx || 0);
    if (!execPx) return;

    const sz     = parseFloat(o.sz || 0);
    const entry  = pos.entry_price;

    // Dollar PnL = price-diff × contracts (correct regardless of leverage)
    const rawPnl = pos.side === 'long'
      ? (execPx - entry) * sz
      : (entry - execPx) * sz;
    const fee    = sz * execPx * HL_TAKER_FEE;
    const netPnl = rawPnl - fee;

    // % of this position's margin that this order outcome represents
    // margin_used covers the full position; scale by sz/pos.size for partial closes
    const marginSlice = pos.margin_used > 0
      ? pos.margin_used * (sz / pos.size)
      : 0;
    const pctMargin = marginSlice > 0 ? (netPnl / marginSlice * 100) : null;

    const pctPos = pos.size > 0 ? (sz / pos.size * 100) : 0;

    // Auto-label TP / SL
    let typeLabel, typeCls;
    if (rawPnl > 0)      { typeLabel = 'TP';   typeCls = 'tp'; }
    else if (rawPnl < 0) { typeLabel = 'SL';   typeCls = 'sl'; }
    else                 { typeLabel = 'FLAT';  typeCls = 'flat'; }

    // Liquidation check: will liq fire before this SL can fill?
    let liqFirst = false;
    const liq = pos.liquidation_price;
    if (liq > 0 && typeLabel === 'SL') {
      liqFirst = (pos.side === 'long'  && liq >= execPx) ||
                 (pos.side === 'short' && liq <= execPx);
    }

    rows.push({ coin: o.coin, pos, typeLabel, typeCls, orderSide,
                execPx, sz, pctPos, rawPnl, fee, netPnl, pctMargin, liqFirst });
  });

  if (!rows.length) return '';

  const tpRows   = rows.filter(r => r.typeLabel === 'TP');
  const slRows   = rows.filter(r => r.typeLabel === 'SL');
  const bestNet  = tpRows.reduce((a, r) => a + r.netPnl, 0);
  const worstNet = slRows.reduce((a, r) => a + r.netPnl, 0);
  const liqFirstCount = rows.filter(r => r.liqFirst).length;

  // R:R by coin
  const byGroup = {};
  rows.forEach(r => {
    if (!byGroup[r.coin]) byGroup[r.coin] = { tp: null, sl: null };
    if (r.typeLabel === 'TP') byGroup[r.coin].tp = r;
    else if (r.typeLabel === 'SL') byGroup[r.coin].sl = r;
  });

  const typeColor = { tp: 'var(--green)', sl: 'var(--red)', flat: 'var(--text-muted)' };
  const typeBg    = { tp: 'rgba(74,222,128,0.15)', sl: 'rgba(248,113,113,0.15)', flat: 'rgba(100,100,100,0.15)' };
  const rowBg     = { tp: 'rgba(74,222,128,0.03)', sl: 'rgba(248,113,113,0.03)', flat: '' };

  const tableRows = rows.map(r => {
    const pnlCls = r.netPnl >= 0 ? 'pos' : 'neg';
    const pnlStr = (r.netPnl >= 0 ? '+' : '') + fmt$(r.netPnl);

    const pctMStr = r.pctMargin !== null
      ? `<span class="mono ${r.pctMargin >= 0 ? 'pos' : 'neg'}" style="font-size:11px">${r.pctMargin >= 0 ? '+' : ''}${r.pctMargin.toFixed(0)}%</span>`
      : '<span class="muted">—</span>';

    // Note cell: liq warning OR R:R badge
    let note = '';
    if (r.liqFirst) {
      note = `<span style="font-size:10px;color:var(--red);font-weight:700" title="Liquidation at ${fmtPrice(r.pos.liquidation_price)} fires before this SL">⚠ Liq ${fmtPrice(r.pos.liquidation_price)}</span>`;
    } else {
      const g = byGroup[r.coin];
      if (g.tp && g.sl) {
        const rr = Math.abs(g.tp.netPnl / g.sl.netPnl);
        const rrCls = rr >= 2 ? 'pos' : rr >= 1 ? 'yellow' : 'neg';
        note = `<span class="mono ${rrCls}" style="font-size:10px">R:R ${rr.toFixed(1)}</span>`;
      }
    }

    return `<tr style="background:${rowBg[r.typeCls]}">
      <td data-label="Coin" class="accent" style="font-weight:600">${r.coin}
        <span style="font-size:10px;color:var(--text-faint);margin-left:4px">${r.pos.leverage_value}x</span></td>
      <td data-label="Type"><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:100px;background:${typeBg[r.typeCls]};color:${typeColor[r.typeCls]}">${r.typeLabel}</span></td>
      <td data-label="Dir"><span class="side-badge ${r.pos.side}" style="font-size:10px">${r.pos.side.toUpperCase()}</span></td>
      <td data-label="Exec Px" class="mono">${fmtPrice(r.execPx)}</td>
      <td data-label="% Pos" class="muted" style="font-size:11px">${r.pctPos.toFixed(0)}%</td>
      <td data-label="Net PnL" class="mono ${pnlCls}" style="font-weight:700">${pnlStr}</td>
      <td data-label="% Margin">${pctMStr}</td>
      <td data-label="Note" style="font-size:11px">${note}</td>
    </tr>`;
  }).join('');

  const liqWarningBanner = liqFirstCount > 0
    ? `<div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.3);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;font-size:12px;color:var(--red)">
        ⚠ <strong>${liqFirstCount} SL order${liqFirstCount>1?'s':''} unreachable</strong> — liquidation price fires first. Your account will be liquidated before the stop fills.
       </div>` : '';

  const summaryLine = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;padding:12px 0 0;border-top:1px solid var(--border);margin-top:8px">
      ${tpRows.length ? `<div><div class="stat-label">Best case (${tpRows.length} TP${tpRows.length>1?'s':''})</div><div class="mono pos" style="font-weight:700">+${fmt$(bestNet)}</div></div>` : ''}
      ${slRows.length ? `<div><div class="stat-label">Worst case (${slRows.length} SL${slRows.length>1?'s':''})</div><div class="mono neg" style="font-weight:700">${fmt$(worstNet)}</div></div>` : ''}
      ${tpRows.length && slRows.length ? `<div style="border-left:1px solid var(--border);padding-left:20px">
        <div class="stat-label">Net if all hit</div>
        <div class="mono ${bestNet+worstNet>=0?'pos':'neg'}" style="font-weight:700">${bestNet+worstNet>=0?'+':''}${fmt$(bestNet+worstNet)}</div>
      </div>` : ''}
    </div>`;

  return `<div class="card" style="margin-top:14px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <div class="card-title" style="margin:0">🎯 Order Scenarios</div>
      <span class="muted" style="font-size:11px">if orders hit · dollar PnL = Δprice × contracts · 0.035% taker fee</span>
    </div>
    ${liqWarningBanner}
    <div class="table-wrap">
      <table class="mobile-cards">
        <thead><tr><th>Coin</th><th>Type</th><th>Dir</th><th>Exec Price</th><th>% Pos</th><th>Net PnL</th><th>% Margin</th><th>Note</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${summaryLine}
  </div>`;
}

function fmtAge(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)   return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400)return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

function _fillMeta(dir) {
  const d = (dir||'').toLowerCase();
  if (d.includes('liq'))   return { label:'LIQ',   bg:'rgba(248,113,113,0.15)', color:'var(--red)',      dirCls:'neg'  };
  if (d.startsWith('open'))return { label:'OPEN',  bg:'rgba(80,210,193,0.10)',  color:'var(--accent)',   dirCls:''     };
  return                          { label:'CLOSE', bg:'var(--surface2)',         color:'var(--text-muted)', dirCls:'' };
}
function _fillDirLabel(dir) {
  const d = (dir||'').toLowerCase();
  if (d.includes('long'))  return { label:'LONG',  cls:'long'  };
  if (d.includes('short')) return { label:'SHORT', cls:'short' };
  return { label:'—', cls:'muted' };
}

function toggleRecentPnL() {
  _recentPnlOpen = !_recentPnlOpen;
  const body    = document.getElementById('recent-pnl-body');
  const chevron = document.getElementById('recent-pnl-chevron');
  if (body)    body.style.display  = _recentPnlOpen ? '' : 'none';
  if (chevron) chevron.textContent = _recentPnlOpen ? '▼' : '▶';
}

function renderRecentPnLWidget(allFills) {
  const hrs    = _recentPnlHours;
  const cutoff = Date.now() - hrs * 3600000;
  const fills  = (allFills||[]).filter(f => f.time >= cutoff && !f.isSpot).slice(0, 100);

  const closingFills = fills.filter(f => f.closed_pnl !== 0);
  const totalPnl  = closingFills.reduce((a,f)=>a+f.closed_pnl, 0);
  const totalFees = fills.reduce((a,f)=>a+f.fee, 0);
  const netPnl    = totalPnl - totalFees;
  const liqCount  = fills.filter(f=>(f.dir||'').toLowerCase().includes('liq')).length;

  const chevron  = `<span id="recent-pnl-chevron" style="font-size:10px;color:var(--text-faint);margin-left:4px">${_recentPnlOpen?'▼':'▶'}</span>`;
  const netBadge = fills.length ? `<span class="mono ${netPnl>=0?'pos':'neg'}" style="font-size:12px;font-weight:700;margin-left:10px">${netPnl>=0?'+':''}${fmt$(netPnl)}</span>` : '';
  const liqBadge = liqCount>0 ? `<span style="margin-left:6px;font-size:10px;background:rgba(248,113,113,0.15);color:var(--red);padding:2px 6px;border-radius:100px;font-weight:700">⚡${liqCount}</span>` : '';
  const headerRow = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;cursor:pointer" onclick="toggleRecentPnL()">
      <div style="display:flex;align-items:center;gap:0;user-select:none">
        <div class="card-title" style="margin:0">📊 Recent PnL${chevron}</div>
        ${netBadge}${liqBadge}
      </div>
      <div style="display:flex;gap:2px" onclick="event.stopPropagation()">
        ${[24, 168].map(h=>`<button class="tab${_recentPnlHours===h?' active':''}" onclick="_recentPnlHours=${h};renderOverviewTab()" style="font-size:11px;padding:3px 10px">${h===24?'24h':'7d'}</button>`).join('')}
      </div>
    </div>`;

  if (!fills.length) return `<div class="card" style="margin-top:14px">
    ${headerRow}
    <div id="recent-pnl-body" style="${_recentPnlOpen?'margin-top:8px':'display:none'}">
      <div class="muted" style="padding:12px 0;text-align:center;font-size:12px">No perp fills in the last ${hrs===24?'24h':'7 days'}</div>
    </div>
  </div>`;

  const wins      = closingFills.filter(f=>f.closed_pnl>0).length;
  const losses    = closingFills.filter(f=>f.closed_pnl<0).length;
  const winRate   = wins+losses>0 ? (wins/(wins+losses)*100).toFixed(0)+'%' : '—';

  // By-coin totals (closing fills only)
  const byCoin = {};
  closingFills.forEach(f => {
    if(!byCoin[f.coin]) byCoin[f.coin] = {coin:f.coin, count:0, pnl:0, fees:0};
    byCoin[f.coin].count++;
    byCoin[f.coin].pnl  += f.closed_pnl;
    byCoin[f.coin].fees += f.fee;
  });
  // add fees from opening fills too
  fills.filter(f=>f.closed_pnl===0).forEach(f => {
    if(!byCoin[f.coin]) byCoin[f.coin] = {coin:f.coin, count:0, pnl:0, fees:0};
    byCoin[f.coin].fees += f.fee;
  });
  const coinRows = Object.values(byCoin).sort((a,b)=>Math.abs(b.pnl)-Math.abs(a.pnl));

  return `<div class="card" style="margin-top:14px">
    ${headerRow}
    <div id="recent-pnl-body" style="margin-top:12px;${_recentPnlOpen?'':'display:none'}">
      <div style="display:flex;gap:20px;flex-wrap:wrap;padding:10px 0 14px;border-bottom:1px solid var(--border);margin-bottom:14px">
        <div><div class="stat-label">Realized PnL</div><div class="mono ${totalPnl>=0?'pos':'neg'}" style="font-size:15px;font-weight:700">${totalPnl>=0?'+':''}${fmt$(totalPnl)}</div></div>
        <div><div class="stat-label">Fees</div><div class="mono neg" style="font-size:15px;font-weight:700">−${fmt$(totalFees)}</div></div>
        <div style="border-left:1px solid var(--border);padding-left:20px"><div class="stat-label">Net PnL</div><div class="mono ${netPnl>=0?'pos':'neg'}" style="font-size:15px;font-weight:700">${netPnl>=0?'+':''}${fmt$(netPnl)}</div></div>
        <div><div class="stat-label">Win Rate</div><div class="mono" style="font-size:15px;font-weight:700">${winRate}</div><div class="muted" style="font-size:10px">${wins}W / ${losses}L</div></div>
        <div><div class="stat-label">Fills</div><div class="mono" style="font-size:15px;font-weight:700">${fills.length}</div></div>
      </div>
      <div class="table-wrap" style="margin-bottom:14px">
        <table class="mobile-cards">
          <thead><tr><th>Time</th><th>Coin</th><th>Type</th><th>Dir</th><th>Price</th><th>Size</th><th>PnL</th><th>Fee</th></tr></thead>
          <tbody>${fills.map(f=>{
            const m = _fillMeta(f.dir);
            const dv= _fillDirLabel(f.dir);
            return `<tr>
              <td data-label="Time" class="muted" style="font-size:11px;white-space:nowrap">${fmtAge(f.time)}</td>
              <td data-label="Coin" class="accent" style="font-weight:600">${f.coin}</td>
              <td data-label="Type"><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:100px;background:${m.bg};color:${m.color};letter-spacing:.03em">${m.label}</span></td>
              <td data-label="Dir"><span class="side-badge ${dv.cls}" style="font-size:10px">${dv.label}</span></td>
              <td data-label="Price" class="mono">${fmtPrice(f.price)}</td>
              <td data-label="Size" class="mono">${f.size}</td>
              <td data-label="PnL" class="${f.closed_pnl>0?'pos':f.closed_pnl<0?'neg':'muted'} mono">${f.closed_pnl!==0?fmt$(f.closed_pnl):'—'}</td>
              <td data-label="Fee" class="neg mono">${f.fee>0?'−'+fmt$(f.fee):'—'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      ${coinRows.length>1?`
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);margin-bottom:6px">By Coin</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Coin</th><th>Trades</th><th>PnL</th><th>Fees</th><th>Net</th></tr></thead>
        <tbody>${coinRows.map(r=>`<tr>
          <td class="accent" style="font-weight:600">${r.coin}</td>
          <td class="muted">${r.count}</td>
          <td class="${r.pnl>=0?'pos':'neg'} mono">${r.pnl!==0?fmt$(r.pnl):'—'}</td>
          <td class="neg mono">−${fmt$(r.fees)}</td>
          <td class="${r.pnl-r.fees>=0?'pos':'neg'} mono">${fmt$(r.pnl-r.fees)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`:''}
    </div>
  </div>`;
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
  _lastRefreshTs=Date.now();
  const el=document.getElementById('refresh-info');
  if(el){el.style.display='block';el.textContent='Updated '+new Date().toLocaleTimeString();}
  setStatus(true);
}
function spinnerHtml(){return '<div class="spinner" style="display:inline-block;vertical-align:middle"></div>';}
function loading(){return `<div class="loading">${spinnerHtml()} Loading…</div>`;}
function err(e){return `<div class="loading">Error: ${e.message}</div>`;}

// ── New Listing Watcher ───────────────────────────────────────────────────────
let _knownCoins = null;

function playListingAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.start(t); osc.stop(t + 0.3);
    });
  } catch(_) {}
}

function showListingToast(coin, price) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'listing-toast';
  const priceStr = price > 0 ? fmtPrice(price) : '';
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:16px">🆕</span>
      <div>
        <div style="font-weight:700;font-size:13px">${coin} <span style="color:var(--accent);font-size:11px">New HL Listing</span></div>
        ${priceStr ? `<div style="font-size:11px;color:var(--text-muted)">Mark ${priceStr}</div>` : ''}
      </div>
      <button onclick="this.closest('.listing-toast').remove()" style="margin-left:auto;background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:14px;padding:0 2px">✕</button>
    </div>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('listing-toast-in'));
  setTimeout(() => { toast.classList.remove('listing-toast-in'); setTimeout(() => toast.remove(), 400); }, 8000);
}

async function checkNewListings() {
  try {
    const raw = await getMetaAndAssetCtxs();
    const [meta, ctxs = []] = raw;
    const coins = (meta?.universe || []).map((a, i) => ({ name: a.name, px: parseFloat(ctxs[i]?.markPx || 0) })).filter(c => c.name);
    const names = coins.map(c => c.name);
    if (_knownCoins === null) {
      const stored = localStorage.getItem('hype_known_coins');
      _knownCoins = stored ? new Set(JSON.parse(stored)) : null;
    }
    if (_knownCoins === null) {
      _knownCoins = new Set(names);
      localStorage.setItem('hype_known_coins', JSON.stringify(names));
      return;
    }
    const newCoins = coins.filter(c => !_knownCoins.has(c.name));
    for (const c of newCoins) {
      _knownCoins.add(c.name);
      playListingAlert();
      showListingToast(c.name, c.px);
      sendTelegram(`🆕 <b>New HL Listing: ${c.name}</b>\nMark price: ${c.px > 0 ? fmtPrice(c.px) : '—'}`);
    }
    if (newCoins.length) localStorage.setItem('hype_known_coins', JSON.stringify([..._knownCoins]));
  } catch(_) {}
}

function startListingWatcher() {
  checkNewListings();
  setInterval(checkNewListings, 60 * 1000);
}

// ── Init ──────────────────────────────────────────────────────────────────────
function _doSilentRefresh(){
  if(document.hidden) return;
  if(_SKIP_SILENT.has(currentPage)) return;
  const main=document.querySelector('.main');
  const sy=main?main.scrollTop:0;
  _silentRefresh=true;
  const loaders={overview:loadOverview,trades:loadTrades,funding:loadFunding,
    flows:loadFlows,markets:loadMarkets,watchlist:loadWatchlist,
    intel:typeof loadIntel!=='undefined'?loadIntel:null,
    indicators:typeof loadIndicators!=='undefined'?loadIndicators:null,
    smartmoney:typeof loadNansen!=='undefined'?loadNansen:null};
  const loader=loaders[currentPage];
  const p=loader?Promise.resolve(loader()):Promise.resolve();
  p.catch(()=>{}).finally(()=>{
    _silentRefresh=false;
    _lastRefreshTs=Date.now();
    if(main) requestAnimationFrame(()=>{main.scrollTop=sy;});
    const ri=document.getElementById('refresh-info');
    if(ri){ri.classList.add('refresh-flash');setTimeout(()=>ri.classList.remove('refresh-flash'),500);}
  });
}

function _startAgoCounter(){
  setInterval(()=>{
    if(!_lastRefreshTs) return;
    const s=Math.floor((Date.now()-_lastRefreshTs)/1000);
    const ri=document.getElementById('refresh-info');
    if(!ri) return;
    if(s<60) ri.textContent='Updated just now';
    else ri.textContent=`Updated ${Math.floor(s/60)}m ago`;
  },30000);
}

// Pull-to-refresh (mobile)
let _ptrY=0;
document.addEventListener('touchstart',e=>{_ptrY=e.touches[0].clientY;},{passive:true});
document.addEventListener('touchend',e=>{
  const main=document.querySelector('.main');
  const dy=e.changedTouches[0].clientY-_ptrY;
  if(dy>65&&main&&main.scrollTop<=0) navigate(currentPage);
},{passive:true});

// Refresh when returning to tab after >60s
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&Date.now()-_lastRefreshTs>60000) _doSilentRefresh();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMktDetail();
});
document.addEventListener('DOMContentLoaded',()=>{
  const wl=getWatchlist();
  if(!wl.find(w=>w.address===DEFAULT_WALLET.toLowerCase())){
    wl.unshift({address:DEFAULT_WALLET.toLowerCase(),label:'My Wallet',added_at:Date.now()});
    saveWatchlist(wl);
  }
  initMobileTableLabels();
  navigate('overview');
  startListingWatcher();
  autoRefreshTimer=setInterval(_doSilentRefresh,60000);
  _startAgoCounter();
  if(typeof loggerInit==='function'){ loggerInit(); loggerRefreshStatus(); }
  // Auto-journal: detect closed trades + schedule daily snapshot
  setTimeout(()=>{
    if(typeof journalAutoCheck==='function') journalAutoCheck();
    if(typeof _ajScheduleDaily==='function') _ajScheduleDaily();
    // Re-check every 10 minutes for new closed trades
    setInterval(()=>{ if(typeof journalAutoCheck==='function') journalAutoCheck(); }, 600000);
  }, 8000); // delay 8s so fills load after initial render
});