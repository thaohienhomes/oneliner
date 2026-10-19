/**
 * ffprobe checks for a stitched trailer (shared by scripts/stitch-test.ts and
 * scripts/stitch-browser.ts): one resolution for every frame, total duration
 * within 0.2s of the target, and the last TITLE_CARD_SECONDS are the (static)
 * title card rather than footage.
 */
import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { mockShotList } from "../lib/shotList";
import { parseProbeLog, TITLE_CARD_SECONDS } from "../lib/stitchPlan";

const run = promisify(execFile);

export const RENDERS = path.join(process.cwd(), "public", "renders");
export const TEST_LOGLINE = "A retired robot opens a noodle shop on Mars";

/** Same probe the browser does: parse the `ffmpeg -i` log (exits 1 because no output is given). */
export async function probeClip(file: string) {
  const res = await run("ffmpeg", ["-hide_banner", "-i", file]).catch((e: { stderr: string }) => ({ stderr: e.stderr }));
  return parseProbeLog(res.stderr);
}

/**
 * The existing 4-shot project: the mock shot list for the e2e logline (first
 * 4 shots) + the 4 clips the last e2e batch rendered (the ~2s ones in
 * public/renders/, oldest first = shot order). No Comfy calls.
 */
export async function loadTestProject(clipArgs: string[] = []) {
  const project = mockShotList(TEST_LOGLINE, "16:9");
  const files = clipArgs.length
    ? clipArgs
    : readdirSync(RENDERS)
        .filter((f) => f.endsWith(".mp4"))
        .map((f) => path.join(RENDERS, f))
        .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  const probed = [];
  for (const f of files) probed.push({ file: f, ...(await probeClip(f)) });
  const clips = (clipArgs.length ? probed : probed.filter((p) => p.duration !== null && p.duration < 2.5)).slice(0, 4);
  if (clips.length < 4) throw new Error(`Need 4 clips, found ${clips.length} in ${RENDERS}`);
  const shots = project.shots.slice(0, 4);
  console.log(`Project "${project.title}" — "${project.tagline}"`);
  shots.forEach((s, i) =>
    console.log(`  shot ${i + 1}: target ${s.seconds}s <- ${path.basename(clips[i].file)} (${clips[i].duration}s, audio=${clips[i].hasAudio})`),
  );
  return { project, shots, clips };
}

/** One luma frame at time t as raw bytes. */
async function grayFrame(file: string, t: number) {
  const { stdout } = await run(
    "ffmpeg",
    ["-hide_banner", "-v", "error", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout as unknown as Buffer;
}

const mae = (a: Buffer, b: Buffer) => {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
};

export async function checkTrailer(file: string, o: { target: number; width: number; height: number; range?: [number, number] }) {
  const { stdout: fmt } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels,nb_frames",
    "-of", "json", file,
  ]);
  const info = JSON.parse(fmt) as { format: { duration: string }; streams: Record<string, string | number>[] };
  const { stdout: frames } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=width,height", "-of", "csv=p=0", file], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows = frames.trim().split(/\r?\n/).map((l) => l.trim().replace(/,$/, ""));
  const sizes = new Set(rows);
  const duration = Number(info.format.duration);

  // Title card is a still: a frame 1s before the end matches the very last frame,
  // while a frame inside the last shot does not.
  const lastFrame = await grayFrame(file, duration - 0.1);
  const cardDiff = mae(await grayFrame(file, duration - 1.0), lastFrame);
  const shotDiff = mae(await grayFrame(file, duration - TITLE_CARD_SECONDS - 0.6), lastFrame);

  const [lo, hi] = o.range ?? [13, 16];
  const checks = {
    oneResolution: sizes.size === 1 && sizes.has(`${o.width},${o.height}`),
    durationWithin0_2: Math.abs(duration - o.target) <= 0.2,
    durationInRange: duration >= lo - 0.2 && duration <= hi + 0.2,
    titleCardAtEnd: cardDiff < 3 && shotDiff > 10,
  };

  console.log("ffprobe streams:", JSON.stringify(info.streams));
  console.log(`frames=${rows.length} resolutions=${[...sizes].join(" | ")}`);
  console.log(`duration=${duration.toFixed(3)}s target=${o.target.toFixed(3)}s delta=${(duration - o.target).toFixed(3)}s`);
  console.log(`title card at end: MAE(end-1s vs last frame)=${cardDiff.toFixed(2)}, MAE(last shot vs last frame)=${shotDiff.toFixed(2)}`);
  console.log("checks:", checks);
  return { pass: Object.values(checks).every(Boolean), checks, duration, frames: rows.length, streams: info.streams };
}
