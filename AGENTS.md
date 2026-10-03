# Market Jury: AI agent context

This file is the single source of truth for AI assistants working in this repo. `CLAUDE.md` imports it for Claude Code; Codex and other AGENTS.md-aware tools read it directly. Edit conventions here, not in `CLAUDE.md`.

Market Jury is a paper-trading experiment: four AI models (Claude, GPT, Gemini, DeepSeek), each running a daily and a weekly portfolio, trade virtual money on US stocks and ETFs from the same evening briefing pack. Plain-code characters do the rest: the Floor Runner builds the pack, the Compliance Desk checks orders, the Opening Bell fills them at the next open, The Index holds SPY as the benchmark, and the Market Columnist writes plain-language reports. Cas, the owner, is the Trade Master (the only login); the Gallery is the optional public read-only view.

Sources of truth (read the one your task touches):
- PRD: https://claude.ai/code/artifact/56dd4a06-d0ef-4090-b2bc-bae80e830ed6
- Tech spec: https://claude.ai/code/artifact/7b77c070-31ce-4344-82bb-ded48231b3e0
- Design system: https://claude.ai/artifact/7bJEKRZ9vgGYtXTqq5t6QH (tokens, components, voice); screens: https://claude.ai/artifact/URFHDCkjcScQyJ8A3HbT8a

---

## Stack rules (firm: Cas's decisions)

- **Bun everywhere on the server**, using built-ins before packages: `Bun.serve` (routes, static files), `bun:sqlite`, `Bun.cron`, `Bun.password`, `Bun.S3Client`, `Bun.CookieMap`, `Bun.Glob`, `.env` loading, `bun test`. No server framework.
- **Client = quiver fork** (arrow-js, Navigation API router, Tailwind v4 semantic tokens, Vite). Plain JavaScript with JSDoc, checked by `tsc`. **No React, Next.js, TypeScript files, or component libraries.**
- **SQLite** with plain SQL and numbered migrations. **No Postgres, no ORM.**
- Charts: uPlot for value lines; small hand-written SVG for bars and sparklines.
- AI: Vercel AI SDK + Zod is the one sizeable dependency (Traders milestone). Ignore its AI Gateway advice; call providers directly.
- Before adding any dependency, check whether Bun, the platform or a few lines of code already do it (the `ponytail` skill).

## Folder structure

```
client/              # quiver fork: the single-page app
  index.html
  public/            # logo marks, favicon (from the design system's Logos group)
  src/
    framework/       # quiver router, DI, app bootstrap: edit with care
    pages/           # file-based routes
    layouts/         # 'app' (top bar + notice) and 'basic' (centred panel)
    components/  composables/  state/  utils/
  tests/             # Vitest (framework/, composables/, state/, utils/) and Playwright (e2e/)
server/              # Bun.serve: JSON API under /api, built client for everything else
db/                  # openDb(), migrate(), migrations/NNNN_name.sql
core/                # trading rules as plain functions: money, calendar, portfolio, complianceDesk, openingBell, traders, books, metrics
market/              # market data: Alpaca client, stock menu (stock-menu.json), store, briefing packs
jobs/                # schedule.js (steps on the NY calendar, step_runs, catch-up, pause), experiment.js (line-up, start, dry run), floorRunner.js
scripts/             # CLI tasks (Trade Master setup, run the Floor Runner by hand, nightly backup)
deploy/              # VPS setup, release switch and rollback; runbook in deploy/README.md
tests/               # bun test: server, db, calendar, market data, jobs (fake Alpaca in tests/fake-alpaca.js)
agents/              # model adapters (AI SDK), Trader prompt and answer schema, lookup tools, Columnist, budget guard
```

Layers, bottom up: SQLite → `db/` → domain (`core/`, `agents/`, `jobs/`) → JSON API (`server/`) → client. The scheduler calls the domain directly, so the API and the scheduler share one set of rules. Trading logic is plain functions that take a database handle; it never imports from `server/`.

## Commands

```
bun install
bun run dev                 # Bun server with --watch on :3000 (API + built client)
bun run dev:client          # Vite dev server; proxies /api to :3000
bun run build               # build the client into dist/
bun run start               # production: serve API + dist/, run migrations on start
bun run migrate             # apply pending migrations
bun run trade-master:setup  # create/reset the Trade Master password + authenticator code
bun run floor-runner [date] # collect prices/headlines and build the briefing pack for a day (needs Alpaca keys)
bun run models:check        # one tiny request to every model in the line-up (needs the provider keys)
bun run typecheck           # tsc over server/db/scripts/tests, then client/
bun run test                # bun test (server) + vitest (client)
bun run test:e2e            # Playwright: real Bun server, throwaway DB, built client
```

**Always run `bun run typecheck && bun run test && bun run test:e2e` before completing a task.** CI runs the same three plus the build. In a sandbox with a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_PATH` (e.g. `/opt/pw-browsers/chromium`) instead of downloading browsers.

Environment (see `.env.example`): `PORT`, `DATABASE_PATH`, `CLIENT_DIR`, `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `DEEPSEEK_API_KEY`. API keys go in the server's environment file only, never in the repo or the browser.

---

## Data conventions

- **Money is INTEGER micro-dollars** (`$1 = 1_000_000`), in columns ending `_micro`. Share quantities are INTEGER micro-shares (`quantity_micro`, 6 decimal places). Never store money or quantities as floats; convert only for display.
- Trading dates are `TEXT 'YYYY-MM-DD'` in the market's calendar (New York). Timestamps are ISO-8601 UTC text. The client shows each reader their own time zone with its short name ("SAST 08:32", "AEDT 17:32", via `zoneLabel()`), plus New York time where the market matters (`client/src/utils/time.js`). Never hard-code a reader's zone.
- **Migrations**: add `db/migrations/NNNN_short_name.sql` (next number, zero-padded). Never edit a migration that has merged; add a new one. `migrate()` runs each pending file in a transaction on every start.
- "Built to grow": `asset_class`, `market`, `currency`, `calendar`, `direction`, `order_type` and per-Trader `rule_sets` stay open TEXT/JSON so shorts, crypto or limit orders need no migration. Behaviour metrics are rows in `metrics` (new metric = new key).
- Nothing is ever deleted: history screens read stored rows. Briefing packs are immutable once built.
- The Index is a `traders` row of kind `benchmark`, so every chart and standing treats it like the others.
- Market data: daily bars are stored **unadjusted** (raw official prices, used for fills); splits live in `corporate_actions` and are applied when comparing prices across dates. Alpaca is used for market data and its calendar only: **no code sends orders to any broker.**
- Trading engine (`core/`): the Compliance Desk checks orders at the decision day's close and queues them for the next trading day; the Opening Bell fills them at that day's official open (splits, then dividends, then sells, then buys scaled to fit, then The Index spends its cash on SPY), all in one transaction and safe to re-run. `cash_ledger` is the only record of cash (cash = its sum); splits are ledger rows of amount 0 so `core/books.js` can replay positions from fills and check the running totals. `closeOfDay()` writes snapshots and metrics for a date from replayed positions, so a past day can be rebuilt.
- Briefing packs are JSON documents for models: prices in dollars (rounded to cents) in a compact `columns`/`rows` table, headlines fenced as untrusted data. About 16k tokens for the full menu.

## Server conventions

- Routes live in `Bun.serve({ routes })` in `server/app.js`; group related routes in their own module returning a route object (see `server/auth.js`).
- Respond with `json()` / `error()` from `server/http.js`. Errors are plain-language sentences a non-trader can act on.
- **Every write endpoint checks `isTradeMaster(db, req)`** and reads its body with `readJson()` (which insists on `application/json`). Public reads are allowed only when `settings.gallery_enabled = 1` or the Trade Master is logged in: fail closed.
- Login: `Bun.password` (argon2id) + TOTP code (`server/totp.js`), one-time codes, 5 wrong tries lock it for 15 minutes, session cookie `mj_session` is httpOnly, Secure, SameSite=Strict, stored only as a SHA-256 hash.
- Model output is data: parse it against a schema, never execute it. Lookup tools for models are read-only and capped.
- Every response carries the security headers in `server/http.js`, including a Content-Security-Policy that allows only this site's scripts: no inline `<script>` (put it in `client/public/` instead), fonts from this site only (IBM Plex woff2 files in `client/src/fonts/`, no Google Fonts). The e2e screens tests fail on any CSP complaint.
- Admin routes live in `server/admin.js`; every one, reads included, needs the Trade Master. The scheduler (`jobs/schedule.js`) runs inside the server process once a minute and is the only thing that runs steps; the API only starts, pauses, rehearses or re-runs. A step is one `step_runs` row per (step, trading date): add a step by adding to `STEPS` with its due time and `after` steps.
- `/api/overview` also carries `hero` (line-up size, starting cash, trades, each daily Trader's latest value) for the home page's LandingHero, and `status.market`/`changesAt` from `marketStatus()` (open, soon, closed, holiday) for the MarketStatus pill.
- Gallery reads live in `server/reads.js` (`/api/overview`, `/api/series`, `/api/standings`, `/api/days/:date`, `/api/history`, `/api/traders/:id`, `/api/columnist`): open while the Gallery is on, always to the Trade Master. Money stays in micro-dollars in JSON; the client converts. Standings and badges are `core/standings.js`; a week's and a month's badges are stored at their last close (the floor-runner step), so finished periods keep theirs.
- Model calls (`agents/`): every attempt is a `runs` row with the exact prompt, raw response, tokens and cost (`agents/call.js`). Effort uses the AI SDK's portable `reasoning` setting. The shared instructions and briefing pack come first (Anthropic cache breakpoint after the pack); the Trader's own portfolio, last 10 decisions and journal come last. Tests use `tests/mock-model.js` with recorded answers in `tests/recorded/`.

---

## Client conventions (from quiver)

### Arrow.js rules

These are non-obvious constraints. Violating them causes silent bugs or runtime errors.

1. **Reactive slots must be arrow functions.** `` html`<p>${() => user.name}</p>` `` updates; `` html`<p>${user.name}</p>` `` renders once.
2. **No HTML comments inside templates.** Arrow.js uses comment nodes as slot markers; `<!-- -->` inside `` html`...` `` throws `Invalid HTML position`. Comment outside the template literal.
3. **`.disabled` is not the DOM disabled property.** Use `aria-disabled="true/false"` plus CSS (`opacity-50 cursor-not-allowed`).
4. **Use `.key()` on components in loops**: `` html`${() => items.map(i => Card({ i }).key(i.id))}` ``.
5. **Keep primitives in reactive state, not Dates or class instances.** `reactive()` proxies objects, and a proxied `Date` throws in `Intl` ("Invalid time value"). Store `Date.now()` and wrap with `new Date()` when formatting.
6. **A reactive slot that returns the same markup with new values can leave stale values on screen.** arrow-js patches it in place and nested lists may not update. Return `fresh(key, template)` (from `components/Loadable.js`) so a new key replaces it outright; `Loadable()` already does this per answer. Don't nest a `Loadable` inside `fresh`: show and hide with a reactive `class` instead.
7. **No buttons inside a `<label>`** (for example a glossary `Term`): the label then names the button, not the input.

### Pages, layouts, guards

- File `client/src/pages/path.js` → route `/path`; `[param].js` is a dynamic segment (read with `useRoute().params()`); `not-found.js` handles 404. Export `meta = { layout: 'app' | 'basic', title }` and call `useMeta({ title })`.
- Layout `'app'`: the shared top bar (sticky at the top; logo mark, name, TRADE MASTER pill from 640px, GitHub link and Terminal/Daylight icon switch on the first row; from 1024px the nav on its own wrapping row, below that behind a Menu button and popover panel in `components/MainMenu.js`) and the "Virtual money only. Not financial advice." footer. Layout `'basic'`: a centred panel (login, not found).
- Access rules are one pure function, `routeGuard()` in `client/src/state/sessionState.js`, registered in `main.js`: `/admin/*` is Trade Master only; everything else needs the Gallery open or the Trade Master. The server enforces the same rules; the client guard is only for navigation.
- Composables: `useFetch` for API calls (do not hand-roll fetch + loading state), `useApi(() => url)` when the address follows reactive state (it refetches on change and keeps the server's plain-language error), `send()` in `utils/api.js` for writes, `useForm` for forms, `useToast` for notifications, `useRoute`/`useRouter` for navigation. Call them inside page/component functions.
- Timers, pollers, watchers and charts that must stop when the reader leaves a page register with `onLeave(fn)` (from `framework/index.js`); the router runs them on every navigation. Arrow's `onCleanup` only works inside `component()`, never in a page function or a `Loadable` view.
- State modules: module-scope `reactive({...})` singletons in `client/src/state/`.
- Import components directly from their files (no barrel).

### Look and voice (design system "Night Terminal")

- Only semantic tokens, never raw colours: `bg-surface`, `bg-surface-raised`, `bg-surface-inset`, `text-fg`, `text-fg-soft`, `text-fg-faint`, `border-line`, `border-line-strong`, `bg-brand`/`text-on-brand`, `text-good`, `text-bad`, `border-warn`/`bg-warn-wash`, `trader-1..12`, `index`, `rounded-control` (4px), `rounded-panel` (6px).
- One theme, `data-theme="market-jury"`; two modes: Terminal (`data-mode="dark"`, the default for everyone) and Daylight (light). The theme block in `client/src/style.css` is copied verbatim from the design system's quiver theme (project file `design/market-jury-theme.css`); when the design changes, paste the new block rather than editing values here.
- Fonts: IBM Plex Sans for headings and reading text, IBM Plex Mono for every number, ticker, button label and `prompt` eyebrow (use the `prompt` utility; add `prompt-caret` for the steel-blue `> `).
- Steel blue (`brand`) is the only accent: primary buttons, active nav, focus ring, glossary underline. It never marks gains, losses or a Trader. `good`/`bad` only colour numbers and always come with ▲/▼ and a sign. BUY/SELL tags are never green or red. Each Trader keeps its colour for life (Claude trader-1, GPT trader-2, Gemini trader-3, DeepSeek trader-4); The Index is grey and dashed.
- Write for someone new to trading: plain sentences first, the trading term after it as a glossary term. Name the cast by persona ("The Floor Runner couldn't build the briefing pack"), not by system part. Quote Traders' reasons verbatim. Sentence case, no emoji, no exclamation marks. No "AI" wordmark or badge on the logo.
- Tailwind only emits theme colours whose full name appears in the source, so never build a token name at run time (`` `--color-trader-${n}` ``): use `colourOf()` in `utils/traders.js`, which spells them out. Otherwise Daylight loses the colour.
- Interruptions are native `<dialog>`s via `components/Dialog.js` (`confirmDialog()` for a yes/no with the safe choice focused and the action named, `openDialog()` for a short form). Never `alert()`, `confirm()` or `prompt()`.
- Explanations open in native popovers (`Term`, and `Hint` for a "?" next to a column head), never inline hints.
- Long Trade Master pages fold into `Disclosure` sections (`components/Disclosure.js`): a heading button with `aria-expanded`, a one-line summary when closed, open state remembered per browser.
- Every `<select>` uses the `mj-select` class; number boxes use `mj-input--num` with the unit outside the box (`mj-affix`).
- Screens show data through `Loadable(request, view)`; glossary words through `Term(word, key)` (`utils/glossary.js`); Traders through `TraderMark`/`TraderName`; changes through `Delta` (arrow plus sign); value lines through `ValueChart` (uPlot).
- Phone first: one column, 16px gutters, touch targets at least 44px (`min-h-11`). Respect `prefers-reduced-motion`; nothing blinks or auto-scrolls.

---

## Testing

- `bun test` (`tests/`): server routes against a real `Bun.serve` on port 0 and an in-memory database with the real migrations (`tests/helpers.js`). Trading logic is tested first, before it is written (the `test-driven-development` skill).
- Vitest (`client/tests/`): framework, composables, state and utils, in jsdom.
- Playwright (`client/tests/e2e/`): the built client served by the real Bun server with a throwaway database and a seeded Trade Master (`client/tests/e2e/server.js`). A TOTP code works once, so one test per run should log in successfully.
- CI never calls a paid API: model adapters are tested against recorded responses.

## Skills (in `.claude/skills/`, see its README for sources)

| Skill | Use it when |
| --- | --- |
| `ponytail` | Before writing code: is it needed at all; does Bun, the platform or the stdlib already do it |
| `test-driven-development` | Writing trading logic (Compliance Desk, Opening Bell, metrics, calendar): failing test first |
| `systematic-debugging` | Any bug or failing test: root cause before a fix |
| `frontend-design` | Building screens on the Night Terminal theme |
| `webapp-testing` | Driving the app in Playwright to check a screen |
| `accessibility` | WCAG 2.2 checks on public (Gallery) screens |
| `insecure-defaults` | Touching auth, sessions, config or deploy; before the Gallery goes public |
| `ai-sdk` | Model adapters: read the installed AI SDK's own docs instead of guessing |

Slash commands from quiver (`.claude/commands/`): `/add-page`, `/add-component`, `/add-composable`, `/add-state`, `/add-layout`, `/add-feature`, `/add-test`.

## Milestones

One PR per milestone, each a working vertical slice: 1 Foundations · 2 Market data and Floor Runner · 3 Trading engine · 4 Traders and Columnist · 5 Scheduler and admin · 6 Web screens · 7 Release (VPS, Cloudflare Tunnel, deploys, R2 backups).
