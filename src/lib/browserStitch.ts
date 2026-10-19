"use client";

/**
 * In-browser trailer stitching with ffmpeg.wasm (single-threaded core, so no
 * SharedArrayBuffer and no COOP/COEP headers are needed). The core is loaded
 * from a CDN as blob URLs, as in the official ffmpeg.wasm Next.js example.
 * The ffmpeg arguments come from lib/stitchPlan.ts (also used by the node
 * DONE-TEST script), so browser and test run the same filter graph.
 */
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { RENDER_SIZE, type Aspect } from "../../lib/renderConfig";
import {
  buildCardArgs,
  buildStitchArgs,
  COLD_OPEN_SECONDS,
  parseLogTime,
  parseProbeLog,
  plannedDuration,
  TITLE_CARD_SECONDS,
  trailerSegments,
} from "../../lib/stitchPlan";
import { drawTitleCard, type CardFonts } from "./titleCard";

export const FFMPEG_CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";

export type StitchStage = "loading" | "fetching" | "cards" | "stitching" | "done";
export type StitchProgress = { stage: StitchStage; ratio: number; label: string };

export type StitchInput = {
  clips: { url: string; seconds: number }[];
  title: string;
  tagline: string;
  aspect: Aspect;
  coldOpen: boolean;
  crossfade?: boolean;
  fonts: CardFonts;
};

export type StitchResult = { blob: Blob; duration: number; target: number; width: number; height: number };

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import("@ffmpeg/ffmpeg"), import("@ffmpeg/util")]);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        // Unbundled worker copy (scripts/copy-ffmpeg-worker.mjs): the bundled one breaks the core's dynamic import.
        classWorkerURL: new URL("/ffmpeg/worker.js", window.location.origin).href,
        coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ffmpeg;
    })().catch((err) => {
      ffmpegPromise = null;
      throw new Error(`Could not load ffmpeg.wasm (${err instanceof Error ? err.message : String(err)}). Check your connection and retry.`);
    });
  }
  return ffmpegPromise;
}

/** Run one ffmpeg command, collecting its log; throws with the tail of the log on failure. */
async function exec(ffmpeg: FFmpeg, args: string[], onTime?: (t: number) => void, allowFail = false) {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    lines.push(message);
    if (onTime) {
      const t = parseLogTime(message);
      if (t !== null) onTime(t);
    }
  };
  ffmpeg.on("log", onLog);
  try {
    const code = await ffmpeg.exec(args);
    if (code !== 0 && !allowFail) throw new Error(`ffmpeg exited ${code}: ${lines.slice(-6).join(" | ")}`);
    return lines.join("\n");
  } finally {
    ffmpeg.off("log", onLog);
  }
}

export async function stitchTrailer(input: StitchInput, onProgress: (p: StitchProgress) => void): Promise<StitchResult> {
  if (!input.clips.length) throw new Error("No finished clips to stitch.");
  const { width, height } = RENDER_SIZE[input.aspect];
  const report = (stage: StitchStage, ratio: number, label: string) => onProgress({ stage, ratio: Math.min(1, Math.max(0, ratio)), label });

  report("loading", 0.02, "Loading ffmpeg.wasm…");
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = await import("@ffmpeg/util");
  const written: string[] = [];

  try {
    // 1. Fetch + probe clips.
    const clips: { file: string; seconds: number; hasAudio: boolean }[] = [];
    for (let i = 0; i < input.clips.length; i++) {
      report("fetching", 0.1 + (0.1 * i) / input.clips.length, `Fetching clip ${i + 1}/${input.clips.length}…`);
      const file = `clip${i}.mp4`;
      await ffmpeg.writeFile(file, await fetchFile(input.clips[i].url));
      written.push(file);
      const info = parseProbeLog(await exec(ffmpeg, ["-hide_banner", "-i", file], undefined, true));
      if (!info.hasVideo) throw new Error(`Clip ${i + 1} has no video stream.`);
      clips.push({ file, seconds: input.clips[i].seconds, hasAudio: info.hasAudio });
    }

    // 2. Title cards: canvas -> PNG -> exact-length MP4.
    report("cards", 0.22, "Drawing title card…");
    const card = async (name: string, seconds: number, tagline?: string) => {
      const png = await drawTitleCard({ width, height, title: input.title, tagline, fonts: input.fonts });
      await ffmpeg.writeFile(`${name}.png`, png);
      written.push(`${name}.png`, `${name}.mp4`);
      await exec(ffmpeg, buildCardArgs(`${name}.png`, seconds, { width, height, output: `${name}.mp4` }));
      return `${name}.mp4`;
    };
    const endFile = await card("endcard", TITLE_CARD_SECONDS, input.tagline);
    const coldOpenFile = input.coldOpen ? await card("coldopen", COLD_OPEN_SECONDS) : undefined;

    // 3. One filter graph: normalize, pad/trim, crossfade, encode.
    const segments = trailerSegments(clips, { endFile, coldOpenFile });
    const target = plannedDuration(segments);
    report("stitching", 0.3, "Stitching…");
    written.push("trailer.mp4");
    await exec(ffmpeg, buildStitchArgs(segments, { width, height, crossfade: input.crossfade, output: "trailer.mp4" }), (t) =>
      report("stitching", 0.3 + 0.68 * (t / target), `Encoding ${t.toFixed(1)}s / ${target.toFixed(1)}s`),
    );

    const data = await ffmpeg.readFile("trailer.mp4");
    if (typeof data === "string") throw new Error("Unexpected text output from ffmpeg.");
    const out = parseProbeLog(await exec(ffmpeg, ["-hide_banner", "-i", "trailer.mp4"], undefined, true));
    report("done", 1, "Done");
    return { blob: new Blob([new Uint8Array(data)], { type: "video/mp4" }), duration: out.duration ?? target, target, width, height };
  } finally {
    for (const f of written) await ffmpeg.deleteFile(f).catch(() => undefined);
  }
}
