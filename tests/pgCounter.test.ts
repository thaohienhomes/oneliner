// @vitest-environment node
/**
 * Neon Postgres shot counter (lib/quota.ts). No network: the neon driver is
 * mocked to throw, and every store gets an in-memory fake of the `usage`
 * table that mirrors TAKE_SHOTS_SQL (snapshot pre-read, guard, conditional
 * upsert per row) and can inject a concurrent write between read and upsert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => {
    throw new Error("network disabled in tests");
  }),
}));

import {
  counterStore,
  DAILY_LIMIT_MESSAGE,
  GLOBAL_ROW,
  hashIp,
  postgresCounterSelfTest,
  postgresCounterStore,
  setCounterStore,
  type SqlQuery,
  takeShotQuota,
  TAKE_SHOTS_SQL,
  UNDO_SHOTS_SQL,
  usageSalt,
} from "../lib/quota";

const DB_URL = "postgres://unit-test-host/oneliner";
const IP = "203.0.113.7";
const NOW = Date.parse("2026-10-19T12:00:00Z");
const H = hashIp(IP, usageSalt(DB_URL));

function fakeUsageTable() {
  const rows = new Map<string, number>();
  const calls: { text: string; params: unknown[] }[] = [];
  const key = (ip: string, day: string) => `${ip}|${day}`;
  const fake = {
    rows,
    calls,
    /** Runs once, after the snapshot read and before the upserts (simulates a concurrent commit). */
    race: null as null | ((day: string) => void),
    get: (ip: string, day: string) => rows.get(key(ip, day)),
    set: (ip: string, day: string, n: number) => rows.set(key(ip, day), n),
    query: (async (text, params) => {
      calls.push({ text, params });
      if (text === TAKE_SHOTS_SQL) {
        const [h, day, n, perIp, global] = params as [string, string, number, number, number];
        const ipShots = fake.get(h, day) ?? 0;
        const globalShots = fake.get(GLOBAL_ROW, day) ?? 0;
        const written: { ip: string; shots: number }[] = [];
        if (ipShots + n <= perIp && globalShots + n <= global) {
          const r = fake.race;
          fake.race = null;
          r?.(day);
          for (const [ip, lim] of [
            [h, perIp],
            [GLOBAL_ROW, global],
          ] as const) {
            const cur = fake.get(ip, day);
            if (cur === undefined || cur + n <= lim) {
              fake.set(ip, day, (cur ?? 0) + n);
              written.push({ ip, shots: (cur ?? 0) + n });
            }
          }
        }
        const pre = { ip_shots: ipShots, global_shots: globalShots };
        return written.length ? written.map((w) => ({ ...pre, ...w })) : [{ ...pre, ip: null, shots: null }];
      }
      if (text === UNDO_SHOTS_SQL) {
        const [ip, day, n] = params as [string, string, number];
        fake.set(ip, day, (fake.get(ip, day) ?? 0) - n);
        return [];
      }
      throw new Error(`unexpected SQL: ${text}`);
    }) as SqlQuery,
  };
  return fake;
}

let db: ReturnType<typeof fakeUsageTable>;
beforeEach(() => {
  db = fakeUsageTable();
  setCounterStore(postgresCounterStore(DB_URL, db.query));
  vi.stubEnv("DAILY_RENDER_LIMIT", "2");
  vi.stubEnv("GLOBAL_DAILY_SHOTS", "3");
});
afterEach(() => {
  setCounterStore(null);
  vi.unstubAllEnvs();
});

describe("store selection", () => {
  const pick = (env: Record<string, string>) => {
    for (const k of ["DATABASE_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) vi.stubEnv(k, env[k] ?? "");
    setCounterStore(null);
    return counterStore().kind;
  };
  it("DATABASE_URL > Upstash > memory", () => {
    const up = { UPSTASH_REDIS_REST_URL: "https://upstash.test", UPSTASH_REDIS_REST_TOKEN: "t" };
    expect(pick({ DATABASE_URL: DB_URL, ...up })).toBe("postgres");
    expect(pick(up)).toBe("upstash");
    expect(pick({})).toBe("memory");
    expect(pick({ DATABASE_URL: "   " })).toBe("memory");
  });
});

describe("postgres counter", () => {
  it("increments both rows and returns the counts", async () => {
    expect(await takeShotQuota(IP, NOW)).toEqual({ ok: true, ipCount: 1, globalCount: 1 });
    expect(await takeShotQuota(IP, NOW)).toEqual({ ok: true, ipCount: 2, globalCount: 2 });
    expect(db.get(H, "2026-10-19")).toBe(2);
    expect(db.get(GLOBAL_ROW, "2026-10-19")).toBe(2);
  });

  it("denies on the per-IP limit with scope ip and increments nothing", async () => {
    await takeShotQuota(IP, NOW);
    await takeShotQuota(IP, NOW);
    expect(await takeShotQuota(IP, NOW)).toEqual({ ok: false, scope: "ip", message: DAILY_LIMIT_MESSAGE });
    expect(db.get(H, "2026-10-19")).toBe(2);
    expect(db.get(GLOBAL_ROW, "2026-10-19")).toBe(2);
  });

  it("denies on the global limit with scope global and increments nothing", async () => {
    for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) expect((await takeShotQuota(ip, NOW)).ok).toBe(true);
    expect(await takeShotQuota("10.0.0.4", NOW)).toEqual({ ok: false, scope: "global", message: DAILY_LIMIT_MESSAGE });
    expect(db.get(GLOBAL_ROW, "2026-10-19")).toBe(3);
    expect(db.get(hashIp("10.0.0.4", usageSalt(DB_URL)), "2026-10-19")).toBeUndefined();
  });

  it("reports ip first when both limits are exhausted", async () => {
    vi.stubEnv("GLOBAL_DAILY_SHOTS", "2");
    await takeShotQuota(IP, NOW);
    await takeShotQuota(IP, NOW);
    expect(await takeShotQuota(IP, NOW)).toMatchObject({ ok: false, scope: "ip" });
  });

  it("a limit of 0 denies a brand-new row", async () => {
    vi.stubEnv("DAILY_RENDER_LIMIT", "0");
    expect(await takeShotQuota(IP, NOW)).toMatchObject({ ok: false, scope: "ip" });
    expect(db.rows.size).toBe(0);
  });

  it("issues exactly one parameterized statement per request; raw IP never sent", async () => {
    await takeShotQuota(IP, NOW);
    await takeShotQuota(IP, NOW);
    await takeShotQuota(IP, NOW); // denied
    expect(db.calls).toHaveLength(3);
    for (const c of db.calls) {
      expect(c.text).toBe(TAKE_SHOTS_SQL); // constant text: no values interpolated
      expect(c.params).toEqual([H, "2026-10-19", 1, 2, 3]);
      expect(JSON.stringify(c)).not.toContain(IP);
      expect(c.text).not.toContain("2026-10-19");
    }
    expect(H).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses the UTC date and rolls over at UTC midnight", async () => {
    const lastMs = Date.parse("2026-10-19T23:59:59.999Z");
    await takeShotQuota(IP, lastMs);
    await takeShotQuota(IP, lastMs);
    expect((await takeShotQuota(IP, lastMs)).ok).toBe(false);
    expect(await takeShotQuota(IP, lastMs + 1)).toEqual({ ok: true, ipCount: 1, globalCount: 1 });
    expect(db.calls.map((c) => c.params[1])).toEqual(["2026-10-19", "2026-10-19", "2026-10-19", "2026-10-20"]);
  });

  it("race: if only the IP row was incremented, it is undone and the request denied (scope global)", async () => {
    db.race = (day) => db.set(GLOBAL_ROW, day, 3); // another instance takes the last global shot
    expect(await takeShotQuota(IP, NOW)).toEqual({ ok: false, scope: "global", message: DAILY_LIMIT_MESSAGE });
    expect(db.calls.map((c) => c.text)).toEqual([TAKE_SHOTS_SQL, UNDO_SHOTS_SQL]);
    expect(db.calls[1].params).toEqual([H, "2026-10-19", 1]);
    expect(db.get(H, "2026-10-19")).toBe(0);
    expect(db.get(GLOBAL_ROW, "2026-10-19")).toBe(3);
  });

  it("race: if only the global row was incremented, it is undone and the request denied (scope ip)", async () => {
    db.race = (day) => db.set(H, day, 2); // same IP, parallel tab
    expect(await takeShotQuota(IP, NOW)).toMatchObject({ ok: false, scope: "ip" });
    expect(db.calls[1]).toEqual({ text: UNDO_SHOTS_SQL, params: [GLOBAL_ROW, "2026-10-19", 1] });
    expect(db.get(GLOBAL_ROW, "2026-10-19")).toBe(0);
  });

  it("query errors propagate (the route turns them into 503)", async () => {
    setCounterStore(postgresCounterStore(DB_URL, async () => Promise.reject(new Error("boom"))));
    await expect(takeShotQuota(IP, NOW)).rejects.toThrow("boom");
  });
});

describe("hashing", () => {
  it("hashIp is deterministic, salted and hex", () => {
    expect(hashIp(IP, "a")).toBe(hashIp(IP, "a"));
    expect(hashIp(IP, "a")).not.toBe(hashIp(IP, "b"));
    expect(hashIp(IP, "a")).toMatch(/^[0-9a-f]{64}$/);
    expect(usageSalt(DB_URL)).not.toContain("unit-test-host");
  });
});

describe("operator self-test", () => {
  it("uses the fake day, prints ok/ok/denied(ip) and never the URL", async () => {
    const lines: string[] = [];
    const results = await postgresCounterSelfTest(DB_URL, (l) => lines.push(l), db.query);
    expect(results.map((r) => (r.ok ? `ok ${r.ipCount}` : `denied ${r.scope}`))).toEqual(["ok 1", "ok 2", "denied ip"]);
    expect(db.calls.every((c) => c.params[1] === "2000-01-01")).toBe(true);
    expect(lines[0]).toBe(`hashed ip prefix: ${hashIp("selftest", usageSalt(DB_URL)).slice(0, 8)}`);
    expect(lines.join("\n")).not.toContain("unit-test-host");
    expect(db.calls.some((c) => /delete/i.test(c.text))).toBe(false);
  });
});
