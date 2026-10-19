/**
 * Prompt 8 DONE TEST, end to end, ZERO credits:
 *   - starts a fake Comfy (127.0.0.1:3199) that records every request and
 *     answers 401, so the real Comfy Cloud is never contacted;
 *   - starts the built app (`next start -p 3101`) with DAILY_RENDER_LIMIT=2,
 *     DEMO_MODE off, COMFY_BASE_URL -> fake Comfy, a fake COMFY_API_KEY;
 *   - drives the real editor (playwright-core + system Edge/Chrome): a 4-shot
 *     project, click "Render trailer";
 *   - expects shots 1-2 to reach (fake) Comfy and fail with the friendly 401
 *     toast, and shots 3-4 to be refused with the daily-budget message, with
 *     no Comfy request for them.
 * Kills its own server process tree at the end.
 *
 *   npm run build && npx tsx scripts/cost-guard-e2e.ts
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { DAILY_LIMIT_MESSAGE } from "../lib/quota";
import { mockShotList } from "../lib/shotList";
import { STORAGE_KEY } from "../src/store/editorStore";

const APP_PORT = 3101;
const COMFY_PORT = 3199;
const BASE = `http://localhost:${APP_PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. Fake Comfy.
  const comfyHits: { at: number; method: string; path: string }[] = [];
  const comfy = createServer((req, res) => {
    comfyHits.push({ at: Date.now(), method: req.method ?? "?", path: (req.url ?? "").split("?")[0] });
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "unauthorized", message: "fake comfy: invalid api key" } }));
  });
  await new Promise<void>((r) => comfy.listen(COMFY_PORT, "127.0.0.1", r));

  // 2. The built app with the cost guard on.
  const env = {
    ...process.env,
    DAILY_RENDER_LIMIT: "2",
    GLOBAL_DAILY_SHOTS: "300",
    DEMO_MODE: "",
    LLM_MOCK: "1",
    COMFY_BASE_URL: `http://127.0.0.1:${COMFY_PORT}`,
    COMFY_API_KEY: "fake-key-for-cost-guard-test",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
  };
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  const serverLog: string[] = [];
  app.stdout.on("data", (d) => serverLog.push(String(d)));
  app.stderr.on("data", (d) => serverLog.push(String(d)));

  const browser = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ channel: "chrome", headless: true }));
  try {
    for (let i = 0; ; i++) {
      if (i > 60) throw new Error(`app did not start:\n${serverLog.join("")}`);
      const ok = await fetch(BASE).then((r) => r.ok).catch(() => false);
      if (ok) break;
      await sleep(500);
    }

    const list = mockShotList("A retired robot opens a noodle shop on Mars", "16:9");
    const shots = list.shots.slice(0, 4);
    const page = await browser.newPage();
    await page.goto(BASE);
    const state = { logline: "A retired robot opens a noodle shop on Mars", aspect: "16:9", title: list.title, tagline: list.tagline, shots, provider: "mock", renders: {} };
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify({ state, version: 1 })] as const);
    await page.reload();

    // Record when each POST /api/shot is answered, to line up with Comfy hits.
    const answers: { at: number; status: number; shotIndex: number; error?: string }[] = [];
    page.on("response", async (res) => {
      if (res.url() !== `${BASE}/api/shot` || res.request().method() !== "POST") return;
      const body = JSON.parse(res.request().postData() ?? "{}");
      const data = await res.json().catch(() => ({}));
      answers.push({ at: Date.now(), status: res.status(), shotIndex: body.shotIndex, error: data.error });
    });

    await page.getByRole("button", { name: "Render trailer" }).click();
    for (let n = 1; n <= 4; n++) await page.getByLabel(`Shot ${n} render state`).filter({ hasText: "Failed" }).waitFor({ timeout: 60_000 });
    await page.getByText("Daily budget reached").first().waitFor({ timeout: 10_000 });

    // Toasts first (they auto-dismiss after 7s).
    const toasts = await page.locator('[aria-live="assertive"] [role="status"] p:first-child').allTextContents();
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-label="Storyboard"] article')].map((a, i) => ({
        shot: i + 1,
        message: a.querySelector('p[class*="text-red-400"]')?.textContent?.trim() ?? null,
      })),
    );
    answers.sort((a, b) => a.shotIndex - b.shotIndex);

    console.log("POST /api/shot answers:", JSON.stringify(answers.map(({ shotIndex, status, error }) => ({ shot: shotIndex + 1, status, error }))));
    console.log("shot card messages:", JSON.stringify(cards));
    console.log("toasts:", JSON.stringify(toasts));
    console.log(`fake Comfy hits: ${comfyHits.length}`, JSON.stringify(comfyHits.map((h) => `${h.method} ${h.path}`)));

    const refused = answers.filter((a) => a.status === 429);
    const lastComfyHit = Math.max(0, ...comfyHits.map((h) => h.at));
    const checks = {
      shots1and2ReachedComfy: answers.filter((a) => a.shotIndex < 2).every((a) => a.status === 401) && comfyHits.length >= 2,
      shots3and4Refused429: refused.length === 2 && refused.every((a) => a.shotIndex >= 2 && a.error === "daily_limit"),
      friendlyMessageOnCards: cards.slice(2).every((c) => c.message === DAILY_LIMIT_MESSAGE),
      toasts: toasts.includes("Daily budget reached") && toasts.includes("Comfy key rejected"),
      // One submit per allowed shot; nothing reached Comfy on behalf of the refused shots.
      comfySubmitsOnlyForAllowedShots: comfyHits.filter((h) => h.method === "POST").length === 2,
      noRawErrorsShown: !cards.some((c) => /fake comfy|stack|at \w+ \(/.test(c.message ?? "")),
    };
    console.log("checks:", checks, `(last Comfy hit ${lastComfyHit ? "recorded" : "none"})`);
    if (!Object.values(checks).every(Boolean)) {
      console.log("server log tail:\n" + serverLog.join("").split("\n").slice(-20).join("\n"));
      process.exitCode = 1;
    } else console.log("COST GUARD DONE TEST: PASS");
  } finally {
    await browser.close();
    comfy.close();
    // Kill the whole app tree (next start spawns workers).
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* already gone */
      }
    } else app.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("FAILED", err instanceof Error ? err.message : err);
  process.exit(1);
});
