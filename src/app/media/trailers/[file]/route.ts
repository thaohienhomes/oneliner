import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { LOCAL_TRAILER_DIR } from "../../../../../lib/trailers";

/**
 * Serves locally published trailers (public/trailers/, local storage adapter).
 * Supports Range requests so browsers can seek/stream the MP4.
 */
const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".json": "application/json" };
const FILE = /^[0-9a-z]{10}\.(mp4|jpg|json)$/;

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const abs = path.join(LOCAL_TRAILER_DIR, file);
  if (!FILE.test(file) || !existsSync(abs)) return new Response("Not found", { status: 404 });

  const size = statSync(abs).size;
  const headers: Record<string, string> = {
    "Content-Type": TYPES[path.extname(file)],
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
}
