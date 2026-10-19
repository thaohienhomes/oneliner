/**
 * Daily render budget (cost guard), checked in POST /api/shot BEFORE any Comfy
 * call. Counts shots: per IP (DAILY_RENDER_LIMIT) and globally
 * (GLOBAL_DAILY_SHOTS). Counters live in Upstash Redis when
 * UPSTASH_REDIS_REST_URL/TOKEN are set (REST API, no SDK), otherwise in this
 * process's memory (fine for local dev; resets on restart).
 */

export const DAILY_LIMIT_MESSAGE = "Daily studio budget used — watch the gallery or run it locally";

export interface CounterStore {
  readonly kind: "upstash" | "memory";
  /** Increment and return the new value; the key expires after ttlSeconds. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export function memoryCounterStore(now: () => number = Date.now): CounterStore {
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

export function upstashCounterStore(url: string, token: string): CounterStore {
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

let store: CounterStore | null = null;
export function counterStore(): CounterStore {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  store = url && token ? upstashCounterStore(url, token) : memoryCounterStore();
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
  const ipCount = await s.incr(`oneliner:shots:ip:${d}:${ip}`, TTL);
  if (ipCount > perIp) return { ok: false, scope: "ip", message: DAILY_LIMIT_MESSAGE };
  const globalCount = await s.incr(`oneliner:shots:global:${d}`, TTL);
  if (globalCount > global) return { ok: false, scope: "global", message: DAILY_LIMIT_MESSAGE };
  return { ok: true, ipCount, globalCount };
}
