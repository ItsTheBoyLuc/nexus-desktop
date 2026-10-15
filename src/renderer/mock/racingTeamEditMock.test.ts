import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, GAME_KEYS } from '../../shared/types'
import type { IpcResult, RacingGame } from '../../shared/types'
import { createRacingMock } from './racingMock'

/**
 * Milestone 7: the fake backend of "Edit team" (what every edit screen is reviewed against in `npm run dev:mock`). It follows
 * docs/APP_API.md: only changed fields count, a rename renames the role and the team name of the results and keeps the order, and every
 * scenario of the list at the top of racingMock.ts answers as promised.
 */
const APEX = '555000000000000001'
const FIRST: Record<RacingGame, string> = { lmu: 'Fake Endurance Racing', iracing: 'Fake Mega Squad', gt7: 'Fake Gran Turismo Team', acc: 'Fake ACC Team One', f1: 'Fake F1 Esports A' }

function setup(scenario = 'normal') {
  const created = createRacingMock({
    scenario,
    isAdmin: true,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id: string) => id === APEX,
    channels: [{ id: '777000000000000001', name: 'c1' }],
    timeoutChannel: '777000000000000007',
    lockedChannel: '777000000000000008',
    hiddenChannel: '777000000000000009',
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSettings: () => undefined,
    liveMessages: new Set<string>(),
    newMessageId: () => '1',
    apex: APEX,
    midnight: '555000000000000004'
  })
  return created
}
const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}
const code = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.code)

describe.each(GAME_KEYS)('editing a team in %s', (game) => {
  it('a rename keeps the position, renames the role and every result of the team, and leaves the roster alone', async () => {
    const { api, roles } = setup()
    const before = ok(await api.racingTeams(APEX, game)).map((team) => team.name)
    const old = FIRST[game]
    const roster = ok(await api.racingTeam(APEX, game, old)).roster
    const resultsBefore = ok(await api.racingResults(APEX, game, { team: old, limit: 100 })).total
    expect(resultsBefore).toBeGreaterThan(0)

    const saved = ok(await api.editRacingTeam(APEX, game, { team: old, newName: 'Fake Renamed Team' }))
    expect(saved.roleUpdated).toBe(true)
    expect(saved.team.name).toBe('Fake Renamed Team')
    expect(saved.team.roster).toEqual(roster)

    const after = ok(await api.racingTeams(APEX, game)).map((team) => team.name)
    expect(after.filter((name) => name !== 'Fake Renamed Team')).toEqual(before.filter((name) => name !== old))
    expect(code(await api.racingTeam(APEX, game, old))).toBe('team_not_found')
    expect(ok(await api.racingResults(APEX, game, { team: 'Fake Renamed Team', limit: 100 })).total).toBe(resultsBefore)
    expect(code(await api.racingResults(APEX, game, { team: old }))).toBe('team_not_found')
    expect(ok(await api.racingTeamRoles(APEX, game)).some((role) => role.name === 'Fake Renamed Team')).toBe(true)
    expect(roles(APEX).some((role) => role.name === 'Fake Renamed Team')).toBe(true)
    expect(roles(APEX).some((role) => role.name === old)).toBe(false)
  })

  it('a class-only edit does not touch the role; null clears the class', async () => {
    const { api } = setup()
    const name = FIRST[game]
    const changed = ok(await api.editRacingTeam(APEX, game, { team: name, focus: 'Brand New Class' }))
    expect(changed).toMatchObject({ roleUpdated: false, team: { name, focus: 'Brand New Class' } })
    const cleared = ok(await api.editRacingTeam(APEX, game, { team: name, focus: null }))
    expect(cleared.team.focus).toBe('')
  })
})

describe('refusals of the edit', () => {
  it('nothing to change answers 400 no_changes (equal values, or no field)', async () => {
    const { api } = setup()
    const team = ok(await api.racingTeam(APEX, 'lmu', FIRST.lmu))
    expect(code(await api.editRacingTeam(APEX, 'lmu', { team: FIRST.lmu, newName: FIRST.lmu, focus: team.focus }))).toBe('no_changes')
    expect(code(await api.editRacingTeam(APEX, 'lmu', { team: FIRST.lmu }))).toBe('no_changes')
  })

  it('a name used by ANOTHER team (any capitals) is 409 team_exists; the capitals of the own name may change', async () => {
    const { api } = setup()
    expect(code(await api.editRacingTeam(APEX, 'lmu', { team: FIRST.lmu, newName: 'FAKE gt SQUAD' }))).toBe('team_exists')
    expect(ok(await api.editRacingTeam(APEX, 'lmu', { team: FIRST.lmu, newName: 'FAKE ENDURANCE RACING' })).team.name).toBe('FAKE ENDURANCE RACING')
  })

  it('an unknown team is 404 team_not_found; the games are kept apart (the same name in another game is another team)', async () => {
    const { api } = setup()
    expect(code(await api.editRacingTeam(APEX, 'lmu', { team: 'Fake Nobody', newName: 'X' }))).toBe('team_not_found')
    expect(code(await api.editRacingTeam(APEX, 'gt7', { team: FIRST.lmu, newName: 'X' }))).toBe('team_not_found')
    expect(ok(await api.racingTeam(APEX, 'lmu', FIRST.lmu)).name).toBe(FIRST.lmu)
  })

  it('an unknown game and an unknown server are refused like every other call', async () => {
    const { api } = setup()
    expect(code(await api.editRacingTeam(APEX, 'f2' as RacingGame, { team: 'A', newName: 'B' }))).toBe('unknown_game')
    expect(code(await api.editRacingTeam('555000000000000099', 'lmu', { team: 'A', newName: 'B' }))).toBe('guild_not_found')
  })

  it.each([
    ['nomanage', 'manage_server_required'],
    ['nostaff', 'forbidden'],
    ['editnochanges', 'no_changes'],
    ['editgone', 'team_not_found']
  ])('scenario %s answers %s and changes nothing', async (scenario, expected) => {
    const { api } = setup(scenario)
    expect(code(await api.editRacingTeam(APEX, 'lmu', { team: FIRST.lmu, newName: 'Fake Other Name' }))).toBe(expected)
    if (scenario !== 'nostaff') expect(ok(await api.racingTeams(APEX, 'lmu')).some((team) => team.name === FIRST.lmu)).toBe(true)
  })

  it.each([
    ['nomanageroles', 'bot_missing_manage_roles'],
    ['roleabove', 'role_not_assignable']
  ])('scenario %s refuses a RENAME with %s, changes nothing, and lets a class-only edit through (Discord is not touched)', async (scenario, expected) => {
    const { api } = setup(scenario)
    expect(code(await api.editRacingTeam(APEX, 'lmu', { team: FIRST.lmu, newName: 'Fake Other Name' }))).toBe(expected)
    expect(ok(await api.racingTeams(APEX, 'lmu')).some((team) => team.name === FIRST.lmu)).toBe(true)
    expect(ok(await api.editRacingTeam(APEX, 'lmu', { team: FIRST.lmu, focus: 'Still Works' })).team.focus).toBe('Still Works')
  })

  it('a rename of a team whose role is gone works and says role_updated false', async () => {
    const { api } = setup()
    const saved = ok(await api.editRacingTeam(APEX, 'iracing', { team: 'Fake Role Deleted Team', newName: 'Fake Role Deleted Renamed' }))
    expect(saved.roleUpdated).toBe(false)
  })
})

describe('the lost answer', () => {
  it('scenario lostracing applies the edit, then the answer is a timeout: a second send would find the old name gone', async () => {
    const { api } = setup('lostracing')
    const first = await api.editRacingTeam(APEX, 'lmu', { team: FIRST.lmu, newName: 'Fake Lost Rename' })
    expect(first).toMatchObject({ ok: false, error: { kind: 'timeout', mayHaveBeenSent: true } })
    expect(ok(await api.racingTeam(APEX, 'lmu', 'Fake Lost Rename')).name).toBe('Fake Lost Rename')
    expect(code(await api.editRacingTeam(APEX, 'lmu', { team: FIRST.lmu, newName: 'Fake Lost Rename' }))).toBe('team_not_found')
  })

  it('a new name with "timeout" is applied then lost; with "fail" it is a 502 and nothing changed', async () => {
    const { api } = setup()
    expect(await api.editRacingTeam(APEX, 'gt7', { team: FIRST.gt7, newName: 'Fake timeout team' })).toMatchObject({ ok: false, error: { kind: 'timeout' } })
    expect(ok(await api.racingTeam(APEX, 'gt7', 'Fake timeout team')).name).toBe('Fake timeout team')
    expect(await api.editRacingTeam(APEX, 'acc', { team: FIRST.acc, newName: 'Fake fail' })).toMatchObject({ ok: false, error: { code: 'discord_error', status: 502 } })
    expect(ok(await api.racingTeam(APEX, 'acc', FIRST.acc)).name).toBe(FIRST.acc)
  })
})
