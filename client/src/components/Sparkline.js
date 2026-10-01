import { svg } from '@arrow-js/core'

// A small trend line for one behaviour measure, in the Trader's colour.
/**
 * @param {{ values: number[], colour: string, label: string }} props
 */
export function Sparkline({ values, colour, label }) {
  const w = 120
  const h = 32
  if (values.length < 2) return svg`<svg width="${w}" height="${h}" role="img" aria-label="${label}"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="var(--color-chart-grid)" stroke-width="1"></line></svg>`
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(' ')
  return svg`<svg width="${w}" height="${h}" viewBox="${`0 0 ${w} ${h}`}" role="img" aria-label="${label}"><polyline points="${points}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline></svg>`
}
