-- Weekend batch for Mon 26 Oct 2026 (week-two and week-three reviews).
-- Changes to what the Traders see take effect from that trading day.
-- Numbered 0011 because the Research Tracks batch (PR #41) takes 0010;
-- migrations run by name, so either can land first.
INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at)
SELECT c.effective_on, c.area, c.summary, c.pr_number, '2026-10-24T00:00:00Z'
FROM (
  SELECT '2026-10-26' AS effective_on, 'Briefing pack' AS area, 'Headlines are drawn from the whole day again: on busy days the Floor Runner had only been keeping the last few hours of news. It now collects the news an hour at a time.' AS summary, 44 AS pr_number
  UNION ALL SELECT '2026-10-26', 'Briefing pack', 'Headlines are spread across the trading day: overnight and pre-open, then three parts of the session (one slice per day in the weekly pack), taken in turns so a quiet slice''s share goes to the others instead of the last hour before the close. Analyst rating notes on menu stocks are capped at 4 a day and 8 a week.', 44
  UNION ALL SELECT '2026-10-26', 'Prompt', 'max_buy_usd is rounded down to the cent, so an order for exactly that amount is never trimmed by a fraction of a cent.', 44
) AS c
WHERE EXISTS (SELECT 1 FROM settings WHERE id = 1 AND start_date IS NOT NULL AND start_date < '2026-10-26');
