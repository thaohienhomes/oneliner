/**
 * Trailer stitching plan: pure ffmpeg argument builders, shared by the browser
 * (ffmpeg.wasm, src/lib/browserStitch.ts) and the node DONE-TEST script
 * (scripts/stitch-test.ts, native ffmpeg). No DOM, no node imports.
 *
 * Duration rule: LTX rounds frames down (a 2s shot is 49 frames = 1.96s), so
 * every segment is padded by holding its last frame (tpad stop_mode=clone) and
 * then trimmed to an exact target. Crossfades overlap neighbours by FADE
 * seconds; each non-final segment is extended by FADE so the trailer still
 * hits sum(targets) exactly.
 */
import { FPS } from "./renderConfig";

/** Seconds of the end title card / optional cold-open title. */
export const TITLE_CARD_SECONDS = 2;
export const COLD_OPEN_SECONDS = 1;
/** 6-frame crossfade. */
export const FADE_FRAMES = 6;
export const FADE_SECONDS = FADE_FRAMES / FPS;
export const AUDIO_RATE = 48000;

export type Segment = {
  /** Path inside the ffmpeg FS (wasm) or on disk (node). */
  file: string;
  kind: "clip" | "card";
  /** Exact seconds this segment occupies on the timeline (before crossfade overlap). */
  target: number;
  /** From probing the input. Cards never have audio. */
  hasAudio: boolean;
};

export type StitchOptions = { width: number; height: number; fps?: number; crossfade?: boolean; output: string };

const r = (n: number) => Number(n.toFixed(4)).toString();

/** Timeline total: what the finished trailer should measure. */
export const plannedDuration = (segments: Pick<Segment, "target">[]) => segments.reduce((t, s) => t + s.target, 0);

/** Keep clip audio only when every clip has it; otherwise the whole track is silence. */
export const keepsClipAudio = (segments: Segment[]) => segments.filter((s) => s.kind === "clip").every((s) => s.hasAudio);

/** Encode a still PNG (canvas title card) into an exact-length silent MP4 at the trailer size/fps. */
export function buildCardArgs(png: string, seconds: number, o: { width: number; height: number; fps?: number; output: string }): string[] {
  const fps = o.fps ?? FPS;
  return [
    "-hide_banner", "-y",
    "-loop", "1", "-framerate", String(fps), "-t", r(seconds), "-i", png,
    "-vf", `scale=${o.width}:${o.height}:flags=lanczos,setsar=1,format=yuv420p`,
    "-r", String(fps), "-frames:v", String(Math.round(seconds * fps)),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-an",
    o.output,
  ];
}

/** One filter graph: normalize every input, pad/trim to target, crossfade (or concat), encode. */
export function buildStitchArgs(segments: Segment[], o: StitchOptions): string[] {
  if (!segments.length) throw new Error("Nothing to stitch.");
  const fps = o.fps ?? FPS;
  const fade = o.crossfade !== false && segments.length > 1 ? FADE_SECONDS : 0;
  const clipAudio = keepsClipAudio(segments);
  const last = segments.length - 1;

  const chains: string[] = [];
  const durs = segments.map((s, i) => s.target + (i < last ? fade : 0));

  segments.forEach((s, i) => {
    const d = r(durs[i]);
    chains.push(
      `[${i}:v]scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,fps=${fps},` +
        `tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`,
    );
    chains.push(
      clipAudio && s.hasAudio
        ? `[${i}:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`
        : `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${d},aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
    );
  });

  if (fade > 0) {
    let v = "v0";
    let a = "a0";
    let offset = 0;
    for (let i = 1; i <= last; i++) {
      offset += durs[i - 1] - fade;
      const vo = i === last ? "vout" : `vx${i}`;
      const ao = i === last ? "aout" : `ax${i}`;
      chains.push(`[${v}][v${i}]xfade=transition=fade:duration=${r(fade)}:offset=${r(offset)}[${vo}]`);
      chains.push(`[${a}][a${i}]acrossfade=d=${r(fade)}:c1=tri:c2=tri[${ao}]`);
      v = vo;
      a = ao;
    }
  } else {
    chains.push(`${segments.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${segments.length}:v=1:a=1[vout][aout]`);
  }

  return [
    "-hide_banner", "-y",
    ...segments.flatMap((s) => ["-i", s.file]),
    "-filter_complex", chains.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-r", String(fps),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", String(AUDIO_RATE),
    "-movflags", "+faststart",
    o.output,
  ];
}

/** Parse `ffmpeg -i file` log output: duration (s) and whether there is an audio stream. */
export function parseProbeLog(log: string): { duration: number | null; hasAudio: boolean; hasVideo: boolean } {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  return { duration, hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(log), hasVideo: /Stream #\d+:\d+.*?: Video:/.test(log) };
}

/** Last `time=HH:MM:SS.xx` in an ffmpeg progress log line, in seconds. */
export function parseLogTime(line: string): number | null {
  const m = /time=\s*(-?\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m || m[1].startsWith("-")) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Timeline for a project: optional cold open, every shot at its whole-second target, end title card. */
export function trailerSegments(
  clips: { file: string; seconds: number; hasAudio: boolean }[],
  cards: { endFile: string; coldOpenFile?: string },
): Segment[] {
  const segs: Segment[] = [];
  if (cards.coldOpenFile) segs.push({ file: cards.coldOpenFile, kind: "card", target: COLD_OPEN_SECONDS, hasAudio: false });
  for (const c of clips) segs.push({ file: c.file, kind: "clip", target: c.seconds, hasAudio: c.hasAudio });
  segs.push({ file: cards.endFile, kind: "card", target: TITLE_CARD_SECONDS, hasAudio: false });
  return segs;
}
