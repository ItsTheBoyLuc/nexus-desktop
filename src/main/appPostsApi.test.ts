import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from './apiClient'
import type { RequestOptions } from './apiClient'
import { createAppPostsApi } from './appPostsApi'
import { dropped, hang, json } from './racingApiTestKit'

/**
 * Milestone 7: the posts made with the app (`GET /app-posts`, `DELETE /app-posts/{channel}/{message}`). Paths, methods and shapes follow
 * docs/APP_API.md only. The list is validated row by row; the delete goes out exactly once and never carries a body.
 */
const G = '555000000000000001'
const CH = '777000000000000001'
const OTHER_CH = '777000000000000002'
const MSG = '600000000000000001'
const BASE = `/api/app/v1/guilds/${G}/app-posts`

function setup(...answers: unknown[]) {
  const calls: RequestOptions[] = []
  const queue = [...answers]
  const request = vi.fn(async (options: RequestOptions) => {
    calls.push(options)
    const next = queue.shift()
    if (next instanceof Error) throw next
    return next
  })
  return { api: createAppPostsApi({ request } as unknown as ApiClient), calls, request }
}

/** The real ApiClient (timeouts, retry rules) over a scripted network. */
function realClient(handler: (signal: AbortSignal | undefined) => Promise<Response>) {
  let calls = 0
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls++
    return handler(init?.signal ?? undefined)
  }) as typeof fetch
  const client = new ApiClient({ baseUrl: 'https://api.test', fetchImpl, timeoutMs: 30, wakeAfterMs: 1000, sleep: async () => undefined })
  client.setSession({ access_token: 'access', refresh_token: 'refresh' })
  return { api: createAppPostsApi(client), calls: () => calls }
}

const row = (over: Record<string, unknown> = {}) => ({ message_id: MSG, channel_id: CH, title: 'Round_3 starts', posted_at: '2026-10-01T12:03:00Z', jump_url: 'https://discord.com/channels/1/2/3', ...over })

describe('GET app-posts', () => {
  it('asks for one channel and parses title, time and ids (the jump link is not used: the app builds its own from the ids)', async () => {
    const { api, calls } = setup({ channel_id: CH, posts: [row(), row({ message_id: '600000000000000002', title: '' })] })
    const list = await api.appPosts(G, CH)
    expect(calls[0]).toMatchObject({ path: `${BASE}?channel_id=${CH}` })
    expect(calls[0]?.method).toBeUndefined()
    expect(list).toEqual({
      channelId: CH,
      posts: [
        { messageId: MSG, channelId: CH, title: 'Round_3 starts', postedAt: '2026-10-01T12:03:00Z' },
        { messageId: '600000000000000002', channelId: CH, title: '', postedAt: '2026-10-01T12:03:00Z' }
      ]
    })
    expect(JSON.stringify(list)).not.toContain('jump')
  })

  it('shows at most 25 posts and cuts a title at 100 characters, without touching its text (it is plain text, never HTML)', async () => {
    const many = Array.from({ length: 40 }, (_, index) => row({ message_id: String(600000000000000100 + index) }))
    const long = await setup({ channel_id: CH, posts: [row({ title: '<b>x</b>'.repeat(40) })] }).api.appPosts(G, CH)
    expect(long.posts[0]?.title).toHaveLength(100)
    expect(long.posts[0]?.title.startsWith('<b>x</b>')).toBe(true)
    expect((await setup({ channel_id: CH, posts: many }).api.appPosts(G, CH)).posts).toHaveLength(25)
  })

  it('drops a row that is not shaped right or that names another channel, so it can never become a delete target elsewhere', async () => {
    const { api } = setup({ channel_id: CH, posts: [row(), row({ channel_id: OTHER_CH }), row({ message_id: 'abc' }), row({ message_id: 5 }), 'nope', null, row({ message_id: '600000000000000009' })] })
    expect((await api.appPosts(G, CH)).posts.map((post) => post.messageId)).toEqual([MSG, '600000000000000009'])
  })

  it('an empty channel is an empty list, not an error', async () => {
    expect(await setup({ channel_id: CH, posts: [] }).api.appPosts(G, CH)).toEqual({ channelId: CH, posts: [] })
  })

  it('refuses a bad channel or server before any request', async () => {
    const { api, request } = setup()
    await expect(api.appPosts(G, 'general')).rejects.toMatchObject({ kind: 'validation', code: 'invalid_channel', mayHaveBeenSent: false })
    await expect(api.appPosts(G, '')).rejects.toMatchObject({ code: 'invalid_channel' })
    await expect(api.appPosts('../x', CH)).rejects.toMatchObject({ code: 'invalid_guild_id' })
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects an answer that is not what the docs describe, or that is about another channel', async () => {
    await expect(setup({ posts: [] }).api.appPosts(G, CH)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ channel_id: CH }).api.appPosts(G, CH)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ channel_id: OTHER_CH, posts: [row()] }).api.appPosts(G, CH)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup('text').api.appPosts(G, CH)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it.each([
    [400, 'invalid_channel'],
    [403, 'forbidden'],
    [403, 'bot_cannot_read'],
    [404, 'channel_not_found'],
    [502, 'discord_error'],
    [504, 'bot_timeout']
  ])('%i %s comes through with its code', async (status, code) => {
    const { api } = realClient(async () => json(status, { error: code, message: code }))
    await expect(api.appPosts(G, CH)).rejects.toMatchObject({ kind: 'http', code, status })
  })
})

describe('DELETE app-posts', () => {
  it('uses the channel and the message in the path, the DELETE method and no body', async () => {
    const { api, calls } = setup({ deleted: true })
    expect(await api.deleteAppPost(G, CH, MSG)).toEqual({ deleted: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/${CH}/${MSG}` })
    expect(calls[0]?.body).toBeUndefined()
  })

  it.each([
    ['channel', 'general', MSG, 'invalid_channel'],
    ['channel', '', MSG, 'invalid_channel'],
    ['message', CH, 'abc', 'invalid_message_id'],
    ['message', CH, '../x', 'invalid_message_id'],
    ['message', CH, '', 'invalid_message_id'],
    ['message', CH, `${MSG}/../${MSG}`, 'invalid_message_id']
  ])('refuses a bad %s id (%s, %s) before any request', async (_what, channel, message, code) => {
    const { api, request } = setup()
    await expect(api.deleteAppPost(G, channel, message)).rejects.toMatchObject({ kind: 'validation', code, mayHaveBeenSent: false })
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects an answer that does not say deleted: true', async () => {
    await expect(setup({ deleted: false }).api.deleteAppPost(G, CH, MSG)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ ok: true }).api.deleteAppPost(G, CH, MSG)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup(null).api.deleteAppPost(G, CH, MSG)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('offers no way to delete anything else: the API has two calls, and neither names a team, event or result', () => {
    const { api } = setup()
    expect(Object.keys(api).sort()).toEqual(['appPosts', 'deleteAppPost'])
  })
})

describe('a delete is sent exactly once', () => {
  const remove = (api: ReturnType<typeof createAppPostsApi>) => api.deleteAppPost(G, CH, MSG)

  it('a timeout is reported once and never repeated: the message may already be gone', async () => {
    const { api, calls } = realClient(hang)
    await expect(remove(api)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it('a dropped connection is not repeated', async () => {
    const { api, calls } = realClient(dropped)
    await expect(remove(api)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it.each([[504, 'bot_timeout'], [502, 'discord_error'], [500, 'internal_error'], [503, 'unavailable']] as const)('%i %s is reported as it is, once', async (status, code) => {
    const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
    await expect(remove(api)).rejects.toMatchObject({ kind: 'http', code, status })
    expect(calls()).toBe(1)
  })

  it.each([
    [403, 'manage_server_required'],
    [403, 'forbidden'],
    [403, 'bot_cannot_read'],
    [403, 'not_an_app_post'],
    [403, 'bot_cannot_delete'],
    [404, 'channel_not_found'],
    [404, 'message_not_found'],
    [400, 'invalid_channel'],
    [400, 'invalid_message_id']
  ])('%i %s comes through with its code, once', async (status, code) => {
    const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
    await expect(remove(api)).rejects.toMatchObject({ kind: 'http', code, status })
    expect(calls()).toBe(1)
  })

  it('429 is reported once with its Retry-After and not repeated', async () => {
    const { api, calls } = realClient(async () => new Response(JSON.stringify({ error: 'rate_limited', message: 'slow' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '12' } }))
    await expect(remove(api)).rejects.toMatchObject({ kind: 'rate_limited', retryAfter: 12 })
    expect(calls()).toBe(1)
  })

  it('a success whose answer is not what the docs describe is a doubtful outcome, once', async () => {
    const { api, calls } = realClient(async () => json(200, { nope: true }))
    await expect(remove(api)).rejects.toMatchObject({ kind: 'invalid_response' })
    expect(calls()).toBe(1)
  })
})
