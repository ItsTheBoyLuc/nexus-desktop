import { isMessageId } from '../shared/attendanceValidation'
import { isRacingGame } from '../shared/racingValidation'
import type {
  AnnouncementInput,
  AnnouncementResult,
  RacingAttendanceInput,
  RacingAttendancePage,
  RacingAttendancePost,
  RacingAttendanceResult,
  RacingAttendanceSummary,
  RacingAttendeeRow,
  RacingDriverProfile,
  RacingEvent,
  RacingEventInput,
  RacingEventPage,
  RacingGame,
  RacingResult,
  RacingResultInput,
  RacingResultPage,
  RacingResultQuery,
  RacingMembership,
  RacingTeam,
  RacingTeamDetail,
  RacingTeamInput,
  RosterAddInput,
  RosterAddResult,
  RosterEntry,
  RosterRemoveResult
} from '../shared/types'
import { isValidHexColor, isValidImageUrl, isValidSnowflake } from '../shared/validation'
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
  /** The append-only results archive, oldest first, paged exactly as the server pages it. `team` narrows it to one team (the team stats). */
  racingResults: (guildId: string, game: RacingGame, query?: RacingResultQuery) => Promise<RacingResultPage>
  /** Appends one entry. Never replayed: logging the same result twice creates two entries. */
  logRacingResult: (guildId: string, game: RacingGame, input: RacingResultInput) => Promise<RacingResult>
  /** Attendance posts of the game, newest first, paged as the server pages them. */
  racingAttendance: (guildId: string, game: RacingGame, page?: { limit?: number; offset?: number }) => Promise<RacingAttendancePage>
  /** One post with the names of the drivers who pressed Available and Not Available (read-only: drivers set their own status in Discord). */
  racingAttendancePost: (guildId: string, game: RacingGame, messageId: string) => Promise<RacingAttendancePost>
  /** Posts the embed with its buttons in Discord. Never replayed: a lost answer may already have posted the message. */
  createRacingAttendance: (guildId: string, game: RacingGame, input: RacingAttendanceInput) => Promise<RacingAttendanceResult>
  /** Posts an announcement embed of this game in a channel. Never replayed: a lost answer may already have posted the message. */
  postRacingAnnouncement: (guildId: string, game: RacingGame, input: AnnouncementInput) => Promise<AnnouncementResult>
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

function parseResult(json: unknown): RacingResult {
  if (!isRecord(json) || typeof json['id'] !== 'string' || json['id'] === '') throw invalid('result')
  return {
    id: json['id'].slice(0, 64),
    eventName: str(json['event_name'], 200),
    teamName: str(json['team_name'], 100),
    result: str(json['result'], 200),
    drivers: str(json['drivers'], 400),
    notes: str(json['notes'], 1000),
    loggedBy: str(json['logged_by'], 40),
    loggedAt: str(json['logged_at'], 40)
  }
}

function parseAttendee(json: unknown): RacingAttendeeRow {
  if (!isRecord(json) || !isValidSnowflake(json['user_id'])) throw invalid('attendance')
  return { userId: json['user_id'], name: optionalText(json['name'], 100), inServer: json['in_server'] !== false }
}

function parseAttendees(value: unknown): RacingAttendeeRow[] {
  if (!Array.isArray(value)) throw invalid('attendance')
  return value.slice(0, 500).map(parseAttendee)
}

function parseAttendanceSummary(json: unknown): RacingAttendanceSummary {
  if (!isRecord(json) || !isMessageId(json['message_id']) || typeof json['name'] !== 'string') throw invalid('attendance post')
  const counts = isRecord(json['counts']) ? json['counts'] : {}
  return {
    messageId: json['message_id'],
    name: json['name'].slice(0, 200),
    date: str(json['date'], 60),
    description: str(json['description'], 1000),
    createdBy: str(json['created_by'], 40),
    createdAt: str(json['created_at'], 40),
    counts: { available: countOr(counts['available'], 0), unavailable: countOr(counts['unavailable'], 0) }
  }
}

/**
 * One post as the single read returns it: the fields of a list row plus `attendance`. The lists are the truth: when the answer has no
 * `counts` they are taken from the lists. `requireLists` is false only for the answer of creating a post (a new post has nobody yet).
 */
function parseAttendancePost(json: unknown, requireLists: boolean): RacingAttendancePost {
  const summary = parseAttendanceSummary(json)
  if (!isRecord(json)) throw invalid('attendance post')
  const raw = json['attendance']
  if (!isRecord(raw) && requireLists) throw invalid('attendance post')
  const lists = isRecord(raw) ? raw : {}
  const attendance = { available: lists['available'] === undefined && !requireLists ? [] : parseAttendees(lists['available']), unavailable: lists['unavailable'] === undefined && !requireLists ? [] : parseAttendees(lists['unavailable']) }
  const counts = isRecord(json['counts']) ? summary.counts : { available: attendance.available.length, unavailable: attendance.unavailable.length }
  return { ...summary, counts, attendance }
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
    },

    async racingResults(guildId, game, queryParams = {}) {
      const json = await client.request({ path: `${racingPath(guildId, game, 'results')}${query({ team: queryParams.team === undefined ? undefined : teamName(queryParams.team), limit: queryParams.limit, offset: queryParams.offset })}` })
      if (!isRecord(json) || !isCount(json['total'])) throw invalid('results')
      return {
        team: optionalText(json['team'], 100),
        total: json['total'],
        limit: countOr(json['limit'], 25),
        offset: countOr(json['offset'], 0),
        results: list(json, 'results', 'results').map(parseResult)
      }
    },

    async logRacingResult(guildId, game, input) {
      // One attempt, never replayed: a lost answer may well have appended the entry, and the archive has no delete.
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'results'),
        body: {
          team: teamName(input.team),
          event_name: input.eventName,
          result: input.result,
          drivers: input.drivers,
          ...(input.notes !== undefined && input.notes !== '' ? { notes: input.notes } : {})
        }
      })
      if (!isRecord(json)) throw invalid('result')
      return parseResult(json['result'])
    },

    async racingAttendance(guildId, game, page = {}) {
      const json = await client.request({ path: `${racingPath(guildId, game, 'attendance')}${query({ limit: page.limit, offset: page.offset })}` })
      if (!isRecord(json) || !isCount(json['total'])) throw invalid('attendance posts')
      return { total: json['total'], limit: countOr(json['limit'], 25), offset: countOr(json['offset'], 0), posts: list(json, 'posts', 'attendance posts').map(parseAttendanceSummary) }
    },

    async racingAttendancePost(guildId, game, messageId) {
      if (!isMessageId(messageId)) throw clientError('invalid_message_id', 'That post ID is not valid.')
      return parseAttendancePost(await client.request({ path: racingPath(guildId, game, `attendance/${messageId}`) }), true)
    },

    async createRacingAttendance(guildId, game, input) {
      if (!isValidSnowflake(input.channelId)) throw clientError('invalid_channel', 'That channel is not valid.')
      // One attempt, never replayed: a lost answer may already have posted the message in Discord.
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'attendance'),
        body: {
          channel_id: input.channelId,
          name: input.name,
          date: input.date,
          ...(input.description !== undefined && input.description !== '' ? { description: input.description } : {})
        }
      })
      if (!isRecord(json) || !isValidSnowflake(json['channel_id'])) throw invalid('attendance post')
      return { post: parseAttendancePost(json['post'], false), channelId: json['channel_id'] }
    },

    async postRacingAnnouncement(guildId, game, input) {
      if (!isValidSnowflake(input.channelId)) throw clientError('invalid_channel', 'That channel is not valid.')
      // The server only takes https (the command lets http through, the API does not): http is refused here, before any request.
      if (input.imageUrl !== undefined && input.imageUrl !== '' && !isValidImageUrl(input.imageUrl)) throw clientError('invalid_image_url', 'Use a full https:// image link without spaces (at most 500 characters).')
      // One attempt, never replayed: a lost answer may already have posted the message in Discord.
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'announcement'),
        body: {
          channel_id: input.channelId,
          title: input.title,
          message: input.message,
          ...(input.imageUrl !== undefined && input.imageUrl !== '' ? { image_url: input.imageUrl } : {})
        }
      })
      if (!isRecord(json) || json['ok'] !== true || !isValidSnowflake(json['message_id']) || !isValidSnowflake(json['channel_id'])) throw invalid('announcement')
      return { messageId: json['message_id'], channelId: json['channel_id'] }
    }
  }
}
