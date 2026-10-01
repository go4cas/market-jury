// Line up value histories on one set of dates for a chart.

/**
 * @param {Array<{ name: string, kind: string, colourSlot: number | null, dotted?: boolean, values: Array<{ date: string, totalMicro: number }> }>} histories
 */
export function alignHistories(histories) {
  const dates = [...new Set(histories.flatMap((h) => h.values.map((v) => v.date)))].sort()
  const lines = histories.map((h) => {
    const byDate = new Map(h.values.map((v) => [v.date, v.totalMicro]))
    return { name: h.name, kind: h.kind, colourSlot: h.colourSlot, dotted: h.dotted, values: dates.map((d) => byDate.get(d) ?? null) }
  })
  return { dates, lines }
}
