-- Tracks: a group of Traders who all play by the same conditions, one Trader
-- per model. The daily and weekly Traders become the first two Tracks. A
-- Track's title is for readers only (the Trade Master can rename it; the
-- Traders never see it). Its conditions are fixed once it is created, like a
-- Trader's model: to try other conditions, start another Track.
CREATE TABLE tracks (
  id                INTEGER PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,                  -- fixed, for links: daily, weekly, weekly-research
  title             TEXT NOT NULL,                         -- shown as "<title> track"
  cadence           TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly')),
  briefing_pack     TEXT NOT NULL DEFAULT 'full',          -- full, prices_only (headlines left out)
  web_search        TEXT NOT NULL DEFAULT 'off',           -- off, native (each model's own), shared (one search tool for all)
  searches_per_run  INTEGER NOT NULL DEFAULT 0,
  started_on        TEXT,                                  -- its Traders' first decision evening
  created_at        TEXT NOT NULL
);
INSERT INTO tracks (id, slug, title, cadence, started_on, created_at)
SELECT 1, 'daily', 'Daily', 'daily', start_date, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM settings WHERE id = 1;
INSERT INTO tracks (id, slug, title, cadence, started_on, created_at)
SELECT 2, 'weekly', 'Weekly', 'weekly', start_date, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM settings WHERE id = 1;

-- Every AI Trader belongs to a Track; The Index belongs to none.
ALTER TABLE traders ADD COLUMN track_id INTEGER REFERENCES tracks (id);
UPDATE traders SET track_id = CASE cadence WHEN 'weekly' THEN 2 ELSE 1 END WHERE kind = 'ai';

-- Web searches a run made, billed per search on top of its tokens.
ALTER TABLE runs ADD COLUMN searches INTEGER NOT NULL DEFAULT 0;

-- When the last trading day last moved, and from what, so each Trader's next
-- run can say so.
ALTER TABLE settings ADD COLUMN end_date_previous TEXT;
ALTER TABLE settings ADD COLUMN end_date_moved_at TEXT;

-- Weekend batch for Mon 2 Nov 2026: the change log, only for the experiment
-- it was made for (one started before it).
INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at)
SELECT '2026-11-02', 'Prompt', 'When the Trade Master moves the last trading day, each Trader''s next run says it moved, from which date to which.', 41, '2026-10-31T00:00:00Z'
WHERE EXISTS (SELECT 1 FROM settings WHERE id = 1 AND start_date IS NOT NULL AND start_date < '2026-11-02');
