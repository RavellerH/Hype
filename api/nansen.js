const NANSEN_BASE = 'https://api.nansen.ai/api/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = req.query.key || process.env.NANSEN_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'No API key' });

  const chains = ['ethereum', 'solana', 'base', 'arbitrum', 'optimism', 'bnb', 'hyperevm'];
  const headers = { 'Content-Type': 'application/json', 'apikey': apiKey };

  const [netflowRes, holdingsRes] = await Promise.allSettled([
    fetch(`${NANSEN_BASE}/smart-money/netflow`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chains, pagination: { page: 1, per_page: 100 } })
    }),
    fetch(`${NANSEN_BASE}/smart-money/holdings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chains })
    })
  ]);

  let netflows = [], holdings = null;

  if (netflowRes.status === 'fulfilled' && netflowRes.value.ok) {
    netflows = await netflowRes.value.json();
  } else {
    const status = netflowRes.status === 'fulfilled' ? netflowRes.value.status : 0;
    if (status === 401 || status === 403) {
      return res.status(401).json({ error: 'Invalid Nansen API key' });
    }
  }

  if (holdingsRes.status === 'fulfilled' && holdingsRes.value.ok) {
    holdings = await holdingsRes.value.json();
  }

  return res.json({ netflows, holdings, fetched_at: Date.now() });
}
