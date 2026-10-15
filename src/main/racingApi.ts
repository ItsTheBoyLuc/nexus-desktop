import { isMessageId } from '../shared/attendanceValidation'
import { isCardId, parsePingRoleIds, parsePostTarget } from '../shared/pingRoles'
import { isRacingGame, RACING_LIMITS } from '../shared/racingValidation'
import { TEXT_LIMITS, utf16Units } from '../shared/textLimits'
import type {
  CardOutcome,
  CardPostResult,
  PingedRole,
  RacingAnnouncementInput,
  RacingAnnouncementResult,
  RacingAttendanceInput,
  RacingAttendancePage,
  RacingAttendancePost,
  RacingAttendanceResult,
  RacingAttendanceSummary,
  RacingAttendeeRow,
  RacingDriverProfile,
  RacingEvent,
  RacingEventInput,
  RacingEventPostInput,
  RacingEventPage,
  RacingGame,
  RacingResult,
  RacingResultInput,
  RacingResultPage,
  RacingResultPostInput,
  RacingResultQuery,
  RacingMembership,
  RacingTeam,
  RacingTeamDetail,
  RacingTeamEditInput,
  RacingTeamEditResult,
  RacingTeamInput,
  RacingTeamPostInput,
  RacingTeamRole,
  RosterAddInput,
  RosterAddResult,
  RosterEntry,
  RosterRemoveResult,
  WithCard
} from '../shared/types'
import { isValidHexColor, isValidImageUrl, isValidSnowflake, singleLineProblem } from '../shared/validation'
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
  /**
   * Creates the team and its Discord role. With `channelId` (M6) its card is posted too: the answer then has `card` (posted, or failed: the team
   * IS saved). Never replayed.
   */
  createRacingTeam: (guildId: string, game: RacingGame, input: RacingTeamInput) => Promise<WithCard<RacingTeamDetail>>
  /**
   * Renames a team and / or changes its class (M7, `PATCH …/teams`). Only the fields in `input` are sent; nothing to change is refused here
   * (`no_changes`) without a request. Never replayed: a lost answer may already have renamed the team's Discord role and its results.
   */
  editRacingTeam: (guildId: string, game: RacingGame, input: RacingTeamEditInput) => Promise<RacingTeamEditResult>
  addRosterMember: (guildId: string, game: RacingGame, input: RosterAddInput) => Promise<RosterAddResult>
  removeRosterMember: (guildId: string, game: RacingGame, team: string, userId: string) => Promise<RosterRemoveResult>
  racingDriver: (guildId: string, game: RacingGame, userId: string) => Promise<RacingDriverProfile>
  racingEvents: (guildId: string, game: RacingGame, page?: { limit?: number; offset?: number }) => Promise<RacingEventPage>
  addRacingEvent: (guildId: string, game: RacingGame, input: RacingEventInput) => Promise<WithCard<RacingEvent>>
  /** The append-only results archive, oldest first, paged exactly as the server pages it. `team` narrows it to one team (the team stats). */
  racingResults: (guildId: string, game: RacingGame, query?: RacingResultQuery) => Promise<RacingResultPage>
  /** Appends one entry. Never replayed: logging the same result twice creates two entries. */
  logRacingResult: (guildId: string, game: RacingGame, input: RacingResultInput) => Promise<WithCard<RacingResult>>
  /** Attendance posts of the game, newest first, paged as the server pages them. */
  racingAttendance: (guildId: string, game: RacingGame, page?: { limit?: number; offset?: number }) => Promise<RacingAttendancePage>
  /** One post with the names of the drivers who pressed Available and Not Available (read-only: drivers set their own status in Discord). */
  racingAttendancePost: (guildId: string, game: RacingGame, messageId: string) => Promise<RacingAttendancePost>
  /** Posts the card of an EXISTING team (M6, part 2). Changes no stored data. Never replayed: a lost answer may already have posted the card and pinged people. */
  postRacingTeam: (guildId: string, game: RacingGame, input: RacingTeamPostInput) => Promise<CardPostResult>
  /** Posts the card of an EXISTING event, by its id. Never replayed. */
  postRacingEvent: (guildId: string, game: RacingGame, input: RacingEventPostInput) => Promise<CardPostResult>
  /** Posts the card of an EXISTING archived result, by its id. Never replayed. */
  postRacingResult: (guildId: string, game: RacingGame, input: RacingResultPostInput) => Promise<CardPostResult>
  /** The Discord role of every team of this game (M6): the quick pick for the roles to ping. A team whose role was deleted is not listed. */
  racingTeamRoles: (guildId: string, game: RacingGame) => Promise<RacingTeamRole[]>
  /**
   * Posts the embed with its buttons in Discord, optionally pinging up to 3 roles (M6). Never replayed: a lost answer may already have
   * posted the message and pinged people.
   */
  createRacingAttendance: (guildId: string, game: RacingGame, input: RacingAttendanceInput) => Promise<RacingAttendanceResult>
  /** Posts an announcement embed of this game in a channel, optionally pinging up to 3 roles (M6). Never replayed: a lost answer may already have posted the message and pinged people. */
  postRacingAnnouncement: (guildId: string, game: RacingGame, input: RacingAnnouncementInput) => Promise<RacingAnnouncementResult>
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
    notes: str(json['notes'], utf16Units(TEXT_LIMITS.eventNotes)),
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
    notes: str(json['notes'], utf16Units(TEXT_LIMITS.resultNotes)),
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
    description: str(json['description'], utf16Units(TEXT_LIMITS.racingAttendanceDescription)),
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

/**
 * `pinged_roles` of a post answer: the roles the server really pinged. Malformed entries are dropped rather than failing a post that
 * already happened; the screens compare it with what was asked for.
 */
function parsePingedRoles(value: unknown): PingedRole[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 10).flatMap((item): PingedRole[] => (isRecord(item) && isValidSnowflake(item['id']) ? [{ id: item['id'], name: str(item['name'], 100) }] : []))
}

/**
 * What a create says about its card: exactly one of `post` / `post_error` is there when a channel was sent. `post_error` means the item was
 * saved and only the post failed. When the server says neither, the outcome is `unknown`: nobody can tell whether the card is in Discord.
 */
function parseCardOutcome(json: Record<string, unknown>): CardOutcome {
  const post = json['post']
  if (isRecord(post) && isValidSnowflake(post['channel_id']) && isValidSnowflake(post['message_id'])) {
    return { status: 'posted', post: { channelId: post['channel_id'], messageId: post['message_id'], pingedRoles: parsePingedRoles(post['pinged_roles']) } }
  }
  const failed = json['post_error']
  if (isRecord(failed)) return { status: 'failed', error: { code: str(failed['error'], 60) || 'discord_error', message: str(failed['message'], 300) } }
  return { status: 'unknown' }
}

/** The answer of a dedicated post endpoint: the message and channel are required (the link is built from them), the roles are what the server says it pinged. */
function parseCardPostResult(json: unknown): CardPostResult {
  if (!isRecord(json) || json['ok'] !== true || !isValidSnowflake(json['message_id']) || !isValidSnowflake(json['channel_id'])) throw invalid('card post')
  return { messageId: json['message_id'], channelId: json['channel_id'], pingedRoles: parsePingedRoles(json['pinged_roles']) }
}

function parseTeamRole(json: unknown): RacingTeamRole {
  if (!isRecord(json) || !isValidSnowflake(json['role_id'])) throw invalid('team roles')
  return { roleId: json['role_id'], name: str(json['name'], 100), team: str(json['team'], 100), mentionable: json['mentionable'] === true }
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
  /**
   * `ping_role_ids` of a post, checked before any request: only numeric ids (so "@everyone", "@here" and mention text can never be sent),
   * at most 3 distinct roles, and never the server's own id (that is the @everyone role). No roles: the field is left out, which is exactly
   * the request of before M6.
   */
  const pingBody = (guildId: string, roleIds: readonly string[] | undefined): { ping_role_ids?: string[] } => {
    const parsed = parsePingRoleIds(roleIds, guildId)
    if (!parsed.ok) throw clientError(parsed.problem.code, parsed.problem.message)
    return parsed.value.length > 0 ? { ping_role_ids: parsed.value } : {}
  }
  /**
   * The optional card of a create: `channel_id` + `ping_role_ids`, checked before any request with the rules of the posts. No channel: the request is
   * exactly the one of before M6 (roles without a channel are refused here, like the server does, never dropped).
   */
  const cardFields = (guildId: string, input: { channelId?: string | undefined; pingRoleIds?: readonly string[] | undefined }): { fields: { channel_id?: string; ping_role_ids?: string[] }; posting: boolean } => {
    const target = parsePostTarget(input.channelId, input.pingRoleIds, guildId)
    if (!target.ok) throw clientError(target.problem.code, target.problem.message)
    if (target.value === null) return { fields: {}, posting: false }
    return { fields: { channel_id: target.value.channelId, ...(target.value.pingRoleIds.length > 0 ? { ping_role_ids: target.value.pingRoleIds } : {}) }, posting: true }
  }
  /** The body of a dedicated post: the channel is required. */
  const requiredCard = (guildId: string, input: { channelId: string; pingRoleIds?: readonly string[] | undefined }): { channel_id: string; ping_role_ids?: string[] } => {
    const { fields } = cardFields(guildId, input)
    if (fields.channel_id === undefined) throw clientError('invalid_channel', 'Choose a channel to post in.')
    return { channel_id: fields.channel_id, ...(fields.ping_role_ids ? { ping_role_ids: fields.ping_role_ids } : {}) }
  }
  const cardId = (value: string, code: 'invalid_event_id' | 'invalid_result_id'): string => {
    if (!isCardId(value)) throw clientError(code, code === 'invalid_event_id' ? 'That event cannot be posted: it has no usable id.' : 'That result cannot be posted: it has no usable id.')
    return value
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
      const card = cardFields(guildId, input)
      // One attempt, never replayed: a lost answer may already have created the team's Discord role (and posted its card).
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'teams'),
        body: { name: teamName(input.name), color: input.color, ...(input.focus !== undefined && input.focus !== '' ? { focus: input.focus } : {}), ...card.fields }
      })
      if (!isRecord(json)) throw invalid('team')
      const team = parseTeamDetail(json['team'])
      return card.posting ? { ...team, card: parseCardOutcome(json) } : team
    },

    async editRacingTeam(guildId, game, input) {
      const body: { team: string; new_name?: string; focus?: string | null } = { team: teamName(input.team) }
      if (input.newName !== undefined) body.new_name = teamName(input.newName)
      if (input.focus !== undefined) {
        // null and empty text both clear the class (the server takes null); the key is only sent when the caller asked for a change.
        const focus = (input.focus ?? '').trim()
        const problem = focus === '' ? null : singleLineProblem(focus, 1, RACING_LIMITS.focusMax, 'a class or category')
        if (problem) throw clientError('invalid_focus', problem)
        body.focus = focus === '' ? null : focus
      }
      if (body.new_name === undefined && body.focus === undefined) throw clientError('no_changes', 'Change the name or the class first: there is nothing to save.')
      // One attempt, never replayed: a lost answer may already have renamed the team's Discord role and the team name of its results.
      const json = await client.request({ method: 'PATCH', path: racingPath(guildId, game, 'teams'), body })
      if (!isRecord(json) || typeof json['role_updated'] !== 'boolean') throw invalid('team')
      return { team: parseTeamDetail(json['team']), roleUpdated: json['role_updated'] }
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
      const card = cardFields(guildId, input)
      // One attempt, never replayed: a lost answer may well have stored the event (and posted its card), and the server keeps it forever.
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'events'),
        body: {
          name: input.name,
          date: input.date,
          time: input.time,
          ...(input.class !== undefined && input.class !== '' ? { class: input.class } : {}),
          ...(input.notes !== undefined && input.notes !== '' ? { notes: input.notes } : {}),
          ...card.fields
        }
      })
      if (!isRecord(json)) throw invalid('event')
      const event = parseEvent(json['event'])
      return card.posting ? { ...event, card: parseCardOutcome(json) } : event
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
      const card = cardFields(guildId, input)
      // One attempt, never replayed: a lost answer may well have appended the entry (and posted its card), and the archive has no delete.
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'results'),
        body: {
          team: teamName(input.team),
          event_name: input.eventName,
          result: input.result,
          drivers: input.drivers,
          ...(input.notes !== undefined && input.notes !== '' ? { notes: input.notes } : {}),
          ...card.fields
        }
      })
      if (!isRecord(json)) throw invalid('result')
      const result = parseResult(json['result'])
      return card.posting ? { ...result, card: parseCardOutcome(json) } : result
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

    async postRacingTeam(guildId, game, input) {
      const path = racingPath(guildId, game, 'teams/post')
      const body = { team: teamName(input.team), ...requiredCard(guildId, input) }
      // One attempt, never replayed: a lost answer may already have posted the card and pinged people.
      return parseCardPostResult(await client.request({ method: 'POST', path, body }))
    },

    async postRacingEvent(guildId, game, input) {
      const path = racingPath(guildId, game, 'events/post')
      const body = { id: cardId(input.id, 'invalid_event_id'), ...requiredCard(guildId, input) }
      return parseCardPostResult(await client.request({ method: 'POST', path, body }))
    },

    async postRacingResult(guildId, game, input) {
      const path = racingPath(guildId, game, 'results/post')
      const body = { id: cardId(input.id, 'invalid_result_id'), ...requiredCard(guildId, input) }
      return parseCardPostResult(await client.request({ method: 'POST', path, body }))
    },

    async racingTeamRoles(guildId, game) {
      return list(await client.request({ path: racingPath(guildId, game, 'team-roles') }), 'roles', 'team roles').map(parseTeamRole)
    },

    async createRacingAttendance(guildId, game, input) {
      if (!isValidSnowflake(input.channelId)) throw clientError('invalid_channel', 'That channel is not valid.')
      const pings = pingBody(guildId, input.pingRoleIds)
      // One attempt, never replayed: a lost answer may already have posted the message in Discord, and may already have pinged people.
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'attendance'),
        body: {
          channel_id: input.channelId,
          name: input.name,
          date: input.date,
          ...(input.description !== undefined && input.description !== '' ? { description: input.description } : {}),
          ...pings
        }
      })
      if (!isRecord(json) || !isValidSnowflake(json['channel_id'])) throw invalid('attendance post')
      return { post: parseAttendancePost(json['post'], false), channelId: json['channel_id'], pingedRoles: parsePingedRoles(json['pinged_roles']) }
    },

    async postRacingAnnouncement(guildId, game, input) {
      if (!isValidSnowflake(input.channelId)) throw clientError('invalid_channel', 'That channel is not valid.')
      // The server only takes https (the command lets http through, the API does not): http is refused here, before any request.
      if (input.imageUrl !== undefined && input.imageUrl !== '' && !isValidImageUrl(input.imageUrl)) throw clientError('invalid_image_url', 'Use a full https:// image link without spaces (at most 500 characters).')
      const pings = pingBody(guildId, input.pingRoleIds)
      // One attempt, never replayed: a lost answer may already have posted the message in Discord, and may already have pinged people.
      const json = await client.request({
        method: 'POST',
        path: racingPath(guildId, game, 'announcement'),
        body: {
          channel_id: input.channelId,
          title: input.title,
          message: input.message,
          ...(input.imageUrl !== undefined && input.imageUrl !== '' ? { image_url: input.imageUrl } : {}),
          ...pings
        }
      })
      if (!isRecord(json) || json['ok'] !== true || !isValidSnowflake(json['message_id']) || !isValidSnowflake(json['channel_id'])) throw invalid('announcement')
      return { messageId: json['message_id'], channelId: json['channel_id'], pingedRoles: parsePingedRoles(json['pinged_roles']) }
    }
  }
}
