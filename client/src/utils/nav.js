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
