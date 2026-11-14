-- Weekend batch for Mon 16 Nov 2026 (week-six review). Changes to what the
-- Traders see take effect from that trading day.
INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at)
SELECT c.effective_on, c.area, c.summary, c.pr_number, '2026-11-14T00:00:00Z'
FROM (
  SELECT '2026-11-16' AS effective_on, 'Prompt' AS area, 'cash_usd is rounded down to the cent, as max_buy_usd already is, so an order for exactly the cash shown is never trimmed by a fraction of a cent.' AS summary, 52 AS pr_number
  UNION ALL SELECT '2026-11-16', 'Tracks', 'Gemini''s own web searches are now counted, so the searches-per-run limit can stop Gemini as it does the other models.', 52
) AS c
WHERE EXISTS (SELECT 1 FROM settings WHERE id = 1 AND start_date IS NOT NULL AND start_date < '2026-11-16');
