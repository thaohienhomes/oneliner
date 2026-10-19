/**
 * Minimal OpenAI-compatible Chat Completions client with model fallback.
 * Server-only. Defaults to Groq; every value can be overridden from env:
 *   LLM_BASE_URL        (default https://api.groq.com/openai/v1)
 *   LLM_MODEL           (default openai/gpt-oss-120b)
 *   LLM_FALLBACK_MODEL  (default qwen/qwen3.8-27b; set to "none" to disable)
 *   LLM_API_KEY         (or GROQ_API_KEY)
 *
 * Each model gets one request plus at most one "repair" request if the reply
 * isn't valid JSON for the schema, all inside a ~20s budget. Uses JSON mode
 * (response_format json_object, supported by every Groq chat model) and still
 * strips <think> blocks / code fences before zod validation.
 */
import { z } from "zod";

export const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_FALLBACK_MODEL = "qwen/qwen3.8-27b";
export const MODEL_BUDGET_MS = 20_000;

export type LlmConfig = { baseURL: string; apiKey: string; models: string[] };
export type Attempt = { model: string; ok: boolean; ms: number; repaired?: boolean; error?: string };

export function llmApiKey() {
  return (process.env.LLM_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim()) ?? "";
}

export function llmConfig(): LlmConfig | null {
  const apiKey = llmApiKey();
  if (!apiKey) return null;
  const primary = process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
  const fallbackEnv = process.env.LLM_FALLBACK_MODEL?.trim();
  const fallback = fallbackEnv === "none" ? "" : fallbackEnv || DEFAULT_FALLBACK_MODEL;
  return {
    baseURL: (process.env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    models: fallback && fallback !== primary ? [primary, fallback] : [primary],
  };
}

/** Thrown when every model failed; the caller decides whether to fall back to the mock. */
export class LlmUnavailableError extends Error {
  constructor(readonly attempts: Attempt[]) {
    super(`All LLM models failed: ${attempts.map((a) => `${a.model}: ${a.error}`).join(" | ")}`);
    this.name = "LlmUnavailableError";
  }
}

/** Pull the JSON object out of a reply: drops <think> blocks, code fences, and surrounding prose. */
export function extractJson(raw: string): unknown {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

type Message = { role: "system" | "user" | "assistant"; content: string };

/** Model-specific knobs. gpt-oss is a reasoning model: keep reasoning short so we stay inside the budget. */
function modelParams(model: string): Record<string, unknown> {
  if (/gpt-oss/i.test(model)) return { reasoning_effort: "low" };
  return {};
}

class InvalidReply extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

async function complete(cfg: LlmConfig, model: string, messages: Message[], temperature: number, deadline: number): Promise<string> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("timeout");
  let res: Response;
  try {
    res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        ...modelParams(model),
      }),
      signal: AbortSignal.timeout(remaining),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "timeout" : `network: ${err instanceof Error ? err.message : err}`);
  }
  const body = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null } }[];
    error?: { message?: string; code?: string; failed_generation?: string };
  } | null;
  if (!res.ok) {
    // Groq rejects JSON-mode replies that don't parse, but hands back the text: repairable.
    if (body?.error?.code === "json_validate_failed") throw new InvalidReply("json_validate_failed", body.error.failed_generation ?? "");
    throw new Error(`HTTP ${res.status}${body?.error?.message ? `: ${body.error.message.slice(0, 200)}` : ""}`);
  }
  return body?.choices?.[0]?.message?.content ?? "";
}

function validate<T>(schema: z.ZodType<T>, raw: string): T {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    throw new InvalidReply("reply is not valid JSON", raw);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new InvalidReply(z.prettifyError(parsed.error).slice(0, 600), raw);
  return parsed.data;
}

/**
 * Ask each configured model in turn for JSON matching `schema`.
 * Resolves with the first valid result; throws LlmUnavailableError if all fail.
 */
export async function chatJson<T>(opts: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
  config?: LlmConfig;
}): Promise<{ data: T; model: string; attempts: Attempt[] }> {
  const cfg = opts.config ?? llmConfig();
  if (!cfg) throw new LlmUnavailableError([]);
  const temperature = opts.temperature ?? 0.8;
  const attempts: Attempt[] = [];
  const messages: Message[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.prompt },
  ];

  for (const model of cfg.models) {
    const t0 = Date.now();
    const deadline = t0 + MODEL_BUDGET_MS;
    let repaired = false;
    try {
      let data: T;
      try {
        data = validate(opts.schema, await complete(cfg, model, messages, temperature, deadline));
      } catch (err) {
        if (!(err instanceof InvalidReply)) throw err;
        // One repair attempt: show the model its reply and what was wrong.
        repaired = true;
        const repair: Message[] = [
          ...messages,
          { role: "assistant", content: err.raw.slice(0, 4000) || "(empty)" },
          { role: "user", content: `That reply was invalid: ${err.message}\nReturn the corrected JSON object only.` },
        ];
        data = validate(opts.schema, await complete(cfg, model, repair, temperature, deadline));
      }
      attempts.push({ model, ok: true, ms: Date.now() - t0, repaired });
      return { data, model, attempts };
    } catch (err) {
      attempts.push({ model, ok: false, ms: Date.now() - t0, repaired, error: err instanceof Error ? err.message : String(err) });
    }
  }
  throw new LlmUnavailableError(attempts);
}
