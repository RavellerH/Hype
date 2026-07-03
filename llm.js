/**
 * Unified LLM caller — routes through the Supabase llm-router Edge Function.
 *
 * Task → provider chain:
 *   Tier 1 (lesson · veto · news · tag · summary)
 *     Groq 8B → Gemini Flash → OpenRouter → Claude Haiku
 *   Tier 2 (synthesis · setups · debrief · weekly_review · chat)
 *     Gemini Pro → Claude Sonnet → OpenRouter → Groq 70B
 *
 * Setup: set hype_edge_fn_url in localStorage to your Supabase claude-proxy URL.
 *   The router URL is derived automatically by replacing the last path segment.
 *   e.g. .../functions/v1/claude-proxy → .../functions/v1/llm-router
 *
 * Usage:
 *   const text = await _callLLM('lesson', 'What lesson does this trade teach?');
 *   const text = await _callLLM('chat', userMsg, { history: _chatMsgs, maxTokens: 1024 });
 */

/**
 * Base URL for the app's own /api/* endpoints (Vercel serverless).
 * Empty string on the Vercel deployment itself (relative fetch works);
 * on GitHub Pages the user sets their Vercel URL once in
 * Settings → App Backend URL (key shared with dailybrief.js/research.js).
 */
function _apiBase() {
  return (localStorage.getItem('hype_trigger_backend_url') || '').trim().replace(/\/$/, '');
}

function _llmRouterUrl() {
  const base = (localStorage.getItem('hype_edge_fn_url') || '').trim().replace(/\/$/, '');
  if (!base) return null;
  return base.replace(/\/[^/]+$/, '/llm-router');
}

async function _callLLM(task, prompt, { system = null, maxTokens = 512, history = [] } = {}) {
  const url = _llmRouterUrl();
  if (!url) {
    console.warn('[LLM] hype_edge_fn_url not set — skipping AI call');
    return null;
  }

  const messages = [...history, { role: 'user', content: String(prompt) }];
  const body = { task, messages, max_tokens: maxTokens };
  if (system) body.system = system;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) {
      console.warn(`[LLM] ${task} failed (${r.status}):`, d.error, d.details);
      return null;
    }
    console.debug(`[LLM] ${task} → ${d.provider}/${d.model}`);
    return d.text || null;
  } catch (e) {
    console.warn('[LLM] fetch error:', e.message);
    return null;
  }
}
