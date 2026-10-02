-- The last trading day of the paper phase (day 63, about three months). After
-- its evening the scheduler pauses the experiment by itself. NULL: no end
-- (not started yet, or resumed after the end).
ALTER TABLE settings ADD COLUMN end_date TEXT;

UPDATE settings SET end_date = (
  SELECT date FROM trading_days WHERE calendar = 'XNYS' AND date > settings.start_date ORDER BY date LIMIT 1 OFFSET 62
) WHERE id = 1 AND start_date IS NOT NULL;
