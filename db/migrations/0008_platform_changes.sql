-- The change log: anything that changes what the Traders are given or how
-- their orders are judged, from the first trading day it applied. Each
-- weekend batch adds its rows in its own migration. Shown on the About page
-- and given to the Columnist.
CREATE TABLE platform_changes (
  id            INTEGER PRIMARY KEY,
  effective_on  TEXT NOT NULL,             -- first trading day it applied (YYYY-MM-DD)
  area          TEXT NOT NULL,             -- 'Briefing pack', 'Prompt', 'Rules' or 'Columnist'
  summary       TEXT NOT NULL,             -- one plain sentence
  pr_number     INTEGER,                   -- the pull request on GitHub
  created_at    TEXT NOT NULL
);
