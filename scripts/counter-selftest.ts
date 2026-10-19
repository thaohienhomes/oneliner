/**
 * Operator self-test for the Neon Postgres shot counter (REAL DATABASE, 3 small queries).
 *   npx tsx --env-file=<file> scripts/counter-selftest.ts
 * Needs DATABASE_URL in that file (never printed). Writes only to the fake day
 * 2000-01-01 with ip "selftest" (limits: 2 per IP, 3 global), so today's real
 * counters are untouched. Expected on a clean table:
 *   take 1: ok ip=1 global=1 / take 2: ok ip=2 global=2 / take 3: denied scope=ip
 * Rows are NOT deleted. Check, then clean up (needed before a re-run):
 *   DELETE FROM usage WHERE day = '2000-01-01';
 */
import { postgresCounterSelfTest } from "../lib/quota";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (pass --env-file=<file>).");
  process.exit(1);
}

postgresCounterSelfTest(databaseUrl).then(
  (results) => {
    const pass = results[0]?.ok && results[1]?.ok && !results[2]?.ok && results[2]?.scope === "ip";
    console.log(pass ? "PASS" : "UNEXPECTED (table not clean for 2000-01-01?)");
    process.exit(pass ? 0 : 1);
  },
  (err) => {
    // Error messages from the driver never include the connection string, but keep it to the message only.
    console.error("self-test failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
