-- Market Jury initial schema.
-- Conventions:
--   * Money is INTEGER micro-dollars (1 USD = 1,000,000) so nothing drifts through rounding.
--   * Share quantities are INTEGER micro-shares (6 decimal places) for fractional shares.
--   * Trading dates are TEXT 'YYYY-MM-DD' in the market's own calendar; timestamps are TEXT ISO-8601 UTC.
--   * "Built to grow" columns (asset_class, market, currency, calendar, direction, order_type, rule sets)
--     are plain TEXT/JSON without CHECK lists, so shorts, crypto or limit orders need no migration.

-- ── Market data ─────────────────────────────────────────────────────────────

CREATE TABLE instruments (
  id           INTEGER PRIMARY KEY,
  ticker       TEXT NOT NULL,
  name         TEXT NOT NULL,
  asset_class  TEXT NOT NULL DEFAULT 'stock',      -- stock, etf; later crypto, option
  market       TEXT NOT NULL DEFAULT 'US',
  currency     TEXT NOT NULL DEFAULT 'USD',
  calendar     TEXT NOT NULL DEFAULT 'XNYS',
  on_menu      INTEGER NOT NULL DEFAULT 1 CHECK (on_menu IN (0, 1)),
  added_on     TEXT NOT NULL,
  removed_on   TEXT,
  UNIQUE (market, ticker)
);

CREATE TABLE trading_days (
  calendar     TEXT NOT NULL,
  date         TEXT NOT NULL,
  open_time    TEXT NOT NULL,                       -- 'HH:MM' local market time
  close_time   TEXT NOT NULL,
  early_close  INTEGER NOT NULL DEFAULT 0 CHECK (early_close IN (0, 1)),
  PRIMARY KEY (calendar, date)
) WITHOUT ROWID;

CREATE TABLE daily_bars (
  instrument_id  INTEGER NOT NULL REFERENCES instruments (id),
  date           TEXT NOT NULL,
  open_micro     INTEGER NOT NULL,
  high_micro     INTEGER NOT NULL,
  low_micro      INTEGER NOT NULL,
  close_micro    INTEGER NOT NULL,
  volume         INTEGER NOT NULL,
  source         TEXT NOT NULL,                     -- alpaca, tiingo
  PRIMARY KEY (instrument_id, date)
) WITHOUT ROWID;

CREATE TABLE news_items (
  id            INTEGER PRIMARY KEY,
  external_id   TEXT NOT NULL UNIQUE,
  headline      TEXT NOT NULL,
  summary       TEXT,
  source        TEXT NOT NULL,
  url           TEXT,
  published_at  TEXT NOT NULL
);
CREATE INDEX news_items_published_at ON news_items (published_at);

CREATE TABLE news_tickers (
  news_id        INTEGER NOT NULL REFERENCES news_items (id),
  instrument_id  INTEGER NOT NULL REFERENCES instruments (id),
  PRIMARY KEY (news_id, instrument_id)
) WITHOUT ROWID;

CREATE TABLE corporate_actions (
  id                     INTEGER PRIMARY KEY,
  instrument_id          INTEGER NOT NULL REFERENCES instruments (id),
  kind                   TEXT NOT NULL CHECK (kind IN ('split', 'dividend')),
  ex_date                TEXT NOT NULL,
  pay_date               TEXT,
  split_from             INTEGER,                    -- a 4-for-1 split: from 1, to 4
  split_to               INTEGER,
  cash_per_share_micro   INTEGER,
  UNIQUE (instrument_id, kind, ex_date)
);

CREATE TABLE briefing_packs (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
  trading_date  TEXT NOT NULL,
  content       TEXT NOT NULL,                       -- JSON, immutable once built
  content_hash  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (kind, trading_date)
);

-- ── The cast ────────────────────────────────────────────────────────────────

CREATE TABLE models (
  id                          INTEGER PRIMARY KEY,
  provider                    TEXT NOT NULL,        -- anthropic, openai, google, deepseek
  model_version               TEXT NOT NULL,        -- exact, pinned version string
  effort                      TEXT NOT NULL,
  input_micro_per_mtok        INTEGER NOT NULL,     -- price per million tokens
  cached_input_micro_per_mtok INTEGER NOT NULL,
  output_micro_per_mtok       INTEGER NOT NULL,
  created_at                  TEXT NOT NULL,
  UNIQUE (provider, model_version, effort)
);

CREATE TABLE traders (
  id                      INTEGER PRIMARY KEY,
  name                    TEXT NOT NULL UNIQUE,
  kind                    TEXT NOT NULL CHECK (kind IN ('ai', 'benchmark')),
  model_id                INTEGER REFERENCES models (id),
  cadence                 TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly')),
  colour_slot             INTEGER CHECK (colour_slot BETWEEN 1 AND 12),
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retiring', 'retired')),
  started_on              TEXT,
  retired_on              TEXT,
  origin                  TEXT NOT NULL DEFAULT 'fresh' CHECK (origin IN ('fresh', 'copied')),
  copied_from_trader_id   INTEGER REFERENCES traders (id),
  CHECK (kind = 'benchmark' OR model_id IS NOT NULL)
);

CREATE TABLE rule_sets (
  id              INTEGER PRIMARY KEY,
  trader_id       INTEGER NOT NULL REFERENCES traders (id),
  rules           TEXT NOT NULL,                     -- JSON: long_only, leverage_limit, position_cap_pct, per_trade_cost_micro
  effective_from  TEXT NOT NULL,
  UNIQUE (trader_id, effective_from)
);

-- ── Decisions and trading ───────────────────────────────────────────────────

CREATE TABLE runs (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('trader', 'columnist')),
  trader_id       INTEGER REFERENCES traders (id),
  model_id        INTEGER NOT NULL REFERENCES models (id),
  pack_id         INTEGER REFERENCES briefing_packs (id),
  dry_run         INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0, 1)),
  status          TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  attempt         INTEGER NOT NULL DEFAULT 1,
  prompt          TEXT,
  response        TEXT,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  tokens_cached   INTEGER NOT NULL DEFAULT 0,
  cost_micro      INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT
);
CREATE INDEX runs_started_at ON runs (started_at);

CREATE TABLE decisions (
  id            INTEGER PRIMARY KEY,
  run_id        INTEGER NOT NULL UNIQUE REFERENCES runs (id),
  trader_id     INTEGER NOT NULL REFERENCES traders (id),
  trading_date  TEXT NOT NULL,
  market_view   TEXT NOT NULL,
  journal       TEXT NOT NULL
);
CREATE INDEX decisions_trader_date ON decisions (trader_id, trading_date);

CREATE TABLE orders (
  id                     INTEGER PRIMARY KEY,
  run_id                 INTEGER REFERENCES runs (id),     -- NULL for The Index and retirement sells
  trader_id              INTEGER NOT NULL REFERENCES traders (id),
  instrument_id          INTEGER REFERENCES instruments (id), -- NULL when the ticker was off-menu or unknown
  ticker                 TEXT NOT NULL,                   -- as the Trader wrote it
  side                   TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type             TEXT NOT NULL DEFAULT 'market_on_open',
  direction              TEXT NOT NULL DEFAULT 'long',
  amount_micro           INTEGER,                         -- requested dollars; NULL with sell_all
  sell_all               INTEGER NOT NULL DEFAULT 0 CHECK (sell_all IN (0, 1)),
  reason                 TEXT NOT NULL,
  verdict                TEXT NOT NULL CHECK (verdict IN ('accepted', 'trimmed', 'rejected')),
  verdict_note           TEXT,
  approved_amount_micro  INTEGER,
  approved_qty_micro     INTEGER,                         -- set for sells resolved to a quantity
  decided_on             TEXT NOT NULL,                   -- trading date of the decision
  fill_on                TEXT,                            -- trading date of the intended fill
  status                 TEXT NOT NULL CHECK (status IN ('queued', 'filled', 'cancelled', 'rejected', 'dry_run')),
  created_at             TEXT NOT NULL
);
CREATE INDEX orders_trader_decided ON orders (trader_id, decided_on);
CREATE INDEX orders_status_fill ON orders (status, fill_on);

CREATE TABLE fills (
  id              INTEGER PRIMARY KEY,
  order_id        INTEGER NOT NULL UNIQUE REFERENCES orders (id),
  trader_id       INTEGER NOT NULL REFERENCES traders (id),
  instrument_id   INTEGER NOT NULL REFERENCES instruments (id),
  side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  price_micro     INTEGER NOT NULL,
  quantity_micro  INTEGER NOT NULL,
  amount_micro    INTEGER NOT NULL,
  trading_date    TEXT NOT NULL
);
CREATE INDEX fills_trader_date ON fills (trader_id, trading_date);

CREATE TABLE positions (
  trader_id         INTEGER NOT NULL REFERENCES traders (id),
  instrument_id     INTEGER NOT NULL REFERENCES instruments (id),
  direction         TEXT NOT NULL DEFAULT 'long',
  quantity_micro    INTEGER NOT NULL,
  cost_basis_micro  INTEGER NOT NULL,
  PRIMARY KEY (trader_id, instrument_id, direction)
) WITHOUT ROWID;

CREATE TABLE cash_ledger (
  id                   INTEGER PRIMARY KEY,
  trader_id            INTEGER NOT NULL REFERENCES traders (id),
  kind                 TEXT NOT NULL,              -- start, buy, sell, dividend, fee
  amount_micro         INTEGER NOT NULL,           -- signed: money in is positive
  trading_date         TEXT NOT NULL,
  fill_id              INTEGER REFERENCES fills (id),
  corporate_action_id  INTEGER REFERENCES corporate_actions (id),
  note                 TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX cash_ledger_trader_date ON cash_ledger (trader_id, trading_date);

CREATE TABLE snapshots (
  trader_id       INTEGER NOT NULL REFERENCES traders (id),
  trading_date    TEXT NOT NULL,
  cash_micro      INTEGER NOT NULL,
  holdings_micro  INTEGER NOT NULL,
  total_micro     INTEGER NOT NULL,
  PRIMARY KEY (trader_id, trading_date)
) WITHOUT ROWID;

-- New behaviour metrics are new keys, never a migration.
CREATE TABLE metrics (
  trader_id     INTEGER NOT NULL REFERENCES traders (id),
  trading_date  TEXT NOT NULL,
  key           TEXT NOT NULL,
  value         REAL NOT NULL,
  PRIMARY KEY (trader_id, trading_date, key)
) WITHOUT ROWID;

-- Written when standings are computed, so past badges never change with the rules.
CREATE TABLE badges (
  period_kind  TEXT NOT NULL CHECK (period_kind IN ('day', 'week', 'month')),
  period_end   TEXT NOT NULL,
  badge        TEXT NOT NULL,
  trader_id    INTEGER NOT NULL REFERENCES traders (id),
  PRIMARY KEY (period_kind, period_end, badge, trader_id)
) WITHOUT ROWID;

CREATE TABLE columnist_posts (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
  period_date  TEXT NOT NULL,
  headline     TEXT NOT NULL,
  body         TEXT NOT NULL,
  run_id       INTEGER REFERENCES runs (id),
  created_at   TEXT NOT NULL,
  UNIQUE (kind, period_date)
);

-- ── Scheduler and settings ──────────────────────────────────────────────────

CREATE TABLE step_runs (
  id            INTEGER PRIMARY KEY,
  step          TEXT NOT NULL,
  trading_date  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  attempt       INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT,
  finished_at   TEXT,
  error         TEXT,
  UNIQUE (step, trading_date)
);

CREATE TABLE settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  experiment_state      TEXT NOT NULL DEFAULT 'setup' CHECK (experiment_state IN ('setup', 'running', 'paused', 'ended')),
  start_date            TEXT,
  starting_cash_micro   INTEGER NOT NULL DEFAULT 1000000000,  -- $1,000
  budget_ceiling_micro  INTEGER NOT NULL DEFAULT 25000000,    -- $25 a month
  gallery_enabled       INTEGER NOT NULL DEFAULT 0 CHECK (gallery_enabled IN (0, 1)),
  stock_menu_version    TEXT,
  updated_at            TEXT NOT NULL
);
INSERT INTO settings (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ── Trade Master login ──────────────────────────────────────────────────────

CREATE TABLE trade_master (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash    TEXT NOT NULL,      -- Bun.password (argon2id)
  totp_secret      TEXT NOT NULL,      -- base32
  last_totp_step   INTEGER NOT NULL DEFAULT 0,  -- refuses a code that was already used
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until     TEXT,
  updated_at       TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,        -- sha256 of the cookie value; the token itself is never stored
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
) WITHOUT ROWID;
