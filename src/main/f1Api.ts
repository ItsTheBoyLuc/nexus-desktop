import { isValidHexColor, isValidSnowflake } from '../shared/validation'
import type {
  AddDriverInput,
  AddDriverResult,
  Calendar,
  CalendarPostInput,
  CalendarPostResult,
  CalendarRound,
  DriverStats,
  Member,
  MemberSearch,
  NextRace,
  PointsSystem,
  PointsSystemInput,
  RaceOutcome,
  RemoveDriverResult,
  ResultLine,
  ResultsInput,
  RoundInput,
  RoundPatch,
  RoundResult,
  ServerLedgerEntry,
  Standings,
  StandingsDriver,
  StandingsTeam,
  Team,
  TeamDriver,
  TeamInput
} from '../shared/types'
import type { ApiClient } from './apiClient'
import { cdnImage, clientError, invalid, isCount, isRecord, isText, list } from './apiParse'

/**
 * The F1 league endpoints of docs/APP_API.md (milestone 2): calendar, teams and drivers, standings, race
 * results and the points system. Paths, methods, bodies and response shapes follow that document and
 * nothing else; every response is validated before the UI sees it.
 */
export interface F1Api {
  members: (guildId: string, query: string) => Promise<MemberSearch>

  calendar: (guildId: string) => Promise<Calendar>
  createRound: (guildId: string, input: RoundInput) => Promise<RoundResult>
  updateRound: (guildId: string, round: number, patch: RoundPatch) => Promise<RoundResult>
  deleteRound: (guildId: string, round: number) => Promise<Calendar>
  postCalendar: (guildId: string, input: CalendarPostInput) => Promise<CalendarPostResult>
  nextRace: (guildId: string) => Promise<NextRace>

  teams: (guildId: string) => Promise<Team[]>
  createTeam: (guildId: string, input: TeamInput) => Promise<Team>
  addDriver: (guildId: string, teamName: string, input: AddDriverInput) => Promise<AddDriverResult>
  removeDriver: (guildId: string, teamName: string, userId: string) => Promise<RemoveDriverResult>
  driver: (guildId: string, userId: string) => Promise<DriverStats>

  standings: (guildId: string) => Promise<Standings>
  recordResults: (guildId: string, input: ResultsInput) => Promise<RaceOutcome>
  /** The races recorded through the app, newest first (the server's duplicate ledger). */
  resultsLedger: (guildId: string, query?: { season?: string; round?: string }) => Promise<ServerLedgerEntry[]>
  pointsSystem: (guildId: string) => Promise<PointsSystem>
  savePointsSystem: (guildId: string, input: PointsSystemInput) => Promise<PointsSystem>
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 1_000_000_000
const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')
const optionalText = (value: unknown, max: number): string | null => (typeof value === 'string' && value !== '' ? value.slice(0, max) : null)
const optionalId = (value: unknown): string | null => (isValidSnowflake(value) ? value : null)

// ── Parsers ─────────────────────────────────────────────────────────────────

function parseRound(json: unknown, what = 'calendar'): CalendarRound {
  if (!isRecord(json) || !isInt(json['round']) || json['round'] < 1 || !isText(json['name'], 500) || typeof json['date'] !== 'string') throw invalid(what)
  return {
    round: json['round'],
    name: json['name'].slice(0, 200),
    date: json['date'].slice(0, 50),
    time: str(json['time'], 20),
    flag: str(json['flag'], 32),
    eventType: typeof json['event_type'] === 'string' && json['event_type'] !== '' ? json['event_type'].slice(0, 100) : 'Normal Race'
  }
}

function parseCalendar(json: unknown): Calendar {
  if (!isRecord(json) || !Array.isArray(json['rounds'])) throw invalid('calendar')
  return {
    name: str(json['name'], 200),
    setupInProgress: json['setup_in_progress'] === true,
    rounds: json['rounds'].map((round) => parseRound(round))
  }
}

function parseTeamDriver(json: unknown): TeamDriver {
  if (!isRecord(json) || !isValidSnowflake(json['user_id']) || !isInt(json['points']) || !isInt(json['wins']) || !isInt(json['podiums'])) throw invalid('team')
  const username = str(json['username'], 100)
  const number = json['number']
  return {
    userId: json['user_id'],
    username,
    displayName: str(json['display_name'], 100) || username,
    number: isInt(number) && number >= 0 ? number : null,
    points: json['points'],
    wins: json['wins'],
    podiums: json['podiums']
  }
}

function parseTeam(json: unknown): Team {
  if (!isRecord(json) || !isText(json['name'], 500) || !isInt(json['points']) || !Array.isArray(json['drivers'])) throw invalid('team')
  const color = json['color']
  return {
    name: json['name'].slice(0, 100),
    abbreviation: str(json['abbreviation'], 20),
    color: isValidHexColor(color) ? color.toUpperCase() : null,
    roleId: optionalId(json['role_id']),
    roleName: optionalText(json['role_name'], 100),
    channelId: optionalId(json['channel_id']),
    channelName: optionalText(json['channel_name'], 100),
    points: json['points'],
    drivers: json['drivers'].map(parseTeamDriver)
  }
}

/** `{ team: <team> }` as returned by the single-team writes. */
function parseTeamEnvelope(json: unknown): Team {
  if (!isRecord(json)) throw invalid('team')
  return parseTeam(json['team'])
}

function parseStandings(json: unknown): Standings {
  if (!isRecord(json) || !Array.isArray(json['drivers']) || !Array.isArray(json['constructors'])) throw invalid('standings')
  const drivers = json['drivers'].map((row): StandingsDriver => {
    if (!isRecord(row) || !isInt(row['position']) || !isValidSnowflake(row['user_id']) || !isInt(row['points'])) throw invalid('standings')
    return {
      position: row['position'],
      userId: row['user_id'],
      username: str(row['username'], 100),
      team: str(row['team'], 100),
      points: row['points'],
      wins: isInt(row['wins']) ? row['wins'] : 0,
      podiums: isInt(row['podiums']) ? row['podiums'] : 0,
      gap: isInt(row['gap']) ? row['gap'] : 0
    }
  })
  const constructors = json['constructors'].map((row): StandingsTeam => {
    if (!isRecord(row) || !isInt(row['position']) || !isText(row['team'], 500) || !isInt(row['points'])) throw invalid('standings')
    return {
      position: row['position'],
      team: row['team'].slice(0, 100),
      points: row['points'],
      drivers: isInt(row['drivers']) ? row['drivers'] : 0,
      gap: isInt(row['gap']) ? row['gap'] : 0
    }
  })
  return { drivers, constructors }
}

/** points (20 whole numbers), pole and fastest lap: the shape of the system and of its built-in defaults. */
function parsePointsTable(json: unknown): PointsSystemInput | null {
  if (!isRecord(json) || !Array.isArray(json['points']) || json['points'].length !== 20 || !json['points'].every(isCount)) return null
  if (!isCount(json['pole']) || !isCount(json['fastest_lap'])) return null
  return { points: json['points'] as number[], pole: json['pole'], fastestLap: json['fastest_lap'] }
}

function parsePointsSystem(json: unknown): PointsSystem {
  const table = parsePointsTable(json)
  if (!table || !isRecord(json)) throw invalid('points system')
  // `defaults` is always sent by the server; if it is missing or malformed the rest still works and "Reset to defaults" is off.
  return { ...table, isDefault: json['is_default'] === true, defaults: parsePointsTable(json['defaults']) }
}

function parseMember(json: unknown): Member | null {
  if (!isRecord(json) || !isValidSnowflake(json['id']) || !isText(json['username'], 100)) return null
  return {
    id: json['id'],
    username: json['username'],
    displayName: str(json['display_name'], 100) || json['username'],
    avatar: cdnImage(json['avatar']),
    bot: json['bot'] === true
  }
}

/** The server lists the drivers it could not match; only their names are shown, so any simple shape is accepted. */
function parseNotFound(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).map((item) => {
    if (typeof item === 'string') return item.slice(0, 100)
    if (isRecord(item)) return str(item['name'], 100) || str(item['username'], 100) || str(item['user_id'], 30) || 'Unknown driver'
    return 'Unknown driver'
  })
}

function parsePosted(value: unknown): RaceOutcome['posted'] {
  if (!isRecord(value) || !isValidSnowflake(value['channel_id'])) return null
  const ids = Array.isArray(value['message_ids']) ? value['message_ids'].filter(isValidSnowflake).slice(0, 10) : []
  return { channelId: value['channel_id'], messageIds: ids }
}

function parseLedgerState(value: unknown): RaceOutcome['ledger'] {
  if (!isRecord(value) || typeof value['recorded'] !== 'boolean') return null
  return { recorded: value['recorded'], duplicate: value['duplicate'] === true }
}

function parseLedgerEntry(json: unknown): ServerLedgerEntry | null {
  if (!isRecord(json) || typeof json['season'] !== 'string' || typeof json['round'] !== 'string' || typeof json['timestamp'] !== 'string') return null
  return {
    season: json['season'].slice(0, 40),
    round: json['round'].slice(0, 40),
    circuit: str(json['circuit'], 120),
    recordedBy: str(json['recorded_by'], 100),
    timestamp: json['timestamp'].slice(0, 40)
  }
}

function parseRaceOutcome(json: unknown): RaceOutcome {
  if (!isRecord(json) || typeof json['race_title'] !== 'string' || !Array.isArray(json['results'])) throw invalid('race result')
  const results = json['results'].map((row): ResultLine => {
    if (!isRecord(row) || !isInt(row['position']) || !isInt(row['points']) || typeof row['matched'] !== 'boolean') throw invalid('race result')
    return { position: row['position'], name: str(row['name'], 100), points: row['points'], matched: row['matched'] }
  })
  return {
    raceTitle: json['race_title'].slice(0, 200),
    results,
    notFound: parseNotFound(json['not_found']),
    standings: parseStandings(json['standings']),
    posted: parsePosted(json['posted']),
    announceError: typeof json['announce_error'] === 'string' && json['announce_error'] !== '' ? json['announce_error'].slice(0, 64) : null,
    ledger: parseLedgerState(json['ledger'])
  }
}

export function createF1Api(client: ApiClient): F1Api {
  const guildPath = (guildId: string, suffix: string): string => {
    if (!isValidSnowflake(guildId)) throw clientError('invalid_guild_id', 'That server ID is not valid.')
    return `/api/app/v1/guilds/${guildId}/${suffix}`
  }
  const roundPath = (guildId: string, round: number): string => {
    if (!Number.isInteger(round) || round < 1 || round > 99) throw clientError('invalid_round', 'That round number is not valid.')
    return guildPath(guildId, `f1/calendar/rounds/${round}`)
  }
  /** Team names are URL-encoded; a name with `/` or `\` cannot be addressed by the API at all. */
  const teamPath = (guildId: string, teamName: string, suffix = ''): string => {
    if (teamName === '' || teamName.length > 100 || /[/\\]/.test(teamName)) throw clientError('invalid_team_name', 'That team name cannot be used.')
    return guildPath(guildId, `f1/teams/${encodeURIComponent(teamName)}${suffix}`)
  }
  const userId = (value: string): string => {
    if (!isValidSnowflake(value)) throw clientError('invalid_user_id', 'That member ID is not valid.')
    return value
  }

  return {
    async members(guildId, query) {
      const q = query.trim()
      if (q === '' || [...q].length > 32) throw clientError('invalid_query', 'Type 1 to 32 characters to search for a member.')
      const json = await client.request({ path: `${guildPath(guildId, 'members')}?q=${encodeURIComponent(q)}` })
      const members = list(json, 'members', 'member list').flatMap((item): Member[] => {
        const member = parseMember(item)
        return member ? [member] : []
      })
      return { members, truncated: isRecord(json) && json['truncated'] === true }
    },

    async calendar(guildId) {
      return parseCalendar(await client.request({ path: guildPath(guildId, 'f1/calendar') }))
    },

    async createRound(guildId, input) {
      const body: Record<string, unknown> = { name: input.name, date: input.date, event_type: input.eventType }
      if (input.time !== '') body['time'] = input.time
      if (input.flag !== '') body['flag'] = input.flag
      if (input.round !== undefined) body['round'] = input.round
      const json = await client.request({ method: 'POST', path: guildPath(guildId, 'f1/calendar/rounds'), body })
      if (!isRecord(json)) throw invalid('calendar')
      return { round: parseRound(json['round']), calendar: parseCalendar(json['calendar']) }
    },

    async updateRound(guildId, round, patch) {
      const body: Record<string, unknown> = {}
      if (patch.name !== undefined) body['name'] = patch.name
      if (patch.date !== undefined) body['date'] = patch.date
      if (patch.time !== undefined) body['time'] = patch.time
      if (patch.flag !== undefined) body['flag'] = patch.flag
      if (patch.eventType !== undefined) body['event_type'] = patch.eventType
      const json = await client.request({ method: 'PATCH', path: roundPath(guildId, round), body })
      if (!isRecord(json)) throw invalid('calendar')
      return { round: parseRound(json['round']), calendar: parseCalendar(json['calendar']) }
    },

    async deleteRound(guildId, round) {
      const json = await client.request({ method: 'DELETE', path: roundPath(guildId, round) })
      if (!isRecord(json) || json['ok'] !== true) throw invalid('delete')
      return parseCalendar(json['calendar'])
    },

    async postCalendar(guildId, input) {
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'f1/calendar/post'),
        body: { channel_id: input.channelId, ...(input.messageId !== undefined ? { message_id: input.messageId } : {}) }
      })
      if (!isRecord(json) || json['ok'] !== true || !isValidSnowflake(json['message_id']) || !isValidSnowflake(json['channel_id']) || typeof json['refreshed'] !== 'boolean') {
        throw invalid('calendar post')
      }
      return { messageId: json['message_id'], channelId: json['channel_id'], refreshed: json['refreshed'] }
    },

    async nextRace(guildId) {
      const json = await client.request({ path: guildPath(guildId, 'f1/next-race') })
      if (!isRecord(json) || typeof json['upcoming'] !== 'boolean') throw invalid('next race')
      const hours = json['countdown_hours']
      const countdown = json['countdown']
      return {
        calendarName: str(json['calendar_name'], 200),
        race: parseRound(json['race'], 'next race'),
        upcoming: json['upcoming'],
        countdownHours: isCount(hours) ? hours : null,
        countdown: isRecord(countdown) && isCount(countdown['days']) && isCount(countdown['hours']) ? { days: countdown['days'], hours: countdown['hours'] } : null
      }
    },

    async teams(guildId) {
      return list(await client.request({ path: guildPath(guildId, 'f1/teams') }), 'teams', 'team list').map(parseTeam)
    },

    async createTeam(guildId, input) {
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'f1/teams'),
        body: { name: input.name, color: input.color, abbreviation: input.abbreviation }
      })
      return parseTeamEnvelope(json)
    },

    async addDriver(guildId, teamName, input) {
      const json = await client.request({
        method: 'POST',
        path: teamPath(guildId, teamName, '/drivers'),
        body: { user_id: userId(input.userId), ...(input.number !== undefined && input.number !== null ? { number: input.number } : {}) }
      })
      if (!isRecord(json) || !isValidSnowflake(json['user_id'])) throw invalid('driver')
      return { team: parseTeam(json['team']), userId: json['user_id'] }
    },

    async removeDriver(guildId, teamName, driverId) {
      const json = await client.request({ method: 'DELETE', path: teamPath(guildId, teamName, `/drivers/${userId(driverId)}`) })
      if (!isRecord(json) || typeof json['role_removed'] !== 'boolean' || typeof json['member_in_server'] !== 'boolean') throw invalid('driver')
      return { team: parseTeam(json['team']), roleRemoved: json['role_removed'], memberInServer: json['member_in_server'] }
    },

    async driver(guildId, driverId) {
      const json = await client.request({ path: guildPath(guildId, `f1/drivers/${userId(driverId)}`) })
      if (!isRecord(json) || !isValidSnowflake(json['user_id']) || !isInt(json['points']) || !isInt(json['wins']) || !isInt(json['podiums'])) throw invalid('driver')
      const username = str(json['username'], 100)
      const number = json['number']
      return {
        userId: json['user_id'],
        username,
        displayName: str(json['display_name'], 100) || username,
        team: str(json['team'], 100) || '—',
        points: json['points'],
        wins: json['wins'],
        podiums: json['podiums'],
        number: isInt(number) && number >= 0 ? number : null
      }
    },

    async standings(guildId) {
      return parseStandings(await client.request({ path: guildPath(guildId, 'f1/standings') }))
    },

    async recordResults(guildId, input) {
      const body: Record<string, unknown> = {
        season: input.season,
        round: input.round,
        circuit: input.circuit,
        results: input.results.map((id) => ({ user_id: userId(id) }))
      }
      if (input.fastestLap !== undefined) body['fastest_lap'] = { user_id: userId(input.fastestLap) }
      if (input.pole !== undefined) body['pole'] = { user_id: userId(input.pole) }
      if (input.channelId !== undefined) {
        if (!isValidSnowflake(input.channelId)) throw clientError('invalid_channel', 'That channel is not valid.')
        body['channel_id'] = input.channelId
      }
      // Only ever sent as true, and only after the user confirmed the "adds the points a second time" warning.
      if (input.confirmDuplicate === true) body['confirm_duplicate'] = true
      // One attempt, never replayed (see ApiClient): a lost answer may still have recorded the race.
      return parseRaceOutcome(await client.request({ method: 'POST', path: guildPath(guildId, 'f1/standings/results'), body }))
    },

    async resultsLedger(guildId, query = {}) {
      const params = new URLSearchParams()
      if (query.season !== undefined) params.set('season', query.season)
      if (query.round !== undefined) params.set('round', query.round)
      const queryText = params.toString()
      const suffix = queryText !== '' ? `?${queryText}` : ''
      const json = await client.request({ path: `${guildPath(guildId, 'f1/standings/results-ledger')}${suffix}` })
      return list(json, 'entries', 'results ledger').flatMap((item): ServerLedgerEntry[] => {
        const entry = parseLedgerEntry(item)
        return entry ? [entry] : []
      })
    },

    async pointsSystem(guildId) {
      return parsePointsSystem(await client.request({ path: guildPath(guildId, 'f1/points-system') }))
    },

    async savePointsSystem(guildId, input) {
      const json = await client.request({
        method: 'PUT',
        path: guildPath(guildId, 'f1/points-system'),
        body: { points: input.points, pole: input.pole, fastest_lap: input.fastestLap }
      })
      return parsePointsSystem(json)
    }
  }
}
