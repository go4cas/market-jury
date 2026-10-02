import { test, expect } from '@playwright/test'
import { E2E_SESSION_TOKEN } from './fixtures.js'

// The server is seeded with one week of the experiment (23 to 27 November 2026,
// four trading days) on fake prices and recorded Trader answers.

/** Content-Security-Policy complaints seen on the page during a test. */
let blocked = /** @type {string[]} */ ([])

test.beforeEach(async ({ context, baseURL, page }) => {
  await context.addCookies([{ name: 'mj_session', value: E2E_SESSION_TOKEN, url: baseURL, httpOnly: true, secure: true, sameSite: 'Strict' }])
  blocked = []
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) blocked.push(msg.text())
  })
})

// Every screen works under the server's Content-Security-Policy.
test.afterEach(() => expect(blocked).toEqual([]))

test('the Overview shows the value chart, standings and the latest recap', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('dateline')).toContainText('Day 3')
  await expect(page.getByRole('img', { name: /Daily track since day one: Claude · Daily \$1,0\d\d/ })).toBeVisible()
  await expect(page.getByRole('table').getByText('Claude · Daily')).toBeVisible()
  await expect(page.getByText('The Columnist · Daily recap · Fri 27 Nov')).toBeVisible()

  // The weekly track swaps the chart and the table.
  await page.getByRole('button', { name: 'Weekly', exact: true }).click()
  await expect(page.getByRole('table').getByText('Claude · Weekly')).toBeVisible()
  await expect(page.getByRole('table').getByText('Claude · Daily')).toHaveCount(0)
})

test('a glossary word opens its plain meaning in a popover, and Escape closes it', async ({ page }) => {
  await page.goto('/')
  const term = page.getByRole('button', { name: 'portfolio' })
  await term.click()
  await expect(term).toHaveAttribute('aria-expanded', 'true')
  const pop = page.getByRole('dialog', { name: 'portfolio' })
  await expect(pop).toContainText('Everything a Trader owns')
  // It sits just under the word, inside the screen.
  const [t, p] = [await term.boundingBox(), await pop.boundingBox()]
  expect(p && t && p.y > t.y && p.x >= 16).toBe(true)
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  await expect(term).toHaveAttribute('aria-expanded', 'false')
})

test('a column head explains itself through its "?" without moving the table', async ({ page }) => {
  await page.goto('/standings')
  const table = page.getByRole('table')
  await expect(table).toBeVisible()
  const before = await table.boundingBox()
  await page.getByRole('button', { name: 'What is worst drop?' }).click()
  await expect(page.getByRole('dialog', { name: 'Worst drop' })).toContainText('maximum drawdown')
  expect(await table.boundingBox()).toEqual(before)
})

test('Standings rank a week with its badges', async ({ page }) => {
  await page.goto('/standings')
  await expect(page.getByRole('heading', { name: 'Week of 23–27 Nov' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Worst drop/ })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Badges' })).toBeVisible()
  await page.getByRole('button', { name: 'Since start' }).click()
  await expect(page.getByRole('heading', { name: 'Since the start, to Fri 27 Nov' })).toBeVisible()
})

test('Yesterday shows each Trader\'s orders with its reason, and steps back a day', async ({ page }) => {
  await page.goto('/yesterday')
  await expect(page.getByRole('heading', { name: 'Yesterday', level: 1 })).toBeVisible()
  await expect(page.getByTestId('trade-card')).toHaveCount(8)
  await expect(page.getByText('“Steady gains and a new phone launch; a core holding.”').first()).toBeVisible()
  await expect(page.getByText(/by the Compliance Desk/).first()).toBeVisible()

  await page.getByRole('link', { name: 'Previous trading day' }).click()
  await expect(page).toHaveURL('/days/2026-11-25')
  await expect(page.getByRole('heading', { name: 'Wed 25 Nov', level: 1 })).toBeVisible()
  await expect(page.getByTestId('trade-card')).toHaveCount(4)

  await page.getByRole('button', { name: 'GPT' }).click()
  await expect(page.getByTestId('trade-card')).toHaveCount(1)
})

test('History opens a day from a week card', async ({ page }) => {
  await page.goto('/history')
  await expect(page.getByTestId('week-card')).toHaveCount(1)
  await expect(page.getByText('Week 1 · 23–27 Nov')).toBeVisible()
  await page.getByRole('link', { name: /^Tue 24 Nov: \d+ trades$/ }).click()
  await expect(page).toHaveURL('/days/2026-11-24')
})

test('a Trader\'s page shows holdings, trades and its journal; Compare puts two side by side', async ({ page }) => {
  await page.goto('/standings')
  await page.getByRole('link', { name: 'Claude · Daily' }).click()
  await expect(page.getByRole('heading', { name: 'Claude · Daily', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What it holds' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'AAPL' })).toBeVisible()
  await expect(page.getByText('Day one. Bought AAPL and SPY').first()).toBeVisible()

  await page.goto('/compare')
  await expect(page.getByRole('columnheader', { name: 'Claude · Weekly' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Since start' })).toBeVisible()
})

test('the Columnist lists recaps and the weekly report', async ({ page }) => {
  await page.goto('/columnist')
  await expect(page.getByTestId('column')).toHaveCount(5)
  await page.getByRole('button', { name: 'Weekly reports' }).click()
  await expect(page.getByTestId('column')).toHaveCount(1)
})

/**
 * Open a collapsed Settings section (sections remember being open, so only click a closed one).
 * @param {import('@playwright/test').Page} page
 * @param {string} title
 */
async function openSection(page, title) {
  const button = page.getByRole('button', { name: new RegExp(`^${title}`) })
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
}

test('the Trade Master screens: settings, costs and the briefing pack', async ({ page }) => {
  await page.goto('/admin/settings')
  await expect(page.getByTestId('experiment-state')).toHaveText('Running')
  await expect(page.getByRole('heading', { name: 'Running · Day 3 of 63' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  // The line-up is open to begin with; the other sections fold away.
  await expect(page.getByRole('button', { name: 'Retire' })).toHaveCount(8)
  await expect(page.getByRole('searchbox', { name: /Find a ticker/ })).toBeHidden()
  await openSection(page, 'Stock list')
  await page.getByRole('searchbox', { name: /Find a ticker/ }).fill('nv')
  await expect(page.getByText('Nvidia')).toBeVisible()
  await expect(page.getByText('Apple Inc.')).toHaveCount(0)

  await page.goto('/admin/costs')
  await expect(page.getByRole('heading', { name: 'By Trader' })).toBeVisible()

  await page.goto('/admin/briefing')
  await expect(page.getByRole('heading', { name: 'Headlines' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'SPY', exact: true })).toBeVisible()
})

test('a dry run shows each Trader\'s answer with its orders and verdicts', async ({ page }) => {
  const order = { side: 'buy', ticker: 'AAPL', amountMicro: 300_000_000, sellAll: 0, reason: 'Steady gains; a core holding.', verdict: 'trimmed', note: 'Cut to the 20% position cap.', approvedAmountMicro: 200_000_000 }
  const result = {
    packDate: '2026-11-24',
    results: [
      { traderId: 1, trader: 'Claude · Daily', ok: true, error: null, costMicro: 1, verdicts: [{}], marketView: 'Large caps drifted higher.', noTradesReason: null, orders: [order] },
      { traderId: 2, trader: 'Gemini · Weekly', ok: false, error: 'You exceeded your current quota.', costMicro: 0, verdicts: [], marketView: null, noTradesReason: null, orders: [] },
    ],
  }
  await page.route('**/api/admin/dry-run', (route) => route.fulfill({ json: { running: false, finishedAt: '2026-11-24T22:00:00Z', result, error: null } }))
  await page.goto('/admin/settings')
  await expect(page.getByText(/Last dry run .* · 2 Traders · \$0\.00/)).toBeVisible()
  await page.getByRole('button', { name: 'See result' }).click()
  await expect(page.getByText('You exceeded your current quota.')).toBeVisible()
  await page.getByText('answered with 1 order').click()
  await expect(page.getByText('Large caps drifted higher.')).toBeVisible()
  await expect(page.getByText('BUY AAPL $300.00')).toBeVisible()
  await expect(page.getByText('trimmed to fit the rules to $200.00')).toBeVisible()
  await expect(page.getByText('"Steady gains; a core holding."')).toBeVisible()
})

test('a visitor reads the Gallery once the Trade Master opens it, but not the Trade Master screens', async ({ page, browser, baseURL }) => {
  await page.goto('/admin/settings')
  await openSection(page, 'Rules and budget')
  await page.getByRole('checkbox', { name: /Open the Gallery/ }).check()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Settings saved.')).toBeVisible()

  const visitor = await browser.newPage({ baseURL })
  await visitor.goto('/yesterday')
  await expect(visitor.getByTestId('trade-card').first()).toBeVisible()
  await expect(visitor.getByText('TRADE MASTER')).toHaveCount(0)
  await expect(visitor.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  await visitor.goto('/admin/costs')
  await expect(visitor).toHaveURL('/login')
  await visitor.close()

  // Close it again for the other tests.
  await page.reload()
  await openSection(page, 'Rules and budget')
  await page.getByRole('checkbox', { name: /Open the Gallery/ }).uncheck()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Settings saved.')).toBeVisible()
})

test('The cast explains who does what, with the live line-up linked to each Trader', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Meet the cast' }).click()
  await expect(page).toHaveURL('/cast')
  await expect(page.getByRole('heading', { name: 'The cast', level: 1 })).toBeVisible()
  await expect(page.locator('#compliance-desk')).toContainText('When · after the Traders decide')
  // The cards follow a trading day, and on a laptop they are all the same height.
  await expect(page.locator('article').first()).toHaveId('floor-runner')
  const heights = await page.locator('article:not(#traders)').evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect().height))
  expect(new Set(heights).size).toBe(1)
  // The icons are drawn as real SVG shapes, so they take up room on the page.
  const shape = await page.getByRole('main').locator('svg path').first().boundingBox()
  expect(shape?.width).toBeGreaterThan(0)
  await page.locator('#traders').getByRole('link', { name: /Claude · Daily/ }).click()
  await expect(page.getByRole('heading', { name: 'Claude · Daily', level: 1 })).toBeVisible()
})

test('the home page opens with the hero: live stats, the jury box and the market status', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '4 AI traders. $1,000 each. 3 months.', level: 1 })).toBeVisible()
  await expect(page.getByText('A paper-trading experiment · Day 3 of 63')).toBeVisible()
  await expect(page.getByText('3/63')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Daily Traders now: Claude \$1,0\d\d, GPT .*; The Index \$1,0\d\d$/ })).toBeVisible()
  // The seeded clock is past Friday's close, so the market is closed until Monday's open.
  await expect(page.getByRole('status').filter({ hasText: 'Market closed' })).toContainText(/opens \w{3} 09:30 NY|holiday/)
  // Closed is red, as Cas asked (open is green, the hour before the open amber).
  await expect(page.getByRole('status').filter({ hasText: 'Market closed' })).toHaveClass(/text-bad/)
  await page.getByRole('button', { name: 'See who is ahead' }).click()
  await expect(page.getByRole('heading', { name: 'Who is ahead' })).toBeInViewport()
})

test('Settings lists every stock in a scrolling box, with short boxes for numbers', async ({ page }) => {
  await page.goto('/admin/settings')
  await openSection(page, 'Stock list')
  await openSection(page, 'Rules and budget')
  const list = page.getByRole('list', { name: 'Stocks and funds' })
  await expect(list.getByRole('listitem').first()).toBeVisible()
  // Every stock is listed (no cut-off); a long list scrolls inside its box.
  const count = await list.getByRole('listitem').count()
  await expect(page.getByText(`All ${count}, scroll to see them.`)).toBeVisible()
  expect(await list.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto')
  const budget = await page.getByRole('spinbutton', { name: /Monthly budget/ }).boundingBox()
  expect(budget?.width).toBeLessThan(200)
})

test('Retire and Add a Trader open dialogs, not browser pop-ups', async ({ page }) => {
  page.on('dialog', () => { throw new Error('A browser pop-up opened') })
  await page.goto('/admin/settings')
  await page.getByRole('button', { name: 'Retire' }).first().click()
  const retire = page.getByRole('dialog', { name: /^Retire / })
  await expect(retire).toContainText("at the next open")
  await expect(retire).toContainText("This can't be undone.")
  await expect(retire.getByRole('button', { name: /^Keep / })).toBeFocused()
  await retire.getByRole('button', { name: /^Keep / }).click()
  await expect(retire).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retire' })).toHaveCount(8)

  await page.getByRole('button', { name: 'Add a Trader' }).click()
  const add = page.getByRole('dialog', { name: 'Add a Trader' })
  await expect(add.getByRole('button', { name: 'Add the Trader' })).toHaveAttribute('aria-disabled', 'true')
  await add.getByRole('button', { name: 'Add the Trader' }).click({ force: true })
  await expect(add.getByText(/fill (in|out) this field/i).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(add).toHaveCount(0)
})

test('the Overview clock shows New York and the reader\'s own time zone', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, timezoneId: 'Australia/Sydney' })
  await context.addCookies([{ name: 'mj_session', value: E2E_SESSION_TOKEN, url: String(baseURL), httpOnly: true, secure: true, sameSite: 'Strict' }])
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByTestId('dateline')).toContainText(/NY \d\d:\d\d · AE[DS]T \d\d:\d\d/)
  await context.close()
})

test('Daylight keeps every Trader colour', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ui-mode', 'light'))
  await page.goto('/cast')
  const mark = page.locator('#traders a span[aria-hidden]').first()
  await expect(mark).toBeVisible()
  expect(await mark.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
})
