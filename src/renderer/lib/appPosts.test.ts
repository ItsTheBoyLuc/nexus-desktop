import { describe, expect, it, vi } from 'vitest'
import type { ApiErrorInfo } from '../../shared/types'
import { cached } from './cache'
import { UiError } from './errors'
import {
  APP_POST_GONE_TEXT,
  APP_POSTS_SCOPE_TEXT,
  appPostsKey,
  channelLabel,
  DELETE_LOST_TEXT,
  DELETE_NEVER_TEXT,
  deleteActions,
  describeAppPostError,
  invalidateAppPosts,
  judgeDelete,
  phaseAfterDelete
} from './appPosts'

/**
 * Milestone 7: deleting the posts made with the app. The wording of every refusal, the verdicts that decide what the dialog does, and the rule
 * that matters most: after a lost answer a delete is never offered again, only a refresh of the list.
 */
const err = (info: Partial<ApiErrorInfo> & Pick<ApiErrorInfo, 'kind' | 'code'>): UiError => new UiError({ message: 'backend text', ...info })
const http = (code: string, status: number): UiError => err({ kind: 'http', code, status })

describe('what the dialog does with an answer', () => {
  it.each([
    [err({ kind: 'timeout', code: 'timeout', mayHaveBeenSent: true }), 'lost'],
    [err({ kind: 'network', code: 'network_error', mayHaveBeenSent: true }), 'lost'],
    [http('bot_timeout', 504), 'lost'],
    [http('discord_error', 502), 'lost'],
    [http('internal_error', 500), 'lost'],
    [http('anything', 503), 'lost'],
    [err({ kind: 'invalid_response', code: 'invalid_response', mayHaveBeenSent: true }), 'lost'],
    [http('manage_server_required', 403), 'denied'],
    [http('message_not_found', 404), 'gone'],
    [http('not_an_app_post', 403), 'stale'],
    [http('channel_not_found', 404), 'stale'],
    [http('bot_cannot_read', 403), 'rejected'],
    [http('bot_cannot_delete', 403), 'rejected'],
    [http('forbidden', 403), 'rejected'],
    [http('invalid_channel', 400), 'rejected'],
    [err({ kind: 'rate_limited', code: 'rate_limited', status: 429, retryAfter: 30 }), 'rejected']
  ])('%#: %s', (error, type) => {
    expect(judgeDelete(error).type).toBe(type)
  })

  it('a delete that proves nothing was deleted may be tried again later; one that is lost, gone or out of date may not', () => {
    expect(phaseAfterDelete({ type: 'rejected' })).toBe('confirming')
    expect(phaseAfterDelete({ type: 'denied' })).toBe('confirming')
    expect(phaseAfterDelete({ type: 'lost' })).toBe('lost')
    expect(phaseAfterDelete({ type: 'gone' })).toBe('gone')
    expect(phaseAfterDelete({ type: 'stale' })).toBe('stale')
  })

  it('no replay: in every phase after a lost, gone or stale answer the only action is refresh, and while it runs nothing can be done', () => {
    expect(deleteActions('confirming')).toEqual(['cancel', 'delete'])
    expect(deleteActions('deleting')).toEqual([])
    for (const phase of ['lost', 'gone', 'stale'] as const) {
      expect(deleteActions(phase), phase).toEqual(['refresh'])
      expect(deleteActions(phase), phase).not.toContain('delete')
    }
  })
})

describe('the words for every refusal', () => {
  it.each(['bot_cannot_read', 'bot_cannot_delete', 'channel_not_found', 'not_an_app_post', 'message_not_found', 'forbidden', 'invalid_channel', 'invalid_message_id', 'manage_server_required'])('%s is explained, not echoed', (code) => {
    for (const action of ['list', 'delete'] as const) {
      const text = describeAppPostError(http(code, 403), action)
      expect(text, `${code} ${action}`).not.toBe('backend text')
      expect(text.length, `${code} ${action}`).toBeGreaterThan(25)
    }
  })

  it('a delete that was refused says that nothing was deleted', () => {
    for (const code of ['bot_cannot_delete', 'not_an_app_post', 'forbidden', 'invalid_channel']) expect(describeAppPostError(http(code, 403), 'delete'), code).toMatch(/nothing was deleted/i)
  })

  it('bot_cannot_read names both permissions the bot needs', () => {
    const text = describeAppPostError(http('bot_cannot_read', 403), 'list')
    expect(text).toContain('View Channel')
    expect(text).toContain('Read Message History')
  })

  it('message_not_found on a delete says the post is already gone', () => {
    expect(describeAppPostError(http('message_not_found', 404), 'delete')).toBe(APP_POST_GONE_TEXT)
    expect(APP_POST_GONE_TEXT).toMatch(/already gone/)
  })

  it('a rate limit says how long to wait, and for a delete that refused attempts count', () => {
    const limited = err({ kind: 'rate_limited', code: 'rate_limited', status: 429, retryAfter: 30 })
    expect(describeAppPostError(limited, 'delete')).toContain('30 seconds')
    expect(describeAppPostError(limited, 'delete')).toMatch(/10 deletes a minute/)
    expect(describeAppPostError(limited, 'delete')).toMatch(/Nothing was deleted/)
    expect(describeAppPostError(limited, 'list')).toContain('30 seconds')
    expect(describeAppPostError(err({ kind: 'rate_limited', code: 'rate_limited', status: 429 }), 'delete')).toMatch(/Wait a minute/)
  })

  it('a lost answer says the post may or may not be deleted and that nothing is sent again', () => {
    expect(DELETE_LOST_TEXT).toMatch(/may or may not be deleted/)
    expect(DELETE_LOST_TEXT).toMatch(/not sent again/)
  })

  it('says what the list covers and that a delete never touches a team, event or result', () => {
    expect(APP_POSTS_SCOPE_TEXT).toContain('Shows posts among the last 100 messages')
    expect(DELETE_NEVER_TEXT).toMatch(/never deletes the team, event or result itself/)
  })

  it('names a channel, or says "the channel" when its name is not known', () => {
    expect(channelLabel('announcements')).toBe('#announcements')
    expect(channelLabel('')).toBe('the channel')
  })
})

describe('the list is memory only and per channel', () => {
  it('has one key per server and channel, and invalidating one forgets only that one', async () => {
    const G = '555000000000000001'
    const A = '777000000000000001'
    const B = '7770000000000000010' // A is the start of B: invalidating A must not forget B
    expect(appPostsKey(G, A)).not.toBe(appPostsKey(G, B))
    expect(appPostsKey(G, A)).not.toBe(appPostsKey('555000000000000002', A))
    const loaders = new Map<string, ReturnType<typeof vi.fn<() => Promise<string>>>>()
    for (const key of [appPostsKey(G, A), appPostsKey(G, B)]) {
      const loader = vi.fn(async () => key)
      loaders.set(key, loader)
      await cached(key, loader, 60_000)
    }
    invalidateAppPosts(G, A)
    await cached(appPostsKey(G, A), loaders.get(appPostsKey(G, A))!, 60_000)
    await cached(appPostsKey(G, B), loaders.get(appPostsKey(G, B))!, 60_000)
    expect(loaders.get(appPostsKey(G, A))).toHaveBeenCalledTimes(2)
    expect(loaders.get(appPostsKey(G, B))).toHaveBeenCalledTimes(1)
  })
})
