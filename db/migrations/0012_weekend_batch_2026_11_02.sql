-- Weekend batch for Mon 2 Nov 2026 (week-four review). Changes to what the
-- Traders see take effect from that trading day.
INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at)
SELECT '2026-11-02', 'Briefing pack', 'Overnight and weekend headlines are drawn from the whole night or weekend, not only the last half hour before the open: each slice of the day spreads its picks across its own time span.', 50, '2026-11-01T00:00:00Z'
WHERE EXISTS (SELECT 1 FROM settings WHERE id = 1 AND start_date IS NOT NULL AND start_date < '2026-11-02');
