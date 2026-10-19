/**
 * DONE TEST for the stitcher (Prompt 6), node path. Runs the SAME ffmpeg
 * argument builders the browser uses (lib/stitchPlan.ts) with native ffmpeg,
 * on clips already in public/renders/ — no Comfy calls, no credits.
 *
 *   npx tsx scripts/stitch-test.ts [clip1.mp4 clip2.mp4 ...]
 *
 * The browser path (ffmpeg.wasm + canvas title card) is scripts/stitch-browser.ts.
 * Output: .tmp/stitch/trailer.mp4.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { RENDER_SIZE } from "../lib/renderConfig";
import { buildCardArgs, buildStitchArgs, COLD_OPEN_SECONDS, plannedDuration, TITLE_CARD_SECONDS, trailerSegments } from "../lib/stitchPlan";
import { checkTrailer, loadTestProject } from "./stitchTestKit";

const run = promisify(execFile);
const OUT = path.join(process.cwd(), ".tmp", "stitch");
const { width: W, height: H } = RENDER_SIZE["16:9"];
const fwd = (p: string) => p.replace(/\\/g, "/").replace(":", "\\:");

async function ff(args: string[]) {
  try {
    return await run("ffmpeg", args, { maxBuffer: 256 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stderr?: string };
    throw new Error(`ffmpeg failed:\n${(e.stderr ?? String(err)).split("\n").slice(-15).join("\n")}`);
  }
}

/** Node stand-in for the browser's canvas card: dark frame, letterbox bars, serif title (+ tagline). */
async function cardPng(name: string, title: string, tagline?: string) {
  const bar = Math.max(0, Math.round((H - W / 2.39) / 2));
  const tf = path.join(OUT, `${name}-title.txt`);
  writeFileSync(tf, title.toUpperCase());
  const parts = [
    `drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill`,
    `drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`,
    `drawtext=fontfile='${fwd("C:/Windows/Fonts/georgiab.ttf")}':textfile='${fwd(tf)}':fontcolor=0xF5E6C8:fontsize=${Math.round(H * 0.11)}:x=(w-tw)/2:y=(h-th)/2-${tagline ? Math.round(H * 0.05) : 0}`,
  ];
  if (tagline) {
    const gf = path.join(OUT, `${name}-tagline.txt`);
    writeFileSync(gf, tagline);
    parts.push(
      `drawtext=fontfile='${fwd("C:/Windows/Fonts/georgiai.ttf")}':textfile='${fwd(gf)}':fontcolor=0xBFB6A6:fontsize=${Math.round(H * 0.045)}:x=(w-tw)/2:y=h/2+${Math.round(H * 0.07)}`,
    );
  }
  const png = path.join(OUT, `${name}.png`);
  await ff(["-hide_banner", "-y", "-f", "lavfi", "-i", `color=c=0x0a0806:s=${W}x${H}:d=1`, "-vf", parts.join(","), "-frames:v", "1", png]);
  return png;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { project, shots, clips } = await loadTestProject(process.argv.slice(2));

  const t0 = Date.now();
  const endMp4 = path.join(OUT, "end.mp4");
  const coldMp4 = path.join(OUT, "cold.mp4");
  await ff(buildCardArgs(await cardPng("end", project.title, project.tagline), TITLE_CARD_SECONDS, { width: W, height: H, output: endMp4 }));
  await ff(buildCardArgs(await cardPng("cold", project.title), COLD_OPEN_SECONDS, { width: W, height: H, output: coldMp4 }));

  const segments = trailerSegments(
    clips.map((c, i) => ({ file: c.file, seconds: shots[i].seconds, hasAudio: c.hasAudio })),
    { endFile: endMp4, coldOpenFile: coldMp4 },
  );
  const target = plannedDuration(segments);
  const out = path.join(OUT, "trailer.mp4");
  const args = buildStitchArgs(segments, { width: W, height: H, output: out });
  writeFileSync(path.join(OUT, "filter_complex.txt"), args[args.indexOf("-filter_complex") + 1].split(";").join(";\n"));
  await ff(args);
  console.log(`Stitched in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}\n`);

  const res = await checkTrailer(out, { target, width: W, height: H });
  if (!res.pass) process.exit(1);
  console.log("STITCH DONE TEST (node/ffmpeg): PASS");
}

main().catch((err) => {
  console.error("FAILED", err instanceof Error ? err.message : err);
  process.exit(1);
});
