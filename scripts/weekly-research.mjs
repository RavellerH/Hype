import { readIndex, writeEntry, tgSend, extractJSON, routedDraft, isoWeek, esc } from './lib.mjs';

const BRIEF_SYSTEM = `You are a senior Hyperliquid (HYPE) market analyst. Base every claim ONLY on the
facts given in the context — never invent data, never speculate beyond what it supports. Look
across the days for trend, not just a list of daily snapshots: is the read getting more bullish,
more bearish, or just noisy? Call out contradictions between days explicitly. If the week's data
is thin or inconclusive on a point, say so. Write like a publication-quality weekly research
note: full sentences with real transitions, a narrative arc across the week, not a list of
disconnected fragments. Neutral, analytical, critical tone — no hype-speak, no financial advice,
no "DYOR" boilerplate.`;

async function main() {
  const { LLM_ROUTER_URL: routerUrl, TG_TOKEN, TG_CHAT } = process.env;
  if (!routerUrl) throw new Error('LLM_ROUTER_URL not set (Supabase llm-router Edge Function URL)');

  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const all = await readIndex('briefs/index.json');
  const rows = all.filter(r => r.date >= since).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) {
    console.log('No daily briefs in the last 7 days — skipping weekly research.');
    return;
  }

  const context = rows.map(r =>
    `### ${r.date} — ${r.headline}\n${r.market_analysis || ''}\n` +
    `Risks: ${(r.risks || []).join('; ')}\nOpportunities: ${(r.opportunities || []).join('; ')}\n` +
    `Confidence: ${r.confidence || 'n/a'}\nTakeaway: ${r.takeaway || ''}`
  ).join('\n\n');

  const userPrompt = `Based on a week of daily Hyperliquid briefs below, write a detailed, critical weekly research report. Return ONLY a JSON object with this exact shape:\n` +
    `{"title":"<one line, specific not generic>",` +
    `"summary":"<3-4 sentence executive summary>",` +
    `"market_structure":"<3-5 sentences: how price/funding/OI evolved across the week, citing specific days where the read changed>",` +
    `"onchain_trends":"<3-5 sentences: TVL/volume/OI trend across the week>",` +
    `"risks":["<specific risk, reference which day(s) it showed up>","<risk>","<risk>"],` +
    `"opportunities":["<specific opportunity>","<opportunity>"],` +
    `"confidence":"high|medium|low — how well the week's data supports this read",` +
    `"outlook":"<2-3 sentence forward-looking, non-financial-advice outlook>"}\n` +
    `No text outside the JSON object.\n\nWEEK CONTEXT:\n${context}`;

  const raw = await routedDraft(routerUrl, 'weekly_review', BRIEF_SYSTEM, userPrompt, 3600);
  const report = extractJSON(raw);
  const weekId = isoWeek(new Date());
  const file = `${weekId}.md`;

  const md = [
    `# ${report.title}`,
    '',
    `*${rows[0].date} → ${rows[rows.length - 1].date} · confidence: ${report.confidence || 'n/a'}*`,
    '',
    '## Summary',
    report.summary || '',
    '',
    '## Market Structure',
    report.market_structure || '',
    '',
    '## On-chain Trends',
    report.onchain_trends || '',
    '',
    '## Risks',
    ...(report.risks || []).map(r => `- ${r}`),
    '',
    '## Opportunities',
    ...(report.opportunities || []).map(o => `- ${o}`),
    '',
    '## Outlook',
    report.outlook || '',
  ].join('\n') + '\n';

  await writeEntry({
    dir: 'research', file, md,
    indexPath: 'research/index.json',
    indexEntry: {
      week: weekId, file, week_start: rows[0].date, week_end: rows[rows.length - 1].date,
      title: report.title, summary: report.summary, market_structure: report.market_structure,
      onchain_trends: report.onchain_trends, risks: report.risks || [],
      opportunities: report.opportunities || [], confidence: report.confidence || null,
      outlook: report.outlook,
    },
    maxEntries: 52,
  });

  console.log(`Weekly research written: research/${file}`);

  if (TG_TOKEN && TG_CHAT) {
    await tgSend(TG_TOKEN, TG_CHAT,
      `<b>░▒▓ WEEKLY RESEARCH ▓▒░</b>\n<b>${esc(report.title)}</b>\n<pre>${esc(report.summary)}</pre>\n<i>full report in dashboard → Research tab</i>`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
