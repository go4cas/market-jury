// A stand-in for Alpaca's HTTP API, answering in the shapes Alpaca documents
// (trading API /v2/calendar, market data /v2/stocks/bars, /v1beta1/news,
// /v1/corporate-actions). Tests hand it to createAlpaca() as `fetch`.

/**
 * @typedef {object} FakeMarket
 * @property {Array<{ date: string, open: string, close: string }>} calendar
 * @property {Record<string, Array<{ t: string, o: number, h: number, l: number, c: number, v: number }>>} bars
 * @property {Array<{ id: number, headline: string, summary: string, source: string, url: string, created_at: string, symbols: string[] }>} news
 * @property {{ forward_splits?: any[], reverse_splits?: any[], cash_dividends?: any[] }} corporateActions
 */

/**
 * @param {FakeMarket} market
 * @param {{ pageSize?: number, failFirst?: number }} [options] failFirst: answer 503 to the first N requests
 */
export function fakeAlpacaFetch(market, { pageSize = 3, failFirst = 0 } = {}) {
  /** @type {URL[]} */
  const requests = []
  let failures = failFirst

  /** @param {string | URL | Request} input @param {RequestInit} [init] */
  async function fetch(input, init) {
    const url = new URL(String(input))
    requests.push(url)
    const headers = new Headers(init?.headers)
    if (!headers.get('APCA-API-KEY-ID') || !headers.get('APCA-API-SECRET-KEY')) return Response.json({ message: 'forbidden' }, { status: 403 })
    if (failures > 0) {
      failures--
      return Response.json({ message: 'service unavailable' }, { status: 503 })
    }
    const q = url.searchParams
    const page = Number(q.get('page_token') ?? 0)

    switch (url.pathname) {
      case '/v2/calendar': {
        const start = q.get('start') ?? ''
        const end = q.get('end') ?? '9999'
        return Response.json(market.calendar.filter((d) => d.date >= start && d.date <= end).map((d) => ({ ...d, session_open: '0400', session_close: '2000' })))
      }
      case '/v2/stocks/bars': {
        const symbols = (q.get('symbols') ?? '').split(',')
        const start = q.get('start') ?? ''
        const end = q.get('end') ?? '9999'
        const all = symbols.flatMap((s) => (market.bars[s] ?? []).filter((b) => b.t.slice(0, 10) >= start && b.t.slice(0, 10) <= end).map((b) => /** @type {[string, any]} */ ([s, b])))
        const slice = all.slice(page, page + pageSize)
        /** @type {Record<string, any[]>} */
        const bars = {}
        for (const [s, b] of slice) (bars[s] ??= []).push({ ...b, n: 100, vw: b.c })
        return Response.json({ bars, next_page_token: page + pageSize < all.length ? String(page + pageSize) : null })
      }
      case '/v1beta1/news': {
        const start = q.get('start') ?? ''
        const end = q.get('end') ?? '9999'
        const all = market.news.filter((n) => n.created_at >= start && n.created_at <= end).sort((a, b) => b.created_at.localeCompare(a.created_at))
        const slice = all.slice(page, page + pageSize)
        return Response.json({ news: slice.map((n) => ({ ...n, author: 'Desk', updated_at: n.created_at, images: [] })), next_page_token: page + pageSize < all.length ? String(page + pageSize) : null })
      }
      case '/v1/corporate-actions': {
        const symbols = new Set((q.get('symbols') ?? '').split(','))
        /** @type {Record<string, any[]>} */
        const out = {}
        for (const [type, list] of Object.entries(market.corporateActions)) out[type] = list.filter((a) => symbols.has(a.symbol))
        return Response.json({ corporate_actions: out, next_page_token: null })
      }
      default:
        return Response.json({ message: 'not found' }, { status: 404 })
    }
  }

  return { fetch, requests }
}
