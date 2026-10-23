ALTER TABLE articles ADD COLUMN image_commit TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_articles_image ON articles (image_key, image_commit);
