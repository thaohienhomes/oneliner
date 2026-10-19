/** Clapperboard loading animation (pure CSS, see .slate in globals.css). */
export function FilmSlate({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col items-center gap-4 py-10">
      <div className="slate" aria-hidden>
        <div className="slate-clapper" />
        <div className="slate-body">
          <span>SCENE 1</span>
          <span>TAKE 1</span>
        </div>
      </div>
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/50">{label}</p>
    </div>
  );
}
