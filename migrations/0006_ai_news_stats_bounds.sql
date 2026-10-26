-- Daily HMAC salt, deleted after the UTC day. Not derived from a token.
-- Bot, 404, and feed counts are daily aggregates. They are not raw page_views rows.
CREATE TABLE IF NOT EXISTS stats_day_salt (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stats_bot_daily (
  day TEXT NOT NULL,
  bot_name TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bot_name)
);

CREATE TABLE IF NOT EXISTS stats_miss_daily (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);

CREATE TABLE IF NOT EXISTS stats_feed_daily (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
