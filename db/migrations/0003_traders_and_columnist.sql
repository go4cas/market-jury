-- Traders and the Market Columnist.
-- A Trader that places no orders still says why (PRD: "No trades today" needs a reason).
ALTER TABLE decisions ADD COLUMN no_trades_reason TEXT;

-- Which models write the Columnist's daily recap and weekly report (swappable in Settings).
ALTER TABLE settings ADD COLUMN columnist_daily_model_id INTEGER REFERENCES models (id);
ALTER TABLE settings ADD COLUMN columnist_weekly_model_id INTEGER REFERENCES models (id);
