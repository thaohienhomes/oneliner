import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RENDER_SIZE } from "../../../../lib/renderConfig";
import { shareLinks, siteOrigin } from "../../../../lib/site";
import { slugify } from "../../../../lib/slug";
import { absoluteUrl, trailerStorage, type TrailerMeta } from "../../../../lib/trailers";
import { CopyLinkButton } from "../../../components/CopyLinkButton";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  const meta = await trailerStorage().getMeta(id);
  if (!meta) notFound();
  return { meta, origin: siteOrigin(await headers()) };
}

/** Blob URLs force a download with ?download=1; same-origin local files use the download attribute. */
const downloadHref = (m: TrailerMeta) => (/^https?:\/\//.test(m.videoUrl) ? `${m.videoUrl}?download=1` : m.videoUrl);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { meta, origin } = await load(id);
  const { width, height } = RENDER_SIZE[meta.aspect];
  const url = `${origin}/t/${meta.id}`;
  const video = absoluteUrl(meta.videoUrl, origin);
  const poster = absoluteUrl(meta.posterUrl, origin);
  const description = meta.tagline || meta.logline || "A movie trailer made from one sentence.";
  return {
    title: `${meta.title} — Oneliner`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "video.other",
      url,
      title: meta.title,
      description,
      siteName: "Oneliner",
      images: [{ url: poster, width, height, alt: meta.title }],
      videos: [{ url: video, secureUrl: video.startsWith("https") ? video : undefined, type: "video/mp4", width, height }],
    },
    twitter: { card: "summary_large_image", title: meta.title, description, images: [poster] },
  };
}

export default async function TrailerPage({ params }: Props) {
  const { id } = await params;
  const { meta, origin } = await load(id);
  const url = `${origin}/t/${meta.id}`;
  const share = shareLinks(url, meta.title);
  const portrait = meta.aspect === "9:16";
  const btn =
    "rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-amber-400 hover:text-white";

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-mono text-sm font-semibold uppercase tracking-[0.45em] text-amber-400">
          Oneliner
        </Link>
        <Link href="/" className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-300">
          Make your own
        </Link>
      </header>

      <div className={`mx-auto w-full ${portrait ? "max-w-sm" : ""}`}>
        <video
          src={meta.videoUrl}
          poster={meta.posterUrl}
          autoPlay
          muted
          loop
          playsInline
          controls
          aria-label={`${meta.title} trailer`}
          style={{ aspectRatio: `${RENDER_SIZE[meta.aspect].width} / ${RENDER_SIZE[meta.aspect].height}` }}
          className="w-full rounded-xl border border-white/10 bg-black"
        />
      </div>

      <section className="flex flex-col gap-3 text-center">
        <h1 className="font-[family-name:var(--font-cinzel)] text-3xl tracking-[0.12em] text-[#f5e6c8] sm:text-5xl">{meta.title}</h1>
        {meta.tagline && <p className="font-[family-name:var(--font-cormorant)] text-xl italic text-white/70">{meta.tagline}</p>}
        {meta.logline && (
          <p className="mx-auto max-w-2xl text-sm text-white/50">
            <span className="field-label mr-2">Logline</span>
            {meta.logline}
          </p>
        )}
      </section>

      <section aria-label="Share" className="flex flex-wrap items-center justify-center gap-2">
        <a href={downloadHref(meta)} download={`${slugify(meta.title) || "trailer"}.mp4`} className={btn}>
          Download MP4
        </a>
        <CopyLinkButton url={url} className={btn} />
        <a href={share.x} target="_blank" rel="noopener noreferrer" className={btn}>
          Share on X
        </a>
        <a href={share.reddit} target="_blank" rel="noopener noreferrer" className={btn}>
          Reddit
        </a>
        <a href={share.linkedin} target="_blank" rel="noopener noreferrer" className={btn}>
          LinkedIn
        </a>
      </section>

      <section aria-label="Director's notes" className="card flex flex-col gap-4 rounded-2xl border border-white/10 p-5 sm:p-6">
        <h2 className="field-label">Director&apos;s notes</h2>
        <ol className="flex flex-col gap-4">
          {meta.shots.map((s, i) => (
            <li key={i} className="flex flex-col gap-1 border-l border-amber-400/40 pl-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-amber-300/80">
                Shot {i + 1} · {s.shotType} · {s.lens} · {s.cameraMove} · {s.seconds}s{s.mood ? ` · ${s.mood}` : ""}
              </p>
              <p className="text-sm text-white/85">{s.action}</p>
              <details className="text-xs text-white/40">
                <summary className="cursor-pointer select-none">LTX prompt</summary>
                <p className="mt-1 leading-relaxed">{s.prompt}</p>
              </details>
            </li>
          ))}
        </ol>
        <p className="font-mono text-[11px] text-white/35">
          {meta.duration.toFixed(1)}s · {meta.aspect} · made {new Date(meta.createdAt).toISOString().slice(0, 10)} with Comfy Cloud + LTX + ffmpeg.wasm
        </p>
      </section>
    </main>
  );
}
