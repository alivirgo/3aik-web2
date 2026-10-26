-- Reader analytics for /ai-news. No IP address, user agent, cookie, or client id column.
-- visitor_hash is an HMAC-SHA256 of a random daily salt. The salt is not derived from a token.
-- New events roll up in later migrations. This raw table is legacy and the cron prunes it.
-- The cron also deletes stats_visitor_day with the raw rows, and deletes the daily salt after the UTC day.
CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  viewed_at TEXT NOT NULL,
  slug TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL,
  referrer_host TEXT NOT NULL DEFAULT '',
  referrer_path TEXT NOT NULL DEFAULT '',
  source_class TEXT NOT NULL,
  search_engine TEXT NOT NULL DEFAULT '',
  search_query TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  continent TEXT NOT NULL DEFAULT '',
  device_class TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  screen TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  bot INTEGER NOT NULL DEFAULT 0,
  bot_name TEXT NOT NULL DEFAULT '',
  visitor_hash TEXT NOT NULL DEFAULT '',
  hour_utc INTEGER NOT NULL DEFAULT 0,
  hour_karachi INTEGER NOT NULL DEFAULT 0,
  event_kind TEXT NOT NULL DEFAULT 'view',
  engaged_ms INTEGER NOT NULL DEFAULT 0,
  scroll_pct INTEGER NOT NULL DEFAULT 0,
  seen_before INTEGER NOT NULL DEFAULT -1,
  click_host TEXT NOT NULL DEFAULT '',
  click_path TEXT NOT NULL DEFAULT '',
  click_kind TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_page_views_time ON page_views (viewed_at);
CREATE INDEX IF NOT EXISTS idx_page_views_kind_time ON page_views (event_kind, viewed_at);
CREATE INDEX IF NOT EXISTS idx_page_views_article ON page_views (page, slug, bot, viewed_at);
CREATE INDEX IF NOT EXISTS idx_page_views_hash_time ON page_views (visitor_hash, viewed_at);

CREATE TABLE IF NOT EXISTS stats_daily (
  day TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  bots INTEGER NOT NULL DEFAULT 0,
  engaged_ms INTEGER NOT NULL DEFAULT 0,
  engage_n INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stats_visitor_day (
  day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);
