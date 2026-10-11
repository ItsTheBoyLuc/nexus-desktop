import { describe, expect, it } from 'vitest'
import { GAME_KEYS } from '../../shared/types'
import type { IpcResult, RacingGame } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { createRacingMock } from './racingMock'

/**
 * The fake backend for the results archive, attendance posts and announcements (milestone 5, part 2): each of the five games has
 * its own data, the cases the screens are reviewed with exist (empty, 50+ entries, 20+ drivers, 403, lost answers, unknown_game),
 * the archive can only grow, and everything is obviously fake.
 */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const OTHER = '555000000000000002'
const CHANNELS = [
  { id: '777000000000000001', name: 'c1' },
  { id: '777000000000000007', name: 'timeout' }
]

function setup(scenario = 'normal') {
  return createRacingMock({
    scenario,
    isAdmin: true,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id: string) => [APEX, MIDNIGHT, OTHER].includes(id),
    channels: CHANNELS,
    timeoutChannel: '777000000000000007',
    lockedChannel: '777000000000000008',
    hiddenChannel: '777000000000000009',
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSettings: () => undefined,
    liveMessages: new Set<string>(),
    newMessageId: (() => {
      let next = 900000000000000000n
      return () => String(next++)
    })(),
    apex: APEX,
    midnight: MIDNIGHT
  }).api
}

const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}
const code = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.code)
const kind = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.kind)
const entry = { eventName: 'Fake Logged Round', result: 'P1 in Fake', drivers: 'Fake Driver 001', notes: 'fake' }

describe.each(GAME_KEYS)('results archive of %s in the mock', (game: RacingGame) => {
  it('has a big archive (50+ entries) in Apex, oldest first, and none in a server without teams', async () => {
    const api = setup()
    const page = ok(await api.racingResults(APEX, game, { limit: 100 }))
    expect(page.total).toBeGreaterThanOrEqual(50)
    expect(page.results.length).toBe(Math.min(100, page.total))
    expect(page.results.map((item) => Date.parse(item.loggedAt))).toEqual([...page.results.map((item) => Date.parse(item.loggedAt))].sort((a, b) => a - b))
    expect(ok(await api.racingResults(OTHER, game)).total).toBe(0)
  })

  it('pages exactly as asked: limit and offset, no entry twice', async () => {
    const api = setup()
    const first = ok(await api.racingResults(APEX, game, { limit: 20, offset: 0 }))
    const second = ok(await api.racingResults(APEX, game, { limit: 20, offset: 20 }))
    expect(first.results).toHaveLength(20)
    expect(second.offset).toBe(20)
    expect(new Set([...first.results, ...second.results].map((item) => item.id)).size).toBe(40)
  })

  it('the team stats only hold that team, with any capitalisation; an unknown team is team_not_found', async () => {
    const api = setup()
    const team = ok(await api.racingTeams(APEX, game)).find((item) => item.memberCount > 0)!.name
    const page = ok(await api.racingResults(APEX, game, { team: team.toUpperCase(), limit: 100 }))
    expect(page.team).toBe(team)
    expect(page.results.length).toBeGreaterThan(0)
    expect(page.results.every((item) => item.teamName === team)).toBe(true)
    expect(code(await api.racingResults(APEX, game, { team: 'Fake Nobody' }))).toBe('team_not_found')
  })

  it('logging appends one entry at the end and refetching shows it; logging the same result twice makes two', async () => {
    const api = setup()
    const team = ok(await api.racingTeams(APEX, game)).find((item) => item.memberCount > 0)!.name
    const before = ok(await api.racingResults(APEX, game, { limit: 1 })).total
    ok(await api.logRacingResult(APEX, game, { team, ...entry }))
    ok(await api.logRacingResult(APEX, game, { team, ...entry }))
    const after = ok(await api.racingResults(APEX, game, { team, limit: 100, offset: 0 }))
    expect(ok(await api.racingResults(APEX, game, { limit: 1 })).total).toBe(before + 2)
    expect(after.results.filter((item) => item.eventName === 'Fake Logged Round')).toHaveLength(2)
    expect(new Set(after.results.map((item) => item.id)).size).toBe(after.results.length)
  })

  it('an entry logged in this game is never visible in another game', async () => {
    const api = setup()
    const team = ok(await api.racingTeams(APEX, game)).find((item) => item.memberCount > 0)!.name
    ok(await api.logRacingResult(APEX, game, { team, ...entry, eventName: 'Fake Only Here' }))
    for (const other of GAME_KEYS.filter((key) => key !== game)) {
      const page = ok(await api.racingResults(APEX, other, { limit: 100 }))
      expect(page.results.some((item) => item.eventName === 'Fake Only Here'), other).toBe(false)
    }
  })

  it('403 manage_server_required for logging in the nomanage scenario, while reading still works', async () => {
    const api = setup('nomanage')
    const team = ok(await api.racingTeams(APEX, game)).find((item) => item.memberCount > 0)!.name
    expect(code(await api.logRacingResult(APEX, game, { team, ...entry }))).toBe('manage_server_required')
    expect(ok(await api.racingResults(APEX, game)).total).toBeGreaterThan(0)
  })

  it('a lost answer: the entry IS stored, the answer is a timeout (lostracing, or "timeout" in the event name)', async () => {
    for (const [scenario, eventName] of [['lostracing', 'Fake Round'], ['normal', 'Fake timeout Round']] as const) {
      const api = setup(scenario)
      const team = ok(await api.racingTeams(APEX, game)).find((item) => item.memberCount > 0)!.name
      const before = ok(await api.racingResults(APEX, game, { limit: 1 })).total
      const result = await api.logRacingResult(APEX, game, { team, ...entry, eventName })
      expect(kind(result), scenario).toBe('timeout')
      expect(ok(await api.racingResults(APEX, game, { limit: 1 })).total, scenario).toBe(before + 1)
    }
  })

  it('an empty archive in the noresults scenario', async () => {
    const api = setup('noresults')
    const page = ok(await api.racingResults(APEX, game))
    expect(page).toMatchObject({ total: 0, results: [] })
  })

  it('logging for a team that does not exist is team_not_found', async () => {
    expect(code(await setup().logRacingResult(APEX, game, { team: 'Fake Nobody', ...entry }))).toBe('team_not_found')
  })
})

describe('the results of the mock are fake, and text is data', () => {
  it('has no real-looking names and keeps html-looking text as text for the screens to show as plain text', async () => {
    const api = setup()
    const page = ok(await api.racingResults(APEX, 'lmu', { limit: 100 }))
    const text = JSON.stringify(page)
    expect(text).toMatch(/Fake/)
    expect(page.results.some((item) => /<script>/.test(item.eventName))).toBe(true)
    for (const item of page.results) expect(item.drivers).toMatch(/Fake/)
  })

  it('an unknown game is unknown_game for every results call', async () => {
    const api = setup()
    expect(code(await api.racingResults(APEX, 'f2' as RacingGame))).toBe('unknown_game')
    expect(code(await api.logRacingResult(APEX, 'f2' as RacingGame, { team: 'T', ...entry }))).toBe('unknown_game')
  })
})
