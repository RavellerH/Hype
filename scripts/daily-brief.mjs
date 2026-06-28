import {
  getFundingRates, getFearGreed, getHLNews, getHLStats,
  sbUpsert, tgSend, extractJSON, claudeDraft, _f8, _fmtM, esc,
} from './lib.mjs';

const BRIEF_SYSTEM = 'You are a Hyperliquid (HYPE) market analyst. Use ONLY the facts and numbers given in the context — never invent data. Write neutral, analytical English. No financial advice, no hype-speak, no "DYOR" boilerplate.';

async function main() {
  const { SUPABASE_URL, SUPABASE_KEY, ANTHROPIC_API_KEY, TG_TOKEN, TG_CHAT, SIGNAL_COINS } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY not set');
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

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

  const userPrompt = `Based on the context below, return ONLY a JSON object with this exact shape:\n` +
    `{"headline":"<one line>","onchain_summary":"<2-3 sentences on price/funding/OI/TVL>",` +
    `"risks":["<short risk>","<short risk>","<short risk>"],"opportunities":["<short opportunity>","<short opportunity>"],` +
    `"news_summary":"<2-3 sentences synthesizing the headlines>","takeaway":"<one neutral, non-advice sentence>"}\n` +
    `No text outside the JSON object.\n\nCONTEXT:\n${context}`;

  const raw = await claudeDraft(ANTHROPIC_API_KEY, BRIEF_SYSTEM, userPrompt, 1000);
  const brief = extractJSON(raw);
  const now = Date.now();

  await sbUpsert(SUPABASE_URL, SUPABASE_KEY, 'daily_briefs', [{
    id: `brief-${today}`, date: today, headline: brief.headline,
    onchain_summary: brief.onchain_summary, risks: brief.risks || [],
    opportunities: brief.opportunities || [], news_summary: brief.news_summary,
    takeaway: brief.takeaway, raw_context: context, created_at: now,
  }]);

  const tags = coins.filter(c => context.includes(c));
  await sbUpsert(SUPABASE_URL, SUPABASE_KEY, 'kb_wiki', [{
    id: `kbw-brief-${today}`, created_at: now, updated_at: now,
    title: brief.headline, category: 'brief', summary: brief.takeaway,
    content: `${brief.onchain_summary || ''}\n\nRISKS:\n${(brief.risks || []).map(r => '- ' + r).join('\n')}` +
      `\n\nOPPORTUNITIES:\n${(brief.opportunities || []).map(o => '- ' + o).join('\n')}\n\nNEWS:\n${brief.news_summary || ''}`,
    coins: tags, tags: ['daily-brief'], source: 'daily-brief',
  }]);

  console.log(`Daily brief stored: ${brief.headline}`);

  if (TG_TOKEN && TG_CHAT) {
    await tgSend(TG_TOKEN, TG_CHAT,
      `<b>░▒▓ DAILY BRIEF ▓▒░</b>\n<b>${esc(brief.headline)}</b>\n<pre>${esc(brief.takeaway)}</pre>\n<i>full brief in dashboard → Brief tab</i>`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
