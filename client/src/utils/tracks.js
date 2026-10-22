/**
 * @typedef {{ title: string, cadence: string, webSearch: string, briefingPack: string }} TrackConditions
 */

/**
 * How two Tracks' conditions differ, in a sentence per difference ("Weekly research
 * can also search the web; Weekly can't."), or '' when they play by the same ones.
 * @param {TrackConditions} x
 * @param {TrackConditions} y
 */
export const differences = (x, y) => {
  const out = []
  if (x.cadence !== y.cadence) {
    const [w, d] = x.cadence === 'weekly' ? [x, y] : [y, x]
    out.push(`${w.title} decides once a week; ${d.title} every trading day.`)
  }
  if ((x.webSearch === 'off') !== (y.webSearch === 'off')) {
    const [on, off] = x.webSearch === 'off' ? [y, x] : [x, y]
    out.push(`${on.title} can also search the web; ${off.title} can't.`)
  } else if (x.webSearch !== y.webSearch) {
    const [own, shared] = x.webSearch === 'native' ? [x, y] : [y, x]
    out.push(`${own.title} uses each model's own web search; ${shared.title} uses one shared search tool.`)
  }
  if (x.briefingPack !== y.briefingPack) {
    const [bare, full] = x.briefingPack === 'prices_only' ? [x, y] : [y, x]
    out.push(`${bare.title} gets prices only, no headlines; ${full.title} gets the full briefing pack.`)
  }
  return out.join(' ')
}
