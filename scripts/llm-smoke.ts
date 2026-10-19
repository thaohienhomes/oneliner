/**
 * DONE TEST for the real LLM path (REAL NETWORK, a handful of Groq calls).
 *   npx tsx scripts/llm-smoke.ts
 * Reads the key from .env.local (LLM_API_KEY or GROQ_API_KEY) and never prints it.
 * Runs 3 loglines through generateShotList on the primary model, then 1 call
 * pinned to the fallback model. Hard cap: MAX_CALLS HTTP requests in total.
 */
import { loadEnvConfig } from "@next/env";
import { guardIP } from "../lib/ipGuard";
import { llmConfig, type Attempt } from "../lib/llm";
import { MAX_TOTAL_SECONDS, SHOT_COUNT } from "../lib/renderConfig";
import { ShotListSchema, totalSeconds } from "../lib/shot";
import { generateShotList, type ShotListResult } from "../lib/shotList";

loadEnvConfig(process.cwd());
delete process.env.LLM_MOCK;

const MAX_CALLS = 6;
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  if (++calls > MAX_CALLS) throw new Error(`smoke: call budget of ${MAX_CALLS} exceeded`);
  return realFetch(...args);
}) as typeof fetch;

type Case = { id: string; logline: string; banned: RegExp[]; fallbackOnly?: boolean };
const CASES: Case[] = [
  { id: "a heist comedy", logline: "Three clumsy grandmas plan a jewel heist at their retirement home's talent show", banned: [] },
  { id: "b sci-fi survival", logline: "A stranded botanist must keep a dying greenhouse alive on a frozen moon", banned: [] },
  { id: "c names Batman", logline: "Batman opens a bakery in Gotham to pay off the Joker", banned: [/batman/i, /gotham/i, /joker/i, /bruce wayne/i] },
  { id: "d fallback model", logline: "A shy lighthouse keeper befriends a lost sea serpent", banned: [], fallbackOnly: true },
];

function check(c: Case, out: ShotListResult) {
  const fails: string[] = [];
  if (out.provider !== "llm") fails.push(`provider=${out.provider} (LLM fell back to mock)`);
  if (!ShotListSchema.safeParse(out).success) fails.push("schema");
  if (out.shots.length < SHOT_COUNT.min || out.shots.length > SHOT_COUNT.max) fails.push(`shots=${out.shots.length}`);
  if (totalSeconds(out.shots) > MAX_TOTAL_SECONDS) fails.push(`total=${totalSeconds(out.shots)}s`);
  const text = JSON.stringify({ title: out.title, tagline: out.tagline, shots: out.shots });
  const leftover = guardIP(text).replacements.map((r) => r.from);
  const banned = c.banned.filter((re) => re.test(text)).map(String);
  const ipOk = leftover.length === 0 && banned.length === 0;
  if (!ipOk) fails.push(`IP: ${[...leftover, ...banned].join(", ")}`);
  return { valid: !fails.some((f) => !f.startsWith("IP")), ipOk, fails };
}

async function main() {
  const cfg = llmConfig();
  if (!cfg) throw new Error("No LLM_API_KEY / GROQ_API_KEY in env");
  console.log(`base=${cfg.baseURL} models=${cfg.models.join(" -> ")} (key loaded, not shown)\n`);

  const rows: string[][] = [];
  let example: ShotListResult | undefined;
  let allOk = true;
  for (const c of CASES) {
    if (c.fallbackOnly && cfg.models.length < 2) continue;
    const config = c.fallbackOnly ? { ...cfg, models: [cfg.models[1]] } : cfg;
    let attempts: Attempt[] = [];
    const t0 = Date.now();
    const out = await generateShotList(c.logline, "16:9", { config, onAttempts: (a) => (attempts = a) });
    const ms = Date.now() - t0;
    const r = check(c, out);
    allOk &&= r.valid && r.ipOk;
    const repaired = attempts.some((a) => a.repaired) ? " (repaired)" : "";
    rows.push([c.id, `${ms}ms`, out.model + repaired, `${out.shots.length} / ${totalSeconds(out.shots)}s`, r.valid ? "yes" : "NO", r.ipOk ? "pass" : "FAIL"]);
    if (r.fails.length) console.log(`  ${c.id}: ${r.fails.join("; ")}`);
    for (const a of attempts) if (!a.ok) console.log(`  ${c.id}: ${a.model} failed after ${a.ms}ms: ${a.error}`);
    if (c.id.startsWith("c")) example = out;
  }

  const head = ["case", "latency", "model", "shots / total", "schema-valid", "IP guard"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => `| ${r.map((v, i) => v.padEnd(widths[i])).join(" | ")} |`;
  console.log([line(head), `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`, ...rows.map(line)].join("\n"));
  console.log(`\nGroq HTTP calls: ${calls}/${MAX_CALLS}`);
  console.log(`\nExample output (case c, "${CASES[2].logline}"):`);
  console.log(JSON.stringify(example, null, 2));
  console.log(allOk ? "\nPASS" : "\nFAIL");
  process.exitCode = allOk ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
