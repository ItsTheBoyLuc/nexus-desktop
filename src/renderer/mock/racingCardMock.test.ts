import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, GAME_KEYS } from '../../shared/types'
import type { IpcResult, RacingGame, Role } from '../../shared/types'
import { MENTION_ALL_CHANNEL, ROLE_NOT_MENTIONABLE } from './pingMock'
import { createRacingMock } from './racingMock'

/**
 * The fake backend for the cards of teams, events and results (milestone 6, part 2): the order the real server uses (the whole post is
 * checked before anything is created), post and post_error on a create, the dedicated "Post to Discord", the lost answer, and the
 * scenarios the screens are reviewed with.
 */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const CH = '777000000000000001'
const TIMEOUT_CH = '777000000000000007'
const LOCKED = '777000000000000008'
const HIDDEN = '777000000000000009'
const DRIVERS = '800000000000000001'
const BIG = '800000000000000019'

const role = (id: string, name: string, over: Partial<Role> = {}): Role => ({ id, name, color: null, position: 1, managed: false, assignable: true, privileged: false, mentionable: true, memberCount: 5, memberCountApproximate: false, ...over })
const SERVER_ROLES: Role[] = [role(DRIVERS, 'Drivers'), role(BIG, 'Big Group', { memberCount: 60 }), role(ROLE_NOT_MENTIONABLE, 'Quiet', { mentionable: false })]

function setup(scenario = 'normal') {
  return createRacingMock({
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
}

const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}
const code = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.code)
const kind = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.kind)

const team = (name: string, extra: Record<string, unknown> = {}) => ({ name, color: '#1E41FF', focus: 'GT3', ...extra })
const event = (name: string, extra: Record<string, unknown> = {}) => ({ name, date: '2030-01-01', time: '20:00 UTC', class: 'GT3', ...extra })
const logged = (eventName: string, teamName: string, extra: Record<string, unknown> = {}) => ({ team: teamName, eventName, result: 'P3', drivers: 'alice', ...extra })

describe.each(GAME_KEYS)('cards in %s in the mock', (game: RacingGame) => {
  it('a team without a channel has no card; with a channel it is posted and the answer says who was pinged', async () => {
    const { api } = setup()
    expect('card' in ok(await api.createRacingTeam(APEX, game, team('Fake Plain Team')))).toBe(false)
    const created = ok(await api.createRacingTeam(APEX, game, team('Fake Card Team', { channelId: CH, pingRoleIds: [DRIVERS] })))
    expect(created.card).toMatchObject({ status: 'posted', post: { channelId: CH, pingedRoles: [{ id: DRIVERS, name: 'Drivers' }] } })
  })

  it('an event and a result get a card the same way', async () => {
    const { api } = setup()
    const added = ok(await api.addRacingEvent(APEX, game, event('Fake Card Event', { channelId: CH })))
    expect(added.card).toMatchObject({ status: 'posted' })
    const [first] = ok(await api.racingTeams(APEX, game))
    const entry = ok(await api.logRacingResult(APEX, game, logged('Fake Card Round', first!.name, { channelId: CH, pingRoleIds: [BIG] })))
    expect(entry.card).toMatchObject({ status: 'posted', post: { pingedRoles: [{ id: BIG, name: 'Big Group' }] } })
  })

  it('the whole post is checked first: a refusal creates nothing (no team, no role, no event, no entry)', async () => {
    const { api, roles } = setup()
    const teamsBefore = ok(await api.racingTeams(APEX, game)).length
    const rolesBefore = roles(APEX).length
    const eventsBefore = ok(await api.racingEvents(APEX, game, { limit: 100 })).total
    const [first] = ok(await api.racingTeams(APEX, game))
    const resultsBefore = ok(await api.racingResults(APEX, game)).total
    for (const extra of [{ channelId: LOCKED }, { channelId: HIDDEN }, { channelId: '777000000000000099' }, { channelId: CH, pingRoleIds: [ROLE_NOT_MENTIONABLE] }, { channelId: CH, pingRoleIds: ['@everyone'] }, { pingRoleIds: [DRIVERS] }]) {
      expect(ok(await api.racingTeams(APEX, game)).length).toBe(teamsBefore)
      expect(code(await api.createRacingTeam(APEX, game, team('Fake Refused Team', extra)))).not.toBe('ok')
      expect(code(await api.addRacingEvent(APEX, game, event('Fake Refused Event', extra)))).not.toBe('ok')
      expect(code(await api.logRacingResult(APEX, game, logged('Fake Refused Round', first!.name, extra)))).not.toBe('ok')
    }
    expect(ok(await api.racingTeams(APEX, game)).length).toBe(teamsBefore)
    expect(roles(APEX).length).toBe(rolesBefore)
    expect(ok(await api.racingEvents(APEX, game, { limit: 100 })).total).toBe(eventsBefore)
    expect(ok(await api.racingResults(APEX, game)).total).toBe(resultsBefore)
  })

  it('the refusals use the documented codes', async () => {
    const { api } = setup()
    expect(code(await api.createRacingTeam(APEX, game, team('Fake A', { channelId: LOCKED })))).toBe('bot_cannot_send')
    expect(code(await api.createRacingTeam(APEX, game, team('Fake B', { channelId: HIDDEN })))).toBe('forbidden')
    expect(code(await api.addRacingEvent(APEX, game, event('Fake C', { channelId: '777000000000000099' })))).toBe('channel_not_found')
    expect(code(await api.addRacingEvent(APEX, game, event('Fake D', { channelId: CH, pingRoleIds: [ROLE_NOT_MENTIONABLE] })))).toBe('bot_cannot_mention_role')
    expect(code(await api.createRacingTeam(APEX, game, team('Fake E', { pingRoleIds: [DRIVERS] })))).toBe('invalid_channel')
    expect(code(await api.addRacingEvent(APEX, game, event('Fake F', { channelId: CH, pingRoleIds: [APEX] })))).toBe('role_not_pingable')
  })

  it('post_error: the item IS saved and the card failed (scenario posterror, or "postfail" in the name)', async () => {
    const { api } = setup()
    const created = ok(await api.addRacingEvent(APEX, game, event('Fake postfail Event', { channelId: CH })))
    expect(created.card).toEqual({ status: 'failed', error: { code: 'discord_error', message: 'Discord rejected the message.' } })
    expect(ok(await api.racingEvents(APEX, game, { limit: 100 })).events.some((item) => item.id === created.id)).toBe(true)
    const timeoutCard = ok(await api.createRacingTeam(APEX, game, team('Fake postslow Team', { channelId: CH })))
    expect(timeoutCard.card).toMatchObject({ status: 'failed', error: { code: 'bot_timeout' } })
    expect(ok(await api.racingTeams(APEX, game)).some((item) => item.name === 'Fake postslow Team')).toBe(true)

    const scenario = setup('posterror')
    const teamCreated = ok(await scenario.api.createRacingTeam(APEX, game, team('Fake Scenario Team', { channelId: CH })))
    expect(teamCreated.card).toMatchObject({ status: 'failed' })
    expect(ok(await scenario.api.racingTeams(APEX, game)).some((item) => item.name === 'Fake Scenario Team')).toBe(true)
    expect('card' in ok(await scenario.api.createRacingTeam(APEX, game, team('Fake No Card Team')))).toBe(false) // without a channel the scenario has nothing to fail
  })

  it('the lost answer: the item AND the card are done, then the answer is lost (a timeout)', async () => {
    const { api } = setup('lostracing')
    const before = ok(await api.racingEvents(APEX, game, { limit: 100 })).total
    const lost = await api.addRacingEvent(APEX, game, event('Fake Lost Event', { channelId: CH }))
    expect(kind(lost)).toBe('timeout')
    expect(!lost.ok && lost.error.mayHaveBeenSent).toBe(true)
    expect(ok(await api.racingEvents(APEX, game, { limit: 100 })).total).toBe(before + 1)
    expect(kind(await api.createRacingTeam(APEX, game, team('Fake Lost Team', { channelId: CH })))).toBe('timeout')
    const [first] = ok(await api.racingTeams(APEX, game))
    expect(kind(await api.logRacingResult(APEX, game, logged('Fake Lost Round', first!.name, { channelId: CH })))).toBe('timeout')
  })

  it('the lost answer also happens in the #timeout channel', async () => {
    const { api } = setup()
    expect(kind(await api.addRacingEvent(APEX, game, event('Fake Slow Event', { channelId: TIMEOUT_CH })))).toBe('timeout')
  })

  describe('Post to Discord on an existing item', () => {
    it('posts the card of a team, an event and a result, changing no stored data', async () => {
      const { api } = setup()
      const [firstTeam] = ok(await api.racingTeams(APEX, game))
      const [firstEvent] = ok(await api.racingEvents(APEX, game, { limit: 1 })).events
      const [firstResult] = ok(await api.racingResults(APEX, game, { limit: 1 })).results
      const teamsBefore = JSON.stringify(ok(await api.racingTeams(APEX, game)))
      const eventsBefore = JSON.stringify(ok(await api.racingEvents(APEX, game, { limit: 100 })).events)
      const resultsBefore = ok(await api.racingResults(APEX, game)).total
      const a = ok(await api.postRacingTeam(APEX, game, { team: firstTeam!.name.toUpperCase(), channelId: CH, pingRoleIds: [DRIVERS] }))
      expect(a).toMatchObject({ channelId: CH, pingedRoles: [{ id: DRIVERS, name: 'Drivers' }] })
      expect(ok(await api.postRacingEvent(APEX, game, { id: firstEvent!.id, channelId: CH })).pingedRoles).toEqual([])
      expect(ok(await api.postRacingResult(APEX, game, { id: firstResult!.id, channelId: CH })).messageId).toMatch(/^\d+$/)
      expect(JSON.stringify(ok(await api.racingTeams(APEX, game)))).toBe(teamsBefore)
      expect(JSON.stringify(ok(await api.racingEvents(APEX, game, { limit: 100 })).events)).toBe(eventsBefore)
      expect(ok(await api.racingResults(APEX, game)).total).toBe(resultsBefore)
    })

    it('an item that is not there is 404, and an item of another game is not found', async () => {
      const { api } = setup()
      expect(code(await api.postRacingTeam(APEX, game, { team: 'Nobody', channelId: CH }))).toBe('team_not_found')
      expect(code(await api.postRacingEvent(APEX, game, { id: 'nope', channelId: CH }))).toBe('event_not_found')
      expect(code(await api.postRacingResult(APEX, game, { id: 'nope', channelId: CH }))).toBe('result_not_found')
      const other = GAME_KEYS.find((key) => key !== game)!
      const [foreign] = ok(await api.racingEvents(APEX, other, { limit: 1 })).events
      expect(code(await api.postRacingEvent(APEX, game, { id: foreign!.id, channelId: CH }))).toBe('event_not_found')
    })

    it('the channel and roles are checked like everywhere else', async () => {
      const { api } = setup()
      const [firstTeam] = ok(await api.racingTeams(APEX, game))
      expect(code(await api.postRacingTeam(APEX, game, { team: firstTeam!.name, channelId: LOCKED }))).toBe('bot_cannot_send')
      expect(code(await api.postRacingTeam(APEX, game, { team: firstTeam!.name, channelId: CH, pingRoleIds: [ROLE_NOT_MENTIONABLE] }))).toBe('bot_cannot_mention_role')
      expect(ok(await api.postRacingTeam(APEX, game, { team: firstTeam!.name, channelId: MENTION_ALL_CHANNEL, pingRoleIds: [ROLE_NOT_MENTIONABLE] })).pingedRoles).toHaveLength(1)
      expect(code(await api.postRacingTeam(APEX, game, { team: firstTeam!.name, channelId: CH, pingRoleIds: ['@here'] }))).toBe('invalid_ping_roles')
    })

    it('needs Manage Server: nomanage answers manage_server_required for all three', async () => {
      const { api } = setup('nomanage')
      expect(code(await api.postRacingTeam(APEX, game, { team: 'x', channelId: CH }))).toBe('manage_server_required')
      expect(code(await api.postRacingEvent(APEX, game, { id: 'x', channelId: CH }))).toBe('manage_server_required')
      expect(code(await api.postRacingResult(APEX, game, { id: 'x', channelId: CH }))).toBe('manage_server_required')
    })

    it('a server error ("fail" in the name) posts nothing; a lost answer happens in #timeout or in the lostracing scenario', async () => {
      const { api } = setup()
      await api.createRacingTeam(APEX, game, team('Fake fail Team'))
      expect(code(await api.postRacingTeam(APEX, game, { team: 'Fake fail Team', channelId: CH }))).toBe('discord_error')
      const firstTeam = ok(await api.racingTeams(APEX, game)).find((item) => !/fail|timeout/i.test(item.name))
      expect(kind(await api.postRacingTeam(APEX, game, { team: firstTeam!.name, channelId: TIMEOUT_CH }))).toBe('timeout')
      expect(kind(await setup('lostracing').api.postRacingTeam(APEX, game, { team: firstTeam!.name, channelId: CH }))).toBe('timeout')
    })

    it('pinging cards share the 5-per-minute limit with the posts', async () => {
      const { api } = setup()
      const [firstTeam] = ok(await api.racingTeams(APEX, game))
      for (let n = 0; n < 5; n++) ok(await api.postRacingTeam(APEX, game, { team: firstTeam!.name, channelId: CH, pingRoleIds: [DRIVERS] }))
      expect(code(await api.postRacingTeam(APEX, game, { team: firstTeam!.name, channelId: CH, pingRoleIds: [DRIVERS] }))).toBe('rate_limited')
      expect(code(await api.postRacingAnnouncement(APEX, game, { channelId: CH, title: 'Fake', message: 'Fake', pingRoleIds: [DRIVERS] }))).toBe('rate_limited')
      expect(ok(await api.postRacingTeam(APEX, game, { team: firstTeam!.name, channelId: CH })).pingedRoles).toEqual([]) // not pinging: not counted
    })
  })
})

describe('an unknown game is refused first', () => {
  it('404 unknown_game on the three dedicated posts', async () => {
    const { api } = setup()
    expect(code(await api.postRacingTeam(APEX, 'f2' as RacingGame, { team: 'x', channelId: CH }))).toBe('unknown_game')
    expect(code(await api.postRacingEvent(APEX, 'f2' as RacingGame, { id: 'x', channelId: CH }))).toBe('unknown_game')
    expect(code(await api.postRacingResult(APEX, 'f2' as RacingGame, { id: 'x', channelId: CH }))).toBe('unknown_game')
  })
})
