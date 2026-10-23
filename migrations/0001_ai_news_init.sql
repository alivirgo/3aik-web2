CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  key_points_json TEXT NOT NULL,
  faq_json TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  related_json TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_alt TEXT NOT NULL,
  image_type TEXT NOT NULL,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_sources (
  source_url TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  outlet TEXT NOT NULL,
  source_title TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category_published ON articles (category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_author_published ON articles (author_id, published_at DESC);

CREATE TABLE IF NOT EXISTS author_stats (
  author_id TEXT PRIMARY KEY,
  publish_count INTEGER NOT NULL DEFAULT 0,
  last_published_at TEXT
);

CREATE TABLE IF NOT EXISTS category_stats (
  category TEXT PRIMARY KEY,
  publish_count INTEGER NOT NULL DEFAULT 0,
  last_published_at TEXT
);

CREATE TABLE IF NOT EXISTS runtime_lock (
  name TEXT PRIMARY KEY,
  locked_until TEXT NOT NULL
);
