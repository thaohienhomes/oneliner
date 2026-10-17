"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_ASPECT, SHOT_COUNT, SHOT_SECONDS, type Aspect } from "../../lib/renderConfig";
import type { Shot } from "../../lib/shot";

export type Provider = "mock" | "llm";
type Status = "idle" | "loading" | "error";

export type EditorData = {
  logline: string;
  aspect: Aspect;
  title: string;
  tagline: string;
  shots: Shot[];
  provider: Provider | null;
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
  reset: () => void;
};

export const INITIAL_DATA: EditorData = {
  logline: "",
  aspect: DEFAULT_ASPECT,
  title: "",
  tagline: "",
  shots: [],
  provider: null,
};

export const STORAGE_KEY = "oneliner-editor";

const newId = () => `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

// Track how many times each shot was regenerated so the mock returns a new line each click.
const regenCount = new Map<string, number>();

export const useEditor = create<EditorState>()(
  persist(
    (set, get) => ({
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

      deleteShot: (id) => set((s) => ({ shots: s.shots.filter((x) => x.id !== id) })),

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
          const data = await postJson<{ title: string; tagline: string; shots: Shot[]; provider: Provider }>("/api/shotlist", {
            logline,
            aspect,
          });
          set({ title: data.title, tagline: data.tagline, shots: data.shots, provider: data.provider, status: "idle" });
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : String(err) });
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

      reset: () => set({ ...INITIAL_DATA, status: "idle", error: null, regenerating: {} }),
    }),
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
      }),
      // Rehydrate on the client after mount (see Editor) to avoid SSR hydration mismatches.
      skipHydration: true,
    },
  ),
);
