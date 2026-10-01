Add a new feature to Market Jury: $ARGUMENTS

The argument is a feature name and optional brief description (e.g. `blog — list and read blog posts`, `cart — add items and checkout`).

Follow this process:

## Step 1 — Plan (do this first, before writing any code)

Analyse the feature request and produce a short plan covering:
- **Pages needed** — list each route and its purpose
- **State module(s) needed** — list each store and its key data/actions
- **Component(s) needed** — list any new reusable components
- **Nav links** — does `AppLayout` top bar need a new link?
- **Tests** — what E2E scenarios cover the happy path?

Present the plan to the developer and wait for confirmation before proceeding.

## Step 2 — Implement

Execute the plan in this order:

1. **State module(s)** — create `client/src/state/<name>.js` as a module-scope `reactive({...})` object. Export as singleton. See `client/src/state/sessionState.js` as the reference pattern.

2. **Component(s)** — create each in `client/src/components/<Name>.js`; import them directly from their files where used (there is no barrel).

3. **Pages** — create each in `client/src/pages/<path>.js`. Structure:
   ```js
   import { html } from '@arrow-js/core'
   import { useMeta } from '../framework/index.js'
   export const meta = { layout: 'app', title: 'Page Title' }
   function FeaturePage() {
     useMeta({ title: 'Page Title' })
     return html`...`
   }
   export default FeaturePage
   ```

4. **Nav link** — if needed, add a `Link` entry to `client/src/layouts/AppLayout.js` matching the pattern of existing nav links.

5. **E2E test** — create `client/tests/e2e/<feature>.test.js` covering the main user flow. Use role-based Playwright selectors; add `data-testid` attributes where needed.

## Step 3 — Verify

Run `bun run dev` and `bun run dev:client` and confirm the feature works end-to-end in the browser. Then run the full gate and fix any failures before reporting done:

```
bun run typecheck && bun run test && bun run test:e2e
```

## Arrow.js rules (apply throughout)

- Wrap reactive values in `() =>` inside templates
- No `<!-- -->` HTML comments inside `` html`...` `` template literals
- Use `aria-disabled` + CSS for disabled states, never `.disabled="${...}"`
- Use `.key(uniqueId)` on components rendered inside loops
- Annotate exported functions and props with JSDoc `@param`/`@returns` — strict `checkJs` is enforced and untyped params fail `bun run typecheck`
