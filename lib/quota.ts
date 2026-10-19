/**
 * Daily render budget (cost guard), checked in POST /api/shot BEFORE any Comfy
 * call. Counts shots: per IP (DAILY_RENDER_LIMIT) and globally
 * (GLOBAL_DAILY_SHOTS). Store, first match wins:
 *   1. DATABASE_URL       -> Neon Postgres `usage` table (db/schema.sql), one
 *                            atomic statement per request, IPs stored hashed.
 *   2. UPSTASH_REDIS_*    -> Upstash Redis (REST API, no SDK).
 *   3. otherwise          -> this process's memory (local dev; resets on restart).
 */
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const DAILY_LIMIT_MESSAGE = "Daily studio budget used — watch the gallery or run it locally";

export interface IncrCounterStore {
  readonly kind: "upstash" | "memory";
  /** Increment and return the new value; the key expires after ttlSeconds. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export interface PostgresCounterStore {
  readonly kind: "postgres";
  /** Atomically check + add `n` shots to the IP row and the global row for `day` (YYYY-MM-DD, UTC). */
  take(ip: string, day: string, limits: { perIp: number; global: number }, n?: number): Promise<QuotaResult>;
}

export type CounterStore = IncrCounterStore | PostgresCounterStore;

export function memoryCounterStore(now: () => number = Date.now): IncrCounterStore {
  const map = new Map<string, { n: number; expires: number }>();
  return {
    kind: "memory",
    async incr(key, ttlSeconds) {
      const t = now();
      const cur = map.get(key);
      const next = cur && cur.expires > t ? { n: cur.n + 1, expires: cur.expires } : { n: 1, expires: t + ttlSeconds * 1000 };
      map.set(key, next);
      if (map.size > 10_000) for (const [k, v] of map) if (v.expires <= t) map.delete(k);
      return next.n;
    },
  };
}

export function upstashCounterStore(url: string, token: string): IncrCounterStore {
  return {
    kind: "upstash",
    async incr(key, ttlSeconds) {
      const res = await fetch(`${url.replace(/\/+$/, "")}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["INCR", key],
          ["EXPIRE", key, String(ttlSeconds), "NX"],
        ]),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Upstash ${res.status}`);
      const out = (await res.json()) as { result?: number; error?: string }[];
      if (typeof out[0]?.result !== "number") throw new Error(`Upstash: ${out[0]?.error ?? "bad response"}`);
      return out[0].result;
    },
  };
}

/** Parameterized query: `$1..$n` placeholders + values, resolves to rows. */
export type SqlQuery = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export const GLOBAL_ROW = "__global__";
const SALT_CONSTANT = "oneliner-usage-v1";

/** Per-deployment salt: derived from DATABASE_URL so it is secret but needs no extra env var. Never log it. */
export const usageSalt = (databaseUrl: string) => createHash("sha256").update(`${databaseUrl}:${SALT_CONSTANT}`).digest("hex");
/** What we store instead of the raw IP. */
export const hashIp = (ip: string, salt: string) => createHash("sha256").update(`${salt}:${ip}`).digest("hex");

/**
 * One statement: read both rows, guard on both limits, then upsert both rows.
 * $1 hashed ip, $2 day, $3 n, $4 per-IP limit, $5 global limit.
 * - The guard uses the statement snapshot; ON CONFLICT ... DO UPDATE ... WHERE
 *   rechecks each row's limit against the latest locked row version, so a
 *   concurrent request can never push a row over its limit.
 * - Brand-new rows are inserted with shots = n, which the guard already
 *   checked against 0 + n <= limit (so a limit of 0 always denies).
 * - Always returns >= 1 row: the pre-read counts, LEFT JOINed with the 0-2
 *   rows actually written.
 */
export const TAKE_SHOTS_SQL = `WITH cur AS (
  SELECT
    COALESCE((SELECT shots FROM usage WHERE ip = $1::text AND day = $2::date), 0) AS ip_shots,
    COALESCE((SELECT shots FROM usage WHERE ip = '${GLOBAL_ROW}' AND day = $2::date), 0) AS global_shots
),
guard AS (
  SELECT 1 FROM cur WHERE ip_shots + $3::int <= $4::int AND global_shots + $3::int <= $5::int
),
ins AS (
  INSERT INTO usage (ip, day, shots)
  SELECT v.ip, $2::date, $3::int
  FROM (VALUES ($1::text), ('${GLOBAL_ROW}')) AS v(ip)
  WHERE EXISTS (SELECT 1 FROM guard)
  ON CONFLICT (ip, day) DO UPDATE
    SET shots = usage.shots + EXCLUDED.shots
    WHERE usage.shots + EXCLUDED.shots <= (CASE WHEN usage.ip = '${GLOBAL_ROW}' THEN $5::int ELSE $4::int END)
  RETURNING ip, shots
)
SELECT cur.ip_shots, cur.global_shots, ins.ip, ins.shots
FROM cur LEFT JOIN ins ON true`;

export const UNDO_SHOTS_SQL = "UPDATE usage SET shots = shots - $3::int WHERE ip = $1::text AND day = $2::date";

export function postgresCounterStore(databaseUrl: string, query?: SqlQuery): PostgresCounterStore {
  const salt = usageSalt(databaseUrl);
  let q = query;
  // neon() is lazy (no connection until the first query); HTTP, so nothing to pool or close.
  const run: SqlQuery = (text, params) => {
    if (!q) {
      const sql = neon(databaseUrl);
      q = (t, p) => sql.query(t, p) as Promise<Record<string, unknown>[]>;
    }
    return q(text, params);
  };
  return {
    kind: "postgres",
    async take(ip, day, limits, n = 1) {
      const h = hashIp(ip, salt);
      const rows = await run(TAKE_SHOTS_SQL, [h, day, n, limits.perIp, limits.global]);
      if (!rows.length) throw new Error("usage counter: empty result");
      const written = rows.filter((r) => typeof r.ip === "string");
      const ipRow = written.find((r) => r.ip === h);
      const globalRow = written.find((r) => r.ip === GLOBAL_ROW);
      if (ipRow && globalRow) return { ok: true, ipCount: Number(ipRow.shots), globalCount: Number(globalRow.shots) };
      if (ipRow || globalRow) {
        // Race: a concurrent request filled one row between our snapshot read and
        // the locked upsert, so only the other row was incremented. Undo that one
        // increment and deny. If the undo itself fails we over-count by n, which
        // only ever denies sooner (never spends more), and the error becomes a 503.
        await run(UNDO_SHOTS_SQL, [ipRow ? h : GLOBAL_ROW, day, n]);
        return { ok: false, scope: ipRow ? "global" : "ip", message: DAILY_LIMIT_MESSAGE };
      }
      const ipShots = Number(rows[0].ip_shots);
      return { ok: false, scope: ipShots + n > limits.perIp ? "ip" : "global", message: DAILY_LIMIT_MESSAGE };
    },
  };
}

export const SELFTEST = { day: "2000-01-01", ip: "selftest", limits: { perIp: 2, global: 3 } } as const;

/**
 * Operator self-test against a real database (scripts/counter-selftest.ts).
 * Uses a fixed fake day so today's counters are never touched; does NOT delete
 * its rows. Expected on a clean table: ok 1/1, ok 2/2, denied (ip).
 * Prints only outcomes, counts and the first 8 chars of the stored hash.
 */
export async function postgresCounterSelfTest(databaseUrl: string, log: (line: string) => void = console.log, query?: SqlQuery) {
  const s = postgresCounterStore(databaseUrl, query);
  const results: QuotaResult[] = [];
  log(`hashed ip prefix: ${hashIp(SELFTEST.ip, usageSalt(databaseUrl)).slice(0, 8)}`);
  for (let i = 1; i <= 3; i++) {
    const r = await s.take(SELFTEST.ip, SELFTEST.day, SELFTEST.limits);
    results.push(r);
    log(r.ok ? `take ${i}: ok ip=${r.ipCount} global=${r.globalCount}` : `take ${i}: denied scope=${r.scope}`);
  }
  return results;
}

let store: CounterStore | null = null;
export function counterStore(): CounterStore {
  if (store) return store;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  store = databaseUrl
    ? postgresCounterStore(databaseUrl)
    : url && token
      ? upstashCounterStore(url, token)
      : memoryCounterStore();
  return store;
}
/** Test hook. */
export function setCounterStore(s: CounterStore | null) {
  store = s;
}

const intEnv = (name: string, fallback: number) => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
export const quotaLimits = () => ({ perIp: intEnv("DAILY_RENDER_LIMIT", 20), global: intEnv("GLOBAL_DAILY_SHOTS", 300) });

/** Best-effort client IP (Vercel sets x-forwarded-for / x-real-ip). */
export function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "local";
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const TTL = 2 * 24 * 3600;

export type QuotaResult = { ok: true; ipCount: number; globalCount: number } | { ok: false; scope: "ip" | "global"; message: string };

/** Consume one shot from today's budget for `ip`. */
export async function takeShotQuota(ip: string, now = Date.now()): Promise<QuotaResult> {
  const { perIp, global } = quotaLimits();
  const s = counterStore();
  const d = day(now);
  if (s.kind === "postgres") return s.take(ip, d, { perIp, global });
  const ipCount = await s.incr(`oneliner:shots:ip:${d}:${ip}`, TTL);
  if (ipCount > perIp) return { ok: false, scope: "ip", message: DAILY_LIMIT_MESSAGE };
  const globalCount = await s.incr(`oneliner:shots:global:${d}`, TTL);
  if (globalCount > global) return { ok: false, scope: "global", message: DAILY_LIMIT_MESSAGE };
  return { ok: true, ipCount, globalCount };
}
