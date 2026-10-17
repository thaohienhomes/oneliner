// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardIP } from "../lib/ipGuard";
import { MAX_TOTAL_SECONDS } from "../lib/renderConfig";
import { ShotListSchema, shotToPrompt, totalSeconds } from "../lib/shot";
import { activeProvider, finalizeDraft, generateShotList, mockShotList } from "../lib/shotList";

afterEach(() => vi.unstubAllEnvs());

describe("provider selection", () => {
  it("uses mock when LLM_API_KEY is empty", () => {
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("LLM_MOCK", "");
    expect(activeProvider()).toBe("mock");
  });
  it("uses mock when LLM_MOCK=1 even with a key", () => {
    vi.stubEnv("LLM_API_KEY", "sk-test");
    vi.stubEnv("LLM_MOCK", "1");
    expect(activeProvider()).toBe("mock");
  });
  it("uses llm when a key is set and LLM_MOCK is off", () => {
    vi.stubEnv("LLM_API_KEY", "sk-test");
    vi.stubEnv("LLM_MOCK", "");
    expect(activeProvider()).toBe("llm");
  });
});

describe("mock shot list", () => {
  it("is schema-valid, deterministic, whole seconds, <= 13s", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    const a = await generateShotList("A retired robot opens a noodle shop on Mars", "16:9");
    const b = await generateShotList("A retired robot opens a noodle shop on Mars", "16:9");
    expect(a.provider).toBe("mock");
    expect(ShotListSchema.safeParse(a).success).toBe(true);
    expect(a.shots).toHaveLength(5);
    expect(a.shots.every((s) => Number.isInteger(s.seconds))).toBe(true);
    expect(totalSeconds(a.shots)).toBeLessThanOrEqual(MAX_TOTAL_SECONDS);
    expect(b).toEqual(a);
  });

  it("replaces Batman with an original character", () => {
    const list = mockShotList("Batman opens a bakery in Gotham", "9:16");
    const text = JSON.stringify(list.shots) + list.title + list.tagline;
    expect(text).not.toMatch(/batman|gotham/i);
    expect(text).toMatch(/Nightwarden/);
    expect(list.replacements.map((r) => r.from)).toContain("Batman");
  });
});

describe("finalizeDraft", () => {
  it("trims an over-budget draft to 13s and clamps seconds", () => {
    const shot = { shotType: "wide", lens: "35mm", cameraMove: "static", mood: "calm", action: "A door opens.", seconds: 4 } as const;
    const out = finalizeDraft({ title: "T", tagline: "L", shots: Array(6).fill(shot) });
    expect(totalSeconds(out.shots)).toBeLessThanOrEqual(MAX_TOTAL_SECONDS);
    expect(out.shots.every((s) => s.seconds >= 2 && s.seconds <= 4)).toBe(true);
  });
});

describe("guardIP / shotToPrompt", () => {
  it("leaves clean text untouched", () => {
    expect(guardIP("vast, lonely, quiet")).toEqual({ text: "vast, lonely, quiet", replacements: [] });
  });
  it("builds a cinematic prompt from all shot fields", () => {
    const p = shotToPrompt({ shotType: "close-up", lens: "85mm", cameraMove: "crane up", mood: "hopeful", action: "A robot smiles" });
    expect(p).toMatch(/^Close-up, 85mm portrait lens/);
    expect(p).toContain("cranes up");
    expect(p).toContain("A robot smiles.");
    expect(p).toContain("Mood: hopeful.");
    expect(p).toContain("Lighting:");
  });
});
