// Vercel serverless function: Anthropic API proxy
// Supports modes: chat (default), trade-analyze, wiki-generate, wiki-enhance
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const body = req.body || {};
  const mode = body.mode || 'chat';

  try {
    // ── trade-analyze ────────────────────────────────────────
    if (mode === 'trade-analyze') {
      const { trade } = body;
      if (!trade) return res.status(400).json({ error: 'trade object required' });
      const prompt = buildTradeAnalysisPrompt(trade);
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: `You are a trading coach analyzing a crypto trade journal entry.
Return ONLY valid JSON with this exact structure:
{
  "assessment": "2-3 sentence assessment of what happened and what can be learned",
  "wiki_entry": {
    "title": "concise lesson title (max 8 words)",
    "category": "lesson",
    "summary": "one sentence summary of the lesson",
    "content": "3-4 paragraph wiki entry covering: what happened, the lesson, what to watch for next time, and how to apply it",
    "tags": ["tag1", "tag2"],
    "coins": ["BTC"]
  }
}`,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content[0]?.text || '{}';
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return res.json(json);
    }

    // ── wiki-generate ────────────────────────────────────────
    if (mode === 'wiki-generate') {
      const { title, category, coins, tags } = body;
      if (!title) return res.status(400).json({ error: 'title required' });
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: `You are building a crypto trading knowledge base wiki. Generate a thorough wiki entry.
Return ONLY valid JSON:
{
  "title": "exact title as given",
  "summary": "one sentence summary",
  "content": "3-5 paragraphs of trading knowledge: what it is, when to use it, what to watch for, common mistakes, and real examples"
}`,
        messages: [{
          role: 'user',
          content: `Generate a wiki entry for: "${title}" (category: ${category || 'lesson'}, coins: ${coins || 'general'}, tags: ${tags || ''})`
        }],
      });
      const text = response.content[0]?.text || '{}';
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return res.json(json);
    }

    // ── wiki-enhance ─────────────────────────────────────────
    if (mode === 'wiki-enhance') {
      const { title, category, content } = body;
      if (!title) return res.status(400).json({ error: 'title required' });
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: `You are enhancing a trading knowledge base entry. Make it deeper, more specific, add real examples and actionable rules.
Return ONLY valid JSON:
{
  "summary": "improved one sentence summary",
  "content": "enhanced content, 4-6 paragraphs with more depth, specific setups, and actionable rules"
}`,
        messages: [{
          role: 'user',
          content: `Enhance this wiki entry:\nTitle: ${title}\nCategory: ${category || 'lesson'}\n\n${content || '(no content yet)'}`
        }],
      });
      const text = response.content[0]?.text || '{}';
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return res.json(json);
    }

    // ── default: regular chat ─────────────────────────────────
    const { system, messages } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: system || '',
      messages,
    });
    return res.json({ content: response.content[0]?.text || '' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function buildTradeAnalysisPrompt(t) {
  return `Trade Journal Entry:
Coin: ${t.coin} | Direction: ${t.direction} | Status: CLOSED
Entry: $${t.entry_price} | Exit: $${t.exit_price} | PnL: ${t.pnl_pct != null ? t.pnl_pct.toFixed(1) : '?'}% ($${t.pnl_usd != null ? t.pnl_usd.toFixed(0) : '?'})
Size: $${t.size_usd || 'unknown'} | Timeframe: ${t.timeframe || 'not specified'}

ENTRY REASONING:
Setup/Pattern: ${t.setup || 'not recorded'}
Thesis: ${t.thesis || 'not recorded'}
Invalidation scenario: ${t.invalidation || 'not recorded'}
Conviction: ${t.conviction || 'not recorded'}/5
Expected timeline: ${t.expected_tf || 'not recorded'}

EXIT REVIEW:
Thesis correct: ${t.thesis_correct || 'not recorded'}
What happened: ${t.exit_review || 'not recorded'}
Mistakes: ${t.mistakes || 'none recorded'}
Key lesson: ${t.lessons || 'not recorded'}

Analyze this trade and extract the most valuable lesson for the knowledge base.`;
}
