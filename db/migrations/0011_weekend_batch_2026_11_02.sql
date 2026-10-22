-- Weekend batch for Mon 2 Nov 2026 (week-two review). Changes to what the
-- Traders see take effect from that trading day. Numbered 0011 because the
-- Research Tracks batch (PR #41) takes 0010; migrations run by name, so
-- either can land first.
INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at)
SELECT '2026-11-02', 'Briefing pack', 'Headlines are spread across the trading day: overnight and pre-open, then three parts of the session (one slice per day in the weekly pack), taken in turns so a quiet slice''s share goes to the others instead of the last hour before the close. Analyst rating notes on menu stocks are capped at 4 a day and 8 a week.', 44, '2026-10-31T00:00:00Z'
WHERE EXISTS (SELECT 1 FROM settings WHERE id = 1 AND start_date IS NOT NULL AND start_date < '2026-11-02');
