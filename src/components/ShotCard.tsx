"use client";

import { useRef, useState } from "react";
import { SHOT_SECONDS, type Aspect } from "../../lib/renderConfig";
import type { Shot } from "../../lib/shot";
import { CAMERA_MOVES, LENS_FOV, LENSES, SHOT_TYPES, shotToPrompt, type ShotType } from "../../lib/shotPresets";
import { useEditor } from "../store/editorStore";
import { CameraMoveIcon } from "./CameraMoveIcon";
import { RenderPanel } from "./RenderPanel";

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Field-of-view wedge: wider lens = wider wedge. */
function FovWedge({ deg }: { deg: number }) {
  const half = (Math.min(deg, 110) / 2) * (Math.PI / 180);
  const r = 9;
  const x = r * Math.sin(half);
  const y = 11 - r * Math.cos(half);
  return (
    <svg viewBox="0 0 20 12" className="h-2.5 w-4" aria-hidden>
      <path d={`M10 11 L${10 - x} ${y} A${r} ${r} 0 0 1 ${10 + x} ${y} Z`} fill="currentColor" opacity="0.7" />
    </svg>
  );
}

type Props = {
  shot: Shot;
  index: number;
  count: number;
  aspect: Aspect;
  dragIndex: number | null;
  onDragStart: (i: number) => void;
  onDragEnd: () => void;
};

export function ShotCard({ shot, index, count, aspect, dragIndex, onDragStart, onDragEnd }: Props) {
  const updateShot = useEditor((s) => s.updateShot);
  const deleteShot = useEditor((s) => s.deleteShot);
  const moveShot = useEditor((s) => s.moveShot);
  const regenerateShot = useEditor((s) => s.regenerateShot);
  const regenerating = useEditor((s) => !!s.regenerating[shot.id]);
  const cardRef = useRef<HTMLElement>(null);
  const [dropTarget, setDropTarget] = useState(false);

  const n = index + 1;
  const prompt = shotToPrompt(shot);
  const set = (patch: Partial<Omit<Shot, "id">>) => updateShot(shot.id, patch);

  return (
    <article
      ref={cardRef}
      role="group"
      aria-label={`Shot ${n}`}
      onDragOver={(e) => {
        if (dragIndex === null) return;
        e.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropTarget(false);
        if (dragIndex !== null) moveShot(dragIndex, index);
      }}
      className={`card relative flex w-[86vw] max-w-[340px] shrink-0 snap-center flex-col gap-4 rounded-2xl border p-4 transition sm:w-[320px] ${
        dropTarget ? "border-amber-400/80" : "border-white/10"
      } ${dragIndex === index ? "opacity-40" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(index));
            if (cardRef.current) e.dataTransfer.setDragImage(cardRef.current, 20, 20);
            onDragStart(index);
          }}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          className="cursor-grab select-none text-white/40 hover:text-amber-300 active:cursor-grabbing"
          aria-hidden
        >
          ⋮⋮
        </span>
        <span className="font-mono text-xs tracking-[0.25em] text-amber-400">SHOT {String(n).padStart(2, "0")}</span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" className="icon-btn" aria-label={`Move shot ${n} left`} disabled={index === 0} onClick={() => moveShot(index, index - 1)}>
            ←
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Move shot ${n} right`}
            disabled={index === count - 1}
            onClick={() => moveShot(index, index + 1)}
          >
            →
          </button>
          <button type="button" className="icon-btn hover:!text-red-400" aria-label={`Delete shot ${n}`} onClick={() => deleteShot(shot.id)}>
            ✕
          </button>
        </span>
      </div>

      {/* Frame: placeholder, render status, or the finished clip */}
      <RenderPanel shot={shot} n={n} aspect={aspect} />

      {/* Action */}
      <label className="flex flex-col gap-1">
        <span className="field-label">Action</span>
        <textarea
          value={shot.action}
          onChange={(e) => set({ action: e.target.value })}
          rows={3}
          className="field resize-none"
          aria-label={`Shot ${n} action`}
        />
      </label>
      <button
        type="button"
        onClick={() => regenerateShot(shot.id)}
        disabled={regenerating}
        className="-mt-2 self-start text-xs text-amber-300/90 underline-offset-4 hover:underline disabled:opacity-50"
      >
        {regenerating ? "Rewriting…" : "↻ Regenerate this shot"}
      </button>

      {/* Duration */}
      <label className="flex flex-col gap-1">
        <span className="field-label flex justify-between">
          Duration <span className="font-mono text-amber-300">{shot.seconds}s</span>
        </span>
        <input
          type="range"
          min={SHOT_SECONDS.min}
          max={SHOT_SECONDS.max}
          step={1}
          value={shot.seconds}
          onChange={(e) => set({ seconds: Number(e.target.value) })}
          className="accent-amber-400"
          aria-label={`Shot ${n} duration in seconds`}
        />
      </label>

      {/* Camera move */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="field-label mb-1.5">Camera move</legend>
        <div className="flex flex-wrap gap-1.5">
          {CAMERA_MOVES.map((m) => (
            <button key={m} type="button" aria-pressed={shot.cameraMove === m} onClick={() => set({ cameraMove: m })} className="chip">
              <CameraMoveIcon move={m} />
              {label(m)}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Lens */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="field-label mb-1.5">Lens</legend>
        <div className="flex flex-wrap gap-1.5">
          {LENSES.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={shot.lens === l}
              aria-label={`${l} lens, ${LENS_FOV[l]}° field of view`}
              title={`${LENS_FOV[l]}° horizontal field of view`}
              onClick={() => set({ lens: l })}
              className="chip"
            >
              <FovWedge deg={LENS_FOV[l]} />
              {l}
              <span className="text-[10px] text-white/40">{LENS_FOV[l]}°</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Shot type + mood */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="field-label">Shot type</span>
          <select value={shot.shotType} onChange={(e) => set({ shotType: e.target.value as ShotType })} className="field" aria-label={`Shot ${n} type`}>
            {SHOT_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="field-label">Mood</span>
          <input value={shot.mood} onChange={(e) => set({ mood: e.target.value })} className="field" aria-label={`Shot ${n} mood`} />
        </label>
      </div>

      {/* Prompt preview */}
      <div className="flex flex-col gap-1">
        <span className="field-label">Prompt preview</span>
        <output aria-label={`Shot ${n} prompt preview`} className="block rounded-lg bg-black/60 p-2.5 font-mono text-[11px] leading-relaxed text-white/60">
          {prompt}
        </output>
      </div>
    </article>
  );
}
