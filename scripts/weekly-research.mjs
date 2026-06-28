import { sbSelect, sbUpsert, tgSend, extractJSON, claudeDraft, isoWeek, esc } from './lib.mjs';

const BRIEF_SYSTEM = 'You are a Hyperliquid (HYPE) market analyst. Use ONLY the facts and numbers given in the context — never invent data. Write neutral, analytical English. No financial advice, no hype-speak, no "DYOR" boilerplate.';

async function main() {
  const { SUPABASE_URL, SUPABASE_KEY, ANTHROPIC_API_KEY, TG_TOKEN, TG_CHAT } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY not set');
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const rows = await sbSelect(SUPABASE_URL, SUPABASE_KEY, 'daily_briefs', `select=*&date=gte.${since}&order=date.asc`);
  if (!rows.length) {
    console.log('No daily briefs in the last 7 days — skipping weekly research.');
    return;
  }

  const context = rows.map(r =>
    `### ${r.date} — ${r.headline}\n${r.onchain_summary || ''}\n` +
    `Risks: ${(r.risks || []).join('; ')}\nOpportunities: ${(r.opportunities || []).join('; ')}\nTakeaway: ${r.takeaway || ''}`
  ).join('\n\n');

  const userPrompt = `Based on a week of daily Hyperliquid briefs below, write a weekly research report. Return ONLY a JSON object with this exact shape:\n` +
    `{"title":"<one line>","summary":"<3-4 sentence executive summary>","market_structure":"<2-4 sentences>",` +
    `"onchain_trends":"<2-4 sentences>","risks":["<risk>","<risk>","<risk>"],"opportunities":["<opportunity>","<opportunity>"],` +
    `"outlook":"<2-3 sentence forward-looking, non-financial-advice outlook>"}\n` +
    `No text outside the JSON object.\n\nWEEK CONTEXT:\n${context}`;

  const raw = await claudeDraft(ANTHROPIC_API_KEY, BRIEF_SYSTEM, userPrompt, 1400);
  const report = extractJSON(raw);
  const now = Date.now();
  const weekId = isoWeek(new Date());

  await sbUpsert(SUPABASE_URL, SUPABASE_KEY, 'weekly_research', [{
    id: `wr-${weekId}`, week_start: rows[0].date, week_end: rows[rows.length - 1].date,
    title: report.title, summary: report.summary,
    market_structure: report.market_structure, onchain_trends: report.onchain_trends,
    risks: report.risks || [], opportunities: report.opportunities || [],
    outlook: report.outlook, created_at: now,
  }]);

  console.log(`Weekly research stored: ${report.title}`);

  if (TG_TOKEN && TG_CHAT) {
    await tgSend(TG_TOKEN, TG_CHAT,
      `<b>░▒▓ WEEKLY RESEARCH ▓▒░</b>\n<b>${esc(report.title)}</b>\n<pre>${esc(report.summary)}</pre>\n<i>full report in dashboard → Research tab</i>`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
