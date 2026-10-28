-- Articles that backfill could not resize. A row means "do not try again".
-- The Worker also creates this table on the first backfill call. Applying the
-- migration by hand is optional.
CREATE TABLE IF NOT EXISTS article_image_backfill (
  article_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
