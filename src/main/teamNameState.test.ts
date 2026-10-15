import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types'
import { SettingsStore } from './settings'

/**
 * Milestone 7: a team can be renamed, so nothing the app keeps ON DISK may be keyed by an esports team's name (a rename would leave
 * the old name behind, wrong for ever). The settings file holds ids, league keys and a few switches, and these tests pin that list: a
 * later change that stores a team name has to change this file on purpose.
 */
let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexus-teamname-'))
  file = join(dir, 'settings.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const G = '555000000000000001'
const CH = '777000000000000001'
const MSG = '888000000000000001'

describe('the settings file and team names', () => {
  it('has a fixed set of fields, none of which is a team, a roster, a result or a post', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(['calendarPosts', 'lastGame', 'lastGuildId', 'ledger', 'panels', 'postChannels', 'reduceMotion'])
  })

  it('a team name written into the file by hand, under any key, is dropped when the file is read and when it is saved again', () => {
    const apex = 'Apex Racing'
    writeFileSync(
      file,
      JSON.stringify({
        lastGuildId: G,
        selectedTeam: apex,
        teams: { [apex]: { color: '#000000' } },
        results: [{ team: apex }],
        panels: { [`${G}:${apex}:t1`]: { messageId: MSG, channelId: CH } },
        postChannels: { [`${G}:${apex}`]: CH, [`${G}:lmu`]: CH },
        ledger: [{ guildId: G, season: '1', round: '1', circuit: apex, recordedAt: '2026-01-01T00:00:00Z', team: apex }]
      })
    )
    const store = new SettingsStore(file)
    const state = store.get()
    // Only what the validators accept stays: the keys with a team name are not valid panel / channel keys.
    expect(Object.keys(state).sort()).toEqual(['calendarPosts', 'lastGame', 'lastGuildId', 'ledger', 'panels', 'postChannels', 'reduceMotion'])
    expect(state.postChannels).toEqual({ [`${G}:lmu`]: CH })
    expect(state.panels).toEqual({})
    store.set({ reduceMotion: true })
    const saved = readFileSync(file, 'utf8')
    expect(saved).not.toContain('selectedTeam')
    expect(saved).not.toContain('"teams"')
    expect(saved).not.toContain('"results"')
    expect(saved).not.toContain('"team"')
    expect(Object.keys(JSON.parse(saved) as object).sort()).toEqual(['calendarPosts', 'lastGame', 'lastGuildId', 'ledger', 'panels', 'postChannels', 'reduceMotion'])
  })

  it('what the app remembers for esports is a channel id per server and game: renaming a team cannot change it', () => {
    const store = new SettingsStore(file)
    store.rememberPostChannel(G, 'lmu', CH)
    store.rememberPostChannel(G, 'Apex Racing', CH) // a team name is not a game: refused
    expect(store.get().postChannels).toEqual({ [`${G}:lmu`]: CH })
  })

  it('the panels and the ledger belong to the LEAGUE (a game and tier key, a season and a round), never to an esports team', () => {
    const store = new SettingsStore(file)
    store.rememberPanel(G, 'f1', 'tier-1', { messageId: MSG, channelId: CH })
    store.recordRace({ guildId: G, season: '1', round: '2', circuit: 'Fake Circuit', recordedAt: '2026-01-01T00:00:00Z' })
    const text = readFileSync(file, 'utf8')
    expect(text).not.toMatch(/team/i)
  })
})
