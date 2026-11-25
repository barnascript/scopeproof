import { DraftPlan, LIMITS, type BriefLine } from "../../shared/plan";
import type { DraftResult } from "./index";

// Talks to any chat API that speaks the OpenAI format (OpenAI, Groq,
// OpenRouter, a local vLLM). The model only ever proposes. Its answer goes
// through the zod schema here and through the plan checks afterwards, and a
// person still has to approve every story.

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function modelConfigFromEnv(env = process.env): ModelConfig | null {
  if (!env.AI_API_KEY || !env.AI_MODEL) return null;
  return {
    apiKey: env.AI_API_KEY,
    baseUrl: (env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    model: env.AI_MODEL,
  };
}

const SYSTEM = `You turn a product brief into user stories for a small dev team.
Reply with JSON only, in this shape:
{"stories":[{"key":"S1","title":"...","description":"...","acceptance":["..."],"estimate_hours":6,"depends_on":["S2"],"brief_lines":[3]}]}
Rules:
- Every story must list the brief line numbers it comes from in brief_lines. Do not add features the brief does not ask for.
- Every brief line that states a requirement needs at least one story.
- 1 to 5 acceptance criteria per story. Each one must be testable: use numbers, not words like "fast" or "easy".
- estimate_hours is for one senior developer, between ${LIMITS.minHours} and ${LIMITS.maxHours}. Split anything bigger than ${LIMITS.splitAbove}.
- depends_on only lists keys from your own answer. No loops.`;

export async function draftWithModel(lines: BriefLine[], cfg: ModelConfig): Promise<DraftResult> {
  const numbered = lines.map((l) => `${l.n}: ${l.text}`).join("\n");
  const messages: { role: string; content: string }[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Brief (line number: text):\n${numbered}` },
  ];
  const started = Date.now();
  const rejected: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await callModel(messages, cfg);
    const problem = parse(text);
    if (problem.ok) {
      return {
        plan: problem.plan,
        source: "model",
        meta: { model: cfg.model, attempts: attempt, ms: Date.now() - started, rejected },
      };
    }
    // Give the model one chance to fix its own answer, with the exact errors.
    rejected.push(problem.error);
    messages.push({ role: "assistant", content: text });
    messages.push({ role: "user", content: `Your JSON failed validation:\n${problem.error}\nSend the full corrected JSON only.` });
  }
  throw new DraftError(`The model answer failed validation twice: ${rejected.at(-1)}`, { model: cfg.model, rejected });
}

function parse(text: string): { ok: true; plan: DraftPlan } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  const r = DraftPlan.safeParse(json);
  if (r.success) return { ok: true, plan: r.data };
  const error = r.error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("\n");
  return { ok: false, error };
}

async function callModel(messages: { role: string; content: string }[], cfg: ModelConfig): Promise<string> {
  const doFetch = cfg.fetch ?? fetch;
  const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 60_000),
  });
  if (!res.ok) {
    // Never echo the provider body back to the browser; it can include account details.
    throw new DraftError(`The model API answered ${res.status}.`, { status: res.status });
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new DraftError("The model API sent an empty answer.", {});
  return content;
}

export class DraftError extends Error {
  constructor(
    message: string,
    public detail: Record<string, unknown>,
  ) {
    super(message);
  }
}
