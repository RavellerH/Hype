import {
  getFundingRates, getFearGreed, getHLNews, getHLStats,
  writeEntry, tgSend, extractJSON, routedDraft, _f8, _fmtM, esc,
} from './lib.mjs';

const BRIEF_SYSTEM = `You are a senior Hyperliquid (HYPE) market analyst. Base every claim ONLY on the
facts and numbers given in the context — never invent data, never speculate beyond what the
numbers support. Cross-check the data points against each other (does price action agree with
funding/OI direction? does news sentiment match price action?) and call out contradictions
explicitly. If the data is thin or inconclusive on a point, say so rather than filling the gap
with generic language. Write like a publication-quality analyst note: full sentences with real
transitions between ideas, not a list of disconnected fragments — each paragraph should build on
the last, not just restate the numbers in prose form. Neutral, analytical, critical tone — no
hype-speak, no financial advice, no "DYOR" boilerplate.`;

async function main() {
  const { LLM_ROUTER_URL: routerUrl, TG_TOKEN, TG_CHAT, SIGNAL_COINS } = process.env;
  if (!routerUrl) throw new Error('LLM_ROUTER_URL not set (Supabase llm-router Edge Function URL)');

  const [news, stats, fng, funding] = await Promise.all([
    getHLNews(), getHLStats(), getFearGreed(), getFundingRates(),
  ]);

  const coins = (SIGNAL_COINS || 'BTC,ETH,SOL,HYPE,SUI').split(',').map(c => c.trim());
  const fundingLines = coins
    .filter(c => funding[c])
    .map(c => `${c} funding(8h): ${_f8(funding[c].fundingRate)}  OI: ${_fmtM(funding[c].openInterest * funding[c].markPx)}`);

  const today = new Date().toISOString().slice(0, 10);
  const lines = [`HYPERLIQUID DAILY BRIEF DATA — ${today}`];
  if (stats.hypePx != null)      lines.push(`HYPE price: ${stats.hypePx.toFixed(2)}${stats.hype24h != null ? ` (${stats.hype24h >= 0 ? '+' : ''}${stats.hype24h.toFixed(2)}% 24h)` : ''}`);
  if (stats.hypeFunding != null) lines.push(`HYPE funding (8h): ${_f8(stats.hypeFunding)}`);
  if (stats.hypeOI)              lines.push(`HYPE open interest: ${_fmtM(stats.hypeOI)}`);
  if (stats.hlVolume24h)         lines.push(`Hyperliquid total perp volume 24h: ${_fmtM(stats.hlVolume24h)}`);
  if (stats.evmTvl)              lines.push(`HyperEVM TVL: ${_fmtM(stats.evmTvl)}`);
  if (fng)                       lines.push(`Fear & Greed Index: ${fng.value} (${fng.label})`);
  if (fundingLines.length)       lines.push('', 'FUNDING / OI BY COIN:', ...fundingLines);
  if (news.length)               lines.push('', 'RECENT HEADLINES:', ...news.map(n => `- [${n.age} ago] ${n.title}`));
  const context = lines.join('\n');

  if (!stats.hypePx && !news.length) {
    console.log('No data available — skipping brief.');
    return;
  }

  const userPrompt = `Based on the context below, write a detailed, critical daily brief. Return ONLY a JSON object with this exact shape:\n` +
    `{"headline":"<one line, specific not generic>",` +
    `"market_analysis":"<4-6 sentences: price action, funding, OI and volume read together — cite the actual numbers, note any divergences (e.g. price up but funding falling, OI dropping while price holds), and call out what is actually notable vs noise>",` +
    `"risks":["<specific, data-grounded risk>","<specific, data-grounded risk>","<specific, data-grounded risk>"],` +
    `"opportunities":["<specific, data-grounded opportunity>","<specific, data-grounded opportunity>"],` +
    `"news_summary":"<3-4 sentences critically synthesizing the headlines — not just listing them; note if news sentiment agrees or conflicts with the price/funding data>",` +
    `"confidence":"high|medium|low — how well the available data actually supports this read",` +
    `"takeaway":"<one or two neutral, non-advice sentences>"}\n` +
    `No text outside the JSON object.\n\nCONTEXT:\n${context}`;

  const raw = await routedDraft(routerUrl, 'debrief', BRIEF_SYSTEM, userPrompt, 1400);
  const brief = extractJSON(raw);
  const file = `${today}.md`;

  const md = [
    `# ${brief.headline}`,
    '',
    `*${today} · confidence: ${brief.confidence || 'n/a'}*`,
    '',
    '## Market Analysis',
    brief.market_analysis || '',
    '',
    '## Risks',
    ...(brief.risks || []).map(r => `- ${r}`),
    '',
    '## Opportunities',
    ...(brief.opportunities || []).map(o => `- ${o}`),
    '',
    '## News',
    brief.news_summary || '',
    '',
    '## Takeaway',
    brief.takeaway || '',
    '',
    '<details><summary>Raw data context</summary>\n\n```\n' + context + '\n```\n\n</details>',
  ].join('\n') + '\n';

  await writeEntry({
    dir: 'briefs', file, md,
    indexPath: 'briefs/index.json',
    indexEntry: {
      date: today, file, headline: brief.headline,
      market_analysis: brief.market_analysis, risks: brief.risks || [],
      opportunities: brief.opportunities || [], news_summary: brief.news_summary,
      confidence: brief.confidence || null, takeaway: brief.takeaway,
    },
  });

  console.log(`Daily brief written: briefs/${file}`);

  if (TG_TOKEN && TG_CHAT) {
    await tgSend(TG_TOKEN, TG_CHAT,
      `<b>░▒▓ DAILY BRIEF ▓▒░</b>\n<b>${esc(brief.headline)}</b>\n<pre>${esc(brief.takeaway)}</pre>\n<i>full brief in dashboard → Brief tab</i>`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
