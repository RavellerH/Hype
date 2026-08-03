import {
  getClearinghouseState, parsePositions, getCandles, detectPhase, findSR, calcTradeSetup, iATR,
  getRegimeInputs, scoreRegime, getJournalSummary,
  writeEntry, tgSend, extractJSON, routedDraft, esc,
} from './lib.mjs';

const INSIGHT_SYSTEM = `You are a senior Hyperliquid (HYPE) trading desk analyst writing a daily
actionable brief for one trader's own book. You are given: (1) their currently open positions with
computed technical read (phase, direction bias, distance to liquidation, funding drag) for each,
(2) computed trade setups (entry/stop/targets) for coins they don't currently hold where the
technicals show a real signal, and (3) a macro regime score. Base every claim ONLY on the numbers
given — never invent data. For each open position, give ONE concrete recommendation: hold, trim,
add, tighten stop, or close — and say why in one sentence tied to the actual numbers (phase
direction vs. position side, distance to liquidation, funding cost). For new setups, only mention
ones actually provided — do not invent additional coins or levels. If nothing in the data supports
a clear action for a position or setup, say so plainly rather than manufacturing false conviction.
Neutral, analytical, critical tone — no hype-speak, no generic "always DYOR" boilerplate, this is
written for someone who already knows the risks.`;

function pctFromLiq(pos) {
  if (!pos.liquidation_price || !pos.mark_price) return null;
  return Math.abs((pos.mark_price - pos.liquidation_price) / pos.mark_price) * 100;
}

// Positive = funding is being paid TO the position (tailwind), negative = paid BY it (headwind).
function fundingDragNote(pos) {
  if (!pos.cum_funding) return 'no funding data';
  const favorable = pos.side === 'long' ? pos.cum_funding > 0 : pos.cum_funding < 0;
  return `${favorable ? 'net positive' : 'net negative'} cumulative funding since open ($${pos.cum_funding.toFixed(2)})`;
}

async function analyzeCoin(coin) {
  const candles = await getCandles(coin, '1h', 15);
  if (!candles || candles.length < 20) return null;
  const closes = candles.map(c => parseFloat(c.c));
  const highs = candles.map(c => parseFloat(c.h));
  const lows = candles.map(c => parseFloat(c.l));
  const phase = detectPhase(candles);
  const atr = iATR(highs, lows, closes, 14).at(-1) || closes.at(-1) * 0.02;
  const sr = findSR(highs, lows, closes);
  const price = closes.at(-1);
  const direction = phase.score >= 0.12 ? 'LONG' : phase.score <= -0.12 ? 'SHORT' : 'NEUTRAL';
  const setup = calcTradeSetup(direction, price, sr, atr);
  return { coin, price, phase, direction, setup };
}

async function main() {
  const { LLM_ROUTER_URL: routerUrl, TG_TOKEN, TG_CHAT, PRIMARY_WALLET, SIGNAL_COINS, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!routerUrl) throw new Error('LLM_ROUTER_URL not set (Supabase llm-router Edge Function URL)');
  if (!PRIMARY_WALLET) throw new Error('PRIMARY_WALLET not set — this report needs your wallet address to read open positions');

  const watchlist = (SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());

  const [state, regimeInputs] = await Promise.all([
    getClearinghouseState(PRIMARY_WALLET),
    getRegimeInputs().catch(() => ({})),
  ]);
  const positions = parsePositions(state);
  const regime = scoreRegime(regimeInputs);

  const heldCoins = new Set(positions.map(p => p.coin));
  const analyzeTargets = [...new Set([...positions.map(p => p.coin), ...watchlist])];
  const analyses = {};
  for (const coin of analyzeTargets) {
    try { analyses[coin] = await analyzeCoin(coin); } catch (e) { console.warn(`[insight] ${coin} analysis failed:`, e.message); }
  }

  const posLines = positions.map(p => {
    const a = analyses[p.coin];
    const liqPct = pctFromLiq(p);
    const techDirection = a?.direction || 'NEUTRAL';
    const aligned = techDirection === 'NEUTRAL' ? 'no clear technical signal' :
      (techDirection === 'LONG') === (p.side === 'long') ? 'technicals agree with position' : 'technicals conflict with position';
    return [
      `${p.coin} — ${p.side.toUpperCase()} ${p.size} @ entry $${p.entry_price}, mark $${p.mark_price.toFixed(4)}, ` +
      `unrealized PnL $${p.unrealized_pnl.toFixed(2)}, ${p.leverage_value}x ${p.leverage_type}`,
      liqPct != null ? `  Liquidation: $${p.liquidation_price.toFixed(4)} (${liqPct.toFixed(1)}% away from mark)` : '  Liquidation: n/a (no leverage risk)',
      `  Funding: ${fundingDragNote(p)}`,
      a ? `  Technical read: phase=${a.phase.phase} (score ${a.phase.score}, confidence ${a.phase.confidence}) → ${aligned}` : '  Technical read: unavailable (insufficient candle data)',
      a ? `  Signals: ${a.phase.signals.slice(0, 4).join('; ')}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const newSetupLines = watchlist
    .filter(c => !heldCoins.has(c))
    .map(c => analyses[c])
    .filter(a => a && a.direction !== 'NEUTRAL' && Math.abs(a.phase.score) >= 0.3)
    .map(a =>
      `${a.coin} — ${a.direction} bias, phase=${a.phase.phase} (score ${a.phase.score}, confidence ${a.phase.confidence})\n` +
      `  Price $${a.price.toFixed(4)} · Entry $${a.setup.entry.toFixed(4)} · SL $${a.setup.sl.toFixed(4)} · TP1 $${a.setup.tp1.toFixed(4)} · TP2 $${a.setup.tp2.toFixed(4)} · R:R ${a.setup.rr.toFixed(2)}\n` +
      `  Signals: ${a.phase.signals.slice(0, 4).join('; ')}`
    ).join('\n\n');

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
    positions.length ? `OPEN POSITIONS (${positions.length}):\n${posLines}` : 'OPEN POSITIONS: none currently open.',
    '',
    newSetupLines ? `NEW SETUPS (watchlist coins not currently held, real signal only):\n${newSetupLines}` : 'NEW SETUPS: no watchlist coin currently shows a signal strong enough to flag.',
    journalNote ? `\nJOURNAL HISTORY: ${journalNote}` : '',
  ].filter(Boolean).join('\n');

  const userPrompt = `Based on the context below, write today's actionable insight report. Return ONLY a JSON object with this exact shape:\n` +
    `{"headline":"<one line, specific not generic>",` +
    `"position_actions":[{"coin":"<coin, only from OPEN POSITIONS above>","action":"hold|trim|add|tighten_stop|close","reason":"<one sentence, tied to the actual numbers>"}],` +
    `"new_setups":[{"coin":"<coin, only from NEW SETUPS above>","direction":"LONG|SHORT","rationale":"<one sentence>"}],` +
    `"regime_note":"<2-3 sentences on what the macro regime score means for sizing/risk today>",` +
    `"risks":["<specific, data-grounded risk>","<specific, data-grounded risk>"],` +
    `"confidence":"high|medium|low — how well the available data actually supports these calls",` +
    `"takeaway":"<one or two neutral, non-advice sentences>"}\n` +
    `Only include a position in "position_actions" if it appears in OPEN POSITIONS, and only include a coin in "new_setups" if it appears in NEW SETUPS. If OPEN POSITIONS is empty, return an empty array for position_actions. If NEW SETUPS has no coins, return an empty array for new_setups.\n` +
    `No text outside the JSON object.\n\nCONTEXT:\n${context}`;

  const raw = await routedDraft(routerUrl, 'setups', INSIGHT_SYSTEM, userPrompt, 3000);
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
      return `- **${esc(s.coin)} ${esc(s.direction)}**${levels}: ${esc(s.rationale)}`;
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
      position_actions: insight.position_actions || [], new_setups: insight.new_setups || [],
      regime_verdict: regime.verdict, regime_score: regime.normScore,
      regime_note: insight.regime_note, risks: insight.risks || [],
      confidence: insight.confidence || null, takeaway: insight.takeaway,
    },
  });

  console.log(`Daily insight written: insights/${file}`);

  if (TG_TOKEN && TG_CHAT) {
    const actionLines = (insight.position_actions || []).map(a => `• ${a.coin}: ${a.action.toUpperCase()}`).join('\n');
    const setupLines = (insight.new_setups || []).map(s => `• ${s.coin} ${s.direction}`).join('\n');
    await tgSend(TG_TOKEN, TG_CHAT,
      `<b>░▒▓ DAILY INSIGHT ▓▒░</b>\n<b>${esc(insight.headline)}</b>\n` +
      (actionLines ? `\n<b>Positions:</b>\n<pre>${esc(actionLines)}</pre>` : '') +
      (setupLines ? `\n<b>New setups:</b>\n<pre>${esc(setupLines)}</pre>` : '') +
      `\n<i>full report in dashboard → Insight tab</i>`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
