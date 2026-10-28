-- Durable desk for a Breaking story. Empty on every other category.
-- The Worker also tolerates a database that does not have this column yet.
ALTER TABLE articles ADD COLUMN section TEXT NOT NULL DEFAULT '';
