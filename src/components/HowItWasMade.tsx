"use client";

import { useRef } from "react";

const STEPS: { name: string; what: string }[] = [
  {
    name: "LLM (Groq, open model)",
    what: "Expands your one sentence into a 4–6 shot list with camera, lens and mood. Any OpenAI-compatible endpoint; open-weight models on Groq by default. No key? A deterministic mock writes the shots.",
  },
  { name: "Comfy SDK", what: "@comfyorg/sdk submits our exported ComfyUI workflows (in /workflows) and polls each job." },
  { name: "Comfy Cloud", what: "Runs the workflows on cloud GPUs: Z-Image-Turbo paints each shot's first frame." },
  { name: "LTX-2.3", what: "Image-to-video: animates every first frame into a 2–4s shot, with generated audio." },
  {
    name: "ffmpeg.wasm",
    what: "Right in your browser: title card, frame-exact padding, crossfades and the final MP4. No server-side video processing.",
  },
];

export function HowItWasMade() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="font-mono text-xs text-white/50 underline-offset-4 hover:text-amber-300 hover:underline"
      >
        How it was made
      </button>
      <dialog
        ref={ref}
        aria-labelledby="how-title"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[min(92vw,560px)] rounded-2xl border border-white/10 bg-[#0d0b08] p-0 text-white backdrop:bg-black/70"
      >
        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="how-title" className="font-[family-name:var(--font-cinzel)] text-xl tracking-widest text-[#f5e6c8]">
              How it was made
            </h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="text-white/50 hover:text-white">
              ×
            </button>
          </div>
          <ol className="flex flex-col gap-4">
            {STEPS.map((s, i) => (
              <li key={s.name} className="flex gap-3">
                <span className="font-mono text-xs text-amber-400">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-sm font-semibold">{s.name}</p>
                  <p className="text-xs leading-relaxed text-white/60">{s.what}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="font-mono text-[11px] text-white/40">Open source · #OpenSourceHiggsfield</p>
        </div>
      </dialog>
    </>
  );
}
