import { go } from '../framework/router.js'

/**
 * Click handler for an in-app <a href>: let the router take it. A query string
 * (for example a period on Standings) stays in the address for the page to read.
 * @param {string} path
 */
export const navigate = (path) => (/** @type {Event} */ e) => {
  e.preventDefault()
  go(path)
}

/**
 * A query parameter of the current address.
 * @param {string} name
 */
export const queryParam = (name) => new URLSearchParams(window.location.search).get(name)

/**
 * Keep a page's choice in the address (?track=weekly) without leaving the page,
 * so a copied link reopens on the same choice. An empty value or the default
 * drops the parameter.
 * @param {string} name
 * @param {string} value
 * @param {string} [fallback] the value the page uses when the parameter is missing
 */
export const setQueryParam = (name, value, fallback = '') => {
  const url = new URL(window.location.href)
  if (!value || value === fallback) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  if (url.href === window.location.href) return
  window.navigation.navigate(url.pathname + url.search + url.hash, { history: 'replace', info: { urlOnly: true } })
}
