import { describe, expect, it } from 'vitest'
import { GAME_KEYS } from '../../shared/types'
import type { IpcResult, RacingGame } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { createRacingMock } from './racingMock'

/**
 * The fake esports backend is what every M5 screen is reviewed against in `npm run dev:mock`, so the cases it promises are
 * pinned here: each of the five games, no teams, a team without members, a roster of 50+, a member who left the server,
 * 403 manage_server_required, bot_missing_manage_roles, a duplicate team name, an ambiguous and an unparseable event date, a
 * lost answer on creating a team and unknown_game. Games must be kept apart. Everything must be obviously fake.
 */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const OTHER = '555000000000000002'
const CHANNELS = [{ id: '777000000000000001', name: 'c1' }]
const FAKE_FRESH = '200000000000000100' // "Fake Racer 01": a member of the search pool who is on no roster

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
    newMessageId: () => '1',
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
const newTeam = { name: 'Fake New Team', color: '#112233', focus: 'Whatever 1' }

describe('the five games', () => {
  it('every game has its own teams in Apex, and nothing in a server that has none', async () => {
    const api = setup()
    for (const game of GAME_KEYS) expect(ok(await api.racingTeams(APEX, game)).length, game).toBeGreaterThan(0)
    for (const game of GAME_KEYS) expect(ok(await api.racingTeams(OTHER, game)), game).toEqual([])
  })

  it('a team created in one game is never visible in another (the data of the games is kept apart)', async () => {
    const api = setup()
    ok(await api.createRacingTeam(APEX, 'gt7', newTeam))
    expect(ok(await api.racingTeams(APEX, 'gt7')).some((team) => team.name === 'Fake New Team')).toBe(true)
    for (const game of GAME_KEYS.filter((key) => key !== 'gt7')) expect(ok(await api.racingTeams(APEX, game)).some((team) => team.name === 'Fake New Team'), game).toBe(false)
    expect(code(await api.racingTeam(APEX, 'iracing', 'Fake New Team'))).toBe('team_not_found')
  })

  it('the same name can exist in two games; a roster entry and an event belong to one game only', async () => {
    const api = setup()
    ok(await api.createRacingTeam(APEX, 'acc', newTeam))
    ok(await api.createRacingTeam(APEX, 'f1', newTeam))
    ok(await api.addRosterMember(APEX, 'acc', { team: 'Fake New Team', userId: FAKE_FRESH, role: 'Race Driver' }))
    expect(ok(await api.racingTeam(APEX, 'f1', 'Fake New Team')).roster).toEqual([])
    ok(await api.addRacingEvent(APEX, 'acc', { name: 'Only ACC', date: '2099-01-01', time: '20:00 UTC' }))
    expect(ok(await api.racingEvents(APEX, 'f1')).events.some((event) => event.name === 'Only ACC')).toBe(false)
    expect(ok(await api.racingEvents(APEX, 'acc')).events.some((event) => event.name === 'Only ACC')).toBe(true)
  })

  it('an unknown game answers 404 unknown_game on every call', async () => {
    const api = setup()
    const game = 'f2' as RacingGame
    for (const result of [await api.racingTeams(APEX, game), await api.racingTeam(APEX, game, 'x'), await api.createRacingTeam(APEX, game, newTeam), await api.racingEvents(APEX, game), await api.racingDriver(APEX, game, FAKE_FRESH)]) {
      expect(code(result)).toBe('unknown_game')
    }
  })
})

describe('teams and rosters', () => {
  it('noracingteams: no team in any game of any server', async () => {
    const api = setup('noracingteams')
    for (const game of GAME_KEYS) for (const guild of [APEX, MIDNIGHT]) expect(ok(await api.racingTeams(guild, game))).toEqual([])
  })

  it('a team without members, and a team whose Discord role was deleted', async () => {
    const api = setup()
    const lmu = ok(await api.racingTeams(APEX, 'lmu'))
    expect(lmu.find((team) => team.name === 'Fake Empty Team')).toMatchObject({ memberCount: 0 })
    expect(ok(await api.racingTeam(APEX, 'lmu', 'Fake Empty Team')).roster).toEqual([])
    const iracing = ok(await api.racingTeams(APEX, 'iracing'))
    expect(iracing.find((team) => team.roleExists === false)).toMatchObject({ roleName: null })
  })

  it('a roster of 50+ with every role, and a member who left the server (no current name, still listed)', async () => {
    const api = setup()
    const mega = ok(await api.racingTeam(APEX, 'iracing', 'fake mega squad')) // case-insensitive
    expect(mega.roster.length).toBeGreaterThanOrEqual(50)
    expect(new Set(mega.roster.map((entry) => entry.role))).toEqual(new Set(['Manager', 'Coach', 'Reserve', 'Race Driver']))
    const left = mega.roster.find((entry) => !entry.inServer)
    expect(left).toMatchObject({ currentName: null })
    expect(left?.displayName).toMatch(/^Fake Driver \d+$/)
  })

  it('the free-text focus is kept as typed; the team list is sorted by name', async () => {
    const api = setup()
    const created = ok(await api.createRacingTeam(APEX, 'lmu', { name: 'Aaa Fake Team', color: '#123456', focus: 'Any text, 42!' }))
    expect(created).toMatchObject({ focus: 'Any text, 42!', roster: [], memberCount: 0, roleExists: true })
    expect(ok(await api.racingTeams(APEX, 'lmu'))[0]!.name).toBe('Aaa Fake Team')
  })

  it('a duplicate team name is refused in any capitalisation (409 team_exists) and creates nothing', async () => {
    const api = setup()
    const before = ok(await api.racingTeams(APEX, 'lmu')).length
    expect(code(await api.createRacingTeam(APEX, 'lmu', { ...newTeam, name: 'FAKE endurance RACING' }))).toBe('team_exists')
    expect(ok(await api.racingTeams(APEX, 'lmu')).length).toBe(before)
  })

  it('nomanageroles: bot_missing_manage_roles creates nothing and adds nobody', async () => {
    const api = setup('nomanageroles')
    const before = ok(await api.racingTeams(APEX, 'lmu')).length
    expect(code(await api.createRacingTeam(APEX, 'lmu', newTeam))).toBe('bot_missing_manage_roles')
    expect(code(await api.addRosterMember(APEX, 'lmu', { team: 'Fake Empty Team', userId: FAKE_FRESH, role: 'Reserve' }))).toBe('bot_missing_manage_roles')
    expect(ok(await api.racingTeams(APEX, 'lmu')).length).toBe(before)
    expect(ok(await api.racingTeam(APEX, 'lmu', 'Fake Empty Team')).roster).toEqual([])
  })

  it('nomanage: every write answers 403 manage_server_required, every read still works', async () => {
    const api = setup('nomanage')
    expect(code(await api.createRacingTeam(APEX, 'lmu', newTeam))).toBe('manage_server_required')
    expect(code(await api.addRosterMember(APEX, 'lmu', { team: 'Fake Empty Team', userId: FAKE_FRESH, role: 'Reserve' }))).toBe('manage_server_required')
    expect(code(await api.removeRosterMember(APEX, 'lmu', 'Fake GT Squad', '410000000000000005'))).toBe('manage_server_required')
    expect(code(await api.addRacingEvent(APEX, 'lmu', { name: 'E', date: '2099-01-01', time: '20:00 UTC' }))).toBe('manage_server_required')
    expect(code(await api.racingTeams(APEX, 'lmu'))).toBe('ok')
    expect(code(await api.racingEvents(APEX, 'lmu'))).toBe('ok')
  })

  it('nostaff: everything is forbidden', async () => {
    const api = setup('nostaff')
    expect(code(await api.racingTeams(APEX, 'lmu'))).toBe('forbidden')
    expect(code(await api.racingEvents(APEX, 'f1'))).toBe('forbidden')
  })

  it('adding to the roster: a member who is on it already (409), who is not in the server (404) or a team that is gone (404)', async () => {
    const api = setup()
    const added = ok(await api.addRosterMember(APEX, 'lmu', { team: 'Fake Empty Team', userId: FAKE_FRESH, role: 'Coach' }))
    expect(added).toMatchObject({ roleAssigned: true, entry: { role: 'Coach', inServer: true } })
    expect(code(await api.addRosterMember(APEX, 'lmu', { team: 'fake empty team', userId: FAKE_FRESH, role: 'Reserve' }))).toBe('already_on_roster')
    expect(code(await api.addRosterMember(APEX, 'lmu', { team: 'Fake Empty Team', userId: '99999999999999999999', role: 'Reserve' }))).toBe('member_not_found')
    expect(code(await api.addRosterMember(APEX, 'lmu', { team: 'No Such Team', userId: FAKE_FRESH, role: 'Reserve' }))).toBe('team_not_found')
    expect(code(await api.addRosterMember(APEX, 'iracing', { team: 'Fake Role Deleted Team', userId: FAKE_FRESH, role: 'Reserve' }))).toBe('team_role_not_found')
  })

  it('removing works for a member who left the server (no role to take away), and for one still in it; a second removal is 404', async () => {
    const api = setup()
    const mega = ok(await api.racingTeam(APEX, 'iracing', 'Fake Mega Squad'))
    const left = mega.roster.find((entry) => !entry.inServer)!
    const present = mega.roster.find((entry) => entry.inServer)!
    expect(ok(await api.removeRosterMember(APEX, 'iracing', 'Fake Mega Squad', left.userId))).toMatchObject({ roleRemoved: false, removed: { userId: left.userId } })
    expect(ok(await api.removeRosterMember(APEX, 'iracing', 'Fake Mega Squad', present.userId))).toMatchObject({ roleRemoved: true })
    expect(code(await api.removeRosterMember(APEX, 'iracing', 'Fake Mega Squad', present.userId))).toBe('not_on_roster')
    expect(ok(await api.racingTeam(APEX, 'iracing', 'Fake Mega Squad')).roster).toHaveLength(mega.roster.length - 2)
  })

  it('the driver profile lists the teams and roles of one game only; someone on no team and not in the server is 404', async () => {
    const api = setup()
    const first = ok(await api.racingTeam(APEX, 'lmu', 'Fake Endurance Racing')).roster[0]!
    const profile = ok(await api.racingDriver(APEX, 'lmu', first.userId))
    expect(profile.memberships).toEqual([expect.objectContaining({ team: 'Fake Endurance Racing', role: 'Manager' })])
    const iracingProfile = ok(await api.racingDriver(APEX, 'gt7', first.userId))
    expect(iracingProfile.memberships.every((membership) => membership.team !== 'Fake Endurance Racing')).toBe(true)
    expect(ok(await api.racingDriver(APEX, 'lmu', FAKE_FRESH)).memberships).toEqual([])
    expect(code(await api.racingDriver(APEX, 'lmu', '99999999999999999999'))).toBe('driver_not_found')
  })

  it('a lost answer on creating a team (lostracing, or a name with "timeout"): the team IS created, the answer is a timeout', async () => {
    for (const [scenario, name] of [['normal', 'Fake timeout Team'], ['lostracing', 'Fake Lost Team']] as const) {
      const api = setup(scenario)
      const before = ok(await api.racingTeams(APEX, 'lmu')).length
      expect(kind(await api.createRacingTeam(APEX, 'lmu', { ...newTeam, name })), scenario).toBe('timeout')
      expect(ok(await api.racingTeams(APEX, 'lmu')).length, scenario).toBe(before + 1)
    }
  })
})

describe('events', () => {
  it('lists upcoming events soonest first; the ambiguous 03/04/2027 is read as March 4th; an unreadable date comes last', async () => {
    const api = setup()
    const { events } = ok(await api.racingEvents(APEX, 'lmu'))
    const ambiguous = events.find((event) => event.date === '03/04/2027')!
    expect(ambiguous.dateIso).toBe('2027-03-04')
    const unreadable = events.find((event) => event.date === 'next friday')!
    expect(unreadable.dateIso).toBeNull()
    expect(events[events.length - 1]).toBe(events.find((event) => event.id === unreadable.id))
    const readable = events.filter((event) => event.dateIso !== null).map((event) => event.dateIso as string)
    expect([...readable].sort()).toEqual(readable)
  })

  it('past events are left out; a new event is stored with the date exactly as sent', async () => {
    const api = setup()
    ok(await api.addRacingEvent(APEX, 'gt7', { name: 'Past fake', date: '2001-01-01', time: '20:00 UTC' }))
    const created = ok(await api.addRacingEvent(APEX, 'gt7', { name: 'Future fake', date: '2099-05-05', time: '19:00 CET', class: 'Free text 1', notes: 'n' }))
    expect(created).toMatchObject({ date: '2099-05-05', time: '19:00 CET', class: 'Free text 1', dateIso: '2099-05-05' })
    const names = ok(await api.racingEvents(APEX, 'gt7')).events.map((event) => event.name)
    expect(names).toContain('Future fake')
    expect(names).not.toContain('Past fake')
  })

  it('iracing has 30+ upcoming events, served in pages', async () => {
    const api = setup()
    const first = ok(await api.racingEvents(APEX, 'iracing'))
    expect(first.total).toBeGreaterThan(30)
    expect(first.events).toHaveLength(25)
    expect(ok(await api.racingEvents(APEX, 'iracing', { offset: 25, limit: 100 })).events).toHaveLength(first.total - 25)
  })

  it('a lost answer on adding an event: it IS stored', async () => {
    const api = setup('lostracing')
    const before = ok(await api.racingEvents(APEX, 'acc')).total
    expect(kind(await api.addRacingEvent(APEX, 'acc', { name: 'Fake Lost Event', date: '2099-01-01', time: '20:00 UTC' }))).toBe('timeout')
    expect(ok(await api.racingEvents(APEX, 'acc')).total).toBe(before + 1)
  })
})

describe('the mock data is obviously fake', () => {
  it('no team, member or event name can pass for a real one', async () => {
    const api = setup()
    for (const game of GAME_KEYS) {
      for (const team of ok(await api.racingTeams(APEX, game))) {
        expect(team.name, game).toMatch(/^Fake /)
        for (const entry of ok(await api.racingTeam(APEX, game, team.name)).roster) {
          expect(entry.displayName).toMatch(/^Fake Driver \d+$/)
          expect(entry.username).toMatch(/^fake_user_\d+$/)
        }
      }
      for (const event of ok(await api.racingEvents(APEX, game)).events) expect(event.name).toMatch(/Fake/)
    }
  })
})
