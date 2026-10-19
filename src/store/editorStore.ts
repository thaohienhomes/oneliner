"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createLimiter, type Limiter } from "../../lib/limiter";
import { DEFAULT_ASPECT, MAX_CONCURRENT_RENDERS, RENDER_SIZE, SHOT_COUNT, SHOT_SECONDS, type Aspect } from "../../lib/renderConfig";
import type { Shot } from "../../lib/shot";
import { shotToPrompt } from "../../lib/shotPresets";
import { toastForError } from "./toastStore";

export type Provider = "mock" | "llm";
type Status = "idle" | "loading" | "error";

export type RenderState = "queued" | "rendering" | "done" | "failed";

/** Per-shot render, persisted so a reload resumes polling by job id. */
export type ShotRender = {
  state: RenderState;
  seed: number;
  /** Comfy I2V job id. Once set, the shot is never re-POSTed except via Retry/Re-render. */
  jobId?: string;
  frameJobId?: string;
  /** 0..1 when Comfy reports it. */
  progress?: number;
  queuePosition?: number;
  /** ms epoch: POST sent / terminal state reached. */
  startedAt?: number;
  finishedAt?: number;
  /** Re-hosted clip URL (Blob or /renders/...), never the short-lived Comfy signed URL. */
  clipUrl?: string;
  error?: string;
};

export type EditorData = {
  logline: string;
  aspect: Aspect;
  title: string;
  tagline: string;
  shots: Shot[];
  provider: Provider | null;
  /** LLM model id that wrote the list, or "mock". Optional: older persisted state lacks it. */
  model?: string | null;
  renders: Record<string, ShotRender>;
};

type EditorState = EditorData & {
  status: Status;
  error: string | null;
  /** Shot ids whose action text is being rewritten. Not persisted. */
  regenerating: Record<string, boolean>;

  setLogline: (v: string) => void;
  setAspect: (v: Aspect) => void;
  setTitle: (v: string) => void;
  setTagline: (v: string) => void;
  updateShot: (id: string, patch: Partial<Omit<Shot, "id">>) => void;
  addShot: () => void;
  deleteShot: (id: string) => void;
  moveShot: (from: number, to: number) => void;
  generate: () => Promise<void>;
  regenerateShot: (id: string) => Promise<void>;
  /** Start every shot that has never been rendered; resume polling for in-flight ones. */
  renderTrailer: () => void;
  /** After rehydration: poll persisted job ids (zero POSTs). */
  resumeRenders: () => void;
  /** Failed shot: new job, same seed. */
  retryShot: (id: string) => void;
  /** Any shot: new job, same or new seed. */
  reRenderShot: (id: string, opts?: { newSeed?: boolean }) => void;
  reset: () => void;
};

export const INITIAL_DATA: EditorData = {
  logline: "",
  aspect: DEFAULT_ASPECT,
  title: "",
  tagline: "",
  shots: [],
  provider: null,
  model: null,
  renders: {},
};

/** Overridable in tests. */
export const renderTuning = { pollMs: 4000, maxPollErrors: 5 };

/* Render runtime (not persisted): one limiter per page, one current task token per shot. */
let limiter: Limiter = createLimiter(MAX_CONCURRENT_RENDERS);
const tokens = new Map<string, number>();
const running = new Set<string>();

/** Test helper: drop in-flight tasks and start a fresh limiter. */
export function resetRenderRuntime() {
  limiter = createLimiter(MAX_CONCURRENT_RENDERS);
  tokens.clear();
  running.clear();
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

type JobStatusResponse = { status: string; progress?: number; queuePosition?: number; error?: string };

export const STORAGE_KEY = "oneliner-editor";

const newId = () => `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** API error with our server's error code (e.g. "daily_limit", "insufficient_credits"). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("Couldn't reach the studio. Check your connection and retry.", "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.message ?? `Request failed (${res.status})`, data?.error, res.status);
  return data as T;
}

const postJson = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Toast the errors a user should notice even when the shot card is off-screen. */
const toastIfNeeded = (err: unknown) => {
  if (err instanceof ApiError) toastForError(err.code, err.message);
};

// Track how many times each shot was regenerated so the mock returns a new line each click.
const regenCount = new Map<string, number>();

const getJson = <T,>(url: string) => request<T>(url);

export const useEditor = create<EditorState>()(
  persist(
    (set, get) => {
      const patchRender = (id: string, patch: Partial<ShotRender>) =>
        set((s) => (s.renders[id] ? { renders: { ...s.renders, [id]: { ...s.renders[id], ...patch } } } : s));

      /** One shot: POST (only if it has no job id yet), then poll to a terminal state and re-host. */
      const runShot = async (id: string, token: number) => {
        const current = () => tokens.get(id) === token && !!get().renders[id];
        if (!current()) return;

        if (!get().renders[id].jobId) {
          const shot = get().shots.find((x) => x.id === id);
          if (!shot) return;
          const { aspect } = get();
          patchRender(id, { state: "queued", startedAt: Date.now(), finishedAt: undefined, error: undefined });
          try {
            const res = await postJson<{ videoJobId: string; frameJobId: string }>("/api/shot", {
              prompt: shotToPrompt(shot),
              seed: get().renders[id].seed,
              aspect,
              ...RENDER_SIZE[aspect],
              seconds: shot.seconds,
              shotIndex: get().shots.findIndex((x) => x.id === id),
            });
            if (!current()) return; // superseded by Retry/Re-render or deleted while submitting
            patchRender(id, { jobId: res.videoJobId, frameJobId: res.frameJobId });
          } catch (err) {
            if (current()) {
              patchRender(id, { state: "failed", error: errMsg(err), finishedAt: Date.now() });
              toastIfNeeded(err);
            }
            return;
          }
        }

        const jobId = get().renders[id].jobId!;
        let errors = 0;
        while (current()) {
          let st: JobStatusResponse;
          try {
            st = await getJson<JobStatusResponse>(`/api/shot/${encodeURIComponent(jobId)}`);
            errors = 0;
          } catch (err) {
            if (++errors >= renderTuning.maxPollErrors) {
              if (current()) {
                patchRender(id, { state: "failed", error: `Lost track of job: ${errMsg(err)}`, finishedAt: Date.now() });
                toastIfNeeded(err);
              }
              return;
            }
            await sleep(renderTuning.pollMs);
            continue;
          }
          if (!current()) return;

          if (st.status === "succeeded") {
            try {
              const { url } = await postJson<{ url: string }>(`/api/shot/${encodeURIComponent(jobId)}/rehost`, {});
              if (current()) patchRender(id, { state: "done", clipUrl: url, progress: 1, finishedAt: Date.now() });
            } catch (err) {
              if (current()) {
                patchRender(id, { state: "failed", error: `Rendered, but saving the clip failed: ${errMsg(err)}`, finishedAt: Date.now() });
                toastIfNeeded(err);
              }
            }
            return;
          }
          if (st.status === "failed" || st.status === "canceled" || st.status === "expired") {
            patchRender(id, { state: "failed", error: st.error ?? `Job ${st.status}`, finishedAt: Date.now() });
            return;
          }
          patchRender(id, {
            state: st.status === "queued" ? "queued" : "rendering",
            progress: typeof st.progress === "number" ? st.progress : undefined,
            queuePosition: st.queuePosition,
          });
          await sleep(renderTuning.pollMs);
        }
      };

      /** Queue a (new) task for a shot; supersedes any older task for the same shot. */
      const enqueue = (id: string) => {
        const token = (tokens.get(id) ?? 0) + 1;
        tokens.set(id, token);
        running.add(id);
        void limiter
          .run(() => runShot(id, token))
          .catch((err) => patchRender(id, { state: "failed", error: errMsg(err), finishedAt: Date.now() }))
          .finally(() => {
            if (tokens.get(id) === token) running.delete(id);
          });
      };

      const restart = (id: string, seed: number) => {
        set((s) => ({ renders: { ...s.renders, [id]: { state: "queued", seed } } }));
        enqueue(id);
      };

      return {
      ...INITIAL_DATA,
      ...INITIAL_DATA,
      status: "idle",
      error: null,
      regenerating: {},

      setLogline: (logline) => set({ logline }),
      setAspect: (aspect) => set({ aspect }),
      setTitle: (title) => set({ title }),
      setTagline: (tagline) => set({ tagline }),

      updateShot: (id, patch) => set((s) => ({ shots: s.shots.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

      addShot: () =>
        set((s) => {
          if (s.shots.length >= SHOT_COUNT.max) return s;
          const shot: Shot = {
            id: newId(),
            shotType: "medium",
            lens: "35mm",
            cameraMove: "static",
            mood: "",
            action: "Describe what happens in this shot.",
            seconds: SHOT_SECONDS.min,
          };
          return { shots: [...s.shots, shot] };
        }),

      deleteShot: (id) =>
        set((s) => {
          tokens.delete(id);
          running.delete(id);
          const renders = { ...s.renders };
          delete renders[id];
          return { shots: s.shots.filter((x) => x.id !== id), renders };
        }),

      moveShot: (from, to) =>
        set((s) => {
          if (from === to || from < 0 || to < 0 || from >= s.shots.length || to >= s.shots.length) return s;
          const shots = [...s.shots];
          const [moved] = shots.splice(from, 1);
          shots.splice(to, 0, moved);
          return { shots };
        }),

      generate: async () => {
        const { logline, aspect } = get();
        if (logline.trim().length < 3) {
          set({ status: "error", error: "Write a one-sentence logline first." });
          return;
        }
        set({ status: "loading", error: null });
        try {
          const data = await postJson<{ title: string; tagline: string; shots: Shot[]; provider: Provider; model?: string }>(
            "/api/shotlist",
            { logline, aspect },
          );
          // New shot ids: old renders belong to the previous list (their tasks stop on their own).
          set({
            title: data.title,
            tagline: data.tagline,
            shots: data.shots,
            provider: data.provider,
            model: data.model ?? null,
            status: "idle",
            renders: {},
          });
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : String(err) });
          toastIfNeeded(err);
        }
      },

      regenerateShot: async (id) => {
        const { shots, logline } = get();
        const index = shots.findIndex((x) => x.id === id);
        if (index < 0) return;
        const variant = (regenCount.get(id) ?? 0) + 1;
        regenCount.set(id, variant);
        set((s) => ({ regenerating: { ...s.regenerating, [id]: true }, error: null }));
        try {
          const shot = shots[index];
          const data = await postJson<{ action: string; provider: Provider }>("/api/shotlist/regenerate", {
            logline: logline.trim().length >= 3 ? logline : shot.action,
            index,
            variant,
            shot: { shotType: shot.shotType, lens: shot.lens, cameraMove: shot.cameraMove, mood: shot.mood, action: shot.action },
          });
          get().updateShot(id, { action: data.action });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        } finally {
          set((s) => ({ regenerating: { ...s.regenerating, [id]: false } }));
        }
      },

      renderTrailer: () => {
        const { shots, renders } = get();
        for (const shot of shots) {
          const r = renders[shot.id];
          if (!r) restart(shot.id, newSeed());
          // Has a job id and isn't finished: poll it, never re-POST.
          else if (r.jobId && (r.state === "queued" || r.state === "rendering") && !running.has(shot.id)) enqueue(shot.id);
          // done / failed / already running: leave alone (Retry / Re-render are explicit).
        }
      },

      resumeRenders: () => {
        for (const [id, r] of Object.entries(get().renders)) {
          if (r.state !== "queued" && r.state !== "rendering") continue;
          if (running.has(id)) continue;
          if (r.jobId) enqueue(id);
          else
            // The page went away before /api/shot answered; don't silently spend credits again.
            patchRender(id, { state: "failed", error: "Interrupted before the job was submitted. Click Retry.", finishedAt: Date.now() });
        }
      },

      retryShot: (id) => {
        const r = get().renders[id];
        if (!get().shots.some((x) => x.id === id)) return;
        restart(id, r?.seed ?? newSeed());
      },

      reRenderShot: (id, opts) => {
        const r = get().renders[id];
        if (!get().shots.some((x) => x.id === id)) return;
        restart(id, opts?.newSeed || !r ? newSeed() : r.seed);
      },

      reset: () => {
        resetRenderRuntime();
        set({ ...INITIAL_DATA, status: "idle", error: null, regenerating: {} });
      },
      };
    },
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): EditorData => ({
        logline: s.logline,
        aspect: s.aspect,
        title: s.title,
        tagline: s.tagline,
        shots: s.shots,
        provider: s.provider,
        model: s.model,
        renders: s.renders,
      }),
      // Rehydrate on the client after mount (see Editor) to avoid SSR hydration mismatches.
      skipHydration: true,
    },
  ),
);
