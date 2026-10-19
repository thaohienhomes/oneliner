/**
 * Published trailers: trailers/{id}.mp4 + {id}.jpg (poster) + {id}.json.
 * Server-only. One interface, two adapters:
 *   - Vercel Blob when BLOB_READ_WRITE_TOKEN is set;
 *   - local disk otherwise: public/trailers/ (gitignored), served by
 *     GET /media/trailers/[file] (Next only serves public/ files that
 *     existed at build time, so runtime uploads need a route).
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { head, list, put } from "@vercel/blob";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { guardIP } from "./ipGuard";
import { ASPECTS, SHOT_COUNT, SHOT_SECONDS } from "./renderConfig";
import { CAMERA_MOVES, LENSES, SHOT_TYPES } from "./shotPresets";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export const TRAILER_ID = /^[0-9a-z]{10}$/;
export const newTrailerId = customAlphabet("0123456789abcdefghijkmnpqrstuvwxyz", 10);

/** Vercel Functions cap request bodies at 4.5 MB; a 6x4s trailer is ~3 MB at our encode settings. */
export const MAX_VIDEO_BYTES = 4_400_000;
export const MAX_POSTER_BYTES = 600_000;

export const PublishShotSchema = z.object({
  shotType: z.enum(SHOT_TYPES),
  lens: z.enum(LENSES),
  cameraMove: z.enum(CAMERA_MOVES),
  mood: z.string().max(80),
  action: z.string().min(1).max(300),
  seconds: z.number().int().min(SHOT_SECONDS.min).max(SHOT_SECONDS.max),
  prompt: z.string().max(1200),
});

/** What the editor sends on Publish (id, URLs and createdAt are assigned server-side). */
export const PublishMetaSchema = z.object({
  title: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(160),
  logline: z.string().trim().max(400),
  aspect: z.enum(ASPECTS),
  duration: z.number().positive().max(60),
  shots: z.array(PublishShotSchema).min(1).max(SHOT_COUNT.max),
});
export type PublishMeta = z.infer<typeof PublishMetaSchema>;

export type TrailerMeta = PublishMeta & { id: string; videoUrl: string; posterUrl: string; createdAt: string };

/* ------------------------------------------------------------------ */
/* Storage adapters                                                    */
/* ------------------------------------------------------------------ */

export interface TrailerStorage {
  readonly kind: "blob" | "local";
  /** Store one file under trailers/; returns its public URL (absolute for Blob, site-relative for local). */
  put(file: string, bytes: Uint8Array, contentType: string): Promise<string>;
  getMeta(id: string): Promise<TrailerMeta | null>;
  /** Newest first. */
  listRecent(limit: number): Promise<TrailerMeta[]>;
}

export const LOCAL_TRAILER_DIR = path.join(process.cwd(), "public", "trailers");
export const LOCAL_MEDIA_PREFIX = "/media/trailers";

const parseMeta = (raw: string): TrailerMeta | null => {
  try {
    const m = JSON.parse(raw) as TrailerMeta;
    return m && typeof m.id === "string" && TRAILER_ID.test(m.id) ? m : null;
  } catch {
    return null;
  }
};

const byNewest = (a: TrailerMeta, b: TrailerMeta) => b.createdAt.localeCompare(a.createdAt);

export const localStorageAdapter: TrailerStorage = {
  kind: "local",
  async put(file, bytes) {
    await mkdir(LOCAL_TRAILER_DIR, { recursive: true });
    await writeFile(path.join(LOCAL_TRAILER_DIR, path.basename(file)), bytes);
    return `${LOCAL_MEDIA_PREFIX}/${path.basename(file)}`;
  },
  async getMeta(id) {
    if (!TRAILER_ID.test(id)) return null;
    const f = path.join(LOCAL_TRAILER_DIR, `${id}.json`);
    return existsSync(f) ? parseMeta(await readFile(f, "utf8")) : null;
  },
  async listRecent(limit) {
    if (!existsSync(LOCAL_TRAILER_DIR)) return [];
    const files = (await readdir(LOCAL_TRAILER_DIR)).filter((f) => f.endsWith(".json"));
    const metas = await Promise.all(files.map(async (f) => parseMeta(await readFile(path.join(LOCAL_TRAILER_DIR, f), "utf8"))));
    return metas.filter((m): m is TrailerMeta => !!m).sort(byNewest).slice(0, limit);
  },
};

async function fetchMeta(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  return res.ok ? parseMeta(await res.text()) : null;
}

export const blobStorageAdapter: TrailerStorage = {
  kind: "blob",
  async put(file, bytes, contentType) {
    const blob = await put(`trailers/${path.basename(file)}`, Buffer.from(bytes), {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return blob.url;
  },
  async getMeta(id) {
    if (!TRAILER_ID.test(id)) return null;
    try {
      return await fetchMeta((await head(`trailers/${id}.json`)).url);
    } catch {
      return null;
    }
  },
  async listRecent(limit) {
    const { blobs } = await list({ prefix: "trailers/", limit: 1000 });
    const recent = blobs
      .filter((b) => b.pathname.endsWith(".json"))
      .sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))
      .slice(0, limit);
    const metas = await Promise.all(recent.map((b) => fetchMeta(b.url).catch(() => null)));
    return metas.filter((m): m is TrailerMeta => !!m);
  },
};

export const trailerStorage = (): TrailerStorage => (process.env.BLOB_READ_WRITE_TOKEN?.trim() ? blobStorageAdapter : localStorageAdapter);

/* ------------------------------------------------------------------ */
/* Publish                                                             */
/* ------------------------------------------------------------------ */

/** MP4 files start with a box whose type is "ftyp" at byte 4. */
export const isMp4 = (b: Uint8Array) => b.length > 12 && String.fromCharCode(...b.subarray(4, 8)) === "ftyp";
export const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export class PublishError extends Error {
  constructor(
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export async function publishTrailer(
  input: { meta: PublishMeta; video: Uint8Array; poster: Uint8Array },
  storage: TrailerStorage = trailerStorage(),
): Promise<TrailerMeta> {
  const { video, poster } = input;
  if (!isMp4(video)) throw new PublishError("The video is not an MP4.");
  if (video.length > MAX_VIDEO_BYTES) throw new PublishError(`The video is too large (max ${(MAX_VIDEO_BYTES / 1e6).toFixed(1)} MB).`, 413);
  if (!isJpeg(poster)) throw new PublishError("The poster is not a JPEG.");
  if (poster.length > MAX_POSTER_BYTES) throw new PublishError("The poster is too large.", 413);

  // Same IP guard as the shot list: published text never names real people/brands/franchises.
  const g = (s: string) => guardIP(s).text;
  const meta = {
    ...input.meta,
    title: g(input.meta.title),
    tagline: g(input.meta.tagline),
    logline: g(input.meta.logline),
    shots: input.meta.shots.map((s) => ({ ...s, action: g(s.action), mood: g(s.mood), prompt: g(s.prompt) })),
  };

  const id = newTrailerId();
  const videoUrl = await storage.put(`${id}.mp4`, video, "video/mp4");
  const posterUrl = await storage.put(`${id}.jpg`, poster, "image/jpeg");
  const full: TrailerMeta = { id, ...meta, videoUrl, posterUrl, createdAt: new Date().toISOString() };
  // JSON last: a trailer only shows up (page, gallery) once its media exists.
  await storage.put(`${id}.json`, new TextEncoder().encode(JSON.stringify(full, null, 2)), "application/json");
  return full;
}

/** Site-relative URLs (local adapter) -> absolute, for OG tags and share links. */
export const absoluteUrl = (url: string, origin: string) => (/^https?:\/\//.test(url) ? url : new URL(url, origin).href);
