import { html } from '@arrow-js/core'
import { useFetch } from '../composables/useFetch.js'
import { fresh } from './Loadable.js'
import { Segmented } from './Segmented.js'
import { navigate } from '../utils/nav.js'

/** Shown until the list arrives: the two Tracks every experiment starts with. */
const FIRST = [{ slug: 'daily', title: 'Daily', webSearch: 'off' }, { slug: 'weekly', title: 'Weekly', webSearch: 'off' }]

/**
 * Pick a Track: one button per Track that has started, named by its title
 * ("Daily track", or just "Daily" when short). When the picked Track can search
 * the web, a line under it says its Traders don't all see the same news, so the
 * "same money, same news" tagline stays honest.
 * @param {{ value: () => string, onPick: (slug: string) => void, short?: boolean }} props
 */
export function TrackPicker({ value, onPick, short = false }) {
  const request = useFetch('/api/tracks')
  /** @returns {Array<{ slug: string, title: string, webSearch?: string }>} */
  const list = () => request.data()?.tracks ?? FIRST
  const searches = () => (list().find((k) => k.slug === value())?.webSearch ?? 'off') !== 'off'
  return html`<div class="flex flex-col gap-2">${() => {
    const options = list().map((k) => ({ value: k.slug, label: short ? k.title : `${k.title} track` }))
    return fresh(options.map((o) => `${o.value}:${o.label}`).join('|'), Segmented({ label: 'Track', options, value, onPick }))
  }}<p class="${() => (searches() ? 'text-[13px] text-fg-soft' : 'hidden')}" data-testid="track-search-note">These Traders can also <a href="/about" class="underline underline-offset-4 hover:text-fg" @click="${navigate('/about')}">search the web</a>, so they don't all see the same news.</p></div>`
}

/**
 * The title of a Track from its slug, as "<title> track" ("Daily track").
 * @param {Array<{ slug: string, title: string }> | undefined} list
 * @param {string} slug
 */
export const trackLabel = (list, slug) => `${(list ?? FIRST).find((k) => k.slug === slug)?.title ?? slug} track`
