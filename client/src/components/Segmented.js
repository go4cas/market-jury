import { html } from '@arrow-js/core'

// A row of choices where one is picked, such as Daily track / Weekly track.
/**
 * @param {{ label: string, options: Array<{ value: string, label: string }>, value: () => string, onPick: (value: string) => void }} props
 */
export function Segmented({ label, options, value, onPick }) {
  return html`<div class="flex flex-wrap gap-2" role="group" aria-label="${label}">${options.map((o) => html`<button
      type="button"
      aria-pressed="${() => (value() === o.value ? 'true' : 'false')}"
      class="${() => `inline-flex min-h-11 items-center rounded-control border px-3.5 font-mono text-sm ${value() === o.value ? 'border-brand bg-brand text-on-brand' : 'border-line-strong text-fg hover:bg-surface-inset'}`}"
      @click="${() => onPick(o.value)}"
    >${o.label}</button>`.key(o.value))}</div>`
}
