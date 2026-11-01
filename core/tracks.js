// Tracks: groups of Traders who play by the same conditions, one Trader per
// model. A Track's conditions (how often it decides, how much of the briefing
// pack it gets, whether it may search the web) are fixed when it is created;
// only its title, which the Traders never see, can change.

/** @typedef {import('bun:sqlite').Database} Database */

/**
 * @typedef {object} Track
 * @property {number} id
 * @property {string} slug fixed, for links
 * @property {string} title for readers, shown as "<title> track"
 * @property {'daily' | 'weekly'} cadence
 * @property {'full' | 'prices_only'} briefing_pack
 * @property {'off' | 'native' | 'shared'} web_search
 * @property {number} searches_per_run
 * @property {string | null} started_on
 */

export const PACK_CHOICES = /** @type {const} */ (['full', 'prices_only'])
export const SEARCH_CHOICES = /** @type {const} */ (['off', 'native', 'shared'])
/** The most web searches a Track may allow in one run. */
export const MAX_SEARCHES = 10
const MAX_TITLE = 40

/** @param {Database} db @returns {Track[]} */
export const tracks = (db) => /** @type {Track[]} */ (db.query('SELECT id, slug, title, cadence, briefing_pack, web_search, searches_per_run, started_on FROM tracks ORDER BY id').all())

/** @param {Database} db @param {string} slug @returns {Track | null} */
export const trackBySlug = (db, slug) => tracks(db).find((t) => t.slug === slug) ?? null

/**
 * The Track a Trader plays in (null for The Index).
 * @param {Database} db
 * @param {number} traderId
 * @returns {Track | null}
 */
export function trackOf(db, traderId) {
  return /** @type {Track | null} */ (db.query(`SELECT k.id, k.slug, k.title, k.cadence, k.briefing_pack, k.web_search, k.searches_per_run, k.started_on
                                                FROM traders t JOIN tracks k ON k.id = t.track_id WHERE t.id = ?`).get(traderId))
}

/** "Claude" from "Claude daily" or "Claude weekly research". @param {string} name */
export const modelLabel = (name) => name.replace(/\s+(daily|weekly)(\s.*)?$/i, '')

/**
 * Check a title: the Trade Master's words, kept short and plain.
 * @param {unknown} value
 * @returns {string}
 */
export function checkTitle(value) {
  const title = String(value ?? '').trim().replace(/\s+/g, ' ').replace(/\s+track$/i, '')
  if (!title) throw new Error('Give the track a title.')
  if (title.length > MAX_TITLE) throw new Error(`The track title can be at most ${MAX_TITLE} characters.`)
  return title
}

/**
 * Check a new Track's conditions.
 * @param {Record<string, unknown>} b
 */
export function checkNewTrack(b) {
  const title = checkTitle(b.title)
  const cadence = b.cadence === 'daily' || b.cadence === 'weekly' ? b.cadence : null
  if (!cadence) throw new Error('Choose how often the track decides: every evening or once a week.')
  const briefingPack = PACK_CHOICES.find((c) => c === b.briefingPack)
  if (!briefingPack) throw new Error('Choose the full briefing pack or prices only.')
  const webSearch = SEARCH_CHOICES.find((c) => c === b.webSearch)
  if (!webSearch) throw new Error("Choose no web search, each model's own search, or the shared search tool.")
  const searches = webSearch === 'off' ? 0 : Number(b.searchesPerRun)
  if (webSearch !== 'off' && !(Number.isInteger(searches) && searches >= 1 && searches <= MAX_SEARCHES)) throw new Error(`Searches per run must be a whole number from 1 to ${MAX_SEARCHES}.`)
  return { title, cadence: /** @type {'daily' | 'weekly'} */ (cadence), briefingPack, webSearch, searchesPerRun: searches }
}

/**
 * The fixed slug of a new Track: its cadence, then its title's words.
 * "Weekly research" on the weekly cadence → "weekly-research".
 * @param {'daily' | 'weekly'} cadence
 * @param {string} title
 */
export function slugFor(cadence, title) {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  const rest = words[0] === cadence ? words.slice(1) : words
  return [cadence, ...rest].join('-')
}

/**
 * What a Track's Traders get, in one plain sentence (the change log and Settings).
 * @param {Pick<Track, 'cadence' | 'briefing_pack' | 'web_search' | 'searches_per_run'>} t
 */
export function describeTrack(t) {
  const when = t.cadence === 'daily' ? 'decides every evening' : 'decides once a week'
  const pack = t.briefing_pack === 'full' ? 'gets the full briefing pack' : 'gets the briefing pack without headlines'
  const search = t.web_search === 'off' ? 'has no web search'
    : `may search the web (${t.web_search === 'native' ? "each model's own search" : 'one shared search tool'}, up to ${t.searches_per_run} ${t.searches_per_run === 1 ? 'search' : 'searches'} a run)`
  return `${when}, ${pack} and ${search}`
}
