/**
 * llm-router — Supabase Edge Function
 *
 * Unified LLM gateway with automatic provider failover and task-based tiering.
 *
 * Task tiers:
 *   Tier 1 (fast / free): lesson · veto · news · tag · summary
 *   Tier 2 (quality):     synthesis · setups · debrief · weekly_review · chat
 *
 * Provider chains (tries each in order, skips on 429 / 5xx):
 *   Tier 1: Groq 8B → Gemini Flash → OpenRouter auto → Claude Haiku
 *   Tier 2: Gemini Pro → Claude Sonnet → OpenRouter auto → Groq 70B
 *
 * Required Edge Function secrets (Supabase Dashboard → Settings → Edge Functions):
 *   ANTHROPIC_API_KEY
 *   GEMINI_API_KEY
 *   GROQ_API_KEY
 *   OPENROUTER_API_KEY
 *
 * Request body:
 *   { task, messages: [{role, content}], system?, max_tokens? }
 *
 * Response:
 *   { text, provider, model }   — success
 *   { error, details[] }        — all providers exhausted
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TIER1_TASKS = new Set(["lesson", "veto", "news", "tag", "summary"]);

type Chain =
  | "groq-8b"
  | "groq-70b"
  | "gemini-flash"
  | "gemini-pro"
  | "openrouter"
  | "claude-haiku"
  | "claude-sonnet";

const TIER1_CHAIN: Chain[] = [
  "groq-8b",
  "gemini-flash",
  "openrouter",
  "claude-haiku",
];
const TIER2_CHAIN: Chain[] = [
  "gemini-pro",
  "claude-sonnet",
  "openrouter",
  "groq-70b",
];

interface Msg {
  role: string;
  content: string;
}

// ── Groq (OpenAI-compatible) ──────────────────────────────────────────────────
async function callGroq(
  model: string,
  messages: Msg[],
  system: string | null,
  maxTokens: number,
): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw err("GROQ_API_KEY not set", 503);

  const msgs = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages: msgs, max_tokens: maxTokens }),
  });

  if (!r.ok) throw err(await r.text(), r.status);
  const d = await r.json();
  return d.choices?.[0]?.message?.content ?? "";
}

// ── Gemini ────────────────────────────────────────────────────────────────────
async function callGemini(
  model: string,
  messages: Msg[],
  system: string | null,
  maxTokens: number,
): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw err("GEMINI_API_KEY not set", 503);

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!r.ok) throw err(await r.text(), r.status);
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ── OpenRouter (OpenAI-compatible, auto picks cheapest) ───────────────────────
async function callOpenRouter(
  messages: Msg[],
  system: string | null,
  maxTokens: number,
): Promise<string> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw err("OPENROUTER_API_KEY not set", 503);

  const msgs = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ravellerh.github.io/Hype",
      "X-Title": "Hype Dashboard",
    },
    body: JSON.stringify({
      model: "openrouter/auto", // auto selects cheapest available
      messages: msgs,
      max_tokens: maxTokens,
    }),
  });

  if (!r.ok) throw err(await r.text(), r.status);
  const d = await r.json();
  return d.choices?.[0]?.message?.content ?? "";
}

// ── Anthropic (Claude) ────────────────────────────────────────────────────────
async function callClaude(
  model: string,
  messages: Msg[],
  system: string | null,
  maxTokens: number,
): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw err("ANTHROPIC_API_KEY not set", 503);

  const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens };
  if (system) body.system = system;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) throw err(await r.text(), r.status);
  const d = await r.json();
  return d.content?.[0]?.text ?? "";
}

// ── Error helper ──────────────────────────────────────────────────────────────
function err(msg: string, status: number): Error {
  return Object.assign(new Error(msg.slice(0, 200)), { status });
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const {
      task = "chat",
      messages,
      system = null,
      max_tokens = 512,
    } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "messages array required" }, 400);
    }

    const chain: Chain[] = TIER1_TASKS.has(task) ? TIER1_CHAIN : TIER2_CHAIN;
    const errors: string[] = [];

    for (const provider of chain) {
      try {
        let text = "";
        let model = "";

        switch (provider) {
          case "groq-8b":
            model = "llama-3.1-8b-instant";
            text = await callGroq(model, messages, system, max_tokens);
            break;
          case "groq-70b":
            model = "llama3-70b-8192";
            text = await callGroq(model, messages, system, max_tokens);
            break;
          case "gemini-flash":
            model = "gemini-1.5-flash";
            text = await callGemini(model, messages, system, max_tokens);
            break;
          case "gemini-pro":
            model = "gemini-1.5-pro";
            text = await callGemini(model, messages, system, max_tokens);
            break;
          case "openrouter":
            model = "openrouter/auto";
            text = await callOpenRouter(messages, system, max_tokens);
            break;
          case "claude-haiku":
            model = "claude-haiku-4-5-20251001";
            text = await callClaude(model, messages, system, max_tokens);
            break;
          case "claude-sonnet":
            model = "claude-sonnet-4-6";
            text = await callClaude(model, messages, system, max_tokens);
            break;
        }

        if (text.trim()) {
          return json({ text, provider, model });
        }

        // Empty response — treat as soft failure and continue
        errors.push(`${provider}: empty response`);
      } catch (e) {
        const status = (e as { status?: number }).status ?? 500;
        errors.push(`${provider}: [${status}] ${(e as Error).message}`);

        // Only retry on rate-limit (429), server error (5xx), or missing key (503)
        if (status !== 429 && status < 500) {
          // Hard error (4xx except 429) — stop trying this provider type
          continue;
        }
      }
    }

    return json({ error: "All providers exhausted", details: errors }, 503);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
