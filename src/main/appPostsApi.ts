import { isAppPostId } from '../shared/appPostInputs'
import type { AppPost, AppPostDeleteResult, AppPostList } from '../shared/types'
import { isValidSnowflake } from '../shared/validation'
import type { ApiClient } from './apiClient'
import { clientError, invalid, isRecord } from './apiParse'

/**
 * The posts the app made itself, read from Discord and deleted again (milestone 7, docs/APP_API.md "App posts").
 *
 * - Nothing is stored: the list is the answer of one call, and nothing here logs, caches or writes a title, a channel or a message id.
 * - The list is only what the server found among the LAST 100 messages of one channel (at most 25 posts). A row for another channel than the
 *   one asked for is dropped, so a row can never become a delete target somewhere else.
 * - The delete goes out exactly once. The ApiClient never replays a DELETE after a timeout or a lost answer: a second send could remove a
 *   post that was meanwhile posted again with the same text, and a lost answer is settled by reading the list again.
 * - The server checks that the message is an app post before it deletes anything (`403 not_an_app_post` otherwise): the app never decides it.
 */
export interface AppPostsApi {
  /** `GET /app-posts?channel_id=` — the app posts among the last 100 messages of the channel, newest first. */
  appPosts: (guildId: string, channelId: string) => Promise<AppPostList>
  /** `DELETE /app-posts/{channel_id}/{message_id}` — needs Manage Server or Administrator. Never replayed. Deletes the message only, never the team, event or result. */
  deleteAppPost: (guildId: string, channelId: string, messageId: string) => Promise<AppPostDeleteResult>
}

/** At most this many posts are shown, the number the server returns at most. */
const MAX_POSTS = 25

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

export function createAppPostsApi(client: ApiClient): AppPostsApi {
  const guildPath = (guildId: string, suffix: string): string => {
    if (!isValidSnowflake(guildId)) throw clientError('invalid_guild_id', 'That server ID is not valid.')
    return `/api/app/v1/guilds/${guildId}/${suffix}`
  }
  const channel = (value: string): string => {
    if (!isAppPostId(value)) throw clientError('invalid_channel', 'That channel is not valid.')
    return value
  }

  return {
    async appPosts(guildId, channelId) {
      const path = `${guildPath(guildId, 'app-posts')}?channel_id=${channel(channelId)}`
      const json = await client.request({ path })
      if (!isRecord(json) || json['channel_id'] !== channelId || !Array.isArray(json['posts'])) throw invalid('app posts')
      const posts = json['posts'].slice(0, MAX_POSTS).flatMap((item): AppPost[] => {
        if (!isRecord(item) || !isAppPostId(item['message_id']) || item['channel_id'] !== channelId) return []
        return [{ messageId: item['message_id'], channelId, title: text(item['title'], 100), postedAt: text(item['posted_at'], 40) }]
      })
      return { channelId, posts }
    },

    async deleteAppPost(guildId, channelId, messageId) {
      if (!isAppPostId(messageId)) throw clientError('invalid_message_id', 'That message ID is not valid.')
      // One attempt, never replayed.
      const json = await client.request({ method: 'DELETE', path: guildPath(guildId, `app-posts/${channel(channelId)}/${messageId}`) })
      if (!isRecord(json) || json['deleted'] !== true) throw invalid('app post delete')
      return { deleted: true }
    }
  }
}
