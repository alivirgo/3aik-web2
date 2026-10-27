-- Dimension counters for the stats desk. No IP, user agent, cookie, or visitor hash.
-- The cron deletes rows older than 400 days.
CREATE TABLE IF NOT EXISTS stats_facet_daily (
  day TEXT NOT NULL,
  slug TEXT NOT NULL,
  facet TEXT NOT NULL,
  value TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, slug, facet, value)
);
