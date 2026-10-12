import { describe, expect, it } from 'vitest'
import { GAME_KEYS } from '../shared/types'
import type { RacingGame } from '../shared/types'
import { createRacingApi } from './racingApi'
import { dropped, hang, json, realClient, setup } from './racingApiTestKit'

/**
 * Milestone 6, part 1: role pings on the attendance post and the announcement of every one of the five games, and the team-roles picker.
 * Paths, bodies and answers follow docs/APP_API.md only. The rules that matter most: without roles the request is exactly the one of
 * before M6, only numeric role ids ever leave the app (so @everyone and @here cannot), and a post is sent exactly once.
 */
const G = '555000000000000001'
const CH = '777000000000000001'
const MSG = '888000000000000001'
const R1 = '820000000000000001'
const R2 = '820000000000000002'
const R3 = '820000000000000003'
const R4 = '820000000000000004'
const BASE = `/api/app/v1/guilds/${G}/racing`

const announcement = { channelId: CH, title: 'Round 3!', message: 'Full text' }
const attendance = { channelId: CH, name: 'Tuesday Practice', date: '2026-09-14' }
const post = (name = 'Tuesday Practice') => ({ message_id: MSG, name, date: '2026-09-14', description: '', created_by: '1', created_at: '2026-01-01T00:00:00Z', counts: { available: 0, unavailable: 0 } })
const announcementAnswer = (game: string, pinged: unknown) => ({ ok: true, game, message_id: MSG, channel_id: CH, ...(pinged === undefined ? {} : { pinged_roles: pinged }) })
const attendanceAnswer = (game: string, pinged: unknown) => ({ game, post: post(), channel_id: CH, ...(pinged === undefined ? {} : { pinged_roles: pinged }) })

describe.each(GAME_KEYS)('role pings of %s', (game: RacingGame) => {
  it('an announcement without roles is exactly the request of before: no ping_role_ids', async () => {
    const { api, calls } = setup(announcementAnswer(game, []), announcementAnswer(game, []), announcementAnswer(game, []))
    await api.postRacingAnnouncement(G, game, announcement)
    await api.postRacingAnnouncement(G, game, { ...announcement, pingRoleIds: [] })
    await api.postRacingAnnouncement(G, game, { ...announcement, pingRoleIds: undefined })
    for (const call of calls) expect(Object.keys(call.body as object).sort()).toEqual(['channel_id', 'message', 'title'])
  })

  it('an announcement with roles sends them as ping_role_ids, once each, in the order given, and returns pinged_roles', async () => {
    const { api, calls } = setup(announcementAnswer(game, [{ id: R1, name: 'Drivers' }, { id: R2, name: 'Reserves' }]))
    const result = await api.postRacingAnnouncement(G, game, { ...announcement, pingRoleIds: [R1, R2, R1] })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/announcement`, body: { channel_id: CH, title: 'Round 3!', message: 'Full text', ping_role_ids: [R1, R2] } })
    expect(result).toEqual({ messageId: MSG, channelId: CH, pingedRoles: [{ id: R1, name: 'Drivers' }, { id: R2, name: 'Reserves' }] })
  })

  it('an attendance post without roles is exactly the request of before; with roles it sends ping_role_ids and returns pinged_roles', async () => {
    const { api, calls } = setup(attendanceAnswer(game, []), attendanceAnswer(game, [{ id: R3, name: 'Team Alpha' }]))
    const plain = await api.createRacingAttendance(G, game, attendance)
    const pinging = await api.createRacingAttendance(G, game, { ...attendance, pingRoleIds: [R3] })
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['channel_id', 'date', 'name'])
    expect(calls[1]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/attendance`, body: { channel_id: CH, name: 'Tuesday Practice', date: '2026-09-14', ping_role_ids: [R3] } })
    expect(plain.pingedRoles).toEqual([])
    expect(pinging.pingedRoles).toEqual([{ id: R3, name: 'Team Alpha' }])
    expect(pinging.channelId).toBe(CH)
  })

  it('channel_id stays required on both: an empty or invalid channel is refused before any request, with or without roles', async () => {
    const { api, request } = setup()
    for (const channelId of ['', 'general', '@everyone']) {
      await expect(api.createRacingAttendance(G, game, { ...attendance, channelId, pingRoleIds: [R1] })).rejects.toMatchObject({ code: 'invalid_channel' })
      await expect(api.postRacingAnnouncement(G, game, { ...announcement, channelId, pingRoleIds: [R1] })).rejects.toMatchObject({ code: 'invalid_channel' })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('a missing pinged_roles in the answer is read as nobody (the screens then say the server did not confirm)', async () => {
    const { api } = setup(announcementAnswer(game, undefined), attendanceAnswer(game, undefined))
    expect((await api.postRacingAnnouncement(G, game, { ...announcement, pingRoleIds: [R1] })).pingedRoles).toEqual([])
    expect((await api.createRacingAttendance(G, game, { ...attendance, pingRoleIds: [R1] })).pingedRoles).toEqual([])
  })

  it('malformed pinged_roles rows are dropped instead of failing a post that already happened', async () => {
    const { api } = setup(announcementAnswer(game, [{ id: R1, name: 'Ok' }, { id: 'everyone', name: 'x' }, 'text', null, { name: 'no id' }]))
    expect((await api.postRacingAnnouncement(G, game, { ...announcement, pingRoleIds: [R1] })).pingedRoles).toEqual([{ id: R1, name: 'Ok' }])
  })

  it('GET team-roles uses the game in the path and returns the roles of the teams', async () => {
    const { api, calls } = setup({ game, roles: [{ role_id: R1, name: 'Apex Racing', team: 'Apex Racing', mentionable: true }, { role_id: R2, name: 'Quiet', team: 'Quiet Team', mentionable: false }] })
    const roles = await api.racingTeamRoles(G, game)
    expect(calls[0]).toMatchObject({ path: `${BASE}/${game}/team-roles` })
    expect(calls[0]?.method).toBeUndefined() // GET
    expect(roles).toEqual([
      { roleId: R1, name: 'Apex Racing', team: 'Apex Racing', mentionable: true },
      { roleId: R2, name: 'Quiet', team: 'Quiet Team', mentionable: false }
    ])
  })

  it('a team-roles answer that is not what the docs describe is rejected', async () => {
    await expect(setup({ game }).api.racingTeamRoles(G, game)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ roles: [{ role_id: 'x', name: 'bad' }] }).api.racingTeamRoles(G, game)).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('@everyone and @here never leave the app', () => {
  const bad: Array<[string, unknown]> = [
    ['@everyone', '@everyone'],
    ['@here', '@here'],
    ['everyone', 'everyone'],
    ['a role mention', '<@&820000000000000001>'],
    ['a mention with text', '820000000000000001 @everyone'],
    ['a number', 82000000000],
    ['an empty string', ''],
    ['null', null],
    ['an object', {}]
  ]
  it.each(bad)('%s is refused with invalid_ping_roles before any request (attendance and announcement)', async (_label, value) => {
    const { api, request } = setup()
    await expect(api.postRacingAnnouncement(G, 'lmu', { ...announcement, pingRoleIds: [value as string] })).rejects.toMatchObject({ kind: 'validation', code: 'invalid_ping_roles', mayHaveBeenSent: false })
    await expect(api.createRacingAttendance(G, 'lmu', { ...attendance, pingRoleIds: [R1, value as string] })).rejects.toMatchObject({ kind: 'validation', code: 'invalid_ping_roles', mayHaveBeenSent: false })
    expect(request).not.toHaveBeenCalled()
  })

  it('the server\'s own id is the @everyone role: refused with role_not_pingable before any request', async () => {
    const { api, request } = setup()
    await expect(api.postRacingAnnouncement(G, 'gt7', { ...announcement, pingRoleIds: [G] })).rejects.toMatchObject({ code: 'role_not_pingable' })
    await expect(api.createRacingAttendance(G, 'gt7', { ...attendance, pingRoleIds: [R1, G] })).rejects.toMatchObject({ code: 'role_not_pingable' })
    expect(request).not.toHaveBeenCalled()
  })

  it('more than 3 distinct roles is refused with too_many_ping_roles; duplicates count once', async () => {
    const { api, request, calls } = setup(announcementAnswer('acc', []))
    await expect(api.postRacingAnnouncement(G, 'acc', { ...announcement, pingRoleIds: [R1, R2, R3, R4] })).rejects.toMatchObject({ code: 'too_many_ping_roles' })
    await expect(api.createRacingAttendance(G, 'acc', { ...attendance, pingRoleIds: [R1, R2, R3, R4] })).rejects.toMatchObject({ code: 'too_many_ping_roles' })
    expect(request).not.toHaveBeenCalled()
    await api.postRacingAnnouncement(G, 'acc', { ...announcement, pingRoleIds: [R1, R2, R3, R1, R2] })
    expect((calls[0]?.body as { ping_role_ids: string[] }).ping_role_ids).toEqual([R1, R2, R3])
  })

  it('the request body never contains a mention in any field the app builds from roles', async () => {
    const { api, calls } = setup(announcementAnswer('f1', [{ id: R1, name: '@everyone' }]))
    await api.postRacingAnnouncement(G, 'f1', { ...announcement, pingRoleIds: [R1] })
    expect((calls[0]?.body as { ping_role_ids: string[] }).ping_role_ids.every((id) => /^\d+$/.test(id))).toBe(true)
  })
})

describe.each(GAME_KEYS)('a pinging post in %s is sent exactly once', (game: RacingGame) => {
  const posts: Array<[string, (api: ReturnType<typeof createRacingApi>) => Promise<unknown>]> = [
    ['announcement', (api) => api.postRacingAnnouncement(G, game, { ...announcement, pingRoleIds: [R1] })],
    ['attendance post', (api) => api.createRacingAttendance(G, game, { ...attendance, pingRoleIds: [R1] })]
  ]

  describe.each(posts)('%s', (_name, run) => {
    it('a timeout is reported once and never repeated: it may already have pinged people', async () => {
      const { api, calls } = realClient(hang)
      await expect(run(api)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
      expect(calls()).toBe(1)
    })

    it('a dropped connection is not repeated', async () => {
      const { api, calls } = realClient(dropped)
      await expect(run(api)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
      expect(calls()).toBe(1)
    })

    it.each([[504, 'bot_timeout'], [502, 'discord_error'], [500, 'internal_error']] as const)('%i %s is reported as it is, once', async (status, code) => {
      const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
      await expect(run(api)).rejects.toMatchObject({ kind: 'http', code, status })
      expect(calls()).toBe(1)
    })

    it.each([
      [400, 'invalid_ping_roles'],
      [400, 'too_many_ping_roles'],
      [404, 'role_not_found'],
      [403, 'role_not_pingable'],
      [403, 'bot_cannot_mention_role'],
      [403, 'manager_required'],
      [403, 'bot_cannot_send'],
      [403, 'forbidden'],
      [404, 'channel_not_found'],
      [400, 'invalid_channel']
    ])('%i %s comes through with its code, once', async (status, code) => {
      const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
      await expect(run(api)).rejects.toMatchObject({ kind: 'http', code, status })
      expect(calls()).toBe(1)
    })

    it('429 (the ping limit) is reported with its Retry-After and is not repeated after the wait', async () => {
      const { api, calls } = realClient(async () => new Response(JSON.stringify({ error: 'rate_limited', message: 'slow down' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } }))
      await expect(run(api)).rejects.toMatchObject({ kind: 'rate_limited', code: 'rate_limited', status: 429, retryAfter: 60 })
      expect(calls()).toBe(1)
    })

    it('a success whose answer is not what the docs describe is reported as a doubtful outcome, once', async () => {
      const { api, calls } = realClient(async () => json(201, { nope: true }))
      await expect(run(api)).rejects.toMatchObject({ kind: 'invalid_response' })
      expect(calls()).toBe(1)
    })
  })
})

describe('the game is checked first for the new calls too', () => {
  it.each(['', 'f2', 'F1', '../iracing', 'gt7 '])('"%s" is refused with unknown_game and nothing is sent', async (game) => {
    const { api, request } = setup()
    await expect(api.racingTeamRoles(G, game as RacingGame)).rejects.toMatchObject({ kind: 'validation', code: 'unknown_game' })
    await expect(api.postRacingAnnouncement(G, game as RacingGame, { ...announcement, pingRoleIds: [R1] })).rejects.toMatchObject({ code: 'unknown_game' })
    await expect(api.createRacingAttendance(G, game as RacingGame, { ...attendance, pingRoleIds: [R1] })).rejects.toMatchObject({ code: 'unknown_game' })
    expect(request).not.toHaveBeenCalled()
  })
})
