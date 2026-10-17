"use client";

import { useEffect, useState } from "react";
import { ASPECTS, MAX_TOTAL_SECONDS, SHOT_COUNT } from "../../lib/renderConfig";
import { totalSeconds } from "../../lib/shotPresets";
import { useEditor } from "../store/editorStore";
import { ShotCard } from "./ShotCard";

export function Editor() {
  const s = useEditor();
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Persisted state is restored after mount so server and first client render match.
  useEffect(() => {
    void useEditor.persist.rehydrate();
  }, []);

  const total = totalSeconds(s.shots);
  const loading = s.status === "loading";

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-8 px-4 py-6 sm:px-8 sm:py-10">
      {/* Top bar */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-mono text-sm font-semibold uppercase tracking-[0.45em] text-amber-400">Oneliner</h1>
        <div role="radiogroup" aria-label="Aspect ratio" className="flex rounded-full border border-white/15 p-1">
          {ASPECTS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={s.aspect === a}
              onClick={() => s.setAspect(a)}
              className="flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-xs text-white/60 transition aria-checked:bg-amber-400 aria-checked:text-black"
            >
              <span aria-hidden className={`inline-block border border-current ${a === "16:9" ? "h-2.5 w-4" : "h-4 w-2.5"}`} />
              {a}
            </button>
          ))}
        </div>
      </header>

      {/* Logline */}
      <section className="flex flex-col gap-4">
        <label htmlFor="logline" className="text-3xl font-semibold tracking-tight sm:text-5xl">
          Your story in <span className="text-amber-400">one sentence</span>.
        </label>
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void s.generate();
          }}
        >
          <input
            id="logline"
            name="logline"
            value={s.logline}
            onChange={(e) => s.setLogline(e.target.value)}
            placeholder="A retired robot opens a noodle shop on Mars"
            className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-white/[0.03] px-5 py-4 text-lg outline-none transition placeholder:text-white/25 focus:border-amber-400 sm:text-xl"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-2xl bg-amber-400 px-7 py-4 text-lg font-semibold text-black transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "Writing…" : "Write my shots"}
          </button>
        </form>
        {s.error && (
          <p role="alert" className="text-sm text-red-400">
            {s.error}
          </p>
        )}
      </section>

      {s.shots.length > 0 && (
        <>
          {/* Title + tagline */}
          <section className="flex flex-col gap-2 border-t border-white/10 pt-6">
            <input
              aria-label="Trailer title"
              value={s.title}
              onChange={(e) => s.setTitle(e.target.value)}
              className="bg-transparent text-2xl font-bold uppercase tracking-[0.15em] outline-none focus:text-amber-300 sm:text-4xl"
            />
            <input
              aria-label="Tagline"
              value={s.tagline}
              onChange={(e) => s.setTagline(e.target.value)}
              className="bg-transparent text-base italic text-white/60 outline-none focus:text-white sm:text-lg"
            />
            <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-white/40">
              <span>
                {s.shots.length}/{SHOT_COUNT.max} shots
              </span>
              <span className={total > MAX_TOTAL_SECONDS ? "text-red-400" : ""}>
                {total}s / {MAX_TOTAL_SECONDS}s{total > MAX_TOTAL_SECONDS ? " — too long, trim a shot" : ""}
              </span>
              {s.provider && <span>written by: {s.provider === "mock" ? "mock (no LLM key)" : "LLM"}</span>}
            </p>
          </section>

          {/* Storyboard */}
          <section aria-label="Storyboard" className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-6 sm:-mx-8 sm:px-8">
            {s.shots.map((shot, i) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                index={i}
                count={s.shots.length}
                aspect={s.aspect}
                dragIndex={dragIndex}
                onDragStart={setDragIndex}
                onDragEnd={() => setDragIndex(null)}
              />
            ))}
            {s.shots.length < SHOT_COUNT.max && (
              <button
                type="button"
                onClick={s.addShot}
                className="flex w-[60vw] max-w-[200px] shrink-0 snap-center flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-white/40 transition hover:border-amber-400 hover:text-amber-300 sm:w-[200px]"
              >
                <span className="text-3xl">+</span>
                <span className="text-sm">Add shot</span>
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );
}
