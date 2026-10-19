/**
 * Live end-to-end batch through a running dev server, every HTTP call via curl
 * (no browser). SPENDS PAID CREDITS: renders 4 shots.
 *   LLM_MOCK=1 npx next dev -p 3100   (in another shell)
 *   npx tsx scripts/e2e-batch.ts [baseUrl]
 * Mock shot list -> first 4 shots at 2s -> POST /api/shot (max 3 concurrent)
 * -> poll GET /api/shot/[jobId] every 4s -> POST .../rehost -> check clip URL.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLimiter } from "../lib/limiter";
import { MAX_CONCURRENT_RENDERS, RENDER_SIZE, type Aspect } from "../lib/renderConfig";
import { shotToPrompt, type Shot } from "../lib/shot";

const BASE = process.argv[2] ?? "http://localhost:3100";
const ASPECT: Aspect = "16:9";
const SHOTS = 4;
const SECONDS = 2;
const POLL_MS = 4000;
const TIMEOUT_MS = 15 * 60_000;

const run = promisify(execFile);

/** curl -> { status, headers, body }. */
async function curl(method: string, url: string, body?: unknown, headOnly = false) {
  const args = ["-sS", "-X", method, "-o", "-", "-D", "-", "--max-time", "300"];
  if (headOnly) args.splice(args.indexOf("-o"), 2, "-o", process.platform === "win32" ? "NUL" : "/dev/null");
  if (body !== undefined) args.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body));
  args.push(url);
  const { stdout } = await run("curl", args, { maxBuffer: 64 * 1024 * 1024 });
  // Skip interim "HTTP/1.1 100 Continue" blocks.
  const blocks = stdout.split(/\r?\n\r?\n/);
  let i = 0;
  while (/^HTTP\/\S+ 1\d\d/.test(blocks[i] ?? "") && i < blocks.length - 1) i++;
  const head = blocks[i];
  const status = Number(/^HTTP\/\S+ (\d+)/.exec(head)?.[1] ?? 0);
  const headers = Object.fromEntries(
    head
      .split(/\r?\n/)
      .slice(1)
      .map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]),
  );
  return { status, headers, body: blocks.slice(i + 1).join("\n\n") };
}

async function curlJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await curl(method, url, body);
  let data: unknown;
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new Error(`${method} ${url} -> ${res.status}, non-JSON body: ${res.body.slice(0, 200)}`);
  }
  if (res.status >= 400) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

type Result = { shot: number; jobId?: string; state: string; renderS?: number; clipUrl?: string; clipCheck?: string; error?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let active = 0;
let peak = 0;

async function renderOne(n: number, shot: Shot, seed: number): Promise<Result> {
  peak = Math.max(peak, ++active);
  const t0 = Date.now();
  const r: Result = { shot: n, state: "queued" };
  try {
    const sub = await curlJson<{ videoJobId: string; frameJobId: string }>("POST", `${BASE}/api/shot`, {
      prompt: shotToPrompt(shot),
      seed,
      aspect: ASPECT,
      ...RENDER_SIZE[ASPECT],
      seconds: shot.seconds,
    });
    r.jobId = sub.videoJobId;
    console.log(`[shot ${n}] submitted video job ${r.jobId} (frame ${sub.frameJobId}) after ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    let last = "";
    while (Date.now() - t0 < TIMEOUT_MS) {
      const st = await curlJson<{ status: string; progress?: number; error?: string }>("GET", `${BASE}/api/shot/${r.jobId}`);
      const line = `${st.status}${typeof st.progress === "number" ? ` ${Math.round(st.progress * 100)}%` : ""}`;
      if (line !== last) console.log(`[shot ${n}] ${line}`);
      last = line;
      if (st.status === "succeeded") break;
      if (["failed", "canceled", "expired"].includes(st.status)) throw new Error(`job ${st.status}: ${st.error ?? ""}`);
      await sleep(POLL_MS);
    }
    if (last.split(" ")[0] !== "succeeded") throw new Error("timed out");
    r.renderS = (Date.now() - t0) / 1000;

    const host = await curlJson<{ url: string; storage: string; contentType: string; sizeBytes: number }>(
      "POST",
      `${BASE}/api/shot/${r.jobId}/rehost`,
      {},
    );
    r.clipUrl = host.url;
    const abs = host.url.startsWith("http") ? host.url : `${BASE}${host.url}`;
    const check = await curl("GET", abs, undefined, true);
    r.clipCheck = `${check.status} ${check.headers["content-type"] ?? "?"} ${check.headers["content-length"] ?? "?"}B (${host.storage})`;
    if (check.status !== 200 || !String(check.headers["content-type"]).startsWith("video/"))
      throw new Error(`clip URL check failed: ${r.clipCheck}`);
    r.state = "done";
  } catch (err) {
    r.state = "failed";
    r.error = err instanceof Error ? err.message : String(err);
    r.renderS ??= (Date.now() - t0) / 1000;
  } finally {
    active--;
  }
  console.log(`[shot ${n}] ${r.state} in ${r.renderS?.toFixed(1)}s${r.error ? `: ${r.error}` : ""}`);
  return r;
}

async function main() {
  const t0 = Date.now();
  const list = await curlJson<{ shots: Shot[]; title: string; provider?: string }>("POST", `${BASE}/api/shotlist`, {
    logline: "A retired robot opens a noodle shop on Mars",
    aspect: ASPECT,
  });
  console.log(`Shot list "${list.title}" provider=${list.provider ?? "?"}: ${list.shots.length} shots, using first ${SHOTS} at ${SECONDS}s`);
  const shots = list.shots.slice(0, SHOTS).map((s) => ({ ...s, seconds: SECONDS }));

  const limit = createLimiter(MAX_CONCURRENT_RENDERS);
  const results = await Promise.all(shots.map((s, i) => limit.run(() => renderOne(i + 1, s, 20261019 + i))));

  console.log(`\nPeak concurrent jobs: ${peak}`);
  console.table(results.map(({ shot, jobId, state, renderS, clipUrl, clipCheck, error }) => ({ shot, jobId, state, renderS, clipUrl, clipCheck, error })));
  console.log(`Total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (results.some((r) => r.state !== "done") || peak > MAX_CONCURRENT_RENDERS) process.exit(1);
}

main().catch((err) => {
  console.error("FAILED", err);
  process.exit(1);
});
