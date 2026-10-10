import { describe, expect, it } from 'vitest'
import type { RacingTeam, RosterEntry } from '../../shared/types'
import { racingKey, racingPrefix, racingScope } from './racingScope'
import { UiError } from './errors'
import { describeEventDate, describeRacingError, describeRoleError, EVENT_GETTERS, MANAGE_SERVER_RULE, matchesRosterFilter, matchesTeamFilter, roleSummary, ROSTER_FILTER_OPTIONS, ROSTER_GETTERS, rosterName, rosterSearchFields, TEAM_GETTERS } from './racingView'
import { matchesQuery, sortRows } from './tableView'

const err = (code: string, status = 403): UiError => new UiError({ kind: 'http', code, message: `backend: ${code}`, status })
const team = (over: Partial<RacingTeam> = {}): RacingTeam => ({ name: 'Fake Team', color: '#112233', focus: 'GT3', roleId: '910', roleName: 'Fake Team', roleExists: true, memberCount: 2, createdBy: '1', createdAt: '2026-01-01T00:00:00Z', ...over })
const entry = (over: Partial<RosterEntry> = {}): RosterEntry => ({ userId: '4100', username: 'fake_user_001', displayName: 'Fake Driver 001', currentName: 'Fake Driver 001', inServer: true, role: 'Race Driver', joinedAt: '2026-01-02T00:00:00Z', ...over })

describe('the words for the refusals of the esports endpoints', () => {
  it('manage_server_required explains the rule in plain words: reading works, creating and changing need Manage Server or Administrator', () => {
    const text = describeRacingError(err('manage_server_required'), 'LMU')
    expect(text).toBe(MANAGE_SERVER_RULE)
    expect(text).toMatch(/Manage Server.*Administrator/)
    expect(text).toMatch(/read everything/)
  })

  it('bot_missing_manage_roles names the permission and says nothing was created', () => {
    const text = describeRacingError(err('bot_missing_manage_roles'), 'iRacing')
    expect(text).toMatch(/Manage Roles/)
    expect(text).toMatch(/nothing was created or changed/)
  })

  it('a duplicate team name names the game and says the comparison ignores capitals', () => {
    expect(describeRacingError(err('team_exists', 409), 'Gran Turismo 7')).toMatch(/Gran Turismo 7 team with that name already exists.*ignoring capitals/)
  })

  it('the role problems of adding a member say what to fix in Discord and that nothing changed', () => {
    expect(describeRacingError(err('role_not_assignable'), 'LMU')).toMatch(/above Nexus's highest role.*Nothing was changed/)
    expect(describeRacingError(err('bot_cannot_assign_role'), 'LMU')).toMatch(/Nexus role has to be above/)
    expect(describeRacingError(err('team_role_not_found', 404), 'LMU')).toMatch(/cannot be repaired/)
  })

  it('member, roster, team and game errors', () => {
    expect(describeRacingError(err('member_not_found', 404), 'LMU')).toMatch(/could not find that member/)
    expect(describeRacingError(err('already_on_roster', 409), 'LMU')).toMatch(/already on this roster/)
    expect(describeRacingError(err('not_on_roster', 404), 'LMU')).toMatch(/not on this roster/)
    expect(describeRacingError(err('team_not_found', 404), 'LMU')).toMatch(/no longer exists/)
    expect(describeRacingError(err('driver_not_found', 404), 'ACC')).toMatch(/on no ACC team/)
    expect(describeRacingError(err('unknown_game', 404), 'ACC')).toBe('That game has no esports team module.')
  })

  it('anything else uses the generic wording', () => {
    expect(describeRacingError(err('forbidden'), 'LMU')).toMatch(/STAFF/)
  })

  it('says why a role could not be taken away after a removal', () => {
    expect(describeRoleError('bot_cannot_remove_role')).toMatch(/not allowed to remove/)
    expect(describeRoleError('bot_timeout')).toMatch(/did not answer/)
    expect(describeRoleError('new_code')).toMatch(/\(new_code\)/)
  })
})

describe('the teams table', () => {
  const rows = [team({ name: 'beta', focus: '', memberCount: 0 }), team({ name: 'Alpha', focus: 'Hypercar', memberCount: 5 }), team({ name: 'gamma', focus: 'GT3', memberCount: 2, roleExists: false, roleName: null })]
  const order = (key: keyof typeof TEAM_GETTERS, direction: 'asc' | 'desc'): string[] => sortRows(rows, { key, direction }, TEAM_GETTERS).map((row) => row.name)

  it('sorts by name, by class (a team without one last) and by members', () => {
    expect(order('name', 'asc')).toEqual(['Alpha', 'beta', 'gamma'])
    expect(order('focus', 'asc')).toEqual(['gamma', 'Alpha', 'beta'])
    expect(order('focus', 'desc')).toEqual(['Alpha', 'gamma', 'beta'])
    expect(order('members', 'desc')).toEqual(['Alpha', 'gamma', 'beta'])
  })

  it('filters teams with and without members, and a deleted Discord role', () => {
    const names = (filter: Parameters<typeof matchesTeamFilter>[1]): string[] => rows.filter((row) => matchesTeamFilter(row, filter)).map((row) => row.name)
    expect(names('all')).toHaveLength(3)
    expect(names('with')).toEqual(['Alpha', 'gamma'])
    expect(names('without')).toEqual(['beta'])
    expect(names('role-missing')).toEqual(['gamma'])
  })

  it('the class is free text: any text is searchable', () => {
    expect(matchesQuery([rows[1]!.name, rows[1]!.focus], 'hyper')).toBe(true)
  })
})

describe('the roster table', () => {
  const rows = [
    entry({ userId: '1', role: 'Reserve', currentName: 'Charlie', displayName: 'Charlie', joinedAt: '2026-03-01T00:00:00Z' }),
    entry({ userId: '2', role: 'Manager', currentName: 'alice', displayName: 'alice', joinedAt: '2026-01-01T00:00:00Z' }),
    entry({ userId: '3', role: 'Race Driver', currentName: null, inServer: false, displayName: 'Bob', joinedAt: 'unreadable' }),
    entry({ userId: '4', role: 'Captain', currentName: 'Dave', displayName: 'Dave', joinedAt: '2026-02-01T00:00:00Z' })
  ]
  const order = (key: keyof typeof ROSTER_GETTERS, direction: 'asc' | 'desc'): string[] => sortRows(rows, { key, direction }, ROSTER_GETTERS).map((row) => row.userId)

  it('shows the name now, or the name stored when they joined for someone who left', () => {
    expect(rosterName(rows[0]!)).toBe('Charlie')
    expect(rosterName(rows[2]!)).toBe('Bob')
    expect(rosterName(entry({ currentName: null, displayName: '', username: 'fake_user_009' }))).toBe('fake_user_009')
  })

  it('sorts by name, by role in dropdown order (a role the commands stored as other text last) and by joined date (unreadable last)', () => {
    expect(order('member', 'asc')).toEqual(['2', '3', '1', '4'])
    expect(order('role', 'asc')).toEqual(['3', '1', '2', '4'])
    expect(order('joined', 'asc')).toEqual(['2', '4', '1', '3'])
  })

  it('filters by each of the four roles, and by members who left the server', () => {
    const ids = (filter: Parameters<typeof matchesRosterFilter>[1]): string[] => rows.filter((row) => matchesRosterFilter(row, filter)).map((row) => row.userId)
    expect(ids('Manager')).toEqual(['2'])
    expect(ids('Race Driver')).toEqual(['3'])
    expect(ids('left')).toEqual(['3'])
    expect(ids('all')).toHaveLength(4)
    expect(ROSTER_FILTER_OPTIONS.map((option) => option.value)).toEqual(['all', 'Race Driver', 'Reserve', 'Coach', 'Manager', 'left'])
  })

  it('searches names, username and role', () => {
    expect(matchesQuery(rosterSearchFields(rows[2]!), 'bob')).toBe(true)
    expect(matchesQuery(rosterSearchFields(rows[1]!), 'manager')).toBe(true)
    expect(matchesQuery(rosterSearchFields(rows[0]!), 'fake_user')).toBe(true)
    expect(rosterSearchFields(rows[2]!)).not.toContain(null)
  })

  it('summarises the roles of a team', () => {
    expect(roleSummary([])).toBe('No members')
    expect(roleSummary(rows)).toBe('1 Race Driver, 1 Reserve, 1 Manager, 1 Other')
    expect(roleSummary([entry({ role: ' manager ' })])).toBe('1 Manager') // the leader check is case-insensitive
  })
})

describe('the data of one game is kept apart from another (game-state isolation)', () => {
  const G = '555000000000000001'
  const games = ['lmu', 'iracing', 'gt7', 'acc', 'f1'] as const

  it('every game has its own scope: switching game or server changes the React key, which rebuilds the screen and drops its state', () => {
    const scopes = new Set<string>()
    for (const guild of [G, '555000000000000002']) for (const game of games) scopes.add(racingScope(guild, game))
    expect(scopes.size).toBe(10)
    expect(racingScope(G, 'lmu')).toBe(racingScope(G, 'lmu')) // stable while nothing changes
    expect(racingScope(G, 'lmu')).not.toBe(racingScope(G, 'iracing'))
    expect(racingScope(G, 'f1')).not.toBe(racingScope('555000000000000002', 'f1'))
  })

  it('every data key carries the server and the game, so no two games can share a cache entry or a loading state', () => {
    const keys = games.map((game) => racingKey(G, game, 'teams'))
    expect(new Set(keys).size).toBe(5)
    for (const game of games) expect(racingKey(G, game, 'team', 'x').startsWith(racingPrefix(G, game))).toBe(true)
  })

  it('invalidating one game\'s prefix matches none of the other games\' keys', () => {
    for (const game of games) {
      for (const other of games.filter((item) => item !== game)) {
        expect(racingKey(G, other, 'teams').startsWith(racingPrefix(G, game)), `${game} vs ${other}`).toBe(false)
        expect(racingKey('555000000000000002', game, 'teams').startsWith(racingPrefix(G, game))).toBe(false)
      }
    }
  })

  it('the esports keys never collide with the league keys of milestone 2 to 4', () => {
    for (const league of ['f1-calendar:', 'f1-teams:', 'f1-standings:', 'f1-attendance:', 'league-signups:']) {
      expect(racingKey(G, 'f1', 'teams').startsWith(league)).toBe(false)
      expect(`${league}${G}`.startsWith(racingPrefix(G, 'f1'))).toBe(false)
    }
  })
})

describe('how an event date is shown', () => {
  const event = (date: string, dateIso: string | null) => ({ date, dateIso })

  it('a date written as the picker writes it is shown as it is', () => {
    expect(describeEventDate(event('2026-09-14', '2026-09-14'))).toEqual({ text: '2026-09-14', readAs: null, ambiguous: false, unreadable: false })
  })

  it('a date written another way says what the bot understood, and flags the ambiguous ones (03/04/2026 is March 4th)', () => {
    expect(describeEventDate(event('03/04/2026', '2026-03-04'))).toEqual({ text: '03/04/2026', readAs: 'Wednesday 4 March 2026', ambiguous: true, unreadable: false })
    expect(describeEventDate(event('14/09/2026', '2026-09-14'))).toMatchObject({ readAs: 'Monday 14 September 2026', ambiguous: false })
  })

  it('a date the bot cannot read is marked: it is kept forever and listed last', () => {
    expect(describeEventDate(event('next friday', null))).toEqual({ text: 'next friday', readAs: null, ambiguous: false, unreadable: true })
  })

  it('events keep the API order until a column is chosen; unreadable dates sort last in both directions', () => {
    const rows = [
      { id: 'a', name: 'B event', date: '2026-10-02', time: '20:00 UTC', class: '', notes: '', dateIso: '2026-10-02', createdBy: '', createdAt: '' },
      { id: 'b', name: 'A event', date: 'someday', time: '19:00 UTC', class: 'GT3', notes: '', dateIso: null, createdBy: '', createdAt: '' },
      { id: 'c', name: 'C event', date: '2026-10-01', time: '21:00 UTC', class: 'LMP2', notes: '', dateIso: '2026-10-01', createdBy: '', createdAt: '' }
    ]
    expect(sortRows(rows, null, EVENT_GETTERS).map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(sortRows(rows, { key: 'date', direction: 'asc' }, EVENT_GETTERS).map((row) => row.id)).toEqual(['c', 'a', 'b'])
    expect(sortRows(rows, { key: 'date', direction: 'desc' }, EVENT_GETTERS).map((row) => row.id)).toEqual(['a', 'c', 'b'])
    expect(sortRows(rows, { key: 'class', direction: 'asc' }, EVENT_GETTERS).map((row) => row.id)).toEqual(['b', 'c', 'a'])
  })
})
