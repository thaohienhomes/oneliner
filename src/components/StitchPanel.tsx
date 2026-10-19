"use client";

import { useEffect, useRef, useState } from "react";
import { slugify } from "../../lib/slug";
import type { StitchProgress, StitchResult } from "../lib/browserStitch";
import { useEditor } from "../store/editorStore";

/** next/font exposes the generated family names as CSS variables on <body> (see layout.tsx). */
function cardFonts() {
  const css = getComputedStyle(document.body);
  return {
    title: css.getPropertyValue("--font-cinzel").trim() || "Georgia, serif",
    tagline: css.getPropertyValue("--font-cormorant").trim() || "Georgia, serif",
  };
}

export type Stitched = StitchResult & { url: string };

/** "Stitch trailer": ffmpeg.wasm in the browser -> preview player + Download MP4. */
export function StitchPanel({ onStitched }: { onStitched?: (r: Stitched | null) => void }) {
  const shots = useEditor((s) => s.shots);
  const renders = useEditor((s) => s.renders);
  const title = useEditor((s) => s.title);
  const tagline = useEditor((s) => s.tagline);
  const aspect = useEditor((s) => s.aspect);

  const [coldOpen, setColdOpen] = useState(true);
  const [progress, setProgress] = useState<StitchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Stitched | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), []);

  const clips = shots.map((s) => ({ url: renders[s.id]?.state === "done" ? renders[s.id]?.clipUrl : undefined, seconds: s.seconds }));
  const ready = clips.length > 0 && clips.every((c) => c.url);
  const busy = progress !== null && progress.stage !== "done";

  const stitch = async () => {
    setError(null);
    setProgress({ stage: "loading", ratio: 0, label: "Starting…" });
    try {
      const { stitchTrailer } = await import("../lib/browserStitch");
      const r = await stitchTrailer(
        { clips: clips.map((c) => ({ url: c.url!, seconds: c.seconds })), title, tagline, aspect, coldOpen, fonts: cardFonts() },
        setProgress,
      );
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(r.blob);
      const stitched = { ...r, url: urlRef.current };
      setResult(stitched);
      onStitched?.(stitched);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    }
  };

  if (!ready && !result) return null;

  return (
    <section aria-label="Trailer" className="card flex flex-col gap-4 rounded-2xl border border-white/10 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={stitch}
          disabled={!ready || busy}
          className="rounded-xl bg-amber-400 px-5 py-2.5 font-semibold text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {result ? "Re-stitch trailer" : "Stitch trailer"}
        </button>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={coldOpen} onChange={(e) => setColdOpen(e.target.checked)} disabled={busy} />
          1s cold-open title
        </label>
        <span className="font-mono text-xs text-white/40">crossfades · end title card · runs in your browser</span>
      </div>

      {busy && progress && (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              role="progressbar"
              aria-label="Stitch progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.ratio * 100)}
              className="h-full bg-amber-400 transition-[width]"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-white/50" aria-live="polite">
            {progress.label}
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <video
            src={result.url}
            controls
            playsInline
            aria-label="Trailer preview"
            data-duration={result.duration.toFixed(2)}
            className={`mx-auto w-full rounded-lg border border-white/10 bg-black ${aspect === "9:16" ? "max-w-sm" : ""}`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={result.url}
              download={`${slugify(title) || "trailer"}.mp4`}
              className="rounded-xl border border-amber-400/70 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-400 hover:text-black"
            >
              Download MP4
            </a>
            <span className="font-mono text-xs text-white/40">
              {result.duration.toFixed(2)}s · {result.width}×{result.height} · {(result.blob.size / 1e6).toFixed(1)} MB
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
