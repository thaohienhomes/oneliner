// @vitest-environment node
/** Real-LLM path with a stubbed fetch: no network in `npm test`. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BASE_URL, DEFAULT_FALLBACK_MODEL, DEFAULT_MODEL, extractJson, llmConfig } from "../lib/llm";
import { ShotListSchema } from "../lib/shot";
import { activeProvider, generateShotList, regenerateShotAction } from "../lib/shotList";

const shot = (action: string, seconds: number | string = 3) => ({
  shotType: "Wide",
  lens: "35mm",
  cameraMove: "dolly in",
  mood: "tense, quiet",
  action,
  seconds,
});
const GOOD = {
  title: "The Vault Job",
  tagline: "Nobody planned for the cat.",
  shots: [shot("A crew of misfits creeps into a marble lobby."), shot("A safe door swings open.", "2"), shot("Alarms flare red."), shot("The crew sprints out laughing.", 4)],
};

type Reply = { status?: number; body: unknown } | Error;
const ok = (content: string): Reply => ({ body: { choices: [{ message: { content } }] } });

function stubFetch(...replies: Reply[]) {
  const calls: { model: string; messages: { role: string; content: string }[]; response_format: unknown }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const r = replies.shift();
    if (!r) throw new Error("unexpected fetch");
    if (r instanceof Error) throw r;
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

// The system prompt names Batman as an example of what NOT to use; check only what the user side sends.
const userText = (call: { messages: { role: string; content: string }[] }) =>
  call.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

beforeEach(() => {
  vi.stubEnv("LLM_MOCK", "");
  vi.stubEnv("LLM_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "gsk-test");
  vi.stubEnv("LLM_BASE_URL", "");
  vi.stubEnv("LLM_MODEL", "");
  vi.stubEnv("LLM_FALLBACK_MODEL", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("config", () => {
  it("defaults to Groq with gpt-oss-120b -> qwen fallback, key from GROQ_API_KEY", () => {
    expect(activeProvider()).toBe("llm");
    expect(llmConfig()).toEqual({ baseURL: DEFAULT_BASE_URL, apiKey: "gsk-test", models: [DEFAULT_MODEL, DEFAULT_FALLBACK_MODEL] });
  });
  it("LLM_* overrides; LLM_FALLBACK_MODEL=none disables the fallback", () => {
    vi.stubEnv("LLM_API_KEY", "sk-other");
    vi.stubEnv("LLM_BASE_URL", "https://example.test/v1/");
    vi.stubEnv("LLM_MODEL", "m1");
    vi.stubEnv("LLM_FALLBACK_MODEL", "none");
    expect(llmConfig()).toEqual({ baseURL: "https://example.test/v1", apiKey: "sk-other", models: ["m1"] });
  });
  it("LLM_MOCK=1 wins over a key", () => {
    vi.stubEnv("LLM_MOCK", "1");
    expect(activeProvider()).toBe("mock");
  });
});

describe("extractJson", () => {
  it("strips <think> blocks, code fences and prose", () => {
    expect(extractJson('<think>hmm {no}</think>Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here: {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
  });
});

describe("generateShotList (LLM)", () => {
  it("uses the primary model with JSON mode and normalizes the reply", async () => {
    const { calls } = stubFetch(ok(JSON.stringify(GOOD)));
    const out = await generateShotList("A crew of misfits robs a vault", "16:9");
    expect(out).toMatchObject({ provider: "llm", model: DEFAULT_MODEL });
    expect(out.fallback).toBeUndefined();
    expect(ShotListSchema.safeParse(out).success).toBe(true);
    expect(out.shots[0].shotType).toBe("wide");
    expect(out.shots[1].seconds).toBe(2);
    expect(calls[0]).toMatchObject({ model: DEFAULT_MODEL, response_format: { type: "json_object" } });
  });

  it("repairs invalid JSON once on the same model", async () => {
    const { calls } = stubFetch(ok("{not json"), ok(JSON.stringify(GOOD)));
    const out = await generateShotList("A crew of misfits robs a vault", "16:9");
    expect(out.model).toBe(DEFAULT_MODEL);
    expect(calls).toHaveLength(2);
    expect(calls[1].model).toBe(DEFAULT_MODEL);
    expect(calls[1].messages.at(-1)?.content).toMatch(/invalid/);
  });

  it("repairs Groq json_validate_failed using failed_generation", async () => {
    const { calls } = stubFetch(
      { status: 400, body: { error: { code: "json_validate_failed", message: "bad", failed_generation: '{"title": ' } } },
      ok(JSON.stringify(GOOD)),
    );
    expect((await generateShotList("A crew robs a vault", "16:9")).provider).toBe("llm");
    expect(calls[1].messages.find((m) => m.role === "assistant")?.content).toBe('{"title": ');
  });

  it("falls back to the second model on HTTP error or timeout", async () => {
    const { calls } = stubFetch({ status: 503, body: { error: { message: "over capacity" } } }, ok(JSON.stringify(GOOD)));
    expect((await generateShotList("A crew robs a vault", "16:9")).model).toBe(DEFAULT_FALLBACK_MODEL);
    expect(calls.map((c) => c.model)).toEqual([DEFAULT_MODEL, DEFAULT_FALLBACK_MODEL]);

    stubFetch(Object.assign(new Error("timed out"), { name: "TimeoutError" }), ok(JSON.stringify(GOOD)));
    expect((await generateShotList("A crew robs a vault", "16:9")).model).toBe(DEFAULT_FALLBACK_MODEL);
  });

  it("falls back to the mock when both models fail (including a failed repair)", async () => {
    const attempts: unknown[] = [];
    stubFetch(ok("nope"), ok("still nope"), { status: 500, body: {} });
    const out = await generateShotList("A crew robs a vault", "16:9", { onAttempts: (a) => attempts.push(...a) });
    expect(out).toMatchObject({ provider: "mock", model: "mock", fallback: true });
    expect(ShotListSchema.safeParse(out).success).toBe(true);
    expect(attempts).toHaveLength(2);
  });

  it("keeps the IP guard: model never sees 'Batman', and leaked names are replaced", async () => {
    const leaky = { ...GOOD, title: "Batman Begins Again", shots: [shot("Batman leaps across Gotham rooftops."), ...GOOD.shots.slice(1)] };
    const { calls } = stubFetch(ok(JSON.stringify(leaky)));
    const out = await generateShotList("Batman opens a bakery in Gotham", "16:9");
    expect(out.provider).toBe("llm");
    expect(out.title).toBe("The Nightwarden Begins Again");
    expect(userText(calls[0])).not.toMatch(/batman|gotham/i);
    expect(calls[0].messages[0].content).toMatch(/ORIGINAL CHARACTERS ONLY/);
    expect(JSON.stringify({ t: out.title, g: out.tagline, s: out.shots })).not.toMatch(/batman|gotham/i);
    expect(out.replacements.map((r) => r.from)).toContain("Batman");
  });
});

describe("regenerateShotAction (LLM)", () => {
  const input = {
    logline: "Batman opens a bakery",
    index: 1,
    shot: { shotType: "wide", lens: "35mm", cameraMove: "static", mood: "calm", action: "Batman kneads dough." },
  } as const;

  it("guards the prompt and the reply", async () => {
    const { calls } = stubFetch(ok('{"action": "Batman flips a tray of buns."}'));
    const out = await regenerateShotAction(input);
    expect(out).toMatchObject({ provider: "llm", model: DEFAULT_MODEL });
    expect(out.action).not.toMatch(/batman/i);
    expect(userText(calls[0])).not.toMatch(/batman/i);
  });

  it("falls back to the mock when both models fail", async () => {
    stubFetch(new Error("ECONNRESET"), new Error("ECONNRESET"));
    const out = await regenerateShotAction(input);
    expect(out).toMatchObject({ provider: "mock", model: "mock", fallback: true });
    expect(out.action).not.toMatch(/batman/i);
  });
});
