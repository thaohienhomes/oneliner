"use client";

import { useToasts } from "../store/toastStore";

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div aria-live="assertive" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-amber-400/30 bg-[#14110c]/95 px-4 py-3 shadow-2xl backdrop-blur"
        >
          <span aria-hidden className="mt-0.5 text-amber-400">
            ●
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">{t.title}</p>
            <p className="text-xs leading-relaxed text-white/70">{t.message}</p>
          </div>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-white/40 hover:text-white">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
