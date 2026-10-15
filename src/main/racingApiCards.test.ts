import { describe, expect, it } from 'vitest'
import { GAME_KEYS } from '../shared/types'
import type { RacingGame } from '../shared/types'
import { createRacingApi } from './racingApi'
import { dropped, hang, json, realClient, setup } from './racingApiTestKit'

/**
 * Milestone 6, part 2: the card of a team, event or result, in every one of the five games. Paths, bodies and answers follow
 * docs/APP_API.md only. Without a channel a create is exactly the request of before; with one it carries channel_id (and ping_role_ids) and
 * the answer says `post` or `post_error`; "Post to Discord" on an existing item uses the dedicated endpoint; nothing is ever sent twice.
 */
const G = '555000000000000001'
const CH = '777000000000000001'
const MSG = '888000000000000001'
const R1 = '820000000000000001'
const R2 = '820000000000000002'
const R3 = '820000000000000003'
const R4 = '820000000000000004'
const BASE = `/api/app/v1/guilds/${G}/racing`

const teamBody = { roster: [], name: 'Apex Racing', color: '#1E41FF', focus: 'GT3', role_id: '910000000000000001', role_name: 'Apex Racing', role_exists: true, member_count: 0, created_by: '1', created_at: '2026-01-01T00:00:00Z' }
const eventBody = { id: 'a1b2c3d4e5f6', name: 'Daytona 24', date: '2026-09-14', time: '20:00 UTC', class: 'GT3', notes: '', date_iso: '2026-09-14', created_by: '1', created_at: '2026-01-01T00:00:00Z' }
const resultBody = { id: 'b1c2d3e4f5a6', event_name: 'Daytona 24', team_name: 'Apex Racing', result: 'P3', drivers: 'alice, bob', notes: '', logged_by: '1', logged_at: '2026-01-01T00:00:00Z' }
const posted = { channel_id: CH, message_id: MSG, pinged_roles: [{ id: R1, name: 'Drivers' }] }
const failed = { error: 'discord_error', message: 'Discord rejected the message.' }

const teamInput = { name: 'Apex Racing', color: '#1E41FF', focus: 'GT3' }
const eventInput = { name: 'Daytona 24', date: '2026-09-14', time: '20:00 UTC', class: 'GT3' }
const resultInput = { team: 'Apex Racing', eventName: 'Daytona 24', result: 'P3', drivers: 'alice, bob' }

type Api = ReturnType<typeof createRacingApi>
interface Kind {
  name: string
  endpoint: string
  create: (api: Api, game: RacingGame, extra?: { channelId?: string; pingRoleIds?: string[] }) => Promise<Record<string, unknown>>
  answer: (game: string, extra?: Record<string, unknown>) => unknown
  post: (api: Api, game: RacingGame, extra: { channelId: string; pingRoleIds?: string[] }) => Promise<unknown>
  postBody: Record<string, unknown>
  postPath: string
  postAnswer: (game: string) => unknown
}
const KINDS: Kind[] = [
  {
    name: 'team',
    endpoint: 'teams',
    create: (api, game, extra) => api.createRacingTeam(G, game, { ...teamInput, ...extra }) as unknown as Promise<Record<string, unknown>>,
    answer: (game, extra = {}) => ({ game, team: teamBody, ...extra }),
    post: (api, game, extra) => api.postRacingTeam(G, game, { team: 'Apex Racing', ...extra }),
    postBody: { team: 'Apex Racing' },
    postPath: 'teams/post',
    postAnswer: (game) => ({ ok: true, game, team: 'Apex Racing', message_id: MSG, channel_id: CH, pinged_roles: [{ id: R1, name: 'Drivers' }] })
  },
  {
    name: 'event',
    endpoint: 'events',
    create: (api, game, extra) => api.addRacingEvent(G, game, { ...eventInput, ...extra }) as unknown as Promise<Record<string, unknown>>,
    answer: (game, extra = {}) => ({ game, event: eventBody, ...extra }),
    post: (api, game, extra) => api.postRacingEvent(G, game, { id: 'a1b2c3d4e5f6', ...extra }),
    postBody: { id: 'a1b2c3d4e5f6' },
    postPath: 'events/post',
    postAnswer: (game) => ({ ok: true, game, event_id: 'a1b2c3d4e5f6', message_id: MSG, channel_id: CH, pinged_roles: [{ id: R1, name: 'Drivers' }] })
  },
  {
    name: 'result',
    endpoint: 'results',
    create: (api, game, extra) => api.logRacingResult(G, game, { ...resultInput, ...extra }) as unknown as Promise<Record<string, unknown>>,
    answer: (game, extra = {}) => ({ game, result: resultBody, ...extra }),
    post: (api, game, extra) => api.postRacingResult(G, game, { id: 'b1c2d3e4f5a6', ...extra }),
    postBody: { id: 'b1c2d3e4f5a6' },
    postPath: 'results/post',
    postAnswer: (game) => ({ ok: true, game, result_id: 'b1c2d3e4f5a6', message_id: MSG, channel_id: CH, pinged_roles: [{ id: R1, name: 'Drivers' }] })
  }
]

describe.each(GAME_KEYS)('cards of %s', (game: RacingGame) => {
  describe.each(KINDS)('the $name create', (kind) => {
    it('without a channel it is exactly the request of before and the answer has no card', async () => {
      const { api, calls } = setup(kind.answer(game), kind.answer(game))
      const plain = await kind.create(api, game)
      await kind.create(api, game, {})
      expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/${kind.endpoint}` })
      expect(Object.keys(calls[0]?.body as object)).not.toContain('channel_id')
      expect(Object.keys(calls[0]?.body as object)).not.toContain('ping_role_ids')
      expect('card' in plain).toBe(false)
    })

    it('with a channel it sends channel_id, and ping_role_ids only when roles are chosen', async () => {
      const { api, calls } = setup(kind.answer(game, { post: posted }), kind.answer(game, { post: posted }))
      await kind.create(api, game, { channelId: CH })
      await kind.create(api, game, { channelId: CH, pingRoleIds: [R1, R2, R1] })
      expect(calls[0]?.body).toMatchObject({ channel_id: CH })
      expect(Object.keys(calls[0]?.body as object)).not.toContain('ping_role_ids')
      expect(calls[1]?.body).toMatchObject({ channel_id: CH, ping_role_ids: [R1, R2] })
    })

    it('a card that was posted comes back as post with the channel, the message and the pinged roles', async () => {
      const { api } = setup(kind.answer(game, { post: posted }))
      const created = await kind.create(api, game, { channelId: CH, pingRoleIds: [R1] })
      expect(created['card']).toEqual({ status: 'posted', post: { channelId: CH, messageId: MSG, pingedRoles: [{ id: R1, name: 'Drivers' }] } })
    })

    it('post_error keeps the item: the answer is a success with a failed card, not an error', async () => {
      const { api } = setup(kind.answer(game, { post_error: failed }))
      const created = await kind.create(api, game, { channelId: CH })
      expect(created['card']).toEqual({ status: 'failed', error: { code: 'discord_error', message: 'Discord rejected the message.' } })
      // The item itself is there.
      expect(created['id'] ?? created['name']).toBeTruthy()
    })

    it('neither post nor post_error with a channel is an unknown outcome, never a guess', async () => {
      const { api } = setup(kind.answer(game))
      expect((await kind.create(api, game, { channelId: CH }))['card']).toEqual({ status: 'unknown' })
    })

    it('roles without a channel are refused before any request (never silently dropped)', async () => {
      const { api, request } = setup()
      await expect(kind.create(api, game, { pingRoleIds: [R1] })).rejects.toMatchObject({ kind: 'validation', code: 'invalid_channel', mayHaveBeenSent: false })
      expect(request).not.toHaveBeenCalled()
    })

    it.each(['general', '@everyone', '777 000', '<#777000000000000001>'])('the channel "%s" is refused before any request', async (channelId) => {
      const { api, request } = setup()
      await expect(kind.create(api, game, { channelId })).rejects.toMatchObject({ code: 'invalid_channel' })
      expect(request).not.toHaveBeenCalled()
    })

    it('@everyone, @here, mention text, the server id and more than 3 roles are refused before any request', async () => {
      const { api, request } = setup()
      for (const value of ['@everyone', '@here', '<@&820000000000000001>', '']) await expect(kind.create(api, game, { channelId: CH, pingRoleIds: [value] })).rejects.toMatchObject({ code: 'invalid_ping_roles' })
      await expect(kind.create(api, game, { channelId: CH, pingRoleIds: [G] })).rejects.toMatchObject({ code: 'role_not_pingable' })
      await expect(kind.create(api, game, { channelId: CH, pingRoleIds: [R1, R2, R3, R4] })).rejects.toMatchObject({ code: 'too_many_ping_roles' })
      expect(request).not.toHaveBeenCalled()
    })
  })

  describe.each(KINDS)('"Post to Discord" on an existing $name', (kind) => {
    it('uses the dedicated endpoint of this game with the item and the channel, and returns the card', async () => {
      const { api, calls } = setup(kind.postAnswer(game), kind.postAnswer(game))
      const plain = await kind.post(api, game, { channelId: CH })
      const pinging = await kind.post(api, game, { channelId: CH, pingRoleIds: [R1] })
      expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/${kind.postPath}`, body: { ...kind.postBody, channel_id: CH } })
      expect(Object.keys(calls[0]?.body as object)).not.toContain('ping_role_ids')
      expect(calls[1]?.body).toMatchObject({ ...kind.postBody, channel_id: CH, ping_role_ids: [R1] })
      expect(plain).toEqual({ messageId: MSG, channelId: CH, pingedRoles: [{ id: R1, name: 'Drivers' }] })
      expect(pinging).toMatchObject({ channelId: CH })
    })

    it('the channel is required', async () => {
      const { api, request } = setup()
      for (const channelId of ['', 'general']) await expect(kind.post(api, game, { channelId })).rejects.toMatchObject({ code: 'invalid_channel' })
      expect(request).not.toHaveBeenCalled()
    })

    it('refuses @everyone, @here, mention text, the server id and more than 3 roles before any request', async () => {
      const { api, request } = setup()
      await expect(kind.post(api, game, { channelId: CH, pingRoleIds: ['@everyone'] })).rejects.toMatchObject({ code: 'invalid_ping_roles' })
      await expect(kind.post(api, game, { channelId: CH, pingRoleIds: ['@here'] })).rejects.toMatchObject({ code: 'invalid_ping_roles' })
      await expect(kind.post(api, game, { channelId: CH, pingRoleIds: [G] })).rejects.toMatchObject({ code: 'role_not_pingable' })
      await expect(kind.post(api, game, { channelId: CH, pingRoleIds: [R1, R2, R3, R4] })).rejects.toMatchObject({ code: 'too_many_ping_roles' })
      expect(request).not.toHaveBeenCalled()
    })

    it('an answer that is not what the docs describe is rejected', async () => {
      await expect(setup({ ok: true, game }).api.postRacingTeam(G, game, { team: 'Apex', channelId: CH })).rejects.toMatchObject({ kind: 'invalid_response' })
      await expect(setup({ ok: false, message_id: MSG, channel_id: CH }).api.postRacingEvent(G, game, { id: 'e1', channelId: CH })).rejects.toMatchObject({ kind: 'invalid_response' })
      await expect(setup({ ok: true, message_id: 7, channel_id: CH }).api.postRacingResult(G, game, { id: 'r1', channelId: CH })).rejects.toMatchObject({ kind: 'invalid_response' })
    })
  })

  it('an item without a usable id cannot be posted: refused before any request', async () => {
    const { api, request } = setup()
    for (const id of ['', '../events', 'a b', 'x'.repeat(65), 'a/b']) {
      await expect(api.postRacingEvent(G, game, { id, channelId: CH })).rejects.toMatchObject({ code: 'invalid_event_id' })
      await expect(api.postRacingResult(G, game, { id, channelId: CH })).rejects.toMatchObject({ code: 'invalid_result_id' })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('a team is posted by its name, trimmed; an empty or over-long name is refused', async () => {
    const { api, calls, request } = setup(KINDS[0]!.postAnswer(game))
    await api.postRacingTeam(G, game, { team: '  Apex Racing  ', channelId: CH })
    expect(calls[0]?.body).toMatchObject({ team: 'Apex Racing' })
    await expect(api.postRacingTeam(G, game, { team: '', channelId: CH })).rejects.toMatchObject({ code: 'invalid_name' })
    await expect(api.postRacingTeam(G, game, { team: 'x'.repeat(51), channelId: CH })).rejects.toMatchObject({ code: 'invalid_name' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe.each(GAME_KEYS)('nothing about a card is ever sent twice in %s', (game: RacingGame) => {
  const runs: Array<[string, (api: Api) => Promise<unknown>]> = [
    ['create team with a card', (api) => api.createRacingTeam(G, game, { ...teamInput, channelId: CH, pingRoleIds: [R1] })],
    ['add event with a card', (api) => api.addRacingEvent(G, game, { ...eventInput, channelId: CH, pingRoleIds: [R1] })],
    ['log result with a card', (api) => api.logRacingResult(G, game, { ...resultInput, channelId: CH, pingRoleIds: [R1] })],
    ['post team card', (api) => api.postRacingTeam(G, game, { team: 'Apex Racing', channelId: CH, pingRoleIds: [R1] })],
    ['post event card', (api) => api.postRacingEvent(G, game, { id: 'a1b2c3d4e5f6', channelId: CH, pingRoleIds: [R1] })],
    ['post result card', (api) => api.postRacingResult(G, game, { id: 'b1c2d3e4f5a6', channelId: CH, pingRoleIds: [R1] })]
  ]

  describe.each(runs)('%s', (_name, run) => {
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
      [403, 'manage_server_required'],
      [403, 'bot_cannot_send'],
      [403, 'forbidden'],
      [403, 'role_not_pingable'],
      [403, 'bot_cannot_mention_role'],
      [400, 'invalid_channel'],
      [400, 'invalid_ping_roles'],
      [400, 'too_many_ping_roles'],
      [404, 'channel_not_found'],
      [404, 'role_not_found'],
      [404, 'team_not_found'],
      [404, 'event_not_found'],
      [404, 'result_not_found']
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
  })
})

describe('the game is checked first for the card calls too', () => {
  it.each(['', 'f2', 'F1', '../iracing', 'gt7 '])('"%s" is refused with unknown_game and nothing is sent', async (game) => {
    const { api, request } = setup()
    const g = game as RacingGame
    await expect(api.postRacingTeam(G, g, { team: 'Apex', channelId: CH })).rejects.toMatchObject({ code: 'unknown_game' })
    await expect(api.postRacingEvent(G, g, { id: 'e1', channelId: CH })).rejects.toMatchObject({ code: 'unknown_game' })
    await expect(api.postRacingResult(G, g, { id: 'r1', channelId: CH })).rejects.toMatchObject({ code: 'unknown_game' })
    await expect(api.createRacingTeam(G, g, { ...teamInput, channelId: CH })).rejects.toMatchObject({ code: 'unknown_game' })
    expect(request).not.toHaveBeenCalled()
  })

  it('the three post calls change nothing: the only call that edits is the team edit of M7; no call deletes anything, and events and results cannot be edited', () => {
    const { api } = setup()
    expect(Object.keys(api).filter((name) => /edit|update|delete/i.test(name))).toEqual(['editRacingTeam'])
  })
})
