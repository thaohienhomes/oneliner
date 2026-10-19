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

/** curl -> status, headers, body (headers of the final response). */
async function curl(url: string, head = false) {
  const args = ["-sS", "-D", "-", "-o", head ? (process.platform === "win32" ? "NUL" : "/dev/null") : "-", "--max-time", "60", url];
  if (head) args.unshift("-r", "0-0"); // tiny ranged GET, avoids pulling the whole MP4
  const { stdout } = await run("curl", args, { maxBuffer: 64 * 1024 * 1024 });
  const [headBlock, ...rest] = stdout.split(/\r?\n\r?\n/);
  const status = Number(/^HTTP\/\S+ (\d+)/.exec(headBlock)?.[1] ?? 0);
  const headers = Object.fromEntries(
    headBlock
      .split(/\r?\n/)
      .slice(1)
      .map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]),
  );
  return { status, headers, body: rest.join("\n\n") };
}

const metaContent = (html: string, prop: string) =>
  new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]+)"`).exec(html)?.[1] ??
  new RegExp(`<meta[^>]+name="${prop}"[^>]+content="([^"]+)"`).exec(html)?.[1];

/** Prompt 7 DONE TEST: share page OG tags, MP4 URL, poster, gallery. */
export async function checkPublished(base: string, id: string) {
  const page = await curl(`${base}/t/${id}`);
  const ogVideo = metaContent(page.body, "og:video") ?? metaContent(page.body, "og:video:url");
  const ogImage = metaContent(page.body, "og:image");
  const twCard = metaContent(page.body, "twitter:card");
  console.log(`curl /t/${id} -> ${page.status}; og:video=${ogVideo}; og:image=${ogImage}; twitter:card=${twCard}`);

  const full = ogVideo ? await curl(ogVideo.replace(/&amp;/g, "&")) : null;
  const ranged = ogVideo ? await curl(ogVideo.replace(/&amp;/g, "&"), true) : null;
  console.log(
    `curl MP4 -> ${full?.status} ${full?.headers["content-type"]} ${full?.headers["content-length"]}B; ranged -> ${ranged?.status} ${ranged?.headers["content-range"]}`,
  );
  const img = ogImage ? await curl(ogImage.replace(/&amp;/g, "&"), true) : null;
  console.log(`curl poster -> ${img?.status} ${img?.headers["content-type"]}`);

  const home = await curl(`${base}/`);
  const inGallery = home.body.includes(`href="/t/${id}"`);
  console.log(`curl / -> ${home.status}; gallery lists /t/${id}: ${inGallery}`);

  const shareX = /href="https:\/\/twitter\.com\/intent\/tweet\?[^"]*OpenSourceHiggsfield/.test(page.body);
  const checks = {
    pageOk: page.status === 200,
    ogVideo: !!ogVideo,
    ogImage: !!ogImage,
    mp4Is200VideoMp4: full?.status === 200 && full.headers["content-type"] === "video/mp4",
    mp4Ranged206: ranged?.status === 206,
    posterIsJpeg: (img?.status === 200 || img?.status === 206) && img.headers["content-type"] === "image/jpeg",
    galleryListsIt: home.status === 200 && inGallery,
    shareIntentWithHashtag: shareX,
  };
  console.log("checks:", checks);
  return Object.values(checks).every(Boolean);
}

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
