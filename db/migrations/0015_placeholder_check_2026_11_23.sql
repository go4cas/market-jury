-- The placeholder check from 16 Nov refused any market view or journal that
-- used the word "placeholder", even in a real sentence about an earlier
-- order. It now refuses a field only when the whole field is a placeholder.
INSERT INTO platform_changes (effective_on, area, summary, pr_number, created_at)
SELECT '2026-11-23', 'Rules', 'An answer is sent back as a placeholder only when a whole market view, journal or order reason is a stub such as "placeholder", "x" or "TBD". A real sentence that mentions an earlier placeholder order is now accepted; from 16 Nov it had been refused.', 53, '2026-11-21T00:00:00Z'
WHERE EXISTS (SELECT 1 FROM settings WHERE id = 1 AND start_date IS NOT NULL AND start_date < '2026-11-23');
