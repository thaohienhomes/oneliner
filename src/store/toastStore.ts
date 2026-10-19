"use client";

import { create } from "zustand";

export type Toast = { id: number; kind: "error" | "info"; title: string; message: string };

type ToastState = {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;
const TTL_MS = 7000;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (t) => {
    // Several shots failing for the same reason -> one toast.
    if (get().toasts.some((x) => x.title === t.title && x.message === t.message)) return;
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), TTL_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Error codes from our API that deserve a toast (besides the inline shot error). */
const TOAST_TITLES: Record<string, string> = {
  unauthorized: "Comfy key rejected",
  missing_credentials: "Studio offline",
  insufficient_credits: "Out of Comfy credits",
  timeout: "Comfy timed out",
  daily_limit: "Daily budget reached",
  budget_unavailable: "Studio busy",
  network: "Connection problem",
};

export function toastForError(code: string | undefined, message: string) {
  const title = code ? TOAST_TITLES[code] : undefined;
  if (title) useToasts.getState().push({ kind: "error", title, message });
}
