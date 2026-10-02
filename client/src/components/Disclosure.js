import { html, reactive } from '@arrow-js/core'

const KEY = 'mj-settings-open'

/** @returns {Record<string, boolean>} */
function remembered() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {} } catch { return {} }
}

/**
 * Which sections are open, remembered per browser. Create one per page.
 * @param {Record<string, boolean>} defaults
 */
export function disclosures(defaults) {
  const open = reactive({ ...defaults, ...remembered() })
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ...open })) } catch {} }
  return {
    open,
    /** @param {string} id */
    toggle(id) { open[id] = !open[id]; save() },
    /** @param {string} id */
    show(id) { open[id] = true; save() },
    /** @param {boolean} value */
    all(value) { for (const id of Object.keys(open)) open[id] = value; save() },
  }
}

// A collapsible Settings section, built as the standard disclosure pattern: the
// heading holds a full-width button with aria-expanded; the panel is hidden when
// closed. The closed row still says what's inside in one muted line.
/**
 * @param {{ id: string, title: string, summary: () => any, state: ReturnType<typeof disclosures>, content: any }} props
 */
export function Disclosure({ id, title, summary, state, content }) {
  return html`<section id="${id}" class="scroll-mt-4 rounded-panel border border-line bg-surface-raised">
    <h2 class="m-0">
      <button type="button" class="mj-disclosure__btn" aria-expanded="${() => String(Boolean(state.open[id]))}" aria-controls="${`${id}-panel`}" @click="${() => state.toggle(id)}">
        <span class="font-display text-xl font-semibold leading-[26px] text-fg">${title}</span>
        <span class="col-start-1 font-mono text-[13px] font-normal leading-[18px] text-fg-soft">${summary}</span>
        <span class="mj-disclosure__chev" aria-hidden="true"></span>
      </button>
    </h2>
    <div id="${`${id}-panel`}" class="${() => (state.open[id] ? 'flex flex-col gap-3 border-t border-line px-4 pb-4 pt-3' : 'hidden')}">${content}</div>
  </section>`
}
