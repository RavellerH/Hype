export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { prompt, key } = req.body || {};
  const apiKey = key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey)  return res.status(400).json({ error: 'No API key provided' });
  if (!prompt)  return res.status(400).json({ error: 'No prompt provided' });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return res.status(resp.status).json({ error: err.error?.message || `Anthropic ${resp.status}` });
  }

  const data = await resp.json();
  return res.json({ text: data.content?.[0]?.text || '' });
}
