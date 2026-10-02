-- The guardrails a new Trader starts with (JSON, like rule_sets.rules), so a
-- Trader added later trades under the rules the Trade Master set, not the
-- built-in defaults. NULL means the built-in defaults (core/portfolio.js).
ALTER TABLE settings ADD COLUMN default_rules TEXT;

-- Until now the Settings screen showed an active AI Trader's latest rules as
-- the guardrails, so start from those.
UPDATE settings SET default_rules = (
  SELECT r.rules FROM rule_sets r JOIN traders t ON t.id = r.trader_id
  WHERE t.kind = 'ai' AND t.status = 'active'
  ORDER BY t.id, r.effective_from DESC
  LIMIT 1
) WHERE id = 1;
