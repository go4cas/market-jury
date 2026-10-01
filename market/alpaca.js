// A small client for the parts of Alpaca's API the Floor Runner needs: the
// market calendar, daily bars, headlines, and splits and dividends. Market
// data only; no orders are ever sent. Answers come back in our own shapes,
// with money as micro-dollars.
import { toMicro } from '../core/money.js'
import { marketDate } from '../core/calendar.js'

const SYMBOLS_PER_REQUEST = 100
const ATTEMPTS = 3

/**
 * @typedef {object} Bar
 * @property {string} ticker
 * @property {string} date
 * @property {number} openMicro
 * @property {number} highMicro
 * @property {number} lowMicro
 * @property {number} closeMicro
 * @property {number} volume
 *
 * @typedef {object} NewsItem
 * @property {string} externalId
 * @property {string} headline
 * @property {string} summary
 * @property {string} source
 * @property {string} url
 * @property {string} publishedAt
 * @property {string[]} tickers
 *
 * @typedef {object} CorporateAction
 * @property {string} ticker
 * @property {'split' | 'dividend'} kind
 * @property {string} exDate
 * @property {string | null} payDate
 * @property {number | null} splitFrom
 * @property {number | null} splitTo
 * @property {number | null} cashPerShareMicro
 *
 * @typedef {ReturnType<typeof createAlpaca>} Alpaca
 */

/**
 * @param {object} options
 * @param {string | undefined} options.keyId
 * @param {string | undefined} options.secretKey
 * @param {string} [options.tradingUrl] the calendar lives on the (paper) trading API
 * @param {string} [options.dataUrl]
 * @param {string} [options.feed] 'sip' (all US exchanges; the default) or 'iex'
 * @param {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} [options.fetch]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createAlpaca({
  keyId,
  secretKey,
  tradingUrl = 'https://paper-api.alpaca.markets',
  dataUrl = 'https://data.alpaca.markets',
  feed = 'sip',
  fetch = globalThis.fetch,
  sleep = Bun.sleep,
}) {
  const headers = { 'APCA-API-KEY-ID': keyId ?? '', 'APCA-API-SECRET-KEY': secretKey ?? '', Accept: 'application/json' }

  /**
   * GET with retries on rate limits and server errors.
   * @param {string} base
   * @param {string} path
   * @param {Record<string, string | number | undefined>} params
   * @returns {Promise<any>}
   */
  async function get(base, path, params) {
    // Checked per call, so the server starts without keys and only market-data steps fail.
    if (!keyId || !secretKey) throw new Error('Alpaca keys are missing: set ALPACA_KEY_ID and ALPACA_SECRET_KEY in the server environment.')
    const url = new URL(path, base)
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value))

    let lastProblem = ''
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, { headers })
        if (res.ok) return await res.json()
        lastProblem = `HTTP ${res.status}`
        if (res.status !== 429 && res.status < 500) break
      } catch (err) {
        lastProblem = err instanceof Error ? err.message : String(err)
      }
      if (attempt < ATTEMPTS) await sleep(1000 * 2 ** attempt)
    }
    throw new Error(`Alpaca did not answer ${path} (${lastProblem}).`)
  }

  /**
   * Follow next_page_token until the answer runs out (or `max` items).
   * @template T
   * @param {(token: string | undefined) => Promise<{ items: T[], next: string | null | undefined }>} page
   * @param {number} [max]
   */
  async function allPages(page, max = Infinity) {
    /** @type {T[]} */
    const out = []
    let token
    do {
      const { items, next } = await page(token)
      out.push(...items)
      token = next ?? undefined
    } while (token && out.length < max)
    return out.slice(0, max)
  }

  return {
    /**
     * Trading days (New York) between two dates, with open and close times.
     * @param {string} start
     * @param {string} end
     * @returns {Promise<Array<{ date: string, open: string, close: string }>>}
     */
    async calendar(start, end) {
      const days = await get(tradingUrl, '/v2/calendar', { start, end })
      return days.map((/** @type {any} */ d) => ({ date: d.date, open: d.open, close: d.close }))
    },

    /**
     * Official daily bars, unadjusted (we apply splits ourselves).
     * @param {string[]} tickers
     * @param {string} start
     * @param {string} end
     * @returns {Promise<Bar[]>}
     */
    async dailyBars(tickers, start, end) {
      /** @type {Bar[]} */
      const out = []
      for (let i = 0; i < tickers.length; i += SYMBOLS_PER_REQUEST) {
        const symbols = tickers.slice(i, i + SYMBOLS_PER_REQUEST).join(',')
        const bars = await allPages(async (page_token) => {
          const body = await get(dataUrl, '/v2/stocks/bars', { symbols, timeframe: '1Day', start, end, adjustment: 'raw', feed, limit: 10000, page_token })
          const items = Object.entries(body.bars ?? {}).flatMap(([ticker, list]) =>
            /** @type {any[]} */ (list).map((b) => ({
              ticker,
              date: marketDate(new Date(b.t)),
              openMicro: toMicro(b.o),
              highMicro: toMicro(b.h),
              lowMicro: toMicro(b.l),
              closeMicro: toMicro(b.c),
              volume: Math.round(b.v),
            })),
          )
          return { items, next: body.next_page_token }
        })
        out.push(...bars)
      }
      return out
    },

    /**
     * Headlines published in a time window, newest first.
     * @param {Date} start
     * @param {Date} end
     * @param {{ max?: number }} [options]
     * @returns {Promise<NewsItem[]>}
     */
    async news(start, end, { max = 1000 } = {}) {
      return allPages(async (page_token) => {
        const body = await get(dataUrl, '/v1beta1/news', { start: start.toISOString(), end: end.toISOString(), sort: 'desc', limit: 50, page_token })
        const items = (body.news ?? []).map((/** @type {any} */ n) => ({
          externalId: String(n.id),
          headline: n.headline,
          summary: n.summary ?? '',
          source: n.source,
          url: n.url ?? '',
          publishedAt: n.created_at,
          tickers: n.symbols ?? [],
        }))
        return { items, next: body.next_page_token }
      }, max)
    },

    /**
     * Splits and cash dividends with an ex-date in the range.
     * @param {string[]} tickers
     * @param {string} start
     * @param {string} end
     * @returns {Promise<CorporateAction[]>}
     */
    async corporateActions(tickers, start, end) {
      /** @type {CorporateAction[]} */
      const out = []
      for (let i = 0; i < tickers.length; i += SYMBOLS_PER_REQUEST) {
        const symbols = tickers.slice(i, i + SYMBOLS_PER_REQUEST).join(',')
        const pages = await allPages(async (page_token) => {
          const body = await get(dataUrl, '/v1/corporate-actions', { symbols, types: 'forward_split,reverse_split,cash_dividend', start, end, limit: 1000, page_token })
          const actions = body.corporate_actions ?? {}
          const splits = [...(actions.forward_splits ?? []), ...(actions.reverse_splits ?? [])].map((/** @type {any} */ s) => ({
            ticker: s.symbol, kind: /** @type {const} */ ('split'), exDate: s.ex_date, payDate: s.payable_date ?? null,
            splitFrom: s.old_rate, splitTo: s.new_rate, cashPerShareMicro: null,
          }))
          const dividends = (actions.cash_dividends ?? []).map((/** @type {any} */ d) => ({
            ticker: d.symbol, kind: /** @type {const} */ ('dividend'), exDate: d.ex_date, payDate: d.payable_date ?? null,
            splitFrom: null, splitTo: null, cashPerShareMicro: toMicro(d.rate),
          }))
          return { items: [...splits, ...dividends], next: body.next_page_token }
        })
        out.push(...pages)
      }
      return out
    },
  }
}
