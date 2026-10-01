// Settings read from the environment (Bun loads .env automatically).
// Secrets such as API keys live in the VPS's environment file, never in the repo.
export const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DATABASE_PATH || 'data/market-jury.sqlite',
  clientDir: process.env.CLIENT_DIR || 'dist',
}
