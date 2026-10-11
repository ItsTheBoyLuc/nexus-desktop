/**
 * FAKE esports team backend for `npm run dev:mock` (milestone 5): /racing/{game} for lmu, iracing, gt7, acc and f1. Part of the
 * mock bridge: it must never end up in an Electron build (it is only reachable through installMock.ts, which main.tsx loads
 * behind the compile-time `__NEXUS_MOCK__` flag).
 *
 * It is stateful, follows docs/APP_API.md (codes, limits, shapes) and keeps ONE state per server AND per game: a call for
 * one game can never read or change another game's teams, rosters or events (the f1 esports data is not the league's).
 *
 * Scenarios (query string, on top of the ones in the other mock files):
 *   noracingteams   no esports team anywhere (the empty state)
 *   nomanage        staff without Manage Server: creating a team, adding or removing a roster member and adding an event answer 403 manage_server_required
 *   nomanageroles   the bot lacks Manage Roles: creating a team and adding a roster member answer 403 bot_missing_manage_roles (nothing is created)
 *   lostracing      creating a team, adding an event and logging a result ARE applied, then the answer is lost (timeout)
 *   noresults       every results archive is empty (the empty state)
 *   nostaff         (existing) every call answers 403 forbidden
 *
 * Hooks (normal scenario):
 *   a team, event name or logged event name containing "timeout"   it IS created, then the answer is lost
 *   a team name equal to an existing one, in any case   409 team_exists
 *   an unknown {game}   404 unknown_game (the real app never sends one: the bridge refuses it first)
 *
 * Sample data: "Apex Racing League" has teams in all five games: lmu (3 teams, one without members), iracing (a team with 55 members and a
 * member who left the server, and 30 upcoming events to page through), gt7, acc and f1 (Formula 1 Esports). The events include a date written
 * 03/04/2027 (the bot reads it as March 4th) and one that cannot be read at all (listed last). "Midnight GT Championship" has only an lmu
 * team; every other server and game has no team. Everything is obviously fake ("Fake Team Alpha", "Fake Driver 007").
 */
import type { NexusBridge } from '../../shared/bridge'
import { isPastDate, isRacingGame, parseEventDate } from '../../shared/racingValidation'
import type {
  IpcResult,
  RacingDriverProfile,
  RacingEvent,
  RacingEventPage,
  RacingGame,
  RacingResult,
  RacingResultPage,
  RacingTeam,
  RacingTeamDetail,
  RosterAddResult,
  RosterEntry,
  RosterRemoveResult
} from '../../shared/types'
import { GAME_KEYS } from '../../shared/types'
import { failure, notFound, refused, timeoutFailure } from './common'
import type { F1MockContext } from './f1Mock'
import { MEMBERS } from './f1Mock'

type RacingMockApi = Pick<NexusBridge['api'], 'racingTeams' | 'racingTeam' | 'createRacingTeam' | 'addRosterMember' | 'removeRosterMember' | 'racingDriver' | 'racingEvents' | 'addRacingEvent' | 'racingResults' | 'logRacingResult'>

const DAY_MS = 86_400_000
const pad = (n: number, size = 3): string => String(n).padStart(size, '0')
const isoDay = (offsetDays: number): string => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10)
const stamp = (daysAgo: number): string => new Date(Date.now() - daysAgo * DAY_MS).toISOString()

/** 60 fake roster members who are not part of the member search; the first few are used on small teams. */
const FAKE_ROSTER = Array.from({ length: 60 }, (_, index) => ({ id: `41000000000000${pad(index + 1, 4)}`, username: `fake_user_${pad(index + 1)}`, name: `Fake Driver ${pad(index + 1)}` }))
/** One of them has left the server: still on the roster, found by id, gone from the server. */
const LEFT = new Set<string>([FAKE_ROSTER[2]!.id])
const KNOWN = new Map<string, { username: string; name: string }>([
  ...FAKE_ROSTER.map((member) => [member.id, { username: member.username, name: member.name }] as [string, { username: string; name: string }]),
  ...MEMBERS.map((member) => [member.id, { username: member.username, name: member.displayName }] as [string, { username: string; name: string }])
])
const inServer = (id: string): boolean => KNOWN.has(id) && !LEFT.has(id)

interface RosterState {
  userId: string
  role: string
  joinedAt: string
  /** The name stored when the member joined. */
  storedName: string
}
interface TeamState {
  name: string
  color: string
  focus: string
  roleId: string
  roleExists: boolean
  roster: RosterState[]
  createdAt: string
}
interface GameState {
  teams: TeamState[]
  events: RacingEvent[]
  /** The append-only archive, oldest first. */
  results: RacingResult[]
}
type GuildStates = Record<RacingGame, GameState>

const emptyGame = (): GameState => ({ teams: [], events: [], results: [] })
const emptyGuild = (): GuildStates => Object.fromEntries(GAME_KEYS.map((game) => [game, emptyGame()])) as GuildStates

let roleCounter = 0
const roleId = (): string => `91000000000000${pad(++roleCounter, 4)}`

function team(name: string, color: string, focus: string, members: Array<[number, string]>, over: Partial<TeamState> = {}): TeamState {
  return {
    name, color, focus, roleId: roleId(), roleExists: true, createdAt: stamp(60),
    roster: members.map(([index, role], position) => ({ userId: FAKE_ROSTER[index]!.id, role, joinedAt: stamp(40 - position), storedName: FAKE_ROSTER[index]!.name })),
    ...over
  }
}

function event(id: string, name: string, date: string, time: string, className: string, notes: string): RacingEvent {
  const parsed = parseEventDate(date)
  return { id, name, date, time, class: className, notes, dateIso: parsed?.iso ?? null, createdBy: '100000000000000001', createdAt: stamp(5) }
}

function seedEvents(prefix: string, label: string, className: string): RacingEvent[] {
  return [
    event(`${prefix}-1`, `${label} Fake Round 1`, isoDay(5), '20:00 UTC', className, 'bring fake snacks'),
    event(`${prefix}-2`, `${label} Fake Round 2`, isoDay(12), '19:30 CET', className, ''),
    event(`${prefix}-3`, `${label} Fake date written as 03/04/2027`, '03/04/2027', '18:00 UTC', '', 'Ambiguous on purpose: the bot reads this as March 4th (MM/DD/YYYY comes first), not 3 April.'),
    event(`${prefix}-4`, `${label} Fake unreadable date`, 'next friday', '21:00 UTC', className, 'Cannot be parsed: kept forever and listed last.')
  ]
}

/**
 * A big archive, oldest first: `count` entries spread over the teams of the game, one with HTML-looking text (it must show as plain text),
 * one with very long text. Obviously fake names only.
 */
function seedResults(prefix: string, teams: readonly string[], className: string, count: number): RacingResult[] {
  return Array.from({ length: count }, (_, index): RacingResult => {
    const first = FAKE_ROSTER[index % 40]!.name
    const second = FAKE_ROSTER[(index + 7) % 40]!.name
    const base = {
      id: `${prefix}-res-${pad(index + 1)}`,
      eventName: `Fake Round ${pad(index + 1, 2)}`,
      teamName: teams[index % teams.length] ?? 'Fake Team',
      result: `P${(index % 12) + 1} in ${className}`,
      drivers: `${first}, ${second}`,
      notes: index % 4 === 0 ? `Fake note for entry ${index + 1}` : '',
      loggedBy: '100000000000000001',
      loggedAt: stamp(count - index)
    }
    if (index === 1) return { ...base, eventName: '<b>Fake</b> <script>alert(1)</script> & "quotes"', notes: '<img src=x onerror=alert(1)> plain text only' }
    if (index === 2) return { ...base, eventName: `Fake Round With A Very Long Name ${'x'.repeat(70)}`, drivers: Array.from({ length: 12 }, (_, n) => FAKE_ROSTER[n]!.name).join(', '), notes: 'A long fake note. '.repeat(14) }
    return base
  })
}

function seedApex(): GuildStates {
  const state = emptyGuild()
  state.lmu = {
    teams: [
      team('Fake Endurance Racing', '#1E41FF', 'Hypercar', [[0, 'Manager'], [1, 'Race Driver'], [2, 'Race Driver'], [3, 'Reserve']]),
      team('Fake GT Squad', '#F43F5E', 'LMGT3', [[4, 'Coach'], [5, 'Race Driver']]),
      team('Fake Empty Team', '#6B7280', '', [])
    ],
    events: seedEvents('lmu', 'LMU', 'Hypercar'),
    results: seedResults('lmu', ['Fake Endurance Racing', 'Fake GT Squad'], 'Hypercar', 55)
  }
  state.iracing = {
    teams: [
      team('Fake Mega Squad', '#16A34A', 'Anything goes 1', Array.from({ length: 55 }, (_, index) => [index, index === 0 ? 'Manager' : index === 1 ? 'Coach' : index % 5 === 0 ? 'Reserve' : 'Race Driver'] as [number, string])),
      team('Fake Role Deleted Team', '#EAB308', 'GT3', [[0, 'Race Driver']], { roleExists: false })
    ],
    events: [
      ...seedEvents('ir', 'iRacing', 'GT3'),
      ...Array.from({ length: 30 }, (_, index) => event(`ir-x${index}`, `iRacing Fake Series Race ${pad(index + 1, 2)}`, isoDay(20 + index), '20:00 UTC', index % 2 === 0 ? 'GT3' : 'LMP2', ''))
    ],
    results: seedResults('ir', ['Fake Mega Squad', 'Fake Role Deleted Team'], 'GT3', 120)
  }
  state.gt7 = { teams: [team('Fake Gran Turismo Team', '#0EA5E9', 'Gr.3', [[6, 'Manager'], [7, 'Race Driver']])], events: seedEvents('gt', 'GT7', 'Gr.3').slice(0, 2), results: seedResults('gt', ['Fake Gran Turismo Team'], 'Gr.3', 52) }
  state.acc = { teams: [team('Fake ACC Team One', '#A855F7', 'GT3 Pro', [[8, 'Race Driver']]), team('Fake ACC Team Two', '#F97316', 'Cup', [[9, 'Coach'], [10, 'Race Driver']])], events: seedEvents('acc', 'ACC', 'GT3 Pro').slice(0, 3), results: seedResults('acc', ['Fake ACC Team One', 'Fake ACC Team Two'], 'GT3 Pro', 58) }
  state.f1 = { teams: [team('Fake F1 Esports A', '#E10600', 'Formula 1 Esports', [[11, 'Manager'], [12, 'Race Driver'], [13, 'Race Driver']]), team('Fake F1 Esports B', '#FF8000', '', [])], events: seedEvents('f1', 'F1 Esports', 'Pro').slice(0, 2), results: seedResults('f1', ['Fake F1 Esports A', 'Fake F1 Esports B'], 'Pro', 54) }
  return state
}

function seedMidnight(): GuildStates {
  const state = emptyGuild()
  state.lmu = { teams: [team('Fake Midnight Endurance Team With A Rather Long Name To Check The Layout', '#7C3AED', 'Hypercar and a very long free-text focus text', [[20, 'Manager'], [21, 'Race Driver']])], events: [], results: [] }
  return state
}

export function createRacingMock(ctx: F1MockContext): { api: RacingMockApi } {
  const scenario = ctx.scenario
  const states: Record<string, GuildStates> = { [ctx.apex]: seedApex(), [ctx.midnight]: seedMidnight() }
  if (scenario === 'noracingteams') for (const guild of Object.values(states)) for (const game of GAME_KEYS) guild[game] = emptyGame()
  if (scenario === 'noresults') for (const guild of Object.values(states)) for (const game of GAME_KEYS) guild[game].results = []
  const stateOf = (guildId: string): GuildStates => (states[guildId] ??= emptyGuild())

  const nostaff = scenario === 'nostaff'
  const lost = (name: string): boolean => scenario === 'lostracing' || /timeout/i.test(name)

  /** Every call: a known game first (404 unknown_game), then the server, then the staff role. */
  const gate = <T,>(guildId: string, game: string, run: (state: GameState) => IpcResult<T>): IpcResult<T> => {
    if (!isRacingGame(game)) return notFound('unknown_game', 'That game has no esports team module.')
    if (!ctx.known(guildId)) return notFound('guild_not_found', 'The bot is not in that server.')
    if (nostaff) return refused('forbidden', 'You need the Administrator permission, or the FIA or STAFF role, in this server.')
    return run(stateOf(guildId)[game])
  }
  /** Writes of the commands need Manage Server or Administrator. */
  const manage = <T,>(guildId: string, game: string, run: (state: GameState) => IpcResult<T>): IpcResult<T> =>
    gate(guildId, game, (state) => (scenario === 'nomanage' ? refused('manage_server_required', 'You need the Manage Server permission, or Administrator, to do this.') : run(state)))

  const findTeam = (state: GameState, name: string): TeamState | undefined => state.teams.find((item) => item.name.toLowerCase() === name.trim().toLowerCase())
  const rosterRow = (item: RosterState): RosterEntry => {
    const known = KNOWN.get(item.userId)
    const present = inServer(item.userId)
    return { userId: item.userId, username: known?.username ?? 'unknown', displayName: item.storedName, currentName: present ? (known?.name ?? null) : null, inServer: present, role: item.role, joinedAt: item.joinedAt }
  }
  const teamView = (item: TeamState): RacingTeam => ({
    name: item.name, color: item.color, focus: item.focus, roleId: item.roleId, roleName: item.roleExists ? item.name : null, roleExists: item.roleExists, memberCount: item.roster.length, createdBy: '100000000000000001', createdAt: item.createdAt
  })
  const detailView = (item: TeamState): RacingTeamDetail => ({ ...teamView(item), roster: item.roster.map(rosterRow) })

  const todayIso = (): string => new Date().toISOString().slice(0, 10)
  /** Upcoming events, soonest first; past ones are left out; unreadable dates come last in stored order (like /racing event-calendar). */
  const upcoming = (state: GameState): RacingEvent[] => {
    const readable = state.events.filter((item) => item.dateIso !== null && !isPastDate(item.dateIso, todayIso()))
    readable.sort((a, b) => (a.dateIso ?? '').localeCompare(b.dateIso ?? '') || a.time.localeCompare(b.time))
    return [...readable, ...state.events.filter((item) => item.dateIso === null)]
  }

  const api: RacingMockApi = {
    racingTeams: (guildId, game) =>
      ctx.api<RacingTeam[]>(() => gate(guildId, game, (state) => ({ ok: true, data: [...state.teams].sort((a, b) => a.name.localeCompare(b.name)).map(teamView) }))),

    racingTeam: (guildId, game, name) =>
      ctx.api<RacingTeamDetail>(() =>
        gate(guildId, game, (state) => {
          const found = findTeam(state, name)
          return found ? { ok: true, data: detailView(found) } : notFound('team_not_found', `Team '${name}' was not found.`)
        })
      ),

    createRacingTeam: (guildId, game, input) =>
      ctx.api<RacingTeamDetail>(() =>
        manage(guildId, game, (state) => {
          if (scenario === 'nomanageroles') return refused('bot_missing_manage_roles', 'The bot needs the Manage Roles permission.')
          if (findTeam(state, input.name)) return failure('http', 'team_exists', `A team named '${input.name}' already exists (any capitalisation).`, 409)
          const created: TeamState = { name: input.name, color: input.color, focus: input.focus ?? '', roleId: roleId(), roleExists: true, roster: [], createdAt: new Date().toISOString() }
          state.teams.push(created)
          if (lost(input.name)) return timeoutFailure() // created (with its role), but the answer "got lost"
          return { ok: true, data: detailView(created) }
        })
      ),

    addRosterMember: (guildId, game, input) =>
      ctx.api<RosterAddResult>(() =>
        manage(guildId, game, (state) => {
          const target = findTeam(state, input.team)
          if (!target) return notFound('team_not_found', `Team '${input.team}' was not found.`)
          if (!target.roleExists) return notFound('team_role_not_found', "The team's Discord role no longer exists.")
          if (scenario === 'nomanageroles') return refused('bot_missing_manage_roles', 'The bot needs the Manage Roles permission.')
          if (!inServer(input.userId)) return notFound('member_not_found', 'That member is not in this server.')
          if (target.roster.some((item) => item.userId === input.userId)) return failure('http', 'already_on_roster', 'That member is already on the roster.', 409)
          const known = KNOWN.get(input.userId)
          const entry: RosterState = { userId: input.userId, role: input.role, joinedAt: new Date().toISOString(), storedName: known?.name ?? 'unknown' }
          target.roster.push(entry)
          return { ok: true, data: { entry: rosterRow(entry), roleAssigned: true } }
        })
      ),

    removeRosterMember: (guildId, game, teamName, userId) =>
      ctx.api<RosterRemoveResult>(() =>
        manage(guildId, game, (state) => {
          const target = findTeam(state, teamName)
          if (!target) return notFound('team_not_found', `Team '${teamName}' was not found.`)
          const index = target.roster.findIndex((item) => item.userId === userId)
          const found = target.roster[index]
          if (!found) return notFound('not_on_roster', 'That member is not on the roster.')
          const row = rosterRow(found)
          target.roster.splice(index, 1) // also for a member who left the server: the entry is found by id
          const present = inServer(userId)
          return { ok: true, data: { removed: row, roleRemoved: present, roleError: null } }
        })
      ),

    racingDriver: (guildId, game, userId) =>
      ctx.api<RacingDriverProfile>(() =>
        gate(guildId, game, (state) => {
          const memberships = state.teams.flatMap((item) => {
            const found = item.roster.find((entry) => entry.userId === userId)
            return found ? [{ team: item.name, role: found.role, joinedAt: found.joinedAt, joined: found.joinedAt.slice(0, 10) }] : []
          })
          const present = inServer(userId)
          if (!present && memberships.length === 0) return notFound('driver_not_found', 'That member is not in the server and is on no team.')
          return { ok: true, data: { userId, displayName: present ? (KNOWN.get(userId)?.name ?? null) : null, inServer: present, memberships } }
        })
      ),

    racingEvents: (guildId, game, page = {}) =>
      ctx.api<RacingEventPage>(() =>
        gate(guildId, game, (state) => {
          const limit = page.limit ?? 25
          const offset = page.offset ?? 0
          const all = upcoming(state)
          return { ok: true, data: { total: all.length, limit, offset, events: all.slice(offset, offset + limit).map((item) => ({ ...item })) } }
        })
      ),

    racingResults: (guildId, game, query = {}) =>
      ctx.api<RacingResultPage>(() =>
        gate(guildId, game, (state) => {
          const limit = query.limit ?? 25
          const offset = query.offset ?? 0
          let all = state.results
          let team: string | null = null
          if (query.team !== undefined) {
            const found = findTeam(state, query.team)
            if (!found) return notFound('team_not_found', `Team '${query.team}' was not found.`)
            team = found.name
            all = all.filter((entry) => entry.teamName.toLowerCase() === found.name.toLowerCase())
          }
          return { ok: true, data: { team, total: all.length, limit, offset, results: all.slice(offset, offset + limit).map((entry) => ({ ...entry })) } }
        })
      ),

    logRacingResult: (guildId, game, input) =>
      ctx.api<RacingResult>(() =>
        manage(guildId, game, (state) => {
          const target = findTeam(state, input.team)
          if (!target) return notFound('team_not_found', `Team '${input.team}' was not found.`)
          const created: RacingResult = {
            id: `new-res-${state.results.length + 1}-${Date.now().toString(16)}`,
            eventName: input.eventName,
            teamName: target.name,
            result: input.result,
            drivers: input.drivers,
            notes: input.notes ?? '',
            loggedBy: '100000000000000001',
            loggedAt: new Date().toISOString()
          }
          state.results.push(created) // the same result twice is two entries: the archive never checks for duplicates
          if (lost(input.eventName)) return timeoutFailure() // appended, but the answer "got lost"
          return { ok: true, data: { ...created } }
        })
      ),

    addRacingEvent: (guildId, game, input) =>
      ctx.api<RacingEvent>(() =>
        manage(guildId, game, (state) => {
          const created = event(`new-${state.events.length + 1}-${Date.now().toString(16)}`, input.name, input.date, input.time, input.class ?? '', input.notes ?? '')
          state.events.push(created)
          if (lost(input.name)) return timeoutFailure() // stored, but the answer "got lost"
          return { ok: true, data: { ...created } }
        })
      )
  }

  return { api }
}
