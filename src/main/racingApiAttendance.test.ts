import { describe, expect, it } from 'vitest'
import { GAME_KEYS } from '../shared/types'
import type { RacingGame } from '../shared/types'
import { createRacingApi } from './racingApi'
import { dropped, hang, json, realClient, setup } from './racingApiTestKit'

/**
 * Milestone 5, part 2: the attendance posts of every one of the five games. Paths, bodies and answers follow docs/APP_API.md only.
 * Drivers set their own status in Discord, so the API object offers only reading and creating a post.
 */
const G = '555000000000000001'
const CH = '777000000000000001'
const MSG = '700000000000000001'
const BASE = `/api/app/v1/guilds/${G}/racing`

const attendeeJson = (over: Record<string, unknown> = {}) => ({ user_id: '200000000000000001', name: 'Fake Driver 001', in_server: true, ...over })
const postJson = (over: Record<string, unknown> = {}) => ({
  message_id: MSG, name: 'Fake Practice', date: '2026-09-14', description: 'fake', created_by: '1001', created_at: '2026-01-01T00:00:00Z', ...over
})

describe.each(GAME_KEYS)('attendance posts of %s', (game: RacingGame) => {
  it('GET attendance lists the posts as the server returns them (newest first), with the page in the query and the counts', async () => {
    const { api, calls } = setup({ game, total: 2, limit: 100, offset: 0, posts: [postJson({ counts: { available: 3, unavailable: 1 } }), postJson({ message_id: '700000000000000002', counts: { available: 0, unavailable: 0 } })] })
    const page = await api.racingAttendance(G, game, { limit: 100, offset: 0 })
    expect(calls[0]?.path).toBe(`${BASE}/${game}/attendance?limit=100&offset=0`)
    expect(calls[0]?.method).toBeUndefined()
    expect(page.total).toBe(2)
    expect(page.posts.map((post) => post.messageId)).toEqual([MSG, '700000000000000002'])
    expect(page.posts[0]).toMatchObject({ name: 'Fake Practice', date: '2026-09-14', description: 'fake', counts: { available: 3, unavailable: 1 } })
  })

  it('GET one post reads the names of the available and not available drivers (a member who left keeps the stored name)', async () => {
    const { api, calls } = setup({
      ...postJson(),
      attendance: { available: [attendeeJson(), attendeeJson({ user_id: '200000000000000002', name: 'Fake Driver 002', in_server: false })], unavailable: [attendeeJson({ user_id: '200000000000000003', name: null })] }
    })
    const post = await api.racingAttendancePost(G, game, MSG)
    expect(calls[0]?.path).toBe(`${BASE}/${game}/attendance/${MSG}`)
    expect(post.attendance.available).toEqual([
      { userId: '200000000000000001', name: 'Fake Driver 001', inServer: true },
      { userId: '200000000000000002', name: 'Fake Driver 002', inServer: false }
    ])
    expect(post.attendance.unavailable).toEqual([{ userId: '200000000000000003', name: null, inServer: true }])
    // no counts in the answer: the lists are the truth
    expect(post.counts).toEqual({ available: 2, unavailable: 1 })
  })

  it('POST attendance sends channel, name, date and the optional description; the answer carries the post and the channel', async () => {
    const answer = { game, post: { ...postJson(), attendance: { available: [], unavailable: [] } }, channel_id: CH }
    const { api, calls } = setup(answer, answer)
    await api.createRacingAttendance(G, game, { channelId: CH, name: 'Fake Practice', date: '2026-09-14' })
    const result = await api.createRacingAttendance(G, game, { channelId: CH, name: 'Fake Practice', date: '2026-09-14', description: 'fake' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/attendance`, body: { channel_id: CH, name: 'Fake Practice', date: '2026-09-14' } })
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['channel_id', 'date', 'name'])
    expect(calls[1]?.body).toMatchObject({ description: 'fake' })
    expect(result.channelId).toBe(CH)
    expect(result.post).toMatchObject({ messageId: MSG, name: 'Fake Practice', counts: { available: 0, unavailable: 0 } })
  })

  it('has no way to set, toggle or remove a status, to edit or delete a post, or to find a channel later', () => {
    const { api } = setup()
    expect(Object.keys(api).filter((name) => /attendance/i.test(name)).sort()).toEqual(['createRacingAttendance', 'racingAttendance', 'racingAttendancePost'])
  })
})

describe('attendance: input checks and shapes', () => {
  it('refuses a bad message id or channel before any request', async () => {
    const { api, request } = setup()
    await expect(api.racingAttendancePost(G, 'lmu', '../x')).rejects.toMatchObject({ code: 'invalid_message_id' })
    await expect(api.createRacingAttendance(G, 'lmu', { channelId: 'nope', name: 'n', date: 'd' })).rejects.toMatchObject({ code: 'invalid_channel' })
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects answers that are not shaped like the documentation', async () => {
    await expect(setup({ nope: [] }).api.racingAttendance(G, 'lmu')).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ total: 1, posts: [{ name: 'no id' }] }).api.racingAttendance(G, 'lmu')).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup(postJson()).api.racingAttendancePost(G, 'lmu', MSG)).rejects.toMatchObject({ kind: 'invalid_response' }) // no attendance lists
    await expect(setup({ post: postJson() }).api.createRacingAttendance(G, 'lmu', { channelId: CH, name: 'n', date: 'd' })).rejects.toMatchObject({ kind: 'invalid_response' }) // no channel_id
    await expect(setup({ channel_id: CH }).api.createRacingAttendance(G, 'lmu', { channelId: CH, name: 'n', date: 'd' })).rejects.toMatchObject({ kind: 'invalid_response' }) // no post
  })

  it('keeps names that look like html as plain text', async () => {
    const { api } = setup({ ...postJson({ name: '<b>x</b>' }), attendance: { available: [attendeeJson({ name: '<script>alert(1)</script>' })], unavailable: [] } })
    const post = await api.racingAttendancePost(G, 'lmu', MSG)
    expect(post.name).toBe('<b>x</b>')
    expect(post.attendance.available[0]?.name).toBe('<script>alert(1)</script>')
  })
})

describe.each(GAME_KEYS)('creating an attendance post in %s is sent exactly once', (game: RacingGame) => {
  const create = (api: ReturnType<typeof createRacingApi>) => api.createRacingAttendance(G, game, { channelId: CH, name: 'Fake Practice', date: '2026-09-14' })

  it('a timeout is reported once and never repeated: the message may already be in Discord', async () => {
    const { api, calls } = realClient(hang)
    await expect(create(api)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it('a dropped connection is not repeated', async () => {
    const { api, calls } = realClient(dropped)
    await expect(create(api)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it.each([[504, 'bot_timeout'], [502, 'discord_error'], [500, 'internal_error']] as const)('%i %s is reported as it is, once', async (status, code) => {
    const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
    await expect(create(api)).rejects.toMatchObject({ kind: 'http', code, status })
    expect(calls()).toBe(1)
  })

  it.each([[403, 'manager_required'], [403, 'bot_cannot_send'], [403, 'forbidden'], [404, 'channel_not_found'], [404, 'unknown_game'], [400, 'invalid_date']])('%i %s comes through with its code', async (status, code) => {
    const { api } = realClient(async () => json(status, { error: code, message: code }))
    await expect(create(api)).rejects.toMatchObject({ kind: 'http', code, status })
  })
})

describe('the game is checked first for the attendance calls too', () => {
  it.each(['', 'f2', 'F1', '../iracing', 'gt7 '])('"%s" is refused with unknown_game and nothing is sent', async (game) => {
    const { api, request } = setup()
    await expect(api.racingAttendance(G, game as RacingGame)).rejects.toMatchObject({ kind: 'validation', code: 'unknown_game', mayHaveBeenSent: false })
    await expect(api.racingAttendancePost(G, game as RacingGame, MSG)).rejects.toMatchObject({ code: 'unknown_game' })
    await expect(api.createRacingAttendance(G, game as RacingGame, { channelId: CH, name: 'n', date: 'd' })).rejects.toMatchObject({ code: 'unknown_game' })
    expect(request).not.toHaveBeenCalled()
  })
})
