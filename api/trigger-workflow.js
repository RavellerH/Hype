// Vercel serverless function: triggers a GitHub Actions workflow_dispatch
// run. The GitHub PAT lives only in the GH_PAT server environment variable
// (set in Vercel project settings) — it never reaches the browser, so the
// Daily Brief / Weekly Research "Generate Now" buttons can't leak it.

const ALLOWED_WORKFLOWS = new Set(['daily-brief.yml', 'weekly-research.yml', 'insights.yml']);
const GH_OWNER = 'RavellerH';
const GH_REPO = 'Hype';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GH_PAT) {
    return res.status(500).json({ error: 'GH_PAT not configured on the server' });
  }

  const { workflow, ref } = req.body || {};
  if (!ALLOWED_WORKFLOWS.has(workflow)) {
    return res.status(400).json({ error: `workflow must be one of: ${[...ALLOWED_WORKFLOWS].join(', ')}` });
  }

  try {
    const r = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GH_PAT}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: ref || 'gh-pages' }),
      }
    );
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: `GitHub ${r.status}: ${text}` });
    }
    return res.status(204).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
