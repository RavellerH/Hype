import {
  getClearinghouseState, parsePositions, getCandles, detectPhase, findSR, calcTradeSetup, iATR,
  calcCVD, sigCVDOI, getRegimeInputs, scoreRegime, getJournalSummary, getFundingRates, getHLNews,
  writeEntry, readIndex, tgSend, extractJSON, routedDraft, esc,
} from './lib.mjs';

const INSIGHT_SYSTEM = `You are a senior Hyperliquid (HYPE) trading desk analyst writing a daily
actionable brief for one trader's own book. You are given, per coin: a Wyckoff-style technical
phase read with a consensus count (how many of ~10 individual TA factors actually agree, not just
the final score), a money-flow read derived from CVD + OI (distinguishes real demand/supply from
leverage-driven squeezes and quiet accumulation/distribution), the current funding rate and
crowding read, and — for coins the trader already holds — position P&L, distance to liquidation and
funding drag. You are also given macro sentiment (Fear & Greed, recent Hyperliquid-relevant
headlines, aggregate funding crowding across the tracked coins) and a macro regime score.

Do the analysis, don't just restate the numbers. For every coin, explicitly weigh whether the
technical phase, the money-flow read, and the funding read AGREE or CONFLICT — say so plainly, and
treat agreement as higher-conviction and conflict as a reason to size down or wait, not as a coin
flip to resolve arbitrarily. Cross-check sentiment against price/technical action the same way (e.g.
extreme fear with a MARKUP phase is a specific, nameable divergence — call it out). If the data on a
point is thin, conflicting, or inconclusive, say so rather than manufacturing false conviction. Base
every claim ONLY on the numbers given — never invent data, never invent coins or levels not present
in the context. Neutral, analytical, critical tone — no hype-speak, no generic "always DYOR"
boilerplate, this is written for someone who already knows the risks and wants the actual reasoning
trail, not just a verdict.`;

function pctFromLiq(pos) {
  if (!pos.liquidation_price || !pos.mark_price) return null;
  return Math.abs((pos.mark_price - pos.liquidation_price) / pos.mark_price) * 100;
}

function fundingDragNote(pos) {
  if (!pos.cum_funding) return 'no funding data';
  const favorable = pos.side === 'long' ? pos.cum_funding > 0 : pos.cum_funding < 0;
  return `${favorable ? 'favorable (tailwind)' : 'unfavorable (headwind)'} — cumulative funding since open $${pos.cum_funding.toFixed(2)}`;
}

// Generalized per-coin funding crowding read (same scale intel.js uses for BTC, applied per-coin).
function fundingRead(apr) {
  if (apr == null) return { dir: 'neutral', note: 'funding data unavailable' };
  if (apr < 0) return { dir: 'bull', note: `${apr.toFixed(1)}% APR — negative, favorable for longs (shorts pay)` };
  if (apr < 10) return { dir: 'neutral', note: `${apr.toFixed(1)}% APR — low, uncrowded` };
  if (apr < 30) return { dir: 'bear', note: `${apr.toFixed(1)}% APR — elevated, longs crowding` };
  return { dir: 'bear', note: `${apr.toFixed(1)}% APR — very high, crowded longs, flush risk` };
}

const FLOW_BULL = new Set(['STRONG BULL', 'SPOT DRIVEN', 'BULL DIVERGENCE', 'ACCUMULATION']);
const FLOW_BEAR = new Set(['STRONG BEAR', 'LEVERAGED SELL', 'SUSPECT PUMP', 'WEAK RALLY']);
function flowDirection(label) {
  if (FLOW_BULL.has(label)) return 'bull';
  if (FLOW_BEAR.has(label)) return 'bear';
  return 'neutral';
}

async function analyzeCoin(coin, fundingMap, prevOiSnapshot) {
  const candles = await getCandles(coin, '1h', 15);
  if (!candles || candles.length < 20) return null;
  const opens = candles.map(c => parseFloat(c.o));
  const closes = candles.map(c => parseFloat(c.c));
  const highs = candles.map(c => parseFloat(c.h));
  const lows = candles.map(c => parseFloat(c.l));
  const volumes = candles.map(c => parseFloat(c.v));

  const phase = detectPhase(candles);
  const atr = iATR(highs, lows, closes, 14).at(-1) || closes.at(-1) * 0.02;
  const sr = findSR(highs, lows, closes);
  const price = closes.at(-1);
  const direction = phase.score >= 0.12 ? 'LONG' : phase.score <= -0.12 ? 'SHORT' : 'NEUTRAL';
  const setup = calcTradeSetup(direction, price, sr, atr);

  // Money flow: CVD over the last 4 candles + day-over-day OI change (persisted
  // across runs via insights/index.json, since a stateless script has no other
  // memory of "OI an hour/day ago").
  const cvdArr = calcCVD(opens, closes, highs, lows, volumes);
  const lb = 4;
  const recentCVD = cvdArr.at(-1) - (cvdArr.length > lb ? cvdArr[cvdArr.length - 1 - lb] : 0);
  const priceChg4 = closes.length > lb ? (closes.at(-1) - closes[closes.length - 1 - lb]) / closes[closes.length - 1 - lb] * 100 : 0;

  const f = fundingMap[coin];
  const oiUsd = f ? f.openInterest * f.markPx : null;
  const prevOi = prevOiSnapshot[coin];
  const oiChgPct = (prevOi && oiUsd) ? (oiUsd - prevOi) / prevOi * 100 : null;
  const flow = sigCVDOI(priceChg4, recentCVD, oiChgPct);

  const fundingApr = f ? f.fundingRate * 24 * 365 * 100 : null;
  const funding = fundingRead(fundingApr);

  const phaseDir = phase.score >= 0.12 ? 'bull' : phase.score <= -0.12 ? 'bear' : 'neutral';
  const flowDir = flowDirection(flow.label);
  const dirs = [phaseDir, flowDir, funding.dir];
  const agreeing = Math.max(dirs.filter(d => d === 'bull').length, dirs.filter(d => d === 'bear').length);

  return { coin, price, phase, direction, setup, oiUsd, flow, fundingApr, funding, phaseDir, flowDir, agreeing };
}

async function main() {
  const { LLM_ROUTER_URL: routerUrl, TG_TOKEN, TG_CHAT, PRIMARY_WALLET, SIGNAL_COINS, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!routerUrl) throw new Error('LLM_ROUTER_URL not set (Supabase llm-router Edge Function URL)');
  if (!PRIMARY_WALLET) throw new Error('PRIMARY_WALLET not set — this report needs your wallet address to read open positions');

  const watchlist = (SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());

  const prevIndex = await readIndex('insights/index.json');
  const prevOiSnapshot = prevIndex[0]?.oi_snapshot || {};

  const [state, regimeInputs, fundingMap, news] = await Promise.all([
    getClearinghouseState(PRIMARY_WALLET),
    getRegimeInputs().catch(() => ({})),
    getFundingRates().catch(() => ({})),
    getHLNews().catch(() => []),
  ]);
  const positions = parsePositions(state);
  const regime = scoreRegime(regimeInputs);

  const heldCoins = new Set(positions.map(p => p.coin));
  const analyzeTargets = [...new Set([...positions.map(p => p.coin), ...watchlist])];
  const analyses = {};
  for (const coin of analyzeTargets) {
    try { analyses[coin] = await analyzeCoin(coin, fundingMap, prevOiSnapshot); } catch (e) { console.warn(`[insight] ${coin} analysis failed:`, e.message); }
  }

  const oiSnapshot = {};
  for (const coin of analyzeTargets) if (analyses[coin]?.oiUsd) oiSnapshot[coin] = analyses[coin].oiUsd;

  const posLines = positions.map(p => {
    const a = analyses[p.coin];
    const liqPct = pctFromLiq(p);
    const aligned = !a || a.phaseDir === 'neutral' ? 'no clear technical signal' :
      (a.phaseDir === 'bull') === (p.side === 'long') ? 'technicals agree with position' : 'technicals conflict with position';
    return [
      `${p.coin} — ${p.side.toUpperCase()} ${p.size} @ entry $${p.entry_price}, mark $${p.mark_price.toFixed(4)}, ` +
      `unrealized PnL $${p.unrealized_pnl.toFixed(2)}, ${p.leverage_value}x ${p.leverage_type}`,
      liqPct != null ? `  Liquidation: $${p.liquidation_price.toFixed(4)} (${liqPct.toFixed(1)}% away from mark)` : '  Liquidation: n/a (no leverage risk)',
      `  Funding drag: ${fundingDragNote(p)}`,
      a ? `  Technical phase: ${a.phase.phase} (score ${a.phase.score}, consensus ${a.phase.consensus.bull}bull/${a.phase.consensus.bear}bear of ${a.phase.consensus.total}) → ${aligned}` : '  Technical phase: unavailable',
      a ? `  Money flow: ${a.flow.label} — ${a.flow.sub} — ${a.flow.detail}` : '',
      a ? `  Current funding: ${a.funding.note}` : '',
      a ? `  Directional agreement: ${a.agreeing}/3 signals (phase=${a.phaseDir}, flow=${a.flowDir}, funding=${a.funding.dir})` : '',
      a ? `  Top TA signals: ${a.phase.signals.slice(0, 4).join('; ')}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const newSetupLines = watchlist
    .filter(c => !heldCoins.has(c))
    .map(c => analyses[c])
    .filter(a => a && a.direction !== 'NEUTRAL' && Math.abs(a.phase.score) >= 0.3)
    .map(a =>
      `${a.coin} — ${a.direction} bias, phase=${a.phase.phase} (score ${a.phase.score}, consensus ${a.phase.consensus.bull}bull/${a.phase.consensus.bear}bear of ${a.phase.consensus.total})\n` +
      `  Price $${a.price.toFixed(4)} · Entry $${a.setup.entry.toFixed(4)} · SL $${a.setup.sl.toFixed(4)} · TP1 $${a.setup.tp1.toFixed(4)} · TP2 $${a.setup.tp2.toFixed(4)} · R:R ${a.setup.rr.toFixed(2)}\n` +
      `  Money flow: ${a.flow.label} — ${a.flow.sub} — ${a.flow.detail}\n` +
      `  Funding: ${a.funding.note}\n` +
      `  Directional agreement: ${a.agreeing}/3 signals (phase=${a.phaseDir}, flow=${a.flowDir}, funding=${a.funding.dir})\n` +
      `  Top TA signals: ${a.phase.signals.slice(0, 4).join('; ')}`
    ).join('\n\n');

  const allAnalyzed = Object.values(analyses).filter(Boolean);
  const crowdedLong = allAnalyzed.filter(a => a.fundingApr != null && a.fundingApr >= 15).map(a => a.coin);
  const crowdedShort = allAnalyzed.filter(a => a.fundingApr != null && a.fundingApr <= -10).map(a => a.coin);
  const highConviction = allAnalyzed.filter(a => a.agreeing === 3).map(a => `${a.coin} (${a.phaseDir})`);
  const conflicted = allAnalyzed.filter(a => a.agreeing <= 1).map(a => a.coin);

  const sentimentLines = [
    regimeInputs.fng ? `Fear & Greed Index: ${regimeInputs.fng.value} (${regimeInputs.fng.label})` : 'Fear & Greed Index: unavailable',
    `Funding-based crowding across tracked coins: ${crowdedLong.length ? `crowded LONG — ${crowdedLong.join(', ')}` : 'no coin crowded long'}; ${crowdedShort.length ? `crowded SHORT — ${crowdedShort.join(', ')}` : 'no coin crowded short'}`,
    news.length ? `Recent Hyperliquid-relevant headlines:\n${news.map(n => `  - [${n.age} ago] ${n.title}`).join('\n')}` : 'No recent Hyperliquid-relevant headlines found.',
  ].join('\n');

  const consensusLines = [
    `High-conviction (all 3 directional signals — phase, money flow, funding — agree): ${highConviction.length ? highConviction.join(', ') : 'none today'}`,
    `Conflicted / low-conviction (signals disagree, 1 or fewer of 3 aligned): ${conflicted.length ? conflicted.join(', ') : 'none today'}`,
  ].join('\n');

  let journalNote = '';
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const entries = await getJournalSummary(SUPABASE_URL, SUPABASE_ANON_KEY, 20);
      if (entries.length) {
        const tagCounts = {};
        for (const e of entries) if (e.tag) tagCounts[e.tag] = (tagCounts[e.tag] || 0) + 1;
        const wins = entries.filter(e => (e.net_pnl ?? e.pnl ?? 0) > 0).length;
        journalNote = `Last ${entries.length} journaled trades: ${wins}/${entries.length} winners. ` +
          `Tags: ${Object.entries(tagCounts).map(([t, n]) => `${t}×${n}`).join(', ') || 'none'}.`;
      }
    } catch (e) { console.warn('[insight] journal fetch failed:', e.message); }
  }

  const context = [
    `HYPERLIQUID DAILY ACTIONABLE INSIGHT — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `MACRO REGIME: ${regime.verdict} (score ${regime.normScore}/10, confidence ${regime.confidence}%)`,
    regime.signals.map(s => `  ${s.name}: ${s.value} — ${s.note} (${s.score > 0 ? '+' : ''}${s.score})`).join('\n'),
    '',
    'SENTIMENT:',
    sentimentLines,
    '',
    'SIGNAL CONSENSUS ACROSS TRACKED COINS:',
    consensusLines,
    '',
    positions.length ? `OPEN POSITIONS (${positions.length}):\n${posLines}` : 'OPEN POSITIONS: none currently open.',
    '',
    newSetupLines ? `NEW SETUPS (watchlist coins not currently held, real signal only):\n${newSetupLines}` : 'NEW SETUPS: no watchlist coin currently shows a signal strong enough to flag.',
    journalNote ? `\nJOURNAL HISTORY: ${journalNote}` : '',
  ].filter(Boolean).join('\n');

  const userPrompt = `Based on the context below, write today's actionable insight report. Return ONLY a JSON object with this exact shape:\n` +
    `{"headline":"<one line, specific not generic>",` +
    `"market_analysis":"<6-10 sentences of real critical analysis, not a restatement of numbers — weave together technical phase, money flow, funding and macro regime per coin where relevant, explicitly naming where signals agree or conflict>",` +
    `"sentiment_summary":"<3-5 sentences on Fear & Greed + headline tone + funding-based crowding, noting whether sentiment agrees or conflicts with price/technical action>",` +
    `"money_flow_summary":"<3-5 sentences on what the CVD/OI-derived flow reads actually mean — which coins show real demand/supply vs. leverage-driven squeezes vs. quiet accumulation>",` +
    `"consensus_summary":"<2-4 sentences: which coins are high-conviction (multi-signal agreement) vs conflicted (sit out or size down)>",` +
    `"position_actions":[{"coin":"<coin, only from OPEN POSITIONS above>","action":"hold|trim|add|tighten_stop|close","reason":"<2-3 sentences, tied to the actual numbers, naming which signals agree or conflict>"}],` +
    `"new_setups":[{"coin":"<coin, only from NEW SETUPS above>","direction":"LONG|SHORT","conviction":"high|medium|low","rationale":"<2-3 sentences>"}],` +
    `"regime_note":"<2-3 sentences on what the macro regime score means for sizing/risk today>",` +
    `"risks":["<specific, data-grounded risk>","<specific, data-grounded risk>","<specific, data-grounded risk>"],` +
    `"confidence":"high|medium|low — how well the available data actually supports these calls",` +
    `"takeaway":"<one or two neutral, non-advice sentences>"}\n` +
    `Only include a position in "position_actions" if it appears in OPEN POSITIONS, and only include a coin in "new_setups" if it appears in NEW SETUPS. If OPEN POSITIONS is empty, return an empty array for position_actions. If NEW SETUPS has no coins, return an empty array for new_setups.\n` +
    `No text outside the JSON object.\n\nCONTEXT:\n${context}`;

  const raw = await routedDraft(routerUrl, 'setups', INSIGHT_SYSTEM, userPrompt, 4096);
  const insight = extractJSON(raw);
  const today = new Date().toISOString().slice(0, 10);
  const file = `${today}.md`;

  const setupDetails = Object.fromEntries(
    watchlist.filter(c => !heldCoins.has(c)).map(c => analyses[c]).filter(a => a && a.direction !== 'NEUTRAL' && Math.abs(a.phase.score) >= 0.3).map(a => [a.coin, a])
  );
  const posDetails = Object.fromEntries(positions.map(p => [p.coin, p]));

  const md = [
    `# ${insight.headline}`,
    '',
    `*${today} · confidence: ${insight.confidence || 'n/a'} · regime: ${regime.verdict} (${regime.normScore}/10)*`,
    '',
    '## Market Analysis',
    insight.market_analysis || '',
    '',
    '## Sentiment',
    insight.sentiment_summary || '',
    '',
    '## Money Flow',
    insight.money_flow_summary || '',
    '',
    '## Signal Consensus',
    insight.consensus_summary || '',
    '',
    '## Position Actions',
    ...(insight.position_actions || []).map(a => {
      const p = posDetails[a.coin];
      const extra = p ? ` _(${p.side} ${p.size} @ $${p.entry_price}, mark $${p.mark_price.toFixed(4)})_` : '';
      return `- **${esc(a.coin)} → ${esc(a.action).toUpperCase()}**${extra}: ${esc(a.reason)}`;
    }),
    !positions.length ? '_No open positions._' : '',
    '',
    '## New Setups',
    ...(insight.new_setups || []).map(s => {
      const d = setupDetails[s.coin];
      const levels = d ? ` — entry $${d.setup.entry.toFixed(4)} · SL $${d.setup.sl.toFixed(4)} · TP1 $${d.setup.tp1.toFixed(4)} · TP2 $${d.setup.tp2.toFixed(4)} · R:R ${d.setup.rr.toFixed(2)}` : '';
      return `- **${esc(s.coin)} ${esc(s.direction)}**${s.conviction ? ` (${esc(s.conviction)} conviction)` : ''}${levels}: ${esc(s.rationale)}`;
    }),
    !(insight.new_setups || []).length ? '_No new setups flagged today._' : '',
    '',
    '## Regime',
    insight.regime_note || '',
    '',
    '## Risks',
    ...(insight.risks || []).map(r => `- ${r}`),
    '',
    '## Takeaway',
    insight.takeaway || '',
    '',
    '<details><summary>Raw data context</summary>\n\n```\n' + context + '\n```\n\n</details>',
  ].join('\n') + '\n';

  await writeEntry({
    dir: 'insights', file, md,
    indexPath: 'insights/index.json',
    indexEntry: {
      date: today, file, headline: insight.headline,
      market_analysis: insight.market_analysis, sentiment_summary: insight.sentiment_summary,
      money_flow_summary: insight.money_flow_summary, consensus_summary: insight.consensus_summary,
      position_actions: insight.position_actions || [], new_setups: insight.new_setups || [],
      regime_verdict: regime.verdict, regime_score: regime.normScore,
      regime_note: insight.regime_note, risks: insight.risks || [],
      confidence: insight.confidence || null, takeaway: insight.takeaway,
      oi_snapshot: oiSnapshot,
    },
  });

  console.log(`Daily insight written: insights/${file}`);

  if (TG_TOKEN && TG_CHAT) {
    const actionLines = (insight.position_actions || []).map(a => `• ${a.coin}: ${a.action.toUpperCase()}`).join('\n');
    const setupLines = (insight.new_setups || []).map(s => `• ${s.coin} ${s.direction}${s.conviction ? ` (${s.conviction})` : ''}`).join('\n');
    await tgSend(TG_TOKEN, TG_CHAT,
      `<b>░▒▓ DAILY INSIGHT ▓▒░</b>\n<b>${esc(insight.headline)}</b>\n` +
      (actionLines ? `\n<b>Positions:</b>\n<pre>${esc(actionLines)}</pre>` : '') +
      (setupLines ? `\n<b>New setups:</b>\n<pre>${esc(setupLines)}</pre>` : '') +
      `\n<i>full report in dashboard → Insight tab</i>`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
