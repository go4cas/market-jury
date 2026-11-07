-- Weekend batch for Mon 9 Nov 2026 (week-five review). Changes to what the
-- Traders see take effect from that trading day.
--
-- KVUE has had no prices from Alpaca since 2 Nov, so it leaves the menu.
-- Nobody holds it; a Trader that did could still sell it.
UPDATE instruments SET on_menu = 0, removed_on = '2026-11-09' WHERE ticker = 'KVUE' AND on_menu = 1;

INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at)
SELECT c.effective_on, c.area, c.summary, c.pr_number, '2026-11-07T00:00:00Z'
FROM (
  SELECT '2026-11-09' AS effective_on, 'Tracks' AS area, 'The searches-per-run limit now holds for every model''s own web search: GPT and Gemini lose their search tool once a run has used its share, as Claude''s and the shared search already did.' AS summary, 51 AS pr_number
  UNION ALL SELECT '2026-11-09', 'Briefing pack', 'KVUE leaves the stock menu: Alpaca has had no prices for it since 2 Nov.', 51
) AS c
WHERE EXISTS (SELECT 1 FROM settings WHERE id = 1 AND start_date IS NOT NULL AND start_date < '2026-11-09');
