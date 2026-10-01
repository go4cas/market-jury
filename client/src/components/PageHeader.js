import { html } from '@arrow-js/core'

// The top of a screen: a `prompt` eyebrow, the title and a plain-language intro.
/**
 * @param {{ eyebrow?: any, title: string, intro?: any }} props
 */
export function PageHeader({ eyebrow = '', title, intro = '' }) {
  return html`
    <header class="flex flex-col gap-1.5 border-b border-line pb-3">
      ${eyebrow ? html`<p class="prompt prompt-caret">${eyebrow}</p>` : ''}
      <h1 class="font-display text-4xl font-semibold tracking-tight text-fg">${title}</h1>
      ${intro ? html`<p class="max-w-prose text-[17px] leading-relaxed text-fg-soft">${intro}</p>` : ''}
    </header>
  `
}
