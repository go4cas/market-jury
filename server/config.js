// Settings read from the environment (Bun loads .env automatically).
// Secrets such as API keys live in the VPS's environment file, never in the repo.
export const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DATABASE_PATH || 'data/market-jury.sqlite',
  clientDir: process.env.CLIENT_DIR || 'dist',
  alpaca: {
    keyId: process.env.ALPACA_KEY_ID,
    secretKey: process.env.ALPACA_SECRET_KEY,
    // Paper trading API: only its market calendar is used. No orders are ever sent.
    tradingUrl: process.env.ALPACA_TRADING_URL || 'https://paper-api.alpaca.markets',
    dataUrl: process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets',
    feed: process.env.ALPACA_FEED || 'sip',
  },
}
