# Market Jury

> 4 AI traders | 1 market | you are the jury

Four AI models trade virtual money on US stocks from the same evening briefing pack, each with a daily and a weekly portfolio, next to an S&P 500 buy-and-hold benchmark. The point is to watch how they behave, in plain language, not to crown a winner. Paper trading only: virtual money, not financial advice.

Built with Bun (server, SQLite, tests) and a vanilla client on [quiver](https://github.com/go4cas/quiver) (arrow-js, Tailwind v4). Conventions for people and AI agents are in [AGENTS.md](AGENTS.md).

## Run it locally

Needs [Bun](https://bun.sh) 1.3 or newer.

```sh
bun install
bun run trade-master:setup   # choose a password, then add the code to your authenticator app
bun run build                # build the client
bun run dev                  # http://localhost:3000
```

For client work with hot reload, keep `bun run dev` running and start `bun run dev:client` (Vite on :5173, proxying `/api`).

## Check it

```sh
bun run typecheck && bun run test && bun run test:e2e
```
