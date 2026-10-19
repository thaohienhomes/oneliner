// @vitest-environment node
/**
 * Prompt 8 DONE TEST (route level): DAILY_RENDER_LIMIT=2, DEMO_MODE off, a
 * 4-shot trailer posted to POST /api/shot from one IP. Comfy is intercepted
 * (lib/renderShot mocked) so no credits are spent; the 3rd shot must be
 * refused with the friendly message BEFORE any Comfy call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const comfy = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("../lib/renderShot", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/renderShot")>();
  return {
    ...real,
    renderFirstFrame: vi.fn(async () => {
      comfy.calls.push("t2i");
      return `frame-${comfy.calls.length}`;
    }),
    getFirstFrame: vi.fn(async (id: string) => {
      comfy.calls.push("wait-frame");
      return { jobId: id, assetId: `asset-${id}`, url: "https://example.test/f.png", expiresAt: null, output: {} };
    }),
    renderShot: vi.fn(async () => {
      comfy.calls.push("i2v");
      return `video-${comfy.calls.length}`;
    }),
  };
});

import { POST as shotPOST } from "../src/app/api/shot/route";
import { GET as statusGET } from "../src/app/api/shot/[jobId]/route";
import { DAILY_LIMIT_MESSAGE, memoryCounterStore, setCounterStore } from "../lib/quota";
import { mockShotList } from "../lib/shotList";
import { shotToPrompt } from "../lib/shotPresets";
import { toPublicError } from "../lib/renderShot";
import { RENDER_SIZE } from "../lib/renderConfig";

const post = (body: unknown, ip = "203.0.113.7") =>
  shotPOST(
    new Request("http://localhost/api/shot", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );

const shots = mockShotList("A retired robot opens a noodle shop on Mars", "16:9").shots.slice(0, 4);
const shotBody = (i: number) => ({
  prompt: shotToPrompt(shots[i]),
  seed: 100 + i,
  aspect: "16:9",
  ...RENDER_SIZE["16:9"],
  seconds: shots[i].seconds,
  shotIndex: i,
});

beforeEach(() => {
  comfy.calls.length = 0;
  setCounterStore(memoryCounterStore());
  vi.stubEnv("DAILY_RENDER_LIMIT", "2");
  vi.stubEnv("GLOBAL_DAILY_SHOTS", "300");
  vi.stubEnv("DEMO_MODE", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("cost guard: per-IP daily limit", () => {
  it("renders shots 1-2, refuses shot 3 (and 4) before any Comfy call", async () => {
    const log: { shot: number; status: number; comfyCallsAfter: number; message?: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const before = comfy.calls.length;
      const res = await post(shotBody(i));
      const data = await res.json();
      log.push({ shot: i + 1, status: res.status, comfyCallsAfter: comfy.calls.length, message: data.message });
      if (i >= 2) expect(comfy.calls.length).toBe(before); // refused before Comfy
    }
    console.log("DONE TEST log:", JSON.stringify(log));
    expect(log.map((l) => l.status)).toEqual([200, 200, 429, 429]);
    expect(log[2].message).toBe(DAILY_LIMIT_MESSAGE);
    expect(log[3].message).toBe(DAILY_LIMIT_MESSAGE);
    // 2 shots x (T2I submit + wait + I2V submit), nothing for shots 3-4.
    expect(comfy.calls).toEqual(["t2i", "wait-frame", "i2v", "t2i", "wait-frame", "i2v"]);
  });

  it("counts per IP: another IP still has budget", async () => {
    await post(shotBody(0));
    await post(shotBody(1));
    expect((await post(shotBody(2))).status).toBe(429);
    expect((await post(shotBody(2), "198.51.100.9")).status).toBe(200);
  });

  it("enforces the global daily cap too", async () => {
    vi.stubEnv("DAILY_RENDER_LIMIT", "100");
    vi.stubEnv("GLOBAL_DAILY_SHOTS", "3");
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await post(shotBody(i % 4), `10.0.0.${i}`)).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(comfy.calls.filter((c) => c === "t2i")).toHaveLength(3);
  });
});

describe("server validation rejects (no Comfy, no budget used)", () => {
  it.each([
    ["5s shot", { seconds: 5 }],
    ["fractional seconds", { seconds: 2.5 }],
    ["1s shot", { seconds: 1 }],
    ["7th shot", { shotIndex: 6 }],
    ["oversized width", { width: 1024 }],
    ["too many pixels", { width: 768, height: 768 }],
    ["prompt too long", { prompt: "x".repeat(1201) }],
    ["empty prompt", { prompt: "   " }],
    ["unknown aspect", { aspect: "4:3" }],
  ])("%s", async (_name, patch) => {
    const res = await post({ ...shotBody(0), ...patch });
    expect(res.status).toBe(400);
    expect(comfy.calls).toHaveLength(0);
  });

  it("blocks non-PG-13 prompts", async () => {
    const res = await post({ ...shotBody(0), prompt: "A nude scene on the beach" });
    expect(res.status).toBe(422);
    expect(comfy.calls).toHaveLength(0);
  });

  it("validation failures don't consume the daily budget", async () => {
    for (let i = 0; i < 5; i++) await post({ ...shotBody(0), seconds: 9 });
    expect((await post(shotBody(0))).status).toBe(200);
  });
});

describe("DEMO_MODE", () => {
  it("plays sample clips without calling Comfy or using budget", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.useFakeTimers({ now: new Date("2026-10-19T12:00:00Z") });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await post(shotBody(i));
      expect(res.status).toBe(200);
      ids.push((await res.json()).videoJobId);
    }
    expect(comfy.calls).toHaveLength(0);
    const st = async (id: string) => (await statusGET(new Request("http://x"), { params: Promise.resolve({ jobId: id }) })).json();
    expect((await st(ids[0])).status).toBe("running");
    vi.advanceTimersByTime(6000);
    const done = await st(ids[0]);
    expect(done.status).toBe("succeeded");
    expect(done.outputUrl).toMatch(/^\/samples\/sample-\d\.mp4$/);
  });
});

describe("public errors", () => {
  it("never leak raw messages or stacks", () => {
    const e = toPublicError(new Error("ECONNRESET at Socket.read (node:net:123)\n    at stack"), "test");
    expect(e.status).toBe(500);
    expect(e.body.message).not.toMatch(/ECONNRESET|node:net|at /);
  });
});
