/**
 * FAKE F1 league backend for `npm run dev:mock` (calendar, teams and drivers, standings, race results, points
 * system, member search). Part of the mock bridge: it must never end up in an Electron build (it is only
 * reachable through installMock.ts, which main.tsx loads behind the compile-time `__NEXUS_MOCK__` flag).
 *
 * It is stateful and follows docs/APP_API.md (codes, limits, shapes), including the facts that matter for the
 * UI: rounds keep their numbers when one is deleted, a recorded race adds points every time it is posted, and
 * the main process (simulated here) writes the calendar message id and the results ledger only after a
 * confirmed answer.
 *
 * Scenarios (query string, on top of the ones in installMock.ts):
 *   norounds     no calendar yet: next race is 404 calendar_not_found, nothing can be posted
 *   nobotperms   the bot lacks permissions: creating a team and adding a driver return 403
 *                bot_missing_manage_roles, posting the calendar returns 403 bot_cannot_send
 *   nofia        staff without the FIA role: recording results and saving the points system return 403 fia_required
 *   lostresults  every "record results" is applied, then the answer is lost (timeout)
 *   noledger     the server's results ledger cannot be read (500): the form falls back to this app's own record
 *
 * Hooks (normal scenario):
 *   Circuit containing "ambiguous"  the server answers 400 ambiguous_name when a fastest lap or pole is chosen
 *   Circuit containing "timeout"    the race IS recorded, then the answer is lost
 *   Circuit containing "late-duplicate"  the ledger read shows nothing, but the POST answers 409 results_already_recorded
 *                                    (somebody recorded the race in between) until confirm_duplicate is sent
 *   Results channel #bot-locked      403 bot_cannot_send, answered before anything is recorded
 *   Results channel #staff-only      403 forbidden (the caller cannot see it), answered before anything is recorded
 *   A round, team or calendar post to #timeout-test, or a name containing "timeout", behaves the same way
 *
 * Sample data: "Apex Racing League" has 8 rounds, five teams (one without drivers, one driver who has left the
 * server), a calendar message in #announcements that was deleted in Discord, and a recorded race (Season 5
 * Round 3) in both the server's results ledger and this app's local ledger. "Midnight GT Championship" has 24 rounds (the wizard is open), eight teams and a live calendar message.
 */
import type {
  AddDriverResult,
  Calendar,
  CalendarPostResult,
  CalendarRound,
  Channel,
  DriverStats,
  IpcResult,
  LedgerEntry,
  Member,
  MemberSearch,
  NextEvent,
  NextRace,
  PointsSystem,
  RaceOutcome,
  RemoveDriverResult,
  ResultLine,
  RoundResult,
  ServerLedgerEntry,
  Settings,
  Standings,
  Team,
  TeamDriver
} from '../../shared/types'
import type { NexusBridge } from '../../shared/bridge'
import { appendLedgerEntry } from '../../shared/f1Store'
import { EVENT_TYPES } from '../../shared/types'
import { failure, notFound, refused, timeoutFailure } from './common'

export interface F1MockContext {
  scenario: string
  isAdmin: boolean
  api: <T>(produce: () => IpcResult<T>) => Promise<IpcResult<T>>
  known: (guildId: string) => boolean
  channels: readonly Channel[]
  timeoutChannel: string
  /** A channel the bot cannot post in any more (a permission was removed after the list was loaded). */
  lockedChannel: string
  /** A channel the caller cannot see: the server answers 403 forbidden. */
  hiddenChannel: string
  getSettings: () => Settings
  setSettings: (next: Settings) => void
  /** Messages that still exist in Discord (shared with the sign-up panel mock). */
  liveMessages: Set<string>
  newMessageId: () => string
  apex: string
  midnight: string
}

type F1Api = Pick<
  NexusBridge['api'],
  | 'members'
  | 'calendar'
  | 'createRound'
  | 'updateRound'
  | 'deleteRound'
  | 'postCalendar'
  | 'nextRace'
  | 'teams'
  | 'createTeam'
  | 'addDriver'
  | 'removeDriver'
  | 'driver'
  | 'standings'
  | 'recordResults'
  | 'resultsLedger'
  | 'pointsSystem'
  | 'savePointsSystem'
>

// ── Members of the fake servers ─────────────────────────────────────────────

const memberId = (n: number): string => `20000000000${String(n).padStart(7, '0')}`
const pool = (n: number, displayName: string, username: string): Member => ({ id: memberId(n), username, displayName, avatar: null, bot: false })

export const MEMBERS: Member[] = [
  pool(1, 'Max Verstappen', 'max_verstappen_nl'),
  pool(2, 'Lando Norris', 'lando_n'),
  pool(3, 'Charles Leclerc', 'charles_l'),
  pool(4, 'Lewis Hamilton', 'lewis44'),
  pool(5, 'George Russell', 'g_russell'),
  pool(6, 'Oscar Piastri', 'oscar_p'),
  pool(7, 'Carlos Sainz', 'carlos55'),
  pool(8, 'Fernando Alonso', 'alonso14'),
  pool(9, 'Max Vandoorne', 'max_vandoorne'),
  pool(10, 'Alex Albon', 'alex_albon23'),
  pool(11, 'Yuki Tsunoda', 'yuki22'),
  pool(12, 'Pierre Gasly', 'pg10'),
  pool(13, 'Esteban Ocon', 'ocon31'),
  pool(14, 'Lance Stroll', 'stroll18'),
  pool(15, 'Nico Hulkenberg', 'hulk27'),
  pool(16, 'Kevin Magnussen', 'kmag20'),
  pool(17, 'Valtteri Bottas', 'vb77'),
  pool(18, 'Zhou Guanyu', 'zhou24'),
  pool(19, 'Logan Sargeant', 'sargeant2'),
  pool(20, 'Daniel Ricciardo', 'dr3'),
  pool(21, 'A Driver With An Extremely Long Display Name To Test The Layout', 'long_name_driver_with_a_long_username'),
  pool(30, 'Marshal Sam', 'marshal_sam'),
  pool(31, 'Steward Sophie', 'steward_sophie'),
  pool(32, 'Commentator Chris', 'chris_commentary'),
  pool(33, 'Spectator Sam', 'spectator_sam'),
  pool(34, 'Reserve Rita', 'rita_reserve'),
  pool(35, 'Sim Rookie', 'sim_rookie'),
  // Obviously fake members for the esports team screens (milestone 5): roster data must never look like real people.
  ...Array.from({ length: 12 }, (_, index) => pool(100 + index, `Fake Racer ${String(index + 1).padStart(2, '0')}`, `fake_racer_${String(index + 1).padStart(2, '0')}`))
]
/** Drivers in the rosters who have left the fake server: still on the roster, not found by the member search. */
export const LEFT_SERVER = new Set([memberId(3)])

// ── Per-server F1 state ─────────────────────────────────────────────────────

interface Stat {
  userId: string
  username: string
  displayName: string
  /** "—" = on no team. */
  team: string
  points: number
  wins: number
  podiums: number
  number: number | null
}
interface RosterEntry {
  userId: string
  number: number | null
}
interface TeamState {
  name: string
  abbreviation: string
  color: string
  roleId: string
  channelId: string
  roster: RosterEntry[]
}
interface F1State {
  calendarExists: boolean
  calendarName: string
  setupInProgress: boolean
  rounds: CalendarRound[]
  teams: TeamState[]
  stats: Map<string, Stat>
  points: { points: number[]; pole: number; fastestLap: number; isDefault: boolean }
  /** The server's results ledger: races recorded through the app, oldest first. */
  ledger: ServerLedgerEntry[]
}

const DEFAULT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
const DAY_MS = 86_400_000

const pad = (n: number): string => String(n).padStart(2, '0')
function formatDate(date: Date): string {
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`
}
/** `DD/MM/YYYY` (+ `HH:MM`) as UTC milliseconds, or null for TBD / unreadable dates. */
function momentOf(round: CalendarRound): number | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(round.date)
  if (!match) return null
  const [, day, month, year] = match
  const time = /^(\d{2}):(\d{2})$/.exec(round.time)
  return Date.UTC(Number(year), Number(month) - 1, Number(day), time ? Number(time[1]) : 0, time ? Number(time[2]) : 0)
}

const CIRCUITS = [
  ['Australian GP', 'AU'], ['Bahrain GP', 'BH'], ['Dutch GP', 'NL'], ['Monza Grand Prix', 'IT'], ['Spa-Francorchamps GP', 'BE'], ['British GP', 'GB'],
  ['Hungarian GP', 'HU'], ['Japanese GP', 'JP'], ['Singapore GP', 'SG'], ['United States GP', 'US'], ['Mexican GP', 'MX'], ['Brazilian GP', 'BR']
] as const

function seedRounds(count: number, firstOffsetDays: number, tbdFrom = Number.POSITIVE_INFINITY): CalendarRound[] {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
  return Array.from({ length: count }, (_, index) => {
    const [name, flag] = CIRCUITS[index % CIRCUITS.length] ?? CIRCUITS[0]
    const tbd = index + 1 >= tbdFrom
    return {
      round: index + 1,
      name: index >= CIRCUITS.length ? `${name} (reverse)` : name,
      date: tbd ? 'TBD' : formatDate(new Date(today + (firstOffsetDays + index * 7) * DAY_MS)),
      time: tbd || index % 5 === 4 ? '' : index % 2 === 0 ? '19:30' : '20:00',
      flag: index % 7 === 6 ? '' : flag,
      eventType: EVENT_TYPES[index % 3 === 1 ? 1 : index % 5 === 2 ? 2 : 0]
    }
  })
}

function stat(n: number, team: string, points: number, wins: number, podiums: number, number: number | null): Stat {
  const member = MEMBERS.find((item) => item.id === memberId(n)) ?? MEMBERS[0]!
  return { userId: member.id, username: member.username, displayName: member.displayName, team, points, wins, podiums, number }
}

function team(name: string, abbreviation: string, color: string, index: number, roster: RosterEntry[]): TeamState {
  return { name, abbreviation, color, roleId: `9100000000000000${pad(index)}`, channelId: `9300000000000000${pad(index)}`, roster }
}
const entry = (n: number, number: number | null): RosterEntry => ({ userId: memberId(n), number })

function seedApex(): F1State {
  const stats = [
    stat(1, 'Red Racing', 187, 5, 8, 1), stat(2, 'Red Racing', 164, 2, 7, 4), stat(3, 'Red Racing', 96, 1, 3, 16),
    stat(4, 'Silver Arrows', 143, 1, 6, 44), stat(5, 'Silver Arrows', 120, 1, 4, 63),
    stat(6, 'Blue Thunder', 101, 0, 3, 81), stat(7, 'Blue Thunder', 88, 0, 2, 55),
    stat(8, 'Papaya Racing', 54, 0, 1, null), stat(9, 'Papaya Racing', 31, 0, 0, 27),
    stat(10, '—', 12, 0, 0, null)
  ]
  return {
    calendarExists: true,
    calendarName: '2026 Season',
    setupInProgress: false,
    rounds: seedRounds(8, -14, 8),
    teams: [
      team('Red Racing', 'RED', '#E10600', 1, [entry(1, 1), entry(2, 4), entry(3, 16)]),
      team('Silver Arrows', 'SIL', '#C0C0C0', 2, [entry(4, 44), entry(5, 63)]),
      team('Blue Thunder', 'BLU', '#1E41FF', 3, [entry(6, 81), entry(7, 55)]),
      team('Papaya Racing', 'PAP', '#FF8000', 4, [entry(8, null), entry(9, 27)]),
      team('Reserve Squad', 'RES', '#6B7280', 5, [])
    ],
    stats: new Map(stats.map((item) => [item.userId, item])),
    points: { points: [...DEFAULT_POINTS], pole: 0, fastestLap: 1, isDefault: true },
    ledger: [{ season: '5', round: '3', circuit: 'Zandvoort', recordedBy: 'DemoStaff', timestamp: new Date(Date.now() - 6 * DAY_MS).toISOString() }]
  }
}

function seedMidnight(): F1State {
  const names: Array<[string, string, string]> = [
    ['Midnight Endurance Works Racing Team International', 'MEW', '#7C3AED'], ['Night Owls', 'OWL', '#0EA5E9'], ['Apex Predators', 'APX', '#16A34A'],
    ['Backmarker Racing', 'BMR', '#9CA3AF'], ['Lights Out', 'LGT', '#F43F5E'], ['Slipstream SC', 'SLP', '#14B8A6'], ['Hairpin Heroes', 'HPH', '#F97316'], ['Pit Wall', 'PIT', '#A855F7']
  ]
  const teams = names.map(([name, abbreviation, color], index) => team(name, abbreviation, color, 20 + index, []))
  const stats: Stat[] = []
  // Drivers 11-20 are spread over the first teams; "Backmarker Racing" stays without drivers.
  const layout: Array<[number, number, number | null]> = [[11, 0, 5], [12, 0, 10], [13, 1, 33], [14, 1, 18], [15, 2, 27], [16, 2, 20], [17, 4, 77], [18, 5, 24], [19, 6, null], [20, 7, 3]]
  layout.forEach(([n, teamIndex, number], index) => {
    const owner = teams[teamIndex]!
    owner.roster.push({ userId: memberId(n), number })
    stats.push(stat(n, owner.name, 120 - index * 11, index === 0 ? 3 : 0, index < 4 ? 4 - index : 0, number))
  })
  return {
    calendarExists: true,
    calendarName: 'Midnight GT Season 12',
    setupInProgress: true,
    rounds: seedRounds(24, -35, 22),
    teams,
    stats: new Map(stats.map((item) => [item.userId, item])),
    points: { points: [...DEFAULT_POINTS], pole: 1, fastestLap: 1, isDefault: false },
    ledger: []
  }
}

function emptyState(): F1State {
  return { calendarExists: false, calendarName: 'F1 Season Calendar', setupInProgress: false, rounds: [], teams: [], stats: new Map(), points: { points: [...DEFAULT_POINTS], pole: 0, fastestLap: 1, isDefault: true }, ledger: [] }
}

// ── The mock ────────────────────────────────────────────────────────────────

export function createF1Mock(ctx: F1MockContext): { api: F1Api; counts: (guildId: string) => { teams: number; teamDrivers: number; rounds: number; next: NextEvent | null } | null; seedSettings: (settings: Settings) => Settings } {
  const states: Record<string, F1State> = { [ctx.apex]: seedApex(), [ctx.midnight]: seedMidnight() }
  if (ctx.scenario === 'norounds') {
    for (const id of Object.keys(states)) Object.assign(states[id]!, { rounds: [], calendarExists: false, setupInProgress: false })
  }
  const stateOf = (guildId: string): F1State => (states[guildId] ??= emptyState())

  const guildMissing = (): IpcResult<never> => notFound('guild_not_found', 'The bot is not in that server.')
  const nobot = ctx.scenario === 'nobotperms'
  const nofia = ctx.scenario === 'nofia'

  // ── Views ──
  const calendarView = (state: F1State): Calendar => ({
    name: state.calendarName,
    setupInProgress: state.setupInProgress,
    rounds: [...state.rounds].sort((a, b) => a.round - b.round).map((round) => ({ ...round }))
  })

  const teamView = (state: F1State, item: TeamState): Team => {
    const drivers = item.roster.flatMap((rosterEntry): TeamDriver[] => {
      const found = state.stats.get(rosterEntry.userId)
      if (!found) return []
      return [{ userId: found.userId, username: found.username, displayName: found.displayName, number: rosterEntry.number, points: found.points, wins: found.wins, podiums: found.podiums }]
    })
    drivers.sort((a, b) => (a.number === null ? 1 : 0) - (b.number === null ? 1 : 0) || (a.number ?? 0) - (b.number ?? 0) || a.displayName.localeCompare(b.displayName))
    return {
      name: item.name,
      abbreviation: item.abbreviation,
      color: item.color,
      roleId: item.roleId,
      roleName: item.name,
      channelId: item.channelId,
      channelName: item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100),
      points: drivers.reduce((sum, driver) => sum + driver.points, 0),
      drivers
    }
  }

  const standingsView = (state: F1State): Standings => {
    const rows = [...state.stats.values()].sort((a, b) => b.points - a.points)
    const leader = rows[0]?.points ?? 0
    const teams = state.teams.map((item) => teamView(state, item)).sort((a, b) => b.points - a.points)
    const leadTeam = teams[0]?.points ?? 0
    return {
      drivers: rows.map((row, index) => ({ position: index + 1, userId: row.userId, username: row.username, team: row.team, points: row.points, wins: row.wins, podiums: row.podiums, gap: leader - row.points })),
      constructors: teams.map((item, index) => ({ position: index + 1, team: item.name, points: item.points, drivers: item.drivers.length, gap: leadTeam - item.points }))
    }
  }

  // The built-in table is always returned, also after a custom system was saved (the form offers "Reset to defaults").
  const pointsView = (state: F1State): PointsSystem => ({
    points: [...state.points.points],
    pole: state.points.pole,
    fastestLap: state.points.fastestLap,
    isDefault: state.points.isDefault,
    defaults: { points: [...DEFAULT_POINTS], pole: 0, fastestLap: 1 }
  })

  /** The first round dated today or later; every round past = the last one (upcoming: false). */
  function pickNext(state: F1State): { race: CalendarRound; upcoming: boolean } | null {
    const rounds = [...state.rounds].sort((a, b) => a.round - b.round)
    if (rounds.length === 0) return null
    const now = new Date()
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const next = rounds.find((round) => {
      const moment = momentOf({ ...round, time: '' })
      return moment !== null && moment >= today
    })
    return next ? { race: next, upcoming: true } : { race: rounds[rounds.length - 1]!, upcoming: false }
  }

  function countdownOf(race: CalendarRound): number {
    const moment = momentOf(race)
    return moment === null ? 0 : Math.max(0, Math.floor((moment - Date.now()) / 3_600_000))
  }

  // ── Round rules (the backend's, in the order it checks them) ──
  const lostAnswer = (text: string): boolean => /timeout/i.test(text)

  const findTeam = (state: F1State, name: string): TeamState | undefined => state.teams.find((item) => item.name.toLowerCase() === name.toLowerCase())
  const memberInServer = (id: string): boolean => MEMBERS.some((member) => member.id === id) && !LEFT_SERVER.has(id)

  function persistCalendarPost(guildId: string, post: { messageId: string; channelId: string } | null): void {
    const settings = ctx.getSettings()
    const calendarPosts = { ...settings.calendarPosts }
    if (post) calendarPosts[guildId] = post
    else delete calendarPosts[guildId]
    ctx.setSettings({ ...settings, calendarPosts })
  }
  function appendLedger(entryToAdd: LedgerEntry): void {
    const settings = ctx.getSettings()
    ctx.setSettings({ ...settings, ledger: appendLedgerEntry(settings.ledger, entryToAdd) })
  }

  const api: F1Api = {
    members: (guildId, query) =>
      ctx.api<MemberSearch>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const q = query.trim().replace(/^@/, '').toLowerCase()
        if (q === '' || [...q].length > 32) return failure('http', 'invalid_query', 'The search must be 1 to 32 characters.', 400)
        const matches = MEMBERS.filter((member) => !LEFT_SERVER.has(member.id) && (member.id === q || `${member.username}\n${member.displayName}`.toLowerCase().includes(q)))
        matches.sort((a, b) => Number(b.displayName.toLowerCase().startsWith(q)) - Number(a.displayName.toLowerCase().startsWith(q)) || a.displayName.localeCompare(b.displayName))
        return { ok: true, data: { members: matches.slice(0, 25), truncated: matches.length > 25 } }
      }),

    calendar: (guildId) => ctx.api(() => (ctx.known(guildId) ? { ok: true, data: calendarView(stateOf(guildId)) } : guildMissing())),

    createRound: (guildId, input) =>
      ctx.api<RoundResult>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        if (state.rounds.length >= 25) return failure('http', 'too_many_rounds', 'A calendar can have at most 25 rounds.', 409)
        if (input.round !== undefined && state.rounds.some((round) => round.round === input.round)) return failure('http', 'round_exists', `Round ${input.round} already exists.`, 409)
        const number = input.round ?? Math.max(0, ...state.rounds.map((round) => round.round)) + 1
        const created: CalendarRound = { round: number, name: input.name, date: input.date, time: input.time, flag: input.flag, eventType: input.eventType }
        state.rounds.push(created)
        state.calendarExists = true
        if (lostAnswer(input.name)) return timeoutFailure() // created, but the answer "got lost"
        return { ok: true, data: { round: { ...created }, calendar: calendarView(state) } }
      }),

    updateRound: (guildId, round, patch) =>
      ctx.api<RoundResult>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        if (!state.calendarExists) return notFound('calendar_not_found', 'There is no calendar yet.')
        const target = state.rounds.find((item) => item.round === round)
        if (!target) return notFound('round_not_found', `Round ${round} was not found.`)
        if (patch.name !== undefined) target.name = patch.name
        if (patch.date !== undefined) target.date = patch.date
        if (patch.time !== undefined) target.time = patch.time
        if (patch.flag !== undefined) target.flag = patch.flag
        if (patch.eventType !== undefined) target.eventType = patch.eventType
        if (lostAnswer(target.name)) return timeoutFailure()
        return { ok: true, data: { round: { ...target }, calendar: calendarView(state) } }
      }),

    deleteRound: (guildId, round) =>
      ctx.api<Calendar>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        if (!state.calendarExists) return notFound('calendar_not_found', 'There is no calendar yet.')
        const index = state.rounds.findIndex((item) => item.round === round)
        if (index < 0) return notFound('round_not_found', `Round ${round} was not found.`)
        state.rounds.splice(index, 1) // the other rounds keep their numbers: a gap stays
        return { ok: true, data: calendarView(state) }
      }),

    // POST /f1/calendar/post + the main process's calendar-message registry (only a confirmed outcome changes it).
    postCalendar: (guildId, input) =>
      ctx.api<CalendarPostResult>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        if (!state.calendarExists) return notFound('calendar_not_found', 'There is no calendar yet.')
        if (!ctx.channels.some((channel) => channel.id === input.channelId)) return notFound('channel_not_found', 'That text channel was not found in this server.')
        if (nobot) return refused('bot_cannot_send', 'The bot cannot post in that channel.')
        let messageId: string
        if (input.messageId !== undefined) {
          if (!ctx.liveMessages.has(input.messageId)) {
            persistCalendarPost(guildId, null) // the real main process forgets a message the API says is gone
            return notFound('message_not_found', 'That calendar message was not found in the channel.')
          }
          messageId = input.messageId
        } else {
          messageId = ctx.newMessageId()
          ctx.liveMessages.add(messageId)
        }
        if (input.channelId === ctx.timeoutChannel) return timeoutFailure() // posted, but the answer "got lost": nothing is remembered
        persistCalendarPost(guildId, { messageId, channelId: input.channelId })
        return { ok: true, data: { messageId, channelId: input.channelId, refreshed: input.messageId !== undefined } }
      }),

    nextRace: (guildId) =>
      ctx.api<NextRace>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        const picked = state.calendarExists ? pickNext(state) : null
        if (!picked) return notFound('calendar_not_found', 'There is no calendar yet.')
        const hours = picked.upcoming ? countdownOf(picked.race) : null
        return {
          ok: true,
          data: {
            calendarName: state.calendarName,
            race: { ...picked.race },
            upcoming: picked.upcoming,
            countdownHours: hours,
            countdown: hours === null ? null : { days: Math.floor(hours / 24), hours: hours % 24 }
          }
        }
      }),

    teams: (guildId) => ctx.api(() => (ctx.known(guildId) ? { ok: true, data: stateOf(guildId).teams.map((item) => teamView(stateOf(guildId), item)) } : guildMissing())),

    createTeam: (guildId, input) =>
      ctx.api<Team>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        if (nobot) return refused('bot_missing_manage_roles', 'The bot needs the Manage Roles permission.')
        if (findTeam(state, input.name)) return failure('http', 'team_exists', `A team named '${input.name}' already exists.`, 409)
        const index = 40 + state.teams.length
        const created: TeamState = { name: input.name, abbreviation: input.abbreviation, color: input.color, roleId: `9100000000000000${pad(index)}`, channelId: `9300000000000000${pad(index)}`, roster: [] }
        state.teams.push(created)
        if (lostAnswer(input.name)) return timeoutFailure() // created, but the answer "got lost"
        return { ok: true, data: teamView(state, created) }
      }),

    addDriver: (guildId, teamName, input) =>
      ctx.api<AddDriverResult>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        const target = findTeam(state, teamName)
        if (!target) return notFound('team_not_found', `Team '${teamName}' was not found.`)
        if (nobot) return refused('bot_missing_manage_roles', 'The bot needs the Manage Roles permission.')
        const member = MEMBERS.find((item) => item.id === input.userId)
        if (!member || !memberInServer(member.id)) return notFound('member_not_found', 'That member was not found in this server.')
        const number = input.number ?? null
        target.roster = [...target.roster.filter((item) => item.userId !== member.id), { userId: member.id, number }]
        const existing = state.stats.get(member.id)
        // Existing points are kept; a driver on another team moves to this one.
        for (const other of state.teams) if (other !== target) other.roster = other.roster.filter((item) => item.userId !== member.id)
        state.stats.set(member.id, { userId: member.id, username: member.username, displayName: member.displayName, team: target.name, points: existing?.points ?? 0, wins: existing?.wins ?? 0, podiums: existing?.podiums ?? 0, number })
        return { ok: true, data: { team: teamView(state, target), userId: member.id } }
      }),

    removeDriver: (guildId, teamName, userId) =>
      ctx.api<RemoveDriverResult>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        const target = findTeam(state, teamName)
        if (!target) return notFound('team_not_found', `Team '${teamName}' was not found.`)
        if (!target.roster.some((item) => item.userId === userId)) return notFound('driver_not_found', 'That driver is not on this team.')
        const inServer = memberInServer(userId)
        if (inServer && nobot) return refused('bot_missing_manage_roles', 'The bot needs the Manage Roles permission.')
        target.roster = target.roster.filter((item) => item.userId !== userId)
        const found = state.stats.get(userId)
        if (found) state.stats.set(userId, { ...found, team: '—', number: found.number }) // stats (and points) are kept
        return { ok: true, data: { team: teamView(state, target), roleRemoved: inServer, memberInServer: inServer } }
      }),

    driver: (guildId, userId) =>
      ctx.api<DriverStats>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const found = stateOf(guildId).stats.get(userId)
        if (!found) return notFound('driver_not_found', 'No stats were found for that driver.')
        return { ok: true, data: { ...found } }
      }),

    standings: (guildId) => ctx.api(() => (ctx.known(guildId) ? { ok: true, data: standingsView(stateOf(guildId)) } : guildMissing())),

    // POST /f1/standings/results (+ the main process's ledger: written only after a confirmed success).
    recordResults: (guildId, input) =>
      ctx.api<RaceOutcome>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        if (nofia) return refused('fia_required', 'The FIA role or Administrator permission is required.')
        // The channel is checked before anything is recorded (docs: invalid_channel, channel_not_found, forbidden, bot_cannot_send).
        if (input.channelId !== undefined) {
          if (input.channelId === ctx.hiddenChannel) return refused('forbidden', 'You cannot see that channel.')
          if (!ctx.channels.some((channel) => channel.id === input.channelId) && input.channelId !== ctx.lockedChannel) return notFound('channel_not_found', 'That text channel was not found in this server.')
          if (input.channelId === ctx.lockedChannel) return refused('bot_cannot_send', 'The bot cannot post in that channel.')
        }
        // The duplicate guard: the ledger of the races recorded through the app (same season and round, trimmed, case-insensitive).
        const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
        const earlier = state.ledger.find((item) => sameText(item.season, input.season) && sameText(item.round, input.round))
        const lateDuplicate = earlier === undefined && /late-duplicate/i.test(input.circuit)
        if ((earlier !== undefined || lateDuplicate) && input.confirmDuplicate !== true) {
          return failure('http', 'results_already_recorded', 'This race was already recorded through the app.', 409)
        }
        if ((input.fastestLap !== undefined || input.pole !== undefined) && /ambiguous/i.test(input.circuit)) {
          return failure('http', 'ambiguous_name', 'That name matches more than one driver in the results.', 400)
        }
        const lines: ResultLine[] = []
        const notFoundNames: string[] = []
        input.results.forEach((userId, index) => {
          const found = state.stats.get(userId)
          const member = MEMBERS.find((item) => item.id === userId)
          if (!found) {
            lines.push({ position: index + 1, name: member?.username ?? userId, points: 0, matched: false })
            notFoundNames.push(member?.username ?? userId)
            return
          }
          let points = state.points.points[index] ?? 0
          if (input.fastestLap === userId && index > 0) points += state.points.fastestLap // not for the winner
          if (input.pole === userId) points += state.points.pole
          state.stats.set(userId, { ...found, points: found.points + points, wins: found.wins + (index === 0 ? 1 : 0), podiums: found.podiums + (index < 3 ? 1 : 0) })
          lines.push({ position: index + 1, name: found.username, points, matched: true })
        })
        const entry: ServerLedgerEntry = { season: input.season, round: input.round, circuit: input.circuit, recordedBy: 'DemoStaff', timestamp: new Date().toISOString() }
        state.ledger.push(entry)
        const duplicate = earlier !== undefined || lateDuplicate
        const outcome: RaceOutcome = {
          raceTitle: `Season ${input.season} Round ${input.round} — ${input.circuit}`,
          results: lines,
          notFound: notFoundNames,
          standings: standingsView(state),
          posted: input.channelId !== undefined ? { channelId: input.channelId, messageIds: [ctx.newMessageId(), ctx.newMessageId(), ctx.newMessageId()] } : null,
          // A post that fails AFTER the points were recorded: the channel #timeout-test stands in for "Discord rejected the post".
          announceError: input.channelId !== undefined && input.channelId === ctx.timeoutChannel ? 'discord_error' : null,
          ledger: { recorded: true, duplicate }
        }
        if (outcome.announceError) outcome.posted = null
        // The race IS recorded from here on; a lost answer leaves the ledger untouched, exactly like the real main process.
        if (ctx.scenario === 'lostresults' || lostAnswer(input.circuit)) return timeoutFailure()
        appendLedger({ guildId, season: input.season, round: input.round, circuit: input.circuit, recordedAt: new Date().toISOString() })
        return { ok: true, data: outcome }
      }),

    resultsLedger: (guildId, query) =>
      ctx.api<ServerLedgerEntry[]>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        if (ctx.scenario === 'noledger') return failure('http', 'internal_error', 'The server hit an unexpected problem.', 500)
        const wanted = (text: string | undefined): string | undefined => (text === undefined ? undefined : text.trim().toLowerCase())
        const season = wanted(query?.season)
        const round = wanted(query?.round)
        const entries = [...stateOf(guildId).ledger].reverse().filter((item) => (season === undefined || wanted(item.season) === season) && (round === undefined || wanted(item.round) === round))
        return { ok: true, data: entries.map((item) => ({ ...item })) }
      }),

    pointsSystem: (guildId) => ctx.api(() => (ctx.known(guildId) ? { ok: true, data: pointsView(stateOf(guildId)) } : guildMissing())),

    savePointsSystem: (guildId, input) =>
      ctx.api<PointsSystem>(() => {
        if (!ctx.known(guildId)) return guildMissing()
        const state = stateOf(guildId)
        if (nofia) return refused('fia_required', 'The FIA role or Administrator permission is required.')
        state.points = { points: [...input.points], pole: input.pole, fastestLap: input.fastestLap, isDefault: false }
        if (input.pole === 999) return timeoutFailure() // saved, but the answer "got lost" (hook: pole = 999)
        return { ok: true, data: pointsView(state) }
      })
  }

  return {
    api,
    counts: (guildId) => {
      if (!(guildId in states)) return null
      const state = stateOf(guildId)
      const picked = state.calendarExists ? pickNext(state) : null
      const next: NextEvent | null =
        picked && picked.upcoming
          ? { round: picked.race.round, name: picked.race.name, flag: picked.race.flag || null, date: picked.race.date, time: picked.race.time || null, eventType: picked.race.eventType, countdownHours: countdownOf(picked.race) }
          : null
      return { teams: state.teams.length, teamDrivers: state.teams.reduce((sum, item) => sum + item.roster.length, 0), rounds: state.rounds.length, next }
    },
    /** The fake settings file starts with a calendar message per server and one recorded race. */
    seedSettings: (settings) => {
      if (ctx.scenario === 'norounds') return settings
      const apexMessage = '888000000000000301' // deleted in Discord: not in liveMessages
      const midnightMessage = '888000000000000302'
      ctx.liveMessages.add(midnightMessage)
      return {
        ...settings,
        calendarPosts: {
          [ctx.apex]: { messageId: apexMessage, channelId: ctx.channels[0]?.id ?? '777000000000000001' },
          [ctx.midnight]: { messageId: midnightMessage, channelId: ctx.channels[2]?.id ?? '777000000000000003' }
        },
        ledger: appendLedgerEntry(settings.ledger, { guildId: ctx.apex, season: '5', round: '3', circuit: 'Zandvoort', recordedAt: new Date(Date.now() - 6 * DAY_MS).toISOString() })
      }
    }
  }
}
