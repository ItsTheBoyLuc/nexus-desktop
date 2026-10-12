import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, GAME_KEYS } from '../../shared/types'
import type { IpcResult, RacingGame, Role } from '../../shared/types'
import { MENTION_ALL_CHANNEL, ROLE_DELETED_MEANWHILE, ROLE_NOT_MENTIONABLE, createPingLimiter } from './pingMock'
import { createRacingMock } from './racingMock'

/**
 * The fake backend for the role pings (milestone 6, part 1): the same checks as docs/APP_API.md, a scenario for each error and for a
 * lost answer, and the cases the screens are reviewed with (60-member role, role that is not mentionable, approximate count).
 */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const CH = '777000000000000001'
const TIMEOUT_CH = '777000000000000007'
const LOCKED = '777000000000000008'
const HIDDEN = '777000000000000009'
const BIG = '800000000000000019'
const APPROX = '800000000000000021'
const BOT = '800000000000000006'
const DRIVERS = '800000000000000001'

const role = (id: string, name: string, over: Partial<Role> = {}): Role => ({ id, name, color: null, position: 1, managed: false, assignable: true, privileged: false, mentionable: true, memberCount: 5, memberCountApproximate: false, ...over })
const SERVER_ROLES: Role[] = [
  role(DRIVERS, 'Drivers'),
  role(BIG, 'Big Announcements Group', { memberCount: 60 }),
  role(ROLE_NOT_MENTIONABLE, 'Quiet Role (not mentionable)', { mentionable: false }),
  role(APPROX, 'Cache Still Filling', { memberCount: 14, memberCountApproximate: true }),
  role(BOT, 'Nexus', { managed: true, assignable: false }),
  role(ROLE_DELETED_MEANWHILE, 'Role Deleted Meanwhile')
]

function setup(scenario = 'normal') {
  const mock = createRacingMock({
    scenario,
    isAdmin: true,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id: string) => [APEX, MIDNIGHT].includes(id),
    channels: [{ id: CH, name: 'c1' }, { id: TIMEOUT_CH, name: 'timeout' }, { id: LOCKED, name: 'locked' }, { id: MENTION_ALL_CHANNEL, name: 'mention-everyone-ok' }],
    timeoutChannel: TIMEOUT_CH,
    lockedChannel: LOCKED,
    hiddenChannel: HIDDEN,
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSettings: () => undefined,
    liveMessages: new Set<string>(),
    newMessageId: (() => {
      let next = 900000000000000000n
      return () => String(next++)
    })(),
    apex: APEX,
    midnight: MIDNIGHT,
    serverRoles: () => SERVER_ROLES,
    mentionAllChannel: MENTION_ALL_CHANNEL
  })
  return mock
}

const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}
const code = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.code)
const kind = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.kind)
const attendance = { channelId: CH, name: 'Fake Practice', date: '2026-09-14' }
const announcement = { channelId: CH, title: 'Fake Round', message: 'Fake text' }

describe('the fake roles', () => {
  it('lists the server roles and the role of every team, with member counts', () => {
    const { roles } = setup()
    const list = roles(APEX)
    expect(list.find((item) => item.id === BIG)?.memberCount).toBe(60)
    expect(list.find((item) => item.id === ROLE_NOT_MENTIONABLE)?.mentionable).toBe(false)
    expect(list.find((item) => item.id === APPROX)?.memberCountApproximate).toBe(true)
    const mega = list.find((item) => item.name === 'Fake Mega Squad')
    expect(mega?.memberCount).toBe(55) // a team role above 50 members
    expect(list.every((item) => typeof item.mentionable === 'boolean' && (item.memberCount === null || item.memberCount >= 0))).toBe(true)
  })

  it('a team whose role was deleted is not a role of the server', () => {
    expect(setup().roles(APEX).some((item) => item.name === 'Fake Role Deleted Team')).toBe(false)
  })

  it.each(GAME_KEYS)('GET team-roles of %s lists only the teams of that game', async (game: RacingGame) => {
    const { api } = setup()
    const roles = ok(await api.racingTeamRoles(APEX, game))
    expect(roles.length).toBeGreaterThan(0)
    const teams = ok(await api.racingTeams(APEX, game)).filter((team) => team.roleExists).map((team) => team.roleId)
    expect(roles.map((item) => item.roleId).sort()).toEqual([...teams].sort())
    for (const other of GAME_KEYS.filter((key) => key !== game)) {
      const foreign = ok(await api.racingTeamRoles(APEX, other)).map((item) => item.roleId)
      expect(roles.some((item) => foreign.includes(item.roleId))).toBe(false)
    }
  })

  it('a server without teams has no team roles; an unknown game is 404 unknown_game', async () => {
    const { api } = setup()
    expect(ok(await api.racingTeamRoles(MIDNIGHT, 'gt7'))).toEqual([])
    expect(code(await api.racingTeamRoles(APEX, 'f2' as RacingGame))).toBe('unknown_game')
  })

  it('manyteamroles gives every game more than 3 team roles', async () => {
    const { api } = setup('manyteamroles')
    for (const game of GAME_KEYS) expect(ok(await api.racingTeamRoles(APEX, game)).length).toBeGreaterThan(3)
  })

  it('@everyone and @here are not in the fake list at all', () => {
    const names = setup().roles(APEX).map((item) => item.name)
    expect(names).not.toContain('@everyone')
    expect(names).not.toContain('@here')
    expect(setup().roles(APEX).some((item) => item.id === APEX)).toBe(false)
  })
})

describe.each(GAME_KEYS)('pinging posts of %s in the mock', (game: RacingGame) => {
  it('an announcement and an attendance post return pinged_roles with the names of the roles', async () => {
    const { api } = setup()
    const a = ok(await api.postRacingAnnouncement(APEX, game, { ...announcement, pingRoleIds: [DRIVERS, APPROX] }))
    expect(a.pingedRoles).toEqual([{ id: DRIVERS, name: 'Drivers' }, { id: APPROX, name: 'Cache Still Filling' }])
    const b = ok(await api.createRacingAttendance(APEX, game, { ...attendance, pingRoleIds: [BIG] }))
    expect(b.pingedRoles).toEqual([{ id: BIG, name: 'Big Announcements Group' }])
  })

  it('without roles nobody is pinged', async () => {
    const { api } = setup()
    expect(ok(await api.postRacingAnnouncement(APEX, game, announcement)).pingedRoles).toEqual([])
    expect(ok(await api.createRacingAttendance(APEX, game, attendance)).pingedRoles).toEqual([])
  })

  it('a team role of this game can be pinged', async () => {
    const { api } = setup()
    const [first] = ok(await api.racingTeamRoles(APEX, game))
    expect(ok(await api.postRacingAnnouncement(APEX, game, { ...announcement, pingRoleIds: [first!.roleId] })).pingedRoles).toEqual([{ id: first!.roleId, name: first!.name }])
  })

  it('a role that is not mentionable is refused with bot_cannot_mention_role, except where the bot may mention everyone', async () => {
    const { api } = setup()
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...announcement, pingRoleIds: [ROLE_NOT_MENTIONABLE] }))).toBe('bot_cannot_mention_role')
    expect(code(await api.createRacingAttendance(APEX, game, { ...attendance, pingRoleIds: [DRIVERS, ROLE_NOT_MENTIONABLE] }))).toBe('bot_cannot_mention_role')
    expect(ok(await api.postRacingAnnouncement(APEX, game, { ...announcement, channelId: MENTION_ALL_CHANNEL, pingRoleIds: [ROLE_NOT_MENTIONABLE] })).pingedRoles).toHaveLength(1)
  })

  it('a role that is listed but gone when the post arrives is 404 role_not_found', async () => {
    const { api } = setup()
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...announcement, pingRoleIds: [ROLE_DELETED_MEANWHILE] }))).toBe('role_not_found')
    expect(code(await api.createRacingAttendance(APEX, game, { ...attendance, pingRoleIds: ['899000000000000001'] }))).toBe('role_not_found')
  })

  it('@everyone (the server id) and a bot role are 403 role_not_pingable; mention text is 400 invalid_ping_roles; 4 roles is 400 too_many_ping_roles', async () => {
    const { api } = setup()
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...announcement, pingRoleIds: [APEX] }))).toBe('role_not_pingable')
    expect(code(await api.createRacingAttendance(APEX, game, { ...attendance, pingRoleIds: [BOT] }))).toBe('role_not_pingable')
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...announcement, pingRoleIds: ['@everyone'] }))).toBe('invalid_ping_roles')
    expect(code(await api.createRacingAttendance(APEX, game, { ...attendance, pingRoleIds: ['@here'] }))).toBe('invalid_ping_roles')
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...announcement, pingRoleIds: [DRIVERS, BIG, APPROX, ROLE_DELETED_MEANWHILE] }))).toBe('too_many_ping_roles')
  })

  it('a refused ping posts nothing: no attendance post appears', async () => {
    const { api } = setup()
    const before = ok(await api.racingAttendance(APEX, game)).total
    await api.createRacingAttendance(APEX, game, { ...attendance, pingRoleIds: [ROLE_NOT_MENTIONABLE] })
    expect(ok(await api.racingAttendance(APEX, game)).total).toBe(before)
  })

  it('the channel errors come first: a locked channel is bot_cannot_send even with a bad role', async () => {
    const { api } = setup()
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...announcement, channelId: LOCKED, pingRoleIds: [ROLE_NOT_MENTIONABLE] }))).toBe('bot_cannot_send')
    expect(code(await api.createRacingAttendance(APEX, game, { ...attendance, channelId: HIDDEN, pingRoleIds: [DRIVERS] }))).toBe('forbidden')
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...announcement, channelId: '777000000000000099', pingRoleIds: [DRIVERS] }))).toBe('channel_not_found')
  })

  it('the permission is checked before any role: manager_required reveals nothing about roles', async () => {
    const { api } = setup(`nomanager-${game}`)
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...announcement, pingRoleIds: ['@everyone'] }))).toBe('manager_required')
    expect(code(await api.createRacingAttendance(APEX, game, { ...attendance, pingRoleIds: [ROLE_DELETED_MEANWHILE] }))).toBe('manager_required')
  })

  it('the lost answer: the post IS made and the answer is lost (a timeout), for both posts', async () => {
    const { api } = setup('lostracing')
    const before = ok(await api.racingAttendance(APEX, game)).total
    const lost = await api.createRacingAttendance(APEX, game, { ...attendance, pingRoleIds: [DRIVERS] })
    expect(kind(lost)).toBe('timeout')
    expect(!lost.ok && lost.error.mayHaveBeenSent).toBe(true)
    expect(ok(await api.racingAttendance(APEX, game)).total).toBe(before + 1)
    expect(kind(await api.postRacingAnnouncement(APEX, game, { ...announcement, pingRoleIds: [DRIVERS] }))).toBe('timeout')
  })

  it('the lost answer also happens in the #timeout channel, and a title or name with "timeout"', async () => {
    const { api } = setup()
    expect(kind(await api.postRacingAnnouncement(APEX, game, { ...announcement, channelId: TIMEOUT_CH, pingRoleIds: [DRIVERS] }))).toBe('timeout')
    expect(kind(await api.createRacingAttendance(APEX, game, { ...attendance, name: 'Fake timeout', pingRoleIds: [DRIVERS] }))).toBe('timeout')
  })

  it('a server error (name or title with "fail") is 502 discord_error and posts nothing', async () => {
    const { api } = setup()
    const before = ok(await api.racingAttendance(APEX, game)).total
    const failed = await api.createRacingAttendance(APEX, game, { ...attendance, name: 'Fake fail', pingRoleIds: [DRIVERS] })
    expect(!failed.ok && failed.error.status).toBe(502)
    expect(ok(await api.racingAttendance(APEX, game)).total).toBe(before)
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...announcement, title: 'Fake fail' }))).toBe('discord_error')
  })
})

describe('the scenarios of each ping error', () => {
  it.each([
    ['invalidping', 'invalid_ping_roles'],
    ['toomanyping', 'too_many_ping_roles'],
    ['pingrefused', 'role_not_pingable'],
    ['pinglimit', 'rate_limited']
  ])('%s answers %s to every pinging post and leaves posts without roles alone', async (scenario, expected) => {
    const { api } = setup(scenario)
    expect(code(await api.postRacingAnnouncement(APEX, 'lmu', { ...announcement, pingRoleIds: [DRIVERS] }))).toBe(expected)
    expect(code(await api.createRacingAttendance(APEX, 'gt7', { ...attendance, pingRoleIds: [DRIVERS] }))).toBe(expected)
    expect(code(await api.postRacingAnnouncement(APEX, 'lmu', announcement))).toBe('ok')
  })

  it('the limit is a 429 of kind rate_limited with a Retry-After of 60 seconds', async () => {
    const { api } = setup('pinglimit')
    const result = await api.postRacingAnnouncement(APEX, 'acc', { ...announcement, pingRoleIds: [DRIVERS] })
    expect(!result.ok && result.error).toMatchObject({ kind: 'rate_limited', status: 429, retryAfter: 60 })
  })

  it('the real limit: the 6th pinging post within a minute is refused; posts without roles and refused posts do not count', async () => {
    const { api } = setup()
    for (let n = 0; n < 5; n++) ok(await api.postRacingAnnouncement(APEX, 'f1', { ...announcement, pingRoleIds: [DRIVERS] }))
    expect(code(await api.postRacingAnnouncement(APEX, 'f1', { ...announcement, pingRoleIds: [DRIVERS] }))).toBe('rate_limited')
    expect(code(await api.createRacingAttendance(APEX, 'lmu', { ...attendance, pingRoleIds: [DRIVERS] }))).toBe('rate_limited') // shared by both posts and all games
    expect(code(await api.postRacingAnnouncement(APEX, 'f1', announcement))).toBe('ok')
  })

  it('the limit is per server', async () => {
    const limiter = createPingLimiter()
    for (let n = 0; n < 5; n++) expect(limiter(APEX)).toBe(true)
    expect(limiter(APEX)).toBe(false)
    expect(limiter(MIDNIGHT)).toBe(true)
  })

  it('the limit opens again after a minute', () => {
    let now = 1_000_000
    const limiter = createPingLimiter(() => now)
    for (let n = 0; n < 5; n++) limiter(APEX)
    expect(limiter(APEX)).toBe(false)
    now += 60_001
    expect(limiter(APEX)).toBe(true)
  })

  it('a request refused for another reason does not use up the limit', async () => {
    const { api } = setup()
    for (let n = 0; n < 10; n++) await api.postRacingAnnouncement(APEX, 'f1', { ...announcement, pingRoleIds: [ROLE_NOT_MENTIONABLE] })
    expect(code(await api.postRacingAnnouncement(APEX, 'f1', { ...announcement, pingRoleIds: [DRIVERS] }))).toBe('ok')
  })
})
