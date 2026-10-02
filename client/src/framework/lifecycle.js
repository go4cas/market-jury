// Pages are plain functions, not arrow components, so arrow's onCleanup has no
// scope to attach to there (and views drawn later by Loadable never do). The
// router owns the page lifecycle instead, as it does for useMeta: whatever a
// page or its composables register here runs when the reader leaves the page.

/** @type {Array<() => void>} */
let pending = []

/**
 * Run `fn` when the router leaves the current page (timers, pollers, aborts, charts).
 * @param {() => void} fn
 */
export function onLeave(fn) {
  pending.push(fn)
}

// The router calls this at the start of every navigation.
export function leavePage() {
  const fns = pending
  pending = []
  for (const fn of fns) {
    try { fn() } catch (err) { console.error(err) }
  }
}
