"use client";

import { useEffect, useState } from "react";
import { ltxFrames, type Aspect } from "../../lib/renderConfig";
import type { Shot } from "../../lib/shot";
import { useEditor, type RenderState } from "../store/editorStore";

const STATE_LABEL: Record<RenderState, string> = { queued: "Queued", rendering: "Rendering", done: "Done", failed: "Failed" };
const STATE_COLOR: Record<RenderState, string> = {
  queued: "text-white/60",
  rendering: "text-amber-300",
  done: "text-emerald-400",
  failed: "text-red-400",
};

/** Re-renders once a second while `on`, so elapsed time ticks. */
function useTick(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const fmtSecs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(0)}s`;

/** Frame area of a shot card: placeholder, live render status, or the finished clip. */
export function RenderPanel({ shot, n, aspect }: { shot: Shot; n: number; aspect: Aspect }) {
  const render = useEditor((s) => s.renders[shot.id]);
  const retryShot = useEditor((s) => s.retryShot);
  const reRenderShot = useEditor((s) => s.reRenderShot);
  const live = render?.state === "queued" || render?.state === "rendering";
  const now = useTick(live);

  const elapsed = render?.startedAt ? (render.finishedAt ?? now) - render.startedAt : null;
  const frameClass = `frame relative mx-auto w-full overflow-hidden rounded-lg border border-white/10 ${
    aspect === "9:16" ? "aspect-[9/16] max-w-[45%]" : "aspect-video"
  }`;

  return (
    <div className="flex flex-col gap-2">
      <div className={frameClass}>
        {render?.state === "done" && render.clipUrl ? (
          <video
            src={render.clipUrl}
            aria-label={`Shot ${n} clip`}
            className="h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            controls
          />
        ) : (
          <div className="flex h-full w-full items-end justify-between p-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">{shot.shotType}</span>
            <span className="font-mono text-[10px] text-white/40">
              {shot.seconds}s · {ltxFrames(shot.seconds)}f
            </span>
          </div>
        )}
        {live && typeof render.progress === "number" && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
            <div
              role="progressbar"
              aria-label={`Shot ${n} render progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(render.progress * 100)}
              className="h-full bg-amber-400 transition-[width]"
              style={{ width: `${Math.round(render.progress * 100)}%` }}
            />
          </div>
        )}
      </div>

      {render && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
          <span aria-label={`Shot ${n} render state`} className={STATE_COLOR[render.state]}>
            {STATE_LABEL[render.state]}
            {live && typeof render.progress === "number" ? ` ${Math.round(render.progress * 100)}%` : ""}
            {render.state === "queued" && typeof render.queuePosition === "number" ? ` #${render.queuePosition}` : ""}
          </span>
          {elapsed !== null && <span className="text-white/40">{fmtSecs(elapsed)}</span>}
          <span className="text-white/30" title="Seed">
            seed {render.seed}
          </span>
        </div>
      )}
      {render?.state === "failed" && render.error && <p className="text-[11px] leading-snug text-red-400/90">{render.error}</p>}

      {render && (
        <div className="flex flex-wrap gap-1.5">
          {render.state === "failed" && (
            <button type="button" className="chip" onClick={() => retryShot(shot.id)} aria-label={`Retry shot ${n}`}>
              Retry
            </button>
          )}
          <button type="button" className="chip" onClick={() => reRenderShot(shot.id)} aria-label={`Re-render shot ${n}, same seed`}>
            Re-render
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => reRenderShot(shot.id, { newSeed: true })}
            aria-label={`Re-render shot ${n}, new seed`}
          >
            New seed
          </button>
        </div>
      )}
    </div>
  );
}
