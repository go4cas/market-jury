import { describe, expect, it } from 'vitest'
import { differences } from '../../src/utils/tracks.js'

const weekly = { title: 'Weekly', cadence: 'weekly', webSearch: 'off', briefingPack: 'full' }

describe('differences between two Tracks', () => {
  it('says nothing when both play by the same conditions', () => {
    expect(differences(weekly, { ...weekly, title: 'Weekly again' })).toBe('')
  })

  it('names the Track that can search the web, whichever side it is on', () => {
    const research = { ...weekly, title: 'Weekly research', webSearch: 'native' }
    expect(differences(research, weekly)).toBe("Weekly research can also search the web; Weekly can't.")
    expect(differences(weekly, research)).toBe("Weekly research can also search the web; Weekly can't.")
  })

  it('lists each difference in turn', () => {
    const daily = { title: 'Daily', cadence: 'daily', webSearch: 'shared', briefingPack: 'prices_only' }
    expect(differences(daily, { ...weekly, webSearch: 'native' })).toBe(
      "Weekly decides once a week; Daily every trading day. Weekly uses each model's own web search; Daily uses one shared search tool. Daily gets prices only, no headlines; Weekly gets the full briefing pack.",
    )
  })
})
