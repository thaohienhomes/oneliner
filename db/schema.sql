-- Reference only: the table already exists on Neon; nothing runs this automatically.
-- Daily shot counters used by lib/quota.ts when DATABASE_URL is set.
--   ip   = hex sha256(salt + ":" + client ip), never the raw IP;
--          '__global__' is the site-wide row.
--   day  = UTC date (YYYY-MM-DD).
CREATE TABLE usage (
  ip    text,
  day   date,
  shots int DEFAULT 0,
  PRIMARY KEY (ip, day)
);
