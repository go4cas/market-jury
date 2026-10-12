-- The error of a step's most recent failed attempt. `error` is overwritten when
-- a later attempt succeeds; this keeps why it failed, for reviews.
ALTER TABLE step_runs ADD COLUMN last_error TEXT;
