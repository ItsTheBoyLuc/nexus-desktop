import { describe, expect, it } from 'vitest'
import { GAME_KEYS } from '../shared/types'
import type { RacingGame } from '../shared/types'
import { createRacingApi } from './racingApi'
import { dropped, hang, json, realClient, setup } from './racingApiTestKit'

/**
 * Milestone 5, part 2: the announcement of every one of the five games. Paths, bodies and answers follow docs/APP_API.md only.
 * The image must be https (the API is stricter than the command), and the write is sent exactly once.
 */
const G = '555000000000000001'
const CH = '777000000000000001'
const MSG = '888000000000000001'
const BASE = `/api/app/v1/guilds/${G}/racing`
const answer = (game: string) => ({ ok: true, game, message_id: MSG, channel_id: CH })
const input = { channelId: CH, title: 'Round 3!', message: 'Full text :emoji_name:' }

describe.each(GAME_KEYS)('announcement of %s', (game: RacingGame) => {
  it('POST announcement uses the game in the path and sends channel, title and message; the image only when given', async () => {
    const { api, calls } = setup(answer(game), answer(game))
    await api.postRacingAnnouncement(G, game, input)
    const result = await api.postRacingAnnouncement(G, game, { ...input, imageUrl: 'https://example.com/fake.png' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/announcement`, body: { channel_id: CH, title: 'Round 3!', message: 'Full text :emoji_name:' } })
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['channel_id', 'message', 'title'])
    expect(calls[1]?.body).toMatchObject({ image_url: 'https://example.com/fake.png' })
    expect(result).toEqual({ messageId: MSG, channelId: CH })
  })

  it('sends the text exactly as typed: no escaping, no conversion, no trimming of formatting characters', async () => {
    const { api, calls } = setup(answer(game))
    await api.postRacingAnnouncement(G, game, { channelId: CH, title: '**Bold** <b>x</b>', message: '_italic_ :server_emoji: <script>1</script>\nsecond line' })
    expect(calls[0]?.body).toMatchObject({ title: '**Bold** <b>x</b>', message: '_italic_ :server_emoji: <script>1</script>\nsecond line' })
  })

  it.each(['http://example.com/fake.png', 'HTTP://example.com/fake.png', 'ftp://example.com/x.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//example.com/x.png', 'https://user:pw@example.com/x.png', 'https://exa mple.com/x.png', 'not a url', `https://example.com/${'x'.repeat(500)}`])(
    'refuses the image "%s" before any request: only https is accepted',
    async (imageUrl) => {
      const { api, request } = setup()
      await expect(api.postRacingAnnouncement(G, game, { ...input, imageUrl })).rejects.toMatchObject({ code: 'invalid_image_url' })
      expect(request).not.toHaveBeenCalled()
    }
  )

  it('an empty image is the same as none', async () => {
    const { api, calls } = setup(answer(game))
    await api.postRacingAnnouncement(G, game, { ...input, imageUrl: '' })
    expect(Object.keys(calls[0]?.body as object)).not.toContain('image_url')
  })

  it('has one call that posts, and no call that edits, deletes or reads an announcement', () => {
    const { api } = setup()
    expect(Object.keys(api).filter((name) => /announcement/i.test(name))).toEqual(['postRacingAnnouncement'])
  })
})

describe('announcement: input checks and shapes', () => {
  it('refuses a bad channel before any request and rejects answers that are not shaped like the documentation', async () => {
    const { api, request } = setup()
    await expect(api.postRacingAnnouncement(G, 'lmu', { ...input, channelId: 'general' })).rejects.toMatchObject({ code: 'invalid_channel' })
    expect(request).not.toHaveBeenCalled()
    await expect(setup({ ok: true, game: 'lmu', channel_id: CH }).api.postRacingAnnouncement(G, 'lmu', input)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ ok: false, message_id: MSG, channel_id: CH }).api.postRacingAnnouncement(G, 'lmu', input)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ ok: true, message_id: 5, channel_id: CH }).api.postRacingAnnouncement(G, 'lmu', input)).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe.each(GAME_KEYS)('posting an announcement in %s is sent exactly once', (game: RacingGame) => {
  const post = (api: ReturnType<typeof createRacingApi>) => api.postRacingAnnouncement(G, game, input)

  it('a timeout is reported once and never repeated: the message may already be in Discord', async () => {
    const { api, calls } = realClient(hang)
    await expect(post(api)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it('a dropped connection is not repeated', async () => {
    const { api, calls } = realClient(dropped)
    await expect(post(api)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it.each([[504, 'bot_timeout'], [502, 'discord_error'], [500, 'internal_error']] as const)('%i %s is reported as it is, once', async (status, code) => {
    const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
    await expect(post(api)).rejects.toMatchObject({ kind: 'http', code, status })
    expect(calls()).toBe(1)
  })

  it.each([[403, 'manager_required'], [403, 'bot_cannot_send'], [403, 'forbidden'], [404, 'channel_not_found'], [404, 'unknown_game'], [400, 'invalid_title'], [400, 'invalid_message'], [400, 'invalid_image_url']])('%i %s comes through with its code', async (status, code) => {
    const { api } = realClient(async () => json(status, { error: code, message: code }))
    await expect(post(api)).rejects.toMatchObject({ kind: 'http', code, status })
  })

  it('a success whose answer is not what the docs describe is reported as a doubtful outcome, once', async () => {
    const { api, calls } = realClient(async () => json(201, { nope: true }))
    await expect(post(api)).rejects.toMatchObject({ kind: 'invalid_response' })
    expect(calls()).toBe(1)
  })
})

describe('the game is checked first for the announcement too', () => {
  it.each(['', 'f2', 'F1', '../iracing', 'gt7 '])('"%s" is refused with unknown_game and nothing is sent', async (game) => {
    const { api, request } = setup()
    await expect(api.postRacingAnnouncement(G, game as RacingGame, input)).rejects.toMatchObject({ kind: 'validation', code: 'unknown_game', mayHaveBeenSent: false })
    expect(request).not.toHaveBeenCalled()
  })
})
