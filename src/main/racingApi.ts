import { isRacingGame } from '../shared/racingValidation'
import type {
  RacingDriverProfile,
  RacingEvent,
  RacingEventInput,
  RacingEventPage,
  RacingGame,
  RacingMembership,
  RacingTeam,
  RacingTeamDetail,
  RacingTeamInput,
  RosterAddInput,
  RosterAddResult,
  RosterEntry,
  RosterRemoveResult
} from '../shared/types'
import { isValidHexColor, isValidSnowflake } from '../shared/validation'
import type { ApiClient } from './apiClient'
import { clientError, invalid, isCount, isRecord, list } from './apiParse'

/**
 * The esports team endpoints of docs/APP_API.md (milestone 5): `/racing/{game}/...` for lmu, iracing, gt7, acc and f1.
 * Paths, methods, bodies and response shapes follow that document and nothing else; every response is validated before
 * the UI sees it.
 *
 * - The game is validated on EVERY call, before any request: an unknown game is refused with `unknown_game` (the same code
 *   the server uses), and the path always carries exactly the game that was passed, so a request for one game can never
 *   touch another game's data.
 * - Every write goes out exactly once. The ApiClient never replays a POST or DELETE after a timeout or a lost answer,
 *   which matters most for creating a team: a lost answer may already have created a Discord role.
 * - Nothing here logs, stores or caches a response: roster and member data only ever live in the objects it returns.
 */
export interface RacingApi {
  racingTeams: (guildId: string, game: RacingGame) => Promise<RacingTeam[]>
  racingTeam: (guildId: string, game: RacingGame, name: string) => Promise<RacingTeamDetail>
  createRacingTeam: (guildId: string, game: RacingGame, input: RacingTeamInput) => Promise<RacingTeamDetail>
  addRosterMember: (guildId: string, game: RacingGame, input: RosterAddInput) => Promise<RosterAddResult>
  removeRosterMember: (guildId: string, game: RacingGame, team: string, userId: string) => Promise<RosterRemoveResult>
  racingDriver: (guildId: string, game: RacingGame, userId: string) => Promise<RacingDriverProfile>
  racingEvents: (guildId: string, game: RacingGame, page?: { limit?: number; offset?: number }) => Promise<RacingEventPage>
  addRacingEvent: (guildId: string, game: RacingGame, input: RacingEventInput) => Promise<RacingEvent>
}

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value).slice(0, max) : '')
const optionalText = (value: unknown, max: number): string | null => (typeof value === 'string' && value !== '' ? value.slice(0, max) : null)
const optionalId = (value: unknown): string | null => (isValidSnowflake(value) ? value : null)
const countOr = (value: unknown, fallback: number): number => (isCount(value) ? value : fallback)

function parseTeam(json: unknown): RacingTeam {
  if (!isRecord(json) || typeof json['name'] !== 'string' || json['name'] === '') throw invalid('team')
  const color = json['color']
  return {
    name: json['name'].slice(0, 100),
    color: isValidHexColor(color) ? color.toUpperCase() : null,
    focus: str(json['focus'], 60),
    roleId: optionalId(json['role_id']),
    roleName: optionalText(json['role_name'], 100),
    roleExists: json['role_exists'] !== false,
    memberCount: countOr(json['member_count'], 0),
    createdBy: str(json['created_by'], 40),
    createdAt: str(json['created_at'], 40)
  }
}

function parseRosterEntry(json: unknown): RosterEntry {
  if (!isRecord(json) || !isValidSnowflake(json['user_id'])) throw invalid('roster')
  const username = str(json['username'], 100)
  const inServer = json['in_server'] !== false
  return {
    userId: json['user_id'],
    username,
    displayName: str(json['display_name'], 100) || username,
    // The roster row that add returns has no current name; the roster of a team has one (null once the member left).
    currentName: inServer ? optionalText(json['current_name'], 100) : null,
    inServer,
    role: str(json['role'], 60),
    joinedAt: str(json['joined_at'], 40)
  }
}

function parseTeamDetail(json: unknown): RacingTeamDetail {
  if (!isRecord(json) || !Array.isArray(json['roster'])) throw invalid('team')
  return { ...parseTeam(json), roster: json['roster'].slice(0, 500).map(parseRosterEntry) }
}

function parseEvent(json: unknown): RacingEvent {
  if (!isRecord(json) || typeof json['id'] !== 'string' || typeof json['name'] !== 'string') throw invalid('event')
  const iso = json['date_iso']
  return {
    id: json['id'].slice(0, 64),
    name: json['name'].slice(0, 200),
    date: str(json['date'], 60),
    time: str(json['time'], 60),
    class: str(json['class'], 60),
    notes: str(json['notes'], 1000),
    dateIso: typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null,
    createdBy: str(json['created_by'], 40),
    createdAt: str(json['created_at'], 40)
  }
}

export function createRacingApi(client: ApiClient): RacingApi {
  const racingPath = (guildId: string, game: RacingGame, suffix: string): string => {
    if (!isValidSnowflake(guildId)) throw clientError('invalid_guild_id', 'That server ID is not valid.')
    // The server answers 404 unknown_game; the app never even asks.
    if (!isRacingGame(game)) throw clientError('unknown_game', 'That game has no esports team module.')
    return `/api/app/v1/guilds/${guildId}/racing/${game}/${suffix}`
  }
  const query = (params: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
    const text = search.toString()
    return text === '' ? '' : `?${text}`
  }
  const teamName = (name: string): string => {
    const trimmed = name.trim()
    if (trimmed === '' || [...trimmed].length > 50) throw clientError('invalid_name', 'Enter a team name of 1 to 50 characters.')
    return trimmed
  }
  const userId = (value: string): string => {
    if (!isValidSnowflake(value)) throw clientError('invalid_user_id', 'That member ID is not valid.')
    return value
  }

  return {
    async racingTeams(guildId, game) {
      return list(await client.request({ path: racingPath(guildId, game, 'teams') }), 'teams', 'team list').map(parseTeam)
    },

    async racingTeam(guildId, game, name) {
      const json = await client.request({ path: `${racingPath(guildId, game, 'team')}${query({ name: teamName(name) })}` })
      if (!isRecord(json)) throw invalid('team')
      return parseTeamDetail(json['team'])
    },

    async createRacingTeam(guildId, game, input) {
      // One attempt, never replayed: a lost answer may already have created the team's Discord role.
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'teams'),
        body: { name: teamName(input.name), color: input.color, ...(input.focus !== undefined && input.focus !== '' ? { focus: input.focus } : {}) }
      })
      if (!isRecord(json)) throw invalid('team')
      return parseTeamDetail(json['team'])
    },

    async addRosterMember(guildId, game, input) {
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'roster'),
        body: { team: teamName(input.team), user_id: userId(input.userId), role: input.role }
      })
      if (!isRecord(json) || typeof json['role_assigned'] !== 'boolean') throw invalid('roster')
      return { entry: parseRosterEntry(json['entry']), roleAssigned: json['role_assigned'] }
    },

    async removeRosterMember(guildId, game, team, memberId) {
      const json = await client.request({ method: 'DELETE', path: `${racingPath(guildId, game, 'roster')}${query({ team: teamName(team), user_id: userId(memberId) })}` })
      if (!isRecord(json) || json['ok'] !== true || typeof json['role_removed'] !== 'boolean') throw invalid('roster')
      return { removed: parseRosterEntry(json['removed']), roleRemoved: json['role_removed'], roleError: optionalText(json['role_error'], 64) }
    },

    async racingDriver(guildId, game, memberId) {
      const json = await client.request({ path: racingPath(guildId, game, `drivers/${userId(memberId)}`) })
      if (!isRecord(json) || !isValidSnowflake(json['user_id'])) throw invalid('driver profile')
      const memberships = list(json, 'memberships', 'driver profile').map((item): RacingMembership => {
        if (!isRecord(item) || typeof item['team'] !== 'string') throw invalid('driver profile')
        return { team: item['team'].slice(0, 100), role: str(item['role'], 60), joinedAt: str(item['joined_at'], 40), joined: str(item['joined'], 20) }
      })
      return { userId: json['user_id'], displayName: optionalText(json['display_name'], 100), inServer: json['in_server'] !== false, memberships }
    },

    async racingEvents(guildId, game, page = {}) {
      const json = await client.request({ path: `${racingPath(guildId, game, 'events')}${query({ limit: page.limit, offset: page.offset })}` })
      if (!isRecord(json) || !isCount(json['total'])) throw invalid('event list')
      return { total: json['total'], limit: countOr(json['limit'], 25), offset: countOr(json['offset'], 0), events: list(json, 'events', 'event list').map(parseEvent) }
    },

    async addRacingEvent(guildId, game, input) {
      // One attempt, never replayed: a lost answer may well have stored the event, and the server keeps it forever.
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'events'),
        body: {
          name: input.name,
          date: input.date,
          time: input.time,
          ...(input.class !== undefined && input.class !== '' ? { class: input.class } : {}),
          ...(input.notes !== undefined && input.notes !== '' ? { notes: input.notes } : {})
        }
      })
      if (!isRecord(json)) throw invalid('event')
      return parseEvent(json['event'])
    }
  }
}
