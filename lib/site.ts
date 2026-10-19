/** Public origin for absolute URLs (OG tags, share links). NEXT_PUBLIC_SITE_URL wins; else the request host. */
export function siteOrigin(h: Headers): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export const CONTEST_TAG = "#OpenSourceHiggsfield";

/** Share-intent URLs only: they open a prefilled composer, nothing is posted automatically. */
export function shareLinks(url: string, title: string) {
  const text = `"${title}" — a movie trailer I made from one sentence with Oneliner (Comfy + LTX, open source) ${CONTEST_TAG}`;
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  return {
    text,
    x: `https://twitter.com/intent/tweet?${q({ text, url })}`,
    reddit: `https://www.reddit.com/submit?${q({ url, title: `${title} — AI movie trailer from one sentence ${CONTEST_TAG}` })}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?${q({ url })}`,
  };
}
