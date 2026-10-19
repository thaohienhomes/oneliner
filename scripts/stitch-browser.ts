/**
 * DONE TEST for the stitcher (Prompt 6), browser path: drives the real editor
 * in headless Edge/Chrome (playwright-core, system browser, no download) so
 * ffmpeg.wasm + the canvas title card run for real. No Comfy calls: the
 * project is seeded into localStorage with clips already in public/renders/.
 *
 *   npx next start -p 3100   (or dev)   then   npx tsx scripts/stitch-browser.ts [baseUrl] [--publish]
 *
 * --publish also clicks Publish (Prompt 7) and checks the share page, MP4 URL
 * and home gallery with curl.
 *
 * Saves the stitched MP4 from the page to .tmp/stitch/browser-trailer.mp4
 * and runs the same ffprobe checks as scripts/stitch-test.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { RENDER_SIZE } from "../lib/renderConfig";
import { COLD_OPEN_SECONDS, TITLE_CARD_SECONDS } from "../lib/stitchPlan";
import { STORAGE_KEY } from "../src/store/editorStore";
import { checkPublished, checkTrailer, loadTestProject } from "./stitchTestKit";

const BASE = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3100";
const OUT = path.join(process.cwd(), ".tmp", "stitch");
const { width: W, height: H } = RENDER_SIZE["16:9"];

async function launch() {
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try the next installed browser */
    }
  }
  throw new Error("No system Edge/Chrome found for playwright-core.");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { project, shots, clips } = await loadTestProject();
  const state = {
    logline: "A retired robot opens a noodle shop on Mars",
    aspect: "16:9",
    title: project.title,
    tagline: project.tagline,
    shots,
    provider: "mock",
    renders: Object.fromEntries(
      shots.map((s, i) => [s.id, { state: "done", seed: 20261019 + i, clipUrl: `/renders/${path.basename(clips[i].file)}`, progress: 1 }]),
    ),
  };
  const target = COLD_OPEN_SECONDS + shots.reduce((t, s) => t + s.seconds, 0) + TITLE_CARD_SECONDS;

  const browser = await launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    await page.goto(BASE);
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify({ state, version: 1 })] as const);
    await page.reload();

    const t0 = Date.now();
    await page.getByRole("button", { name: "Stitch trailer" }).click();
    const labels = new Set<string>();
    const poll = setInterval(() => {
      page
        .locator('[aria-label="Trailer"] [aria-live="polite"]')
        .textContent({ timeout: 500 })
        .then((t) => t && labels.add(t.replace(/[\d.]+s \/.*/, "…")))
        .catch(() => undefined);
    }, 300);
    const video = page.locator('video[aria-label="Trailer preview"]');
    try {
      await Promise.race([
        video.waitFor({ timeout: 5 * 60_000 }),
        page
          .locator('[aria-label="Trailer"] [role="alert"]')
          .waitFor({ timeout: 5 * 60_000 })
          .then(async () => {
            throw new Error(`Stitch error shown: ${await page.locator('[aria-label="Trailer"] [role="alert"]').textContent()}`);
          }),
      ]);
    } catch (err) {
      await page.screenshot({ path: path.join(OUT, "browser-fail.png") }).catch(() => undefined);
      throw new Error(`${err instanceof Error ? err.message.split("\n")[0] : err}\n  stages: ${[...labels].join(" -> ")}\n  page errors: ${errors.join(" | ") || "none"}`);
    } finally {
      clearInterval(poll);
    }
    const seconds = (Date.now() - t0) / 1000;

    const b64 = await video.evaluate(async (v: HTMLVideoElement) => {
      const buf = new Uint8Array(await (await fetch(v.src)).arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const file = path.join(OUT, "browser-trailer.mp4");
    writeFileSync(file, Buffer.from(b64, "base64"));
    const download = await page.getByRole("link", { name: "Download MP4" }).getAttribute("download");
    console.log(`Browser stitch took ${seconds.toFixed(1)}s; stages: ${[...labels].join(" -> ")}`);
    console.log(`Download link file name: ${download}; page errors: ${errors.length ? errors.join(" | ") : "none"}\n`);

    const res = await checkTrailer(file, { target, width: W, height: H });
    if (!res.pass || !download) process.exit(1);
    console.log("STITCH DONE TEST (browser/ffmpeg.wasm): PASS");

    if (process.argv.includes("--publish")) {
      // Prompt 7 DONE TEST: click Publish (local adapter), then check with curl.
      await page.getByRole("button", { name: "Publish" }).click();
      const link = page.getByRole("link", { name: /View share page/ });
      await Promise.race([
        link.waitFor({ timeout: 60_000 }),
        page
          .locator('[aria-label="Trailer"] [role="alert"]')
          .waitFor({ timeout: 60_000 })
          .then(async () => {
            throw new Error(`Publish error shown: ${await page.locator('[aria-label="Trailer"] [role="alert"]').textContent()}`);
          }),
      ]);
      const href = (await link.getAttribute("href"))!;
      const id = href.split("/").pop()!;
      console.log(`\nPublished: ${href}`);
      const ok = await checkPublished(BASE, id);
      if (!ok) process.exit(1);
      console.log("PUBLISH DONE TEST: PASS");
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("FAILED", err instanceof Error ? err.message : err);
  process.exit(1);
});
