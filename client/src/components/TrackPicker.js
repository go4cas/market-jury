import { html } from '@arrow-js/core'
import { useFetch } from '../composables/useFetch.js'
import { fresh } from './Loadable.js'
import { Segmented } from './Segmented.js'

/** Shown until the list arrives: the two Tracks every experiment starts with. */
const FIRST = [{ slug: 'daily', title: 'Daily' }, { slug: 'weekly', title: 'Weekly' }]

/**
 * Pick a Track: one button per Track that has started, named by its title
 * ("Daily track", or just "Daily" when short).
 * @param {{ value: () => string, onPick: (slug: string) => void, short?: boolean }} props
 */
export function TrackPicker({ value, onPick, short = false }) {
  const request = useFetch('/api/tracks')
  return html`${() => {
    /** @type {Array<{ slug: string, title: string }>} */
    const list = request.data()?.tracks ?? FIRST
    const options = list.map((k) => ({ value: k.slug, label: short ? k.title : `${k.title} track` }))
    return fresh(options.map((o) => `${o.value}:${o.label}`).join('|'), Segmented({ label: 'Track', options, value, onPick }))
  }}`
}

/**
 * The title of a Track from its slug, as "<title> track" ("Daily track").
 * @param {Array<{ slug: string, title: string }> | undefined} list
 * @param {string} slug
 */
export const trackLabel = (list, slug) => `${(list ?? FIRST).find((k) => k.slug === slug)?.title ?? slug} track`
