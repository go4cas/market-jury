-- Weekend batch for Mon 19 Oct 2026 (week-one review). Changes to what the
-- Traders see take effect from that trading day.
--
-- PSKY and WBD have had no prices from Alpaca since 6 Oct, so they leave the
-- menu. A Trader that holds either can still sell it.
UPDATE instruments SET on_menu = 0, removed_on = '2026-10-19' WHERE ticker IN ('PSKY', 'WBD') AND on_menu = 1;

-- The change log, only for the experiment these changes were made for (one
-- started before them); a fresh install starts with the current platform.
INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at)
SELECT c.effective_on, c.area, c.summary, c.pr_number, '2026-10-17T00:00:00Z'
FROM (
  SELECT '2026-10-19' AS effective_on, 'Briefing pack' AS area, 'Headlines are chosen across the whole day (or week) and the stock menu instead of being the newest few: only news about a menu ticker or the market as a whole, no analyst notes on companies off the menu, and at most a few per ticker.' AS summary, 40 AS pr_number
  UNION ALL SELECT '2026-10-19', 'Prompt', 'Each Trader''s portfolio now shows max_buy_usd, the position cap in dollars: the most it can buy of one ticker that evening.', 40
  UNION ALL SELECT '2026-10-19', 'Briefing pack', 'The weekly pack no longer repeats the week''s change in a second column (chg_1w).', 40
  UNION ALL SELECT '2026-10-19', 'Briefing pack', 'PSKY and WBD leave the stock menu: Alpaca has had no prices for them since 6 Oct. Holders can still sell.', 40
) AS c
WHERE EXISTS (SELECT 1 FROM settings WHERE id = 1 AND start_date IS NOT NULL AND start_date < '2026-10-19');
