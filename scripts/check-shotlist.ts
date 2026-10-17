/**
 * DONE TEST for POST /api/shotlist. Needs a running dev server.
 *   npx tsx scripts/check-shotlist.ts [baseUrl]
 */
import { MAX_TOTAL_SECONDS, SHOT_COUNT } from "../lib/renderConfig";
import { ShotListSchema, totalSeconds } from "../lib/shot";

const BASE = process.argv[2] ?? "http://localhost:3000";

async function check(logline: string, aspect: "16:9" | "9:16", banned: RegExp[] = []) {
  const res = await fetch(`${BASE}/api/shotlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logline, aspect }),
  });
  const body = await res.json();
  const fails: string[] = [];
  if (!res.ok) fails.push(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  const parsed = ShotListSchema.safeParse(body);
  if (!parsed.success) fails.push(`schema: ${parsed.error.message}`);
  const shots: { seconds: number }[] = body.shots ?? [];
  if (shots.length < SHOT_COUNT.min || shots.length > SHOT_COUNT.max) fails.push(`shot count ${shots.length}`);
  if (!shots.every((s) => Number.isInteger(s.seconds))) fails.push("non-integer seconds");
  if (totalSeconds(shots) > MAX_TOTAL_SECONDS) fails.push(`total ${totalSeconds(shots)}s`);
  const text = JSON.stringify({ title: body.title, tagline: body.tagline, shots: body.shots });
  for (const re of banned) if (re.test(text)) fails.push(`banned term ${re} still present`);

  console.log(`\n"${logline}" (${aspect}) -> provider=${body.provider}`);
  console.log(`  title: ${body.title} | tagline: ${body.tagline} | size: ${JSON.stringify(body.size)}`);
  console.log(`  shots: ${shots.length}, total ${totalSeconds(shots)}s, seconds=[${shots.map((s) => s.seconds).join(",")}]`);
  if (body.replacements?.length) console.log(`  replacements: ${JSON.stringify(body.replacements)}`);
  console.log(`  shot 1 action: ${body.shots?.[0]?.action}`);
  console.log(fails.length ? `  FAIL: ${fails.join("; ")}` : "  PASS");
  return fails.length === 0;
}

async function main() {
  const results = [
    await check("A retired robot opens a noodle shop on Mars", "16:9"),
    await check("Batman opens a bakery in Gotham", "16:9", [/batman/i, /gotham/i]),
    await check("Batman opens a bakery in Gotham to pay off the Joker", "9:16", [/batman/i, /gotham/i, /joker/i]),
  ];
  process.exitCode = results.every(Boolean) ? 0 : 1;
}

main();
