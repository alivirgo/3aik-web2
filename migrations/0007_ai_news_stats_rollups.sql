-- Hourly article rollups and the D1 fallback write budget.
-- Raw events go to Analytics Engine. These tables are the small D1 rollup.
-- The cron deletes rows older than 400 days. stats_write_budget is only the
-- fallback counter used when the Durable Object binding is absent.
CREATE TABLE IF NOT EXISTS stats_article_hour (
  day TEXT NOT NULL,
  hour_utc INTEGER NOT NULL,
  slug TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  engaged_ms INTEGER NOT NULL DEFAULT 0,
  engage_n INTEGER NOT NULL DEFAULT 0,
  scroll_sum INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour_utc, slug)
);

CREATE TABLE IF NOT EXISTS stats_click_daily (
  day TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, slug, kind, host, path)
);

CREATE TABLE IF NOT EXISTS stats_write_budget (
  day TEXT PRIMARY KEY,
  writes INTEGER NOT NULL DEFAULT 0
);
