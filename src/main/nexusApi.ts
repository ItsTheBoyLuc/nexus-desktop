import { DISCORD_CDN } from '../shared/csp'
import type { AnnouncementInput, AnnouncementResult, Channel, Game, Guild, UserInfo } from '../shared/types'
import { isValidSnowflake } from '../shared/validation'
import { ApiError } from './apiClient'
import type { ApiClient } from './apiClient'

/** Everything the UI can ask the backend for. Responses are validated, never trusted blindly. */
export interface NexusApi {
  me: () => Promise<UserInfo>
  guilds: () => Promise<Guild[]>
  games: (guildId: string) => Promise<Game[]>
  channels: (guildId: string) => Promise<Channel[]>
  postAnnouncement: (guildId: string, input: AnnouncementInput) => Promise<AnnouncementResult>
}

function invalid(what: string): ApiError {
  return new ApiError({
    kind: 'invalid_response',
    code: 'invalid_response',
    message: `The server sent an unexpected ${what} response. Please try again later.`,
    mayHaveBeenSent: true
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

/** Only Discord CDN images may be shown (the renderer CSP enforces the same). */
function cdnImage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === DISCORD_CDN ? url.href : null
  } catch {
    return null
  }
}

function list(json: unknown, key: string, what: string): unknown[] {
  if (!isRecord(json) || !Array.isArray(json[key])) throw invalid(what)
  return json[key] as unknown[]
}

export function createNexusApi(client: ApiClient): NexusApi {
  const guildPath = (guildId: string, suffix: string): string => {
    if (!isValidSnowflake(guildId)) {
      throw new ApiError({ kind: 'validation', code: 'invalid_guild_id', message: 'That server ID is not valid.', mayHaveBeenSent: false })
    }
    return `/api/app/v1/guilds/${guildId}/${suffix}`
  }

  return {
    async me() {
      const json = await client.request({ path: '/api/app/v1/me' })
      if (!isRecord(json) || !isText(json['id'], 20) || !isText(json['username'], 100)) throw invalid('profile')
      return { id: json['id'], username: json['username'], avatar: cdnImage(json['avatar']) ?? '' }
    },

    async guilds() {
      const items = list(await client.request({ path: '/api/app/v1/guilds' }), 'guilds', 'server list')
      return items.flatMap((item): Guild[] => {
        if (!isRecord(item) || !isValidSnowflake(item['id']) || !isText(item['name'], 100)) return []
        return [{ id: item['id'], name: item['name'], icon: cdnImage(item['icon']) }]
      })
    },

    async games(guildId) {
      const items = list(await client.request({ path: guildPath(guildId, 'games') }), 'games', 'game list')
      return items.flatMap((item): Game[] => {
        if (!isRecord(item) || !isText(item['key'], 32) || !isText(item['label'], 100) || typeof item['enabled'] !== 'boolean') return []
        return [{ key: item['key'], label: item['label'], enabled: item['enabled'] }]
      })
    },

    async channels(guildId) {
      const items = list(await client.request({ path: guildPath(guildId, 'channels') }), 'channels', 'channel list')
      return items.flatMap((item): Channel[] => {
        if (!isRecord(item) || !isValidSnowflake(item['id']) || !isText(item['name'], 100)) return []
        return [{ id: item['id'], name: item['name'] }]
      })
    },

    async postAnnouncement(guildId, input) {
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'announcement'),
        body: {
          title: input.title,
          message: input.message,
          channel_id: input.channelId,
          ...(input.imageUrl ? { image_url: input.imageUrl } : {})
        }
      })
      if (!isRecord(json) || !isValidSnowflake(json['message_id']) || !isValidSnowflake(json['channel_id'])) throw invalid('announcement')
      return { messageId: json['message_id'], channelId: json['channel_id'] }
    }
  }
}
