import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { IpcResult } from '../../shared/types'
import { createAppPostsMock } from './appPostsMock'

/**
 * Milestone 7: the fake "posts made with the app" backend is what the list and the delete dialog are reviewed against in
 * `npm run dev:mock`. The cases it promises are pinned here: the last-100 window, the cap of 25, an empty channel, 403 manage_server_required,
 * 404 already gone, not_an_app_post, bot_cannot_read, bot_cannot_delete, a lost answer, the rate limit, and that a delete removes one message
 * and nothing else.
 */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const OTHER = '555000000000000002'
const ANNOUNCEMENTS = '777000000000000001'
const RESULTS = '777000000000000002'
const NEWS = '777000000000000003'
const EMPTY = '777000000000000004'
const TIMEOUT = '777000000000000007'
const LOCKED = '777000000000000008'
const HIDDEN = '777000000000000009'
const CHANNELS = ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map((n) => ({ id: `7770000000000000${n}`, name: `c${n}` }))

function setup(scenario = 'normal') {
  const mock = createAppPostsMock({
    scenario,
    isAdmin: true,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id: string) => [APEX, MIDNIGHT, OTHER].includes(id),
    channels: CHANNELS,
    timeoutChannel: TIMEOUT,
    lockedChannel: LOCKED,
    hiddenChannel: HIDDEN,
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSettings: () => undefined,
    liveMessages: new Set<string>(),
    newMessageId: () => '1',
    apex: APEX,
    midnight: MIDNIGHT
  })
  return mock
}
const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}
const code = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.code)
const titleIds = async (api: ReturnType<typeof setup>['api'], guild: string, channel: string, title: RegExp): Promise<string[]> =>
  ok(await api.appPosts(guild, channel)).posts.filter((post) => title.test(post.title)).map((post) => post.messageId)

describe('the list', () => {
  it('shows the app posts among the last 100 messages, newest first, with plain-text titles; older ones are not found', async () => {
    const { api } = setup()
    const list = ok(await api.appPosts(APEX, ANNOUNCEMENTS))
    expect(list.channelId).toBe(ANNOUNCEMENTS)
    expect(list.posts).toHaveLength(8)
    expect(list.posts.map((post) => post.title)).not.toContain('Fake old post, older than the last 100 messages')
    const times = list.posts.map((post) => Date.parse(post.postedAt))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(list.posts.some((post) => post.title.includes('<script>'))).toBe(true) // html-looking text must be shown as text by the screens
    expect(list.posts.some((post) => post.title.length > 90)).toBe(true)
    for (const post of list.posts) expect(post.channelId).toBe(ANNOUNCEMENTS)
  })

  it('other channels and servers have their own lists; a channel with no app post is an empty list', async () => {
    const { api } = setup()
    expect(ok(await api.appPosts(APEX, NEWS)).posts).toHaveLength(2)
    expect(ok(await api.appPosts(APEX, RESULTS)).posts).toHaveLength(1)
    expect(ok(await api.appPosts(MIDNIGHT, ANNOUNCEMENTS)).posts).toHaveLength(1)
    expect(ok(await api.appPosts(APEX, EMPTY)).posts).toEqual([])
    expect(ok(await api.appPosts(OTHER, ANNOUNCEMENTS)).posts).toEqual([])
  })

  it('scenario noappposts has no post anywhere', async () => {
    const { api } = setup('noappposts')
    expect(ok(await api.appPosts(APEX, ANNOUNCEMENTS)).posts).toEqual([])
  })

  it('returns at most 25 posts even when more are among the last 100 messages', async () => {
    const { api, record } = setup('noappposts')
    for (let index = 0; index < 40; index++) record(APEX, EMPTY, String(900000000000000000n + BigInt(index)), `Fake post ${index}`)
    const list = ok(await api.appPosts(APEX, EMPTY))
    expect(list.posts).toHaveLength(25)
    expect(list.posts[0]?.title).toBe('Fake post 39')
  })

  it('a post that is pushed beyond the last 100 messages is no longer found', async () => {
    const { api, record } = setup('noappposts')
    record(APEX, EMPTY, '900000000000000001', 'Fake first post')
    expect(ok(await api.appPosts(APEX, EMPTY)).posts).toHaveLength(1)
    // The mock only records app posts, so "100 newer messages" are 100 newer app posts of which only 25 are returned: the first is out of reach.
    for (let index = 0; index < 100; index++) record(APEX, EMPTY, String(900000000000000100n + BigInt(index)), `Fake newer ${index}`)
    expect(ok(await api.appPosts(APEX, EMPTY)).posts.some((post) => post.title === 'Fake first post')).toBe(false)
  })

  it('refuses like the server: an unknown channel, a channel the caller cannot see, one the bot cannot read, an unknown server', async () => {
    const { api } = setup()
    expect(code(await api.appPosts(APEX, '777000000000000099'))).toBe('channel_not_found')
    expect(code(await api.appPosts(APEX, HIDDEN))).toBe('forbidden')
    expect(code(await api.appPosts(APEX, LOCKED))).toBe('bot_cannot_read')
    expect(code(await api.appPosts('555000000000000099', ANNOUNCEMENTS))).toBe('guild_not_found')
  })

  it.each([
    ['cannotread', 'bot_cannot_read'],
    ['channelgone', 'channel_not_found'],
    ['nostaff', 'forbidden']
  ])('scenario %s answers %s', async (scenario, expected) => {
    expect(code(await setup(scenario).api.appPosts(APEX, ANNOUNCEMENTS))).toBe(expected)
  })
})

describe('what is posted can be listed and deleted again', () => {
  it('a recorded post shows up first, with the title it was posted with', async () => {
    const { api, record } = setup()
    record(APEX, NEWS, '900000000000000042', 'Fake new announcement')
    const list = ok(await api.appPosts(APEX, NEWS))
    expect(list.posts[0]).toMatchObject({ messageId: '900000000000000042', title: 'Fake new announcement', channelId: NEWS })
    expect(ok(await api.deleteAppPost(APEX, NEWS, '900000000000000042'))).toEqual({ deleted: true })
    expect(ok(await api.appPosts(APEX, NEWS)).posts.some((post) => post.messageId === '900000000000000042')).toBe(false)
  })
})

describe('the delete', () => {
  it('removes that message and nothing else', async () => {
    const { api } = setup()
    const before = ok(await api.appPosts(APEX, ANNOUNCEMENTS)).posts
    const [target] = await titleIds(api, APEX, ANNOUNCEMENTS, /Round 3 starts/)
    expect(ok(await api.deleteAppPost(APEX, ANNOUNCEMENTS, target!))).toEqual({ deleted: true })
    const after = ok(await api.appPosts(APEX, ANNOUNCEMENTS)).posts
    expect(after.map((post) => post.messageId)).toEqual(before.map((post) => post.messageId).filter((id) => id !== target))
    // Another channel and another server are untouched.
    expect(ok(await api.appPosts(APEX, NEWS)).posts).toHaveLength(2)
    expect(ok(await api.appPosts(MIDNIGHT, ANNOUNCEMENTS)).posts).toHaveLength(1)
  })

  it('a second delete of the same message is 404 message_not_found ("already gone")', async () => {
    const { api } = setup()
    const [target] = await titleIds(api, APEX, ANNOUNCEMENTS, /Round 3 starts/)
    ok(await api.deleteAppPost(APEX, ANNOUNCEMENTS, target!))
    expect(code(await api.deleteAppPost(APEX, ANNOUNCEMENTS, target!))).toBe('message_not_found')
  })

  it('the message must be in the channel it is asked for', async () => {
    const { api } = setup()
    const [target] = await titleIds(api, APEX, ANNOUNCEMENTS, /Round 3 starts/)
    expect(code(await api.deleteAppPost(APEX, NEWS, target!))).toBe('message_not_found')
    expect(ok(await api.appPosts(APEX, ANNOUNCEMENTS)).posts.some((post) => post.messageId === target)).toBe(true)
  })

  it('a message that is not an app post is never deleted: 403 not_an_app_post', async () => {
    const { api } = setup()
    // The first ordinary message of the channel sits right after the newest app post; its id is one above that post's.
    const [newest] = ok(await api.appPosts(APEX, ANNOUNCEMENTS)).posts
    const ordinary = String(BigInt(newest!.messageId) + 1n)
    expect(code(await api.deleteAppPost(APEX, ANNOUNCEMENTS, ordinary))).toBe('not_an_app_post')
    expect(ok(await api.appPosts(APEX, ANNOUNCEMENTS)).posts).toHaveLength(8)
  })

  it.each([
    ['nomanage', 'manage_server_required'],
    ['nostaff', 'forbidden'],
    ['postgone', 'message_not_found'],
    ['notappost', 'not_an_app_post'],
    ['cannotread', 'bot_cannot_read'],
    ['cannotdelete', 'bot_cannot_delete'],
    ['channelgone', 'channel_not_found'],
    ['deletelimit', 'rate_limited']
  ])('scenario %s answers %s', async (scenario, expected) => {
    const { api } = setup(scenario)
    const [id] = await titleIds(setup().api, APEX, NEWS, /season recap/) // the same ids in every mock: they are seeded the same way
    expect(code(await api.deleteAppPost(APEX, NEWS, id!)), scenario).toBe(expected)
  })

  it('scenario postgone makes the post disappear (it was deleted a moment earlier); the others delete nothing', async () => {
    const gone = setup('postgone')
    const [id] = await titleIds(gone.api, APEX, NEWS, /season recap/)
    await gone.api.deleteAppPost(APEX, NEWS, id!)
    expect(ok(await gone.api.appPosts(APEX, NEWS)).posts).toHaveLength(1)
    for (const scenario of ['nomanage', 'notappost', 'cannotdelete', 'deletelimit']) {
      const mock = setup(scenario)
      const [target] = await titleIds(mock.api, APEX, NEWS, /season recap/)
      await mock.api.deleteAppPost(APEX, NEWS, target!)
      expect(ok(await mock.api.appPosts(APEX, NEWS)).posts, scenario).toHaveLength(2)
    }
  })

  it('a rate limit carries Retry-After and the kind the app maps to a rate-limit message', async () => {
    const { api } = setup('deletelimit')
    const [id] = await titleIds(setup().api, APEX, NEWS, /season recap/)
    expect(await api.deleteAppPost(APEX, NEWS, id!)).toMatchObject({ ok: false, error: { kind: 'rate_limited', code: 'rate_limited', status: 429, retryAfter: 30 } })
  })

  it('the 11th delete within a minute is refused like the real limit (10 a minute per server); a refused attempt counts too', async () => {
    const { api, record } = setup('noappposts')
    for (let index = 0; index < 11; index++) record(APEX, EMPTY, String(900000000000000500n + BigInt(index)), `Fake post ${index}`)
    const ids = ok(await api.appPosts(APEX, EMPTY)).posts.map((post) => post.messageId)
    const results: string[] = []
    for (const id of ids) results.push(code(await api.deleteAppPost(APEX, EMPTY, id)))
    expect(results.filter((value) => value === 'ok')).toHaveLength(10)
    expect(results[10]).toBe('rate_limited')
    // Another server has its own allowance.
    record(MIDNIGHT, EMPTY, '900000000000000999', 'Fake other server')
    expect(code(await api.deleteAppPost(MIDNIGHT, EMPTY, '900000000000000999'))).toBe('ok')
  })

  it('a lost answer: scenario lostdelete and a title with "timeout" delete the message and then time out; "fail" is a 502 that deletes nothing', async () => {
    const lost = setup('lostdelete')
    const [first] = await titleIds(lost.api, APEX, NEWS, /season recap/)
    expect(await lost.api.deleteAppPost(APEX, NEWS, first!)).toMatchObject({ ok: false, error: { kind: 'timeout', mayHaveBeenSent: true } })
    expect(ok(await lost.api.appPosts(APEX, NEWS)).posts).toHaveLength(1) // it WAS deleted: the app can only find out by reading the list

    const hook = setup()
    const [slow] = await titleIds(hook.api, APEX, ANNOUNCEMENTS, /timeout/)
    expect(await hook.api.deleteAppPost(APEX, ANNOUNCEMENTS, slow!)).toMatchObject({ ok: false, error: { kind: 'timeout' } })
    expect(await titleIds(hook.api, APEX, ANNOUNCEMENTS, /timeout/)).toEqual([])
    const [bad] = await titleIds(hook.api, APEX, ANNOUNCEMENTS, /with a fail/)
    expect(await hook.api.deleteAppPost(APEX, ANNOUNCEMENTS, bad!)).toMatchObject({ ok: false, error: { code: 'discord_error', status: 502 } })
    expect(await titleIds(hook.api, APEX, ANNOUNCEMENTS, /with a fail/)).toHaveLength(1)
  })

  it('the title hooks: "gone" is 404 and disappears, "notapp" is 403 not_an_app_post and stays', async () => {
    const { api } = setup()
    const [gone] = await titleIds(api, APEX, ANNOUNCEMENTS, /already gone/)
    const [notapp] = await titleIds(api, APEX, ANNOUNCEMENTS, /notapp/)
    expect(code(await api.deleteAppPost(APEX, ANNOUNCEMENTS, gone!))).toBe('message_not_found')
    expect(await titleIds(api, APEX, ANNOUNCEMENTS, /already gone/)).toEqual([])
    expect(code(await api.deleteAppPost(APEX, ANNOUNCEMENTS, notapp!))).toBe('not_an_app_post')
    expect(await titleIds(api, APEX, ANNOUNCEMENTS, /notapp/)).toHaveLength(1)
  })

  it('refuses a channel the caller cannot see or the bot cannot read before it deletes anything', async () => {
    const { api } = setup()
    expect(code(await api.deleteAppPost(APEX, HIDDEN, '600000000000000001'))).toBe('forbidden')
    expect(code(await api.deleteAppPost(APEX, LOCKED, '600000000000000001'))).toBe('bot_cannot_read')
    expect(code(await api.deleteAppPost(APEX, '777000000000000099', '600000000000000001'))).toBe('channel_not_found')
  })
})
