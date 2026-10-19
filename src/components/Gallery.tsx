import Link from "next/link";
import { trailerStorage, type TrailerMeta } from "../../lib/trailers";

export const GALLERY_SIZE = 6;

/** Home gallery: the 6 most recent published trailers (server component). */
export async function Gallery() {
  let trailers: TrailerMeta[] = [];
  try {
    trailers = await trailerStorage().listRecent(GALLERY_SIZE);
  } catch (err) {
    console.error("gallery: listing failed", err instanceof Error ? err.message : err);
  }

  return (
    <section aria-label="Recent trailers" className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 pb-16 sm:px-8">
      <h2 className="field-label">Fresh from the studio</h2>
      {trailers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/40">
          No trailers published yet. Write one sentence above and be the first.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {trailers.map((t) => (
            <li key={t.id}>
              <Link href={`/t/${t.id}`} className="group flex flex-col gap-2">
                <div className="frame overflow-hidden rounded-xl border border-white/10 transition group-hover:border-amber-400/70">
                  {/* eslint-disable-next-line @next/next/no-img-element -- poster may live on Blob or a local route */}
                  <img
                    src={t.posterUrl}
                    alt=""
                    className={`w-full object-cover ${t.aspect === "9:16" ? "aspect-[9/16]" : "aspect-video"}`}
                    loading="lazy"
                  />
                </div>
                <span className="font-[family-name:var(--font-cinzel)] text-sm tracking-wider text-white/85 group-hover:text-amber-300">
                  {t.title}
                </span>
                {t.tagline && <span className="line-clamp-1 text-xs italic text-white/45">{t.tagline}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
