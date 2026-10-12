import type {
  AnnouncementInput,
  AnnouncementResult,
  Channel,
  ChecklistItem,
  Game,
  GameCreateInput,
  Guild,
  LeagueGame,
  LeagueGames,
  NextEvent,
  Overview,
  OverviewCounts,
  PanelInput,
  PanelResult,
  Role,
  SeasonSource,
  ServerSettings,
  ServerSettingsInput,
  Tier,
  TierCreateInput,
  TierUpdateInput,
  UserInfo
} from '../shared/types'
import { isValidHexColor, isValidKey, isValidSnowflake } from '../shared/validation'
import type { ApiClient } from './apiClient'
import { cdnImage, clientError, invalid, isCount, isRecord, isText, list } from './apiParse'
import { createAttendanceApi } from './attendanceApi'
import type { AttendanceApi } from './attendanceApi'
import { createF1Api } from './f1Api'
import { createRacingApi } from './racingApi'
import type { RacingApi } from './racingApi'
import type { F1Api } from './f1Api'
import { createStewardApi } from './f1StewardApi'
import type { StewardApi } from './f1StewardApi'

/**
 * Everything the UI can ask the backend for. Responses are validated, never trusted blindly.
 * Paths, methods, bodies and response shapes follow docs/APP_API.md and nothing else.
 */
export interface NexusApi extends F1Api, StewardApi, AttendanceApi, RacingApi {
  me: () => Promise<UserInfo>
  guilds: () => Promise<Guild[]>
  games: (guildId: string) => Promise<Game[]>
  channels: (guildId: string) => Promise<Channel[]>
  roles: (guildId: string) => Promise<Role[]>
  postAnnouncement: (guildId: string, input: AnnouncementInput) => Promise<AnnouncementResult>

  overview: (guildId: string) => Promise<Overview>
  serverSettings: (guildId: string) => Promise<ServerSettings>
  saveServerSettings: (guildId: string, input: ServerSettingsInput) => Promise<ServerSettings>

  leagueGames: (guildId: string) => Promise<LeagueGames>
  createGame: (guildId: string, input: GameCreateInput) => Promise<LeagueGame>
  setGameActive: (guildId: string, gameKey: string, active: boolean) => Promise<LeagueGame>
  deleteGame: (guildId: string, gameKey: string) => Promise<void>
  createTier: (guildId: string, gameKey: string, input: TierCreateInput) => Promise<Tier>
  updateTier: (guildId: string, gameKey: string, tierKey: string, input: TierUpdateInput) => Promise<Tier>
  deleteTier: (guildId: string, gameKey: string, tierKey: string) => Promise<void>
  postPanel: (guildId: string, gameKey: string, tierKey: string, input: PanelInput) => Promise<PanelResult>
}

// ── Parsers for the milestone-1 shapes ──────────────────────────────────────

function parseTier(key: string, json: unknown): Tier {
  if (!isRecord(json) || !isValidSnowflake(json['role_id']) || typeof json['signup_panel_posted'] !== 'boolean') throw invalid('tier')
  const channel = json['signup_channel_id']
  const points = json['points_system']
  const count = json['driver_count']
  const roleName = json['role_name']
  if (channel !== null && channel !== undefined && !isValidSnowflake(channel)) throw invalid('tier')
  if (points !== null && points !== undefined && typeof points !== 'string') throw invalid('tier')
  if (count !== null && count !== undefined && !isCount(count)) throw invalid('tier')
  if (roleName !== null && roleName !== undefined && typeof roleName !== 'string') throw invalid('tier')
  return {
    key,
    roleId: json['role_id'],
    signupPanelPosted: json['signup_panel_posted'],
    signupChannelId: typeof channel === 'string' ? channel : null,
    pointsSystem: typeof points === 'string' && points !== '' ? points.slice(0, 500) : null,
    driverCount: typeof count === 'number' ? count : null,
    roleName: typeof roleName === 'string' ? roleName.slice(0, 100) : null
  }
}

function parseGame(key: string, json: unknown): LeagueGame {
  if (!isRecord(json) || typeof json['label'] !== 'string' || typeof json['category'] !== 'string' || typeof json['active'] !== 'boolean') {
    throw invalid('game')
  }
  const tiers = json['tiers']
  if (tiers !== undefined && !isRecord(tiers)) throw invalid('game')
  return {
    key,
    label: json['label'].slice(0, 200),
    category: json['category'].slice(0, 200),
    active: json['active'],
    tiers: Object.entries(tiers ?? {}).map(([tierKey, value]) => parseTier(tierKey, value))
  }
}

/** `{ game_key, game }` as returned by POST/PATCH on a game. */
function parseGameEnvelope(json: unknown): LeagueGame {
  if (!isRecord(json) || !isValidKey(json['game_key'])) throw invalid('game')
  return parseGame(json['game_key'], json['game'])
}

function parseSettings(json: unknown): ServerSettings {
  if (!isRecord(json)) throw invalid('settings')
  const season = json['season_number']
  const source = json['season_source']
  const effective = json['effective_season']
  if (!isValidHexColor(json['embed_color']) || typeof json['footer_name'] !== 'string') throw invalid('settings')
  if (season !== null && !isCount(season)) throw invalid('settings')
  if (!isCount(effective)) throw invalid('settings')
  if (source !== 'penalty_settings' && source !== 'settings' && source !== 'default') throw invalid('settings')
  return {
    embedColor: json['embed_color'].toUpperCase(),
    footerName: json['footer_name'].slice(0, 200),
    seasonNumber: season,
    effectiveSeason: effective,
    seasonSource: source satisfies SeasonSource,
    canEdit: typeof json['can_edit'] === 'boolean' ? json['can_edit'] : null
  }
}

const COUNT_KEYS: Record<keyof OverviewCounts, string> = {
  games: 'games',
  activeGames: 'active_games',
  tiers: 'tiers',
  tiersWithPanel: 'tiers_with_panel',
  tierDrivers: 'tier_drivers',
  teams: 'teams',
  teamDrivers: 'team_drivers',
  calendarRounds: 'calendar_rounds',
  openSignups: 'open_signups',
  reports: 'reports',
  pendingReports: 'pending_reports'
}

function parseCounts(json: unknown): OverviewCounts {
  if (!isRecord(json)) throw invalid('overview')
  const counts = {} as Record<keyof OverviewCounts, number>
  for (const [name, apiName] of Object.entries(COUNT_KEYS) as [keyof OverviewCounts, string][]) {
    const value = json[apiName]
    if (!isCount(value)) throw invalid('overview')
    counts[name] = value
  }
  return counts
}

function parseNextEvent(json: unknown): NextEvent | null {
  if (json === null || json === undefined) return null
  if (!isRecord(json) || typeof json['name'] !== 'string' || typeof json['date'] !== 'string' || !isCount(json['countdown_hours'])) throw invalid('overview')
  const round = json['round']
  const flag = json['flag']
  const time = json['time']
  return {
    round: typeof round === 'number' || typeof round === 'string' ? round : null,
    name: json['name'].slice(0, 200),
    flag: typeof flag === 'string' && flag !== '' ? flag.slice(0, 16) : null,
    date: json['date'].slice(0, 100),
    time: typeof time === 'string' && time !== '' ? time.slice(0, 50) : null,
    eventType: typeof json['event_type'] === 'string' ? json['event_type'].slice(0, 100) : 'Normal Race',
    countdownHours: json['countdown_hours']
  }
}

function parseChecklist(json: unknown): ChecklistItem[] {
  if (!Array.isArray(json)) throw invalid('overview')
  return json.map((item): ChecklistItem => {
    if (!isRecord(item) || !isText(item['key'], 64) || !isText(item['label'], 200) || typeof item['done'] !== 'boolean') throw invalid('overview')
    const detail = item['detail']
    return { key: item['key'], label: item['label'], done: item['done'], detail: typeof detail === 'string' && detail !== '' ? detail.slice(0, 200) : null }
  })
}

export function createNexusApi(client: ApiClient): NexusApi {
  const guildPath = (guildId: string, suffix: string): string => {
    if (!isValidSnowflake(guildId)) throw clientError('invalid_guild_id', 'That server ID is not valid.')
    return `/api/app/v1/guilds/${guildId}/${suffix}`
  }
  const gamePath = (guildId: string, gameKey: string, suffix = ''): string => {
    if (!isValidKey(gameKey)) throw clientError('invalid_game_key', 'That game key is not valid.')
    return guildPath(guildId, `league/games/${gameKey}${suffix}`)
  }
  const tierPath = (guildId: string, gameKey: string, tierKey: string, suffix = ''): string => {
    if (!isValidKey(tierKey)) throw clientError('invalid_tier_key', 'That tier key is not valid.')
    return gamePath(guildId, gameKey, `/tiers/${tierKey}${suffix}`)
  }
  const parseTierEnvelope = (json: unknown): Tier => {
    if (!isRecord(json) || !isValidKey(json['tier_key'])) throw invalid('tier')
    return parseTier(json['tier_key'], json['tier'])
  }

  return {
    ...createF1Api(client),
    ...createStewardApi(client),
    ...createAttendanceApi(client),
    ...createRacingApi(client),

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

    async roles(guildId) {
      const items = list(await client.request({ path: guildPath(guildId, 'roles') }), 'roles', 'role list')
      return items.flatMap((item): Role[] => {
        if (!isRecord(item) || !isValidSnowflake(item['id']) || !isText(item['name'], 100)) return []
        const color = item['color']
        return [
          {
            id: item['id'],
            name: item['name'],
            color: isValidHexColor(color) ? color.toUpperCase() : null,
            position: typeof item['position'] === 'number' ? item['position'] : 0,
            managed: item['managed'] === true,
            assignable: item['assignable'] === true,
            privileged: item['privileged'] === true,
            // M6. Only `mentionable: true` counts as mentionable; a count that is missing or unreadable is "unknown", never 0.
            mentionable: item['mentionable'] === true,
            memberCount: isCount(item['member_count']) ? item['member_count'] : null,
            memberCountApproximate: item['member_count_approximate'] === true || !isCount(item['member_count'])
          }
        ]
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
    },

    async overview(guildId) {
      const json = await client.request({ path: guildPath(guildId, 'overview') })
      if (!isRecord(json) || !isCount(json['season']) || typeof json['setup_complete'] !== 'boolean') throw invalid('overview')
      const guild = isRecord(json['guild']) ? json['guild'] : {}
      return {
        memberCount: isCount(guild['member_count']) ? guild['member_count'] : null,
        season: json['season'],
        counts: parseCounts(json['counts']),
        nextEvent: parseNextEvent(json['next_event']),
        checklist: parseChecklist(json['checklist']),
        setupComplete: json['setup_complete'],
        memberCacheComplete: json['member_cache_complete'] !== false
      }
    },

    async serverSettings(guildId) {
      return parseSettings(await client.request({ path: guildPath(guildId, 'settings') }))
    },

    async saveServerSettings(guildId, input) {
      const body: Record<string, unknown> = {}
      if (input.embedColor !== undefined) body['embed_color'] = input.embedColor
      if (input.footerName !== undefined) body['footer_name'] = input.footerName
      if (input.seasonNumber !== undefined) body['season_number'] = input.seasonNumber
      return parseSettings(await client.request({ method: 'PUT', path: guildPath(guildId, 'settings'), body }))
    },

    async leagueGames(guildId) {
      const json = await client.request({ path: guildPath(guildId, 'league/games') })
      if (!isRecord(json) || !isRecord(json['games'])) throw invalid('game list')
      return {
        games: Object.entries(json['games']).map(([key, value]) => parseGame(key, value)),
        memberCacheComplete: json['member_cache_complete'] !== false
      }
    },

    async createGame(guildId, input) {
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'league/games'),
        body: { game_key: input.gameKey, label: input.label, category: input.category }
      })
      return parseGameEnvelope(json)
    },

    async setGameActive(guildId, gameKey, active) {
      return parseGameEnvelope(await client.request({ method: 'PATCH', path: gamePath(guildId, gameKey), body: { active } }))
    },

    async deleteGame(guildId, gameKey) {
      const json = await client.request({ method: 'DELETE', path: gamePath(guildId, gameKey) })
      if (!isRecord(json) || json['ok'] !== true) throw invalid('delete')
    },

    async createTier(guildId, gameKey, input) {
      const json = await client.request({
        method: 'POST',
        path: gamePath(guildId, gameKey, '/tiers'),
        body: {
          tier_key: input.tierKey,
          role_id: input.roleId,
          ...(input.pointsSystem ? { points_system: input.pointsSystem } : {})
        }
      })
      return parseTierEnvelope(json)
    },

    async updateTier(guildId, gameKey, tierKey, input) {
      const body: Record<string, unknown> = {}
      if (input.roleId !== undefined) body['role_id'] = input.roleId
      if (input.pointsSystem !== undefined) body['points_system'] = input.pointsSystem
      if (input.signupChannelId !== undefined) body['signup_channel_id'] = input.signupChannelId
      return parseTierEnvelope(await client.request({ method: 'PATCH', path: tierPath(guildId, gameKey, tierKey), body }))
    },

    async deleteTier(guildId, gameKey, tierKey) {
      const json = await client.request({ method: 'DELETE', path: tierPath(guildId, gameKey, tierKey) })
      if (!isRecord(json) || json['ok'] !== true) throw invalid('delete')
    },

    async postPanel(guildId, gameKey, tierKey, input) {
      const json = await client.request({
        method: 'POST',
        path: tierPath(guildId, gameKey, tierKey, '/post-panel'),
        body: { channel_id: input.channelId, ...(input.messageId !== undefined ? { message_id: input.messageId } : {}) }
      })
      if (!isRecord(json) || json['ok'] !== true || !isValidSnowflake(json['message_id']) || !isValidSnowflake(json['channel_id'])) throw invalid('panel')
      if (typeof json['refreshed'] !== 'boolean') throw invalid('panel')
      return {
        messageId: json['message_id'],
        channelId: json['channel_id'],
        refreshed: json['refreshed'],
        tier: parseTier(tierKey, json['tier'])
      }
    }
  }
}
