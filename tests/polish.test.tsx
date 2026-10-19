/**
 * Prompt 8 UI: friendly toasts (daily limit / 401 / out of credits / timeout),
 * Enter to generate, film-slate loading, empty state, How-it-was-made.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Shot } from "../lib/shot";
import { DAILY_LIMIT_MESSAGE } from "../lib/quota";
import { Editor } from "../src/components/Editor";
import { INITIAL_DATA, renderTuning, resetRenderRuntime, useEditor } from "../src/store/editorStore";
import { useToasts } from "../src/store/toastStore";

const shot = (i: number): Shot => ({ id: `s${i}`, shotType: "wide", lens: "35mm", cameraMove: "static", mood: "tense", action: `Shot ${i}.`, seconds: 2 });
const json = (status: number, data: unknown) => ({ ok: status < 400, status, json: async () => data });

beforeEach(() => {
  renderTuning.pollMs = 5;
  resetRenderRuntime();
  localStorage.clear();
  useEditor.setState({ ...INITIAL_DATA, status: "idle", error: null, regenerating: {} });
  useToasts.setState({ toasts: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  renderTuning.pollMs = 4000;
});

describe("toasts", () => {
  it("daily limit: shots 3-4 refused, one friendly toast, inline message on the shot", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && url === "/api/shot") {
          n++;
          return n <= 2 ? json(200, { videoJobId: `job-${n}`, frameJobId: "f" }) : json(429, { error: "daily_limit", message: DAILY_LIMIT_MESSAGE });
        }
        if (url.endsWith("/rehost")) return json(200, { url: "/renders/x.mp4" });
        return json(200, { status: "succeeded" });
      }),
    );
    useEditor.setState({ shots: [1, 2, 3, 4].map(shot), title: "T", tagline: "t" });
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Render trailer" }));
    await screen.findByText("Daily budget reached");
    await waitFor(() => expect(Object.values(useEditor.getState().renders).filter((r) => r.state === "failed")).toHaveLength(2));
    expect(useToasts.getState().toasts).toHaveLength(1);
    expect(screen.getAllByText(DAILY_LIMIT_MESSAGE).length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["unauthorized", 401, "Comfy key rejected"],
    ["insufficient_credits", 402, "Out of Comfy credits"],
    ["timeout", 504, "Comfy timed out"],
  ])("%s -> toast", async (code, status, title) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(status, { error: code, message: "friendly text" })));
    useEditor.setState({ shots: [shot(1)] });
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Render trailer" }));
    await screen.findByText(title);
  });

  it("network failure -> toast, no raw error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    useEditor.setState({ shots: [shot(1)] });
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Render trailer" }));
    await screen.findByText("Connection problem");
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  });
});

describe("editor polish", () => {
  it("Enter in the logline generates; film slate shows while writing", async () => {
    let release!: () => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(json(200, { title: "T", tagline: "t", shots: [1, 2, 3, 4].map(shot), provider: "mock" }));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Editor />);
    const input = screen.getByLabelText(/one sentence/i);
    fireEvent.change(input, { target: { value: "A robot opens a noodle shop" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("status", { name: "Writing your shot list" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/shotlist", expect.objectContaining({ method: "POST" }));
    release();
    await waitFor(() => expect(useEditor.getState().shots).toHaveLength(4));
  });

  it("empty state offers example loglines; How it was made lists the stack", () => {
    render(<Editor />);
    expect(screen.getByRole("region", { name: "Examples" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "How it was made" })).toBeTruthy();
    for (const name of ["Comfy SDK", "Comfy Cloud", "LTX-2.3", "LLM (Groq, open model)", "ffmpeg.wasm"])
      expect(screen.getByText(name, { exact: true })).toBeTruthy();
  });
});
