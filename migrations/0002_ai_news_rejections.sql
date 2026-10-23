CREATE TABLE IF NOT EXISTS source_rejections (
  source_url TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_rejections_expires ON source_rejections (expires_at);
