/**
 * Prompt 5 DONE TEST (store + UI, no network): concurrency cap, resume after
 * reload with zero POSTs, Retry = exactly one new POST.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLimiter } from "../lib/limiter";
import { RENDER_SIZE } from "../lib/renderConfig";
import type { Shot } from "../lib/shot";
import { Editor } from "../src/components/Editor";
import { INITIAL_DATA, STORAGE_KEY, renderTuning, resetRenderRuntime, useEditor, type ShotRender } from "../src/store/editorStore";

const shot = (i: number): Shot => ({
  id: `s${i}`,
  shotType: "wide",
  lens: "35mm",
  cameraMove: "static",
  mood: "tense",
  action: `Shot number ${i} happens.`,
  seconds: 2,
});

type Call = { method: string; url: string; body?: Record<string, unknown> };

/**
 * Fake /api/shot backend. Each job reports "running" for `runningPolls` GETs,
 * then "succeeded" (or `failJobs` -> "failed"). Tracks jobs in flight.
 */
function fakeApi(opts: { runningPolls?: number; failJobs?: Set<string> } = {}) {
  const calls: Call[] = [];
  const polls = new Map<string, number>();
  let seq = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const live = new Set<string>();

  const json = (status: number, data: unknown) => ({ ok: status < 400, status, json: async () => data });

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    await new Promise((r) => setTimeout(r, 1));

    if (method === "POST" && url === "/api/shot") {
      const id = `job-${++seq}`;
      live.add(id);
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      return json(200, { frameJobId: `frame-${seq}`, videoJobId: id });
    }
    const rehost = url.match(/^\/api\/shot\/([^/]+)\/rehost$/);
    if (method === "POST" && rehost) return json(200, { url: `/renders/${rehost[1]}.mp4`, storage: "local" });

    const get = url.match(/^\/api\/shot\/([^/]+)$/);
    if (method === "GET" && get) {
      const id = decodeURIComponent(get[1]);
      const n = (polls.get(id) ?? 0) + 1;
      polls.set(id, n);
      if (n <= (opts.runningPolls ?? 2)) return json(200, { jobId: id, status: "running", progress: n / 4 });
      if (live.delete(id)) inFlight--;
      return opts.failJobs?.has(id)
        ? json(200, { jobId: id, status: "failed", error: "boom" })
        : json(200, { jobId: id, status: "succeeded" });
    }
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    calls,
    posts: () => calls.filter((c) => c.method === "POST" && c.url === "/api/shot"),
    gets: () => calls.filter((c) => c.method === "GET"),
    maxInFlight: () => maxInFlight,
  };
}

const allSettled = () =>
  waitFor(() => {
    const rs = Object.values(useEditor.getState().renders);
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.every((r) => r.state === "done" || r.state === "failed")).toBe(true);
  });

beforeEach(() => {
  renderTuning.pollMs = 5;
  resetRenderRuntime();
  localStorage.clear();
  useEditor.setState({ ...INITIAL_DATA, status: "idle", error: null, regenerating: {} });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  renderTuning.pollMs = 4000;
});

describe("createLimiter", () => {
  it("never runs more than 3 tasks at once and runs all of them in order", async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        limit.run(async () => {
          started.push(i);
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 2 + (i % 3) * 3));
          active--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(results).toEqual([...Array(10).keys()]);
    expect(started).toEqual([...Array(10).keys()]);
  });

  it("frees the slot when a task throws", async () => {
    const limit = createLimiter(1);
    await expect(limit.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(limit.run(async () => 7)).resolves.toBe(7);
    expect(limit.active).toBe(0);
  });
});

describe("render trailer (store)", () => {
  it("renders 5 shots with at most 3 jobs in flight, a seed each, aspect size, and re-hosted clips", async () => {
    const api = fakeApi({ runningPolls: 3 });
    useEditor.setState({ shots: [1, 2, 3, 4, 5].map(shot), aspect: "9:16" });

    useEditor.getState().renderTrailer();
    await allSettled();

    expect(api.posts()).toHaveLength(5);
    expect(api.maxInFlight()).toBe(3);
    const seeds = new Set(api.posts().map((c) => c.body!.seed));
    expect(seeds.size).toBe(5);
    for (const c of api.posts()) {
      expect(c.body).toMatchObject({ aspect: "9:16", ...RENDER_SIZE["9:16"], seconds: 2 });
      expect(typeof c.body!.prompt).toBe("string");
    }
    const renders = useEditor.getState().renders;
    for (const r of Object.values(renders)) {
      expect(r.state).toBe("done");
      expect(r.clipUrl).toMatch(/^\/renders\/job-\d+\.mp4$/);
      expect(r.finishedAt! - r.startedAt!).toBeGreaterThanOrEqual(0);
    }

    // Clicking again does nothing: every shot already has a job id.
    useEditor.getState().renderTrailer();
    await new Promise((r) => setTimeout(r, 30));
    expect(api.posts()).toHaveLength(5);
  });

  it("a rehydrated store with job ids resumes polling and makes zero POSTs", async () => {
    const api = fakeApi({ runningPolls: 2 });
    const renders: Record<string, ShotRender> = {
      s1: { state: "rendering", seed: 11, jobId: "job-a", startedAt: Date.now() - 5000 },
      s2: { state: "queued", seed: 22, jobId: "job-b", startedAt: Date.now() - 4000 },
      s3: { state: "done", seed: 33, jobId: "job-c", clipUrl: "/renders/job-c.mp4" },
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { ...INITIAL_DATA, logline: "x", shots: [1, 2, 3].map(shot), renders }, version: 1 }),
    );

    await useEditor.persist.rehydrate();
    expect(useEditor.getState().renders.s1.jobId).toBe("job-a");
    useEditor.getState().resumeRenders();
    await allSettled();

    expect(api.posts()).toHaveLength(0);
    const polled = new Set(api.gets().map((c) => c.url));
    expect(polled).toEqual(new Set(["/api/shot/job-a", "/api/shot/job-b"]));
    const r = useEditor.getState().renders;
    expect(r.s1).toMatchObject({ state: "done", seed: 11, clipUrl: "/renders/job-a.mp4" });
    expect(r.s2).toMatchObject({ state: "done", seed: 22, clipUrl: "/renders/job-b.mp4" });
    expect(r.s3.clipUrl).toBe("/renders/job-c.mp4");

    // Render trailer after resume must not POST either.
    useEditor.getState().renderTrailer();
    await new Promise((r) => setTimeout(r, 30));
    expect(api.posts()).toHaveLength(0);
  });

  it("an in-flight POST lost to a reload is marked failed, not re-POSTed", async () => {
    const api = fakeApi();
    useEditor.setState({ shots: [shot(1)], renders: { s1: { state: "queued", seed: 5, startedAt: Date.now() } } });
    useEditor.getState().resumeRenders();
    expect(useEditor.getState().renders.s1.state).toBe("failed");
    expect(api.posts()).toHaveLength(0);
  });

  it("Re-render with a new seed POSTs once with a different seed", async () => {
    const api = fakeApi({ runningPolls: 0 });
    useEditor.setState({ shots: [shot(1)], renders: { s1: { state: "done", seed: 5, jobId: "old", clipUrl: "/renders/old.mp4" } } });
    useEditor.getState().reRenderShot("s1", { newSeed: true });
    await allSettled();
    expect(api.posts()).toHaveLength(1);
    expect(api.posts()[0].body!.seed).not.toBe(5);
    useEditor.getState().reRenderShot("s1");
    await waitFor(() => expect(api.posts()).toHaveLength(2));
    expect(api.posts()[1].body!.seed).toBe(api.posts()[0].body!.seed);
  });
});

describe("render panel (UI)", () => {
  it("a failed card shows Retry; clicking it creates exactly one new POST with the same seed", async () => {
    const api = fakeApi({ runningPolls: 1 });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          ...INITIAL_DATA,
          logline: "x",
          shots: [shot(1), shot(2)],
          renders: {
            s1: { state: "failed", seed: 77, jobId: "job-dead", error: "boom", startedAt: 1, finishedAt: 2 },
            s2: { state: "done", seed: 88, jobId: "job-ok", clipUrl: "/renders/job-ok.mp4" },
          },
        },
        version: 1,
      }),
    );
    await act(async () => {
      render(<Editor />);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry shot 1" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Retry shot 2" })).toBeNull();
    expect(screen.getByLabelText("Shot 2 clip").getAttribute("src")).toBe("/renders/job-ok.mp4");
    expect(api.posts()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Retry shot 1" }));
    await waitFor(() => expect(screen.getByLabelText("Shot 1 clip")).toBeTruthy());

    expect(api.posts()).toHaveLength(1);
    expect(api.posts()[0].body!.seed).toBe(77);
    expect(screen.getByLabelText("Shot 1 render state").textContent).toContain("Done");
    // Job ids are persisted for reload-resume.
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(saved.state.renders.s1).toMatchObject({ state: "done", jobId: "job-1", seed: 77 });
  });
});
