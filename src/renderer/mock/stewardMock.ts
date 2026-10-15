/**
 * FAKE reports / penalties / dirty-drivers backend for `npm run dev:mock` (milestone 3). Part of the mock bridge: it
 * must never end up in an Electron build (it is only reachable through installMock.ts, which main.tsx loads behind
 * the compile-time `__NEXUS_MOCK__` flag).
 *
 * It is stateful and follows docs/APP_API.md (codes, limits, shapes), including the facts the UI depends on: a
 * decision is claimed once (the second answer is 409 already_decided), the report text of a decision is not returned,
 * manual points return the ban text instead of posting it, and the destructive endpoints refuse without confirm: true.
 *
 * Scenarios (query string, on top of the ones in installMock.ts and f1Mock.ts):
 *   noreports         no report exists in any server
 *   nopenaltyconfig   /league penalty-setup was never done: overview 404, deciding with points / manual points /
 *                     advance race answer 409 penalty_not_configured (nothing changes)
 *   nofia             staff without the FIA role (also for results): clear points, bans and advance race answer 403 fia_required
 *   notadmin          staff, not Administrator: saving the penalty settings answers 403 admin_required
 *   nostaff           the caller lost the staff role: every report / penalty / dirty-driver call answers 403 forbidden
 *   lostdecisions     every report decision is applied, then the answer is lost (timeout)
 *   nodirty           the dirty-driver list is empty in every server
 *
 * Hooks (normal scenario), put the word in a report decision's text, a driver name or a report's thread:
 *   description / explanation "timeout"        the decision IS applied, then the answer is lost
 *   description / explanation "race-condition" somebody decided the report in Discord first: 409 already_decided
 *   description / explanation "points-fail"    the report IS decided, the points are NOT saved: 500 penalty_points_failed
 *   a report without a message, or whose thread is named "deleted-thread": 404 report_message_not_found, nothing changes
 *   reason "timeout" (manual points, clear, dirty report): the write IS applied, then the answer is lost
 *   ban threshold: Apex season 5, thresholds 8 / 13. "Lando_N" has 7 points, so one more point reaches the qualifying
 *   ban and the answer carries the ban text.
 *
 * Sample data: "Apex Racing League" has 11 reports (pending, decided, a legacy "under investigation", one decided in
 * Discord meanwhile, one whose message is gone), configured penalty rules for season 5 and three dirty drivers.
 * "Midnight GT Championship" has 60 reports (to try the table with many rows), season 12 rules, no dirty drivers.
 * The report texts contain things like <script> and <b> on purpose: they must show up as plain text.
 */
import type {
  AdvanceRaceResult,
  BanResult,
  BanState,
  ClearPointsResult,
  DecisionResult,
  DirtyDriver,
  DirtyHistory,
  DirtyRemoveResult,
  DirtyReport,
  DirtyReportBody,
  DirtyReportResult,
  IpcResult,
  ManualPointsResult,
  PenaltyHistory,
  PenaltyHistoryItem,
  PenaltyOverview,
  PenaltyRow,
  PenaltySettings,
  Report,
  ReportPage,
  ReportRoundDetail,
  ReportRoundRow,
  ReportStatus
} from '../../shared/types'
import type { NexusBridge } from '../../shared/bridge'
import { failure, notFound, refused, timeoutFailure } from './common'
import type { F1MockContext } from './f1Mock'
import { checkLongText } from './textLimitsMock'

type StewardApi = Pick<
  NexusBridge['api'],
  | 'reports'
  | 'reportRounds'
  | 'reportRound'
  | 'report'
  | 'decideReport'
  | 'penaltySettings'
  | 'savePenaltySettings'
  | 'penaltyOverview'
  | 'penaltyHistory'
  | 'addPenaltyPoints'
  | 'clearPenaltyPoints'
  | 'setBan'
  | 'advanceRace'
  | 'dirtyDrivers'
  | 'dirtyHistory'
  | 'addDirtyReport'
  | 'removeDirtyReport'
>

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString()
const keyOf = (name: string): string => name.trim().toLowerCase()

// ── State ───────────────────────────────────────────────────────────────────

interface PenaltyDriverState {
  displayName: string
  total: number
  history: PenaltyHistoryItem[]
  quali: boolean
  race: boolean
}
interface PenaltyRules {
  configured: boolean
  currentSeason: number
  expiryRaces: number
  quali: number
  race: number
  setupBy: string | null
  setupAt: string | null
}
interface GuildState {
  reports: Report[]
  rules: PenaltyRules
  /** season -> driver key -> record */
  penalties: Map<number, Map<string, PenaltyDriverState>>
  dirty: Map<string, { displayName: string; reports: DirtyReportBody[] }>
}

const DEFAULTS = { currentSeason: 1, expiryRaces: 15, qualiBanThreshold: 8, raceBanThreshold: 13 }

function makeReport(guildTag: string, serial: number, roundKey: string, over: Partial<Report> & Pick<Report, 'season' | 'round' | 'circuit' | 'number'>): Report {
  const status: ReportStatus = over.status ?? 'pending'
  const decided = status === 'penalty_issued' || status === 'no_further_action'
  return {
    id: `rp${guildTag}${serial.toString(16).padStart(6, '0')}`,
    roundKey,
    reporter: 'Reporter Rita',
    reporterId: '20000000000000034',
    driversInvolved: 'Max Verstappen, Lando Norris',
    lap: '4',
    description: 'Contact into turn 1, I was alongside and got squeezed.',
    evidenceUrl: null,
    evidenceImg: null,
    status,
    decided,
    penalty: null,
    decision: null,
    threadName: `Report #${over.number} - ${roundKey} - ${over.circuit}`,
    messageId: `88800000000000${String(1000 + serial)}`,
    timestamp: iso((serial % 40) * DAY_MS + (serial % 7) * HOUR_MS),
    ...over
  }
}

function seedApexReports(): Report[] {
  const t = 'a'
  return [
    makeReport(t, 1, 'S5R3', {
      season: '5', round: '3', circuit: 'Zandvoort', number: 1, driversInvolved: 'alice_x, bob_y',
      description: 'Bob divebombed at turn 3 <b>and took me out</b>. <script>alert("x")</script> Plain text only, please.',
      evidenceUrl: 'https://discord.com/channels/555000000000000001/777000000000000004/999000000000000001',
      evidenceImg: 'https://cdn.discordapp.com/attachments/777000000000000004/999000000000000002/turn3.png'
    }),
    makeReport(t, 2, 'S5R3', {
      season: '5', round: '3', circuit: 'Zandvoort', number: 2, status: 'penalty_issued', driversInvolved: 'Charles Leclerc, Lewis Hamilton',
      description: 'Track limits repeatedly at the final corner.', penalty: '5 second time penalty', decision: { type: 'penalty_issued', penalty: '5 second time penalty' },
      evidenceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    }),
    makeReport(t, 3, 'S5R3', {
      season: '5', round: '3', circuit: 'Zandvoort', number: 3, status: 'no_further_action', driversInvolved: 'Oscar Piastri',
      description: 'Blocking in qualifying.', decision: { type: 'no_further_action', penalty: null }, evidenceImg: 'https://i.imgur.com/example.png'
    }),
    makeReport(t, 4, 'S5R4', {
      season: '5', round: '4', circuit: 'Monza Grand Prix', number: 1, driversInvolved: 'George Russell, Carlos Sainz', lap: '12',
      description: 'A very long description. '.repeat(30).trim(), evidenceUrl: 'http://insecure.example/clip.mp4', evidenceImg: 'http://insecure.example/frame.png'
    }),
    makeReport(t, 5, 'S5R4', {
      season: '5', round: '4', circuit: 'Monza Grand Prix', number: 2, driversInvolved: 'Fernando Alonso, Max Vandoorne',
      description: 'Pushed off at the Parabolica. (race-condition: someone else decides this one in Discord first)'
    }),
    makeReport(t, 6, 'S5R4', {
      season: '5', round: '4', circuit: 'Monza Grand Prix', number: 3, driversInvolved: 'Alex Albon',
      description: 'The thread of this report was deleted in Discord.', threadName: 'Report #3 - S5R4 - Monza Grand Prix (deleted-thread)'
    }),
    makeReport(t, 7, 'S5R4', {
      season: '5', round: '4', circuit: 'Monza Grand Prix', number: 4, driversInvolved: 'Yuki Tsunoda', description: 'A legacy report without a tracked message.', messageId: null
    }),
    makeReport(t, 8, 'S5R2', {
      season: '5', round: '2', circuit: 'Bahrain GP', number: 1, status: 'under_investigation', driversInvolved: 'Pierre Gasly, Esteban Ocon',
      description: 'Under investigation by the stewards (legacy button).'
    }),
    makeReport(t, 9, 'S5R2', {
      season: '5', round: '2', circuit: 'Bahrain GP', number: 2, status: 'penalty_issued', driversInvolved: 'A Driver With An Extremely Long Display Name To Test The Layout, Lance Stroll',
      description: 'Causing a collision.', penalty: '10 second time penalty and 3 penalty points', decision: { type: 'penalty_issued', penalty: '10 second time penalty and 3 penalty points' }
    }),
    makeReport(t, 10, 'S5R1', {
      season: '5', round: '1', circuit: 'Australian GP', number: 1, driversInvolved: 'Nico Hulkenberg, Kevin Magnussen', description: 'Unsafe rejoin.',
      evidenceUrl: 'https://discord.com/channels/555000000000000001/777000000000000004/999000000000000010'
    }),
    makeReport(t, 11, 'S5R1', {
      season: '5', round: '1', circuit: 'Australian GP', number: 2, status: 'no_further_action', driversInvolved: 'Valtteri Bottas', description: 'Pit lane speeding claim.', decision: { type: 'no_further_action', penalty: null }
    })
  ]
}

const MIDNIGHT_CIRCUITS = ['Bahrain GP', 'Jeddah Corniche', 'Albert Park', 'Suzuka', 'Imola', 'Miami']

function seedMidnightReports(): Report[] {
  const counters = new Map<string, number>()
  const statuses: ReportStatus[] = ['pending', 'pending', 'penalty_issued', 'no_further_action', 'pending', 'penalty_issued', 'under_investigation']
  return Array.from({ length: 60 }, (_, index) => {
    const round = (index % 6) + 1
    const roundKey = `S12R${round}`
    const number = (counters.get(roundKey) ?? 0) + 1
    counters.set(roundKey, number)
    const status = statuses[index % statuses.length] ?? 'pending'
    const decided = status === 'penalty_issued' || status === 'no_further_action'
    return makeReport('m', index + 1, roundKey, {
      season: '12', round: String(round), circuit: MIDNIGHT_CIRCUITS[round - 1] ?? 'Unknown', number, status,
      driversInvolved: `Driver ${index + 1}, Driver ${((index * 7) % 60) + 1}`, lap: String((index % 20) + 1),
      description: `Incident ${index + 1}: contact in sector ${(index % 3) + 1}.`,
      reporter: `Reporter ${(index % 9) + 1}`,
      ...(decided ? { penalty: status === 'penalty_issued' ? '5 second time penalty' : null, decision: { type: status, penalty: status === 'penalty_issued' ? '5 second time penalty' : null } } : {})
    })
  })
}

const entry = (points: number, reason: string, race: string, expiresAfter: number | null, daysAgo: number, index: number): PenaltyHistoryItem => ({
  index, points, reason, race, expiresAfterRace: expiresAfter, timestamp: iso(daysAgo * DAY_MS)
})

function seedApexPenalties(): Map<number, Map<string, PenaltyDriverState>> {
  const season5 = new Map<string, PenaltyDriverState>([
    ['max_v', { displayName: 'Max_V', total: 14, quali: true, race: true, history: [entry(5, 'Causing a collision', 'Season 5 Round 2 — Bahrain GP', 17, 30, 1), entry(6, 'Repeated track limits', 'Season 5 Round 3 — Zandvoort', 18, 22, 2), entry(3, 'Contact at T1', 'Season 5 Round 4 — Monza Grand Prix', 19, 8, 3)] }],
    ['lando_n', { displayName: 'Lando_N', total: 7, quali: false, race: false, history: [entry(4, 'Unsafe rejoin', 'Season 5 Round 1 — Australian GP', 16, 40, 1), entry(3, 'Blocking', 'Season 5 Round 3 — Zandvoort', 18, 21, 2)] }],
    ['charles_l', { displayName: 'Charles_L', total: 9, quali: true, race: false, history: [entry(9, 'Dangerous driving', 'Season 5 Round 2 — Bahrain GP', 17, 31, 1)] }],
    ['bobby_r', { displayName: 'Bobby_R', total: 2, quali: false, race: false, history: [entry(2, 'Ignoring blue flags', 'Season 5 Round 3 — Zandvoort', 18, 20, 1)] }],
    ['a driver with an extremely long display name to test the layout', { displayName: 'A Driver With An Extremely Long Display Name To Test The Layout', total: 3, quali: false, race: false, history: [entry(3, 'Causing a collision', 'Season 5 Round 2 — Bahrain GP', 17, 29, 1)] }]
  ])
  const season4 = new Map<string, PenaltyDriverState>([
    ['max_v', { displayName: 'Max_V', total: 4, quali: false, race: false, history: [entry(4, 'Track limits', 'Season 4 Round 9 — Brazilian GP', 24, 200, 1)] }]
  ])
  return new Map([[5, season5], [4, season4]])
}

function seedMidnightPenalties(): Map<number, Map<string, PenaltyDriverState>> {
  return new Map([[12, new Map<string, PenaltyDriverState>([['driver 3', { displayName: 'Driver 3', total: 5, quali: false, race: false, history: [entry(5, 'Contact', 'Season 12 Round 2 — Jeddah Corniche', 17, 12, 1)] }]])]])
}

const dirtyBody = (reason: string, evidence: string, reportedBy: string, incident: string | null, daysAgo: number): DirtyReportBody => ({ reason, evidence, reportedBy, relatedIncident: incident, timestamp: iso(daysAgo * DAY_MS) })

function seedApexDirty(): Map<string, { displayName: string; reports: DirtyReportBody[] }> {
  return new Map([
    ['max_v', { displayName: 'Max_V', reports: [dirtyBody('Rammed another driver on purpose at the start.', 'https://discord.com/channels/555000000000000001/777000000000000004/999000000000000003', 'boss', 'Season 5 Round 3 — Zandvoort', 14), dirtyBody('Repeated <b>deliberate</b> blocking in qualifying.', 'https://www.youtube.com/watch?v=abc', 'steward_sophie', null, 3)] }],
    ['bobby_r', { displayName: 'Bobby_R', reports: [dirtyBody('Left the lobby mid-race twice.', 'http://insecure.example/proof', 'boss', 'Season 5 Round 2', 30)] }],
    ['a driver with an extremely long display name to test the layout', { displayName: 'A Driver With An Extremely Long Display Name To Test The Layout', reports: [dirtyBody('Unsportsmanlike chat messages. '.repeat(10).trim(), 'https://discord.com/channels/555000000000000001/777000000000000004/999000000000000004', 'marshal_sam', 'Season 5 Round 4 — Monza Grand Prix', 6)] }]
  ])
}

// ── The mock ────────────────────────────────────────────────────────────────

export function createStewardMock(ctx: F1MockContext): {
  api: StewardApi
  counts: (guildId: string) => { reports: number; pending: number; penaltiesConfigured: boolean } | null
} {
  const scenario = ctx.scenario
  const states: Record<string, GuildState> = {
    [ctx.apex]: {
      reports: scenario === 'noreports' ? [] : seedApexReports(),
      rules: { configured: scenario !== 'nopenaltyconfig', currentSeason: 5, expiryRaces: 15, quali: 8, race: 13, setupBy: 'boss', setupAt: iso(60 * DAY_MS) },
      penalties: seedApexPenalties(),
      dirty: scenario === 'nodirty' ? new Map() : seedApexDirty()
    },
    [ctx.midnight]: {
      reports: scenario === 'noreports' ? [] : seedMidnightReports(),
      rules: { configured: scenario !== 'nopenaltyconfig', currentSeason: 12, expiryRaces: 10, quali: 6, race: 10, setupBy: 'owner', setupAt: iso(90 * DAY_MS) },
      penalties: seedMidnightPenalties(),
      dirty: new Map() // an empty dirty-driver list
    }
  }
  const emptyState = (): GuildState => ({
    reports: [],
    rules: { configured: false, currentSeason: 1, expiryRaces: DEFAULTS.expiryRaces, quali: DEFAULTS.qualiBanThreshold, race: DEFAULTS.raceBanThreshold, setupBy: null, setupAt: null },
    penalties: new Map(),
    dirty: new Map()
  })
  const stateOf = (guildId: string): GuildState => (states[guildId] ??= emptyState())

  const nostaff = scenario === 'nostaff'
  const nofia = scenario === 'nofia'
  const lostAnswer = (text: string): boolean => scenario === 'lostdecisions' || /timeout/i.test(text)

  /** Every call: the server must know the guild, and a caller without the staff role is refused. */
  const gate = <T,>(guildId: string, run: (state: GuildState) => IpcResult<T>): IpcResult<T> => {
    if (!ctx.known(guildId)) return notFound('guild_not_found', 'The bot is not in that server.')
    if (nostaff) return refused('forbidden', 'You need the Administrator permission, or the FIA or STAFF role, in this server.')
    return run(stateOf(guildId))
  }
  const fiaGate = <T,>(guildId: string, run: (state: GuildState) => IpcResult<T>): IpcResult<T> =>
    gate(guildId, (state) => (nofia ? refused('fia_required', 'The FIA role or Administrator permission is required.') : run(state)))

  const seasonOfReport = (state: GuildState, report: Report): number => {
    const parsed = /^\d{1,5}$/.test(report.season.trim()) ? Number(report.season.trim()) : NaN
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : state.rules.currentSeason
  }

  // ── Penalty helpers ──
  const banState = (record: PenaltyDriverState): BanState => (record.race ? 'race' : record.quali ? 'quali' : 'none')
  const recordsOf = (state: GuildState, season: number): Map<string, PenaltyDriverState> => {
    let records = state.penalties.get(season)
    if (!records) {
      records = new Map()
      state.penalties.set(season, records)
    }
    return records
  }
  const reportedCount = (state: GuildState, key: string): number => state.dirty.get(key)?.reports.length ?? 0
  const incidents = (record: PenaltyDriverState): number => record.history.filter((item) => item.points > 0).length

  /** Adds points and applies the ban thresholds in the same step; returns the ban text when a threshold was newly reached. */
  function addPoints(state: GuildState, season: number, driver: string, points: number, reason: string, race: string): { record: PenaltyDriverState; banNotice: string | null } {
    const records = recordsOf(state, season)
    const key = keyOf(driver)
    const record = records.get(key) ?? { displayName: driver.trim(), total: 0, history: [], quali: false, race: false }
    record.total += points
    record.history.push({ index: record.history.length + 1, points, reason, race, expiresAfterRace: state.rules.expiryRaces, timestamp: new Date().toISOString() })
    let notice: string | null = null
    const escaped = record.displayName.replace(/_/g, '\\_')
    if (!record.race && record.total >= state.rules.race) {
      record.race = true
      notice = `⚠️ **RACE BAN** — **${escaped}** has reached **${record.total}** penalty points (threshold ${state.rules.race}) and is banned from the next race.`
    }
    if (!record.quali && record.total >= state.rules.quali) {
      record.quali = true
      notice ??= `⚠️ **QUALI BAN** — **${escaped}** has reached **${record.total}** penalty points (threshold ${state.rules.quali}) and is banned from the next qualifying.`
    }
    records.set(key, record)
    return { record, banNotice: notice }
  }

  const recalcBans = (state: GuildState, record: PenaltyDriverState): void => {
    record.quali = record.total >= state.rules.quali
    record.race = record.total >= state.rules.race
  }

  const dirtyReports = (entryOf: { reports: DirtyReportBody[] }): DirtyReport[] => entryOf.reports.map((body, position) => ({ index: position + 1, ...body }))

  // ── Report helpers ──
  const sorted = (reports: Report[]): Report[] => [...reports].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  const view = (report: Report): Report => ({ ...report, decision: report.decision ? { ...report.decision } : null })

  const api: StewardApi = {
    reports: (guildId, filters = {}) =>
      ctx.api<ReportPage>(() =>
        gate(guildId, (state) => {
          const limit = filters.limit ?? 50
          const offset = filters.offset ?? 0
          const matches = sorted(state.reports).filter(
            (report) =>
              (filters.season === undefined || report.season.trim().toLowerCase() === filters.season.trim().toLowerCase()) &&
              (filters.round === undefined || report.round.trim().toLowerCase() === filters.round.trim().toLowerCase()) &&
              (filters.status === undefined || report.status === filters.status) &&
              (filters.driver === undefined || report.driversInvolved.toLowerCase().includes(filters.driver.trim().toLowerCase()))
          )
          return { ok: true, data: { total: matches.length, limit, offset, reports: matches.slice(offset, offset + limit).map(view) } }
        })
      ),

    reportRounds: (guildId) =>
      ctx.api<ReportRoundRow[]>(() =>
        gate(guildId, (state) => {
          const rows = new Map<string, ReportRoundRow>()
          for (const report of state.reports) {
            const row = rows.get(report.roundKey) ?? { season: report.season, round: report.round, roundKey: report.roundKey, circuit: report.circuit, total: 0, pending: 0, underInvestigation: 0, penaltyIssued: 0, noFurtherAction: 0 }
            row.total++
            if (report.status === 'pending') row.pending++
            if (report.status === 'under_investigation') row.underInvestigation++
            if (report.status === 'penalty_issued') row.penaltyIssued++
            if (report.status === 'no_further_action') row.noFurtherAction++
            rows.set(report.roundKey, row)
          }
          return { ok: true, data: [...rows.values()].sort((a, b) => a.roundKey.localeCompare(b.roundKey, 'en', { numeric: true })) }
        })
      ),

    reportRound: (guildId, season, round) =>
      ctx.api<ReportRoundDetail>(() =>
        gate(guildId, (state) => {
          const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
          const reports = state.reports.filter((report) => same(report.season, season) && same(report.round, round)).sort((a, b) => a.number - b.number)
          return { ok: true, data: { season, round, roundKey: reports[0]?.roundKey ?? `S${season}R${round}`, circuit: reports[0]?.circuit ?? '', count: reports.length, reports: reports.map(view) } }
        })
      ),

    report: (guildId, reportId) =>
      ctx.api<Report>(() =>
        gate(guildId, (state) => {
          const found = state.reports.find((report) => report.id === reportId)
          return found ? { ok: true, data: view(found) } : notFound('report_not_found', 'That report was not found.')
        })
      ),

    decideReport: (guildId, reportId, input) =>
      ctx.api<DecisionResult>(() =>
        gate(guildId, (state) => {
          const report = state.reports.find((item) => item.id === reportId)
          if (!report) return notFound('report_not_found', 'That report was not found.')
          const text = input.decision === 'penalty_issued' ? input.description : input.explanation
          const tooLong = checkLongText(input.decision === 'penalty_issued' ? 'decisionDescription' : 'decisionExplanation', text)
          if (tooLong) return tooLong
          const points = input.decision === 'penalty_issued' ? input.penaltyPoints : 0

          // 1. Nothing changes until the bot found the report's message and thread.
          if (report.messageId === null || /deleted-thread/i.test(report.threadName)) {
            return notFound('report_message_not_found', "The bot cannot find this report's message or thread in Discord.")
          }
          if (report.decided) return failure('http', 'already_decided', 'This report was already decided.', 409)
          if (points > 0 && !state.rules.configured) {
            return failure('http', 'penalty_not_configured', 'The penalty points are not set up yet. Run /league penalty-setup first.', 409)
          }
          if (input.decision === 'penalty_issued' && points > 0 && (input.driver === undefined || input.driver.trim() === '')) {
            return failure('http', 'driver_required', 'A driver is required when penalty points are given.', 400)
          }
          // A decision made in Discord a moment earlier: the claim is lost.
          if (/race-condition/i.test(text) || /race-condition/i.test(report.description)) {
            report.status = 'no_further_action'
            report.decided = true
            report.decision = { type: 'no_further_action', penalty: null }
            return failure('http', 'already_decided', 'This report was already decided.', 409)
          }

          // 2 + 3. The report is claimed and its embed edited (the explanation and the awarded points are not stored on the report).
          report.status = input.decision
          report.decided = true
          report.penalty = input.decision === 'penalty_issued' ? text : null
          report.decision = { type: input.decision, penalty: input.decision === 'penalty_issued' ? text : null }

          // 4. The points.
          const result: DecisionResult = {
            decision: input.decision,
            report: view(report),
            points: { applied: false, driver: null, added: 0, season: null, total: null, qualiBanned: false, raceBanned: false, banNotice: null, banNoticePosted: false },
            warnings: []
          }
          if (input.decision === 'penalty_issued' && points > 0) {
            if (/points-fail/i.test(text)) return failure('http', 'penalty_points_failed', 'The report was decided, but saving the penalty points failed.', 500)
            const season = input.season ?? seasonOfReport(state, report)
            const driver = (input.driver ?? '').trim()
            const added = addPoints(state, season, driver, points, input.description, `Season ${report.season} Round ${report.round} — ${report.circuit}`)
            result.points = {
              applied: true, driver: added.record.displayName, added: points, season, total: added.record.total,
              qualiBanned: added.record.quali, raceBanned: added.record.race, banNotice: added.banNotice, banNoticePosted: added.banNotice !== null
            }
          }
          if (lostAnswer(text)) return timeoutFailure() // decided (and the points saved), but the answer "got lost"
          return { ok: true, data: result }
        })
      ),

    // ── Penalty settings ──
    penaltySettings: (guildId) =>
      ctx.api<PenaltySettings>(() =>
        gate(guildId, (state) => ({ ok: true, data: settingsView(state) }))
      ),

    savePenaltySettings: (guildId, input) =>
      ctx.api<PenaltySettings>(() =>
        gate(guildId, (state) => {
          if (!ctx.isAdmin) return refused('admin_required', 'Administrator permission is required to change the penalty settings.')
          state.rules = { configured: true, currentSeason: input.currentSeason, expiryRaces: input.expiryRaces, quali: input.qualiBanThreshold, race: input.raceBanThreshold, setupBy: 'DemoStaff', setupAt: new Date().toISOString() }
          return { ok: true, data: settingsView(state) } // the points are never touched by a settings write
        })
      ),

    // ── Penalty points ──
    penaltyOverview: (guildId, season) =>
      ctx.api<PenaltyOverview>(() =>
        gate(guildId, (state) => {
          if (!state.rules.configured) return notFound('penalty_not_configured', 'The penalty points are not set up yet.')
          const wanted = season ?? state.rules.currentSeason
          const rows: PenaltyRow[] = [...(state.penalties.get(wanted)?.entries() ?? [])]
            .sort((a, b) => b[1].total - a[1].total || a[1].displayName.localeCompare(b[1].displayName))
            .map(([key, record], index) => ({
              position: index + 1, key, displayName: record.displayName, totalPoints: record.total, incidents: incidents(record), ban: banState(record),
              qualiBanned: record.quali, raceBanned: record.race, reportedCount: reportedCount(state, key)
            }))
          return {
            ok: true,
            data: { season: wanted, currentSeason: state.rules.currentSeason, isCurrent: wanted === state.rules.currentSeason, settings: { expiryRaces: state.rules.expiryRaces, qualiBanThreshold: state.rules.quali, raceBanThreshold: state.rules.race }, drivers: rows }
          }
        })
      ),

    penaltyHistory: (guildId, driver, season) =>
      ctx.api<PenaltyHistory>(() =>
        gate(guildId, (state) => {
          const wanted = season ?? state.rules.currentSeason
          const record = state.penalties.get(wanted)?.get(keyOf(driver))
          if (!record) return notFound('driver_not_found', `No penalty record was found for ${driver} in season ${wanted}.`)
          return {
            ok: true,
            data: {
              season: wanted, key: keyOf(driver), displayName: record.displayName, totalPoints: record.total, incidents: incidents(record), ban: banState(record),
              qualiBanned: record.quali, raceBanned: record.race, history: record.history.map((item) => ({ ...item }))
            }
          }
        })
      ),

    addPenaltyPoints: (guildId, input) =>
      ctx.api<ManualPointsResult>(() =>
        gate(guildId, (state) => {
          const tooLong = checkLongText('penaltyPointsReason', input.reason) // the fake server's own check of the text limit
          if (tooLong) return tooLong
          if (input.points === 0 && input.channelId === undefined) return failure('http', 'nothing_to_do', '0 points records nothing and needs a channel.', 400)
          if (input.channelId !== undefined) {
            if (input.channelId === ctx.hiddenChannel) return refused('forbidden', 'You cannot see that channel.')
            if (!ctx.channels.some((channel) => channel.id === input.channelId)) return notFound('channel_not_found', 'That text channel was not found in this server.')
            if (input.channelId === ctx.lockedChannel) return refused('bot_cannot_send', 'The bot cannot post in that channel.')
          }
          if (!state.rules.configured) return failure('http', 'penalty_not_configured', 'The penalty points are not set up yet. Run /league penalty-setup first.', 409)
          const season = input.season ?? state.rules.currentSeason
          let outcome: { record: PenaltyDriverState | null; banNotice: string | null } = { record: null, banNotice: null }
          if (input.points > 0) outcome = addPoints(state, season, input.driver, input.points, `${input.penaltyType}: ${input.reason}`, `Season ${season} — Manual Penalty`)
          const posted = input.channelId !== undefined ? { channelId: input.channelId, messageId: ctx.newMessageId() } : null
          if (/timeout/i.test(input.reason)) return timeoutFailure() // applied, but the answer "got lost"
          return {
            ok: true,
            data: {
              driver: input.driver.trim(), season, saved: input.points > 0, pointsAdded: input.points, totalPoints: outcome.record?.total ?? null,
              qualiBanned: outcome.record?.quali ?? false, raceBanned: outcome.record?.race ?? false,
              // Returned, never posted: the command shows it only to the person who issued the penalty.
              banNotice: outcome.banNotice, posted, announceError: null
            }
          }
        })
      ),

    clearPenaltyPoints: (guildId, input) =>
      ctx.api<ClearPointsResult>(() =>
        fiaGate(guildId, (state) => {
          const tooLong = checkLongText('penaltyClearReason', input.reason)
          if (tooLong) return tooLong
          const season = input.season ?? state.rules.currentSeason
          const record = state.penalties.get(season)?.get(keyOf(input.driver))
          if (!record) return notFound('driver_not_found', `No penalty record was found for ${input.driver} in season ${season}.`)
          let result: ClearPointsResult
          if (input.points === undefined) {
            result = { driver: record.displayName, season, mode: 'all', pointsRemoved: record.total, remaining: 0 }
            record.total = 0
            record.history = []
            record.quali = false
            record.race = false
          } else {
            const removed = Math.min(input.points, record.total)
            record.total -= removed
            record.history.push({ index: record.history.length + 1, points: -input.points, reason: `Admin removed ${input.points} pts: ${input.reason}`, race: `Season ${season} — Admin removal`, expiresAfterRace: null, timestamp: new Date().toISOString() })
            recalcBans(state, record)
            result = { driver: record.displayName, season, mode: 'partial', pointsRemoved: removed, remaining: record.total }
          }
          if (/timeout/i.test(input.reason)) return timeoutFailure()
          return { ok: true, data: result }
        })
      ),

    setBan: (guildId, input) =>
      ctx.api<BanResult>(() =>
        fiaGate(guildId, (state) => {
          const season = input.season ?? state.rules.currentSeason
          const records = recordsOf(state, season)
          let record = records.get(keyOf(input.driver))
          if (!record) {
            if (input.action === 'remove') return notFound('driver_not_found', `No penalty record was found for ${input.driver} in season ${season}.`)
            record = { displayName: input.driver.trim(), total: 0, history: [], quali: false, race: false }
            records.set(keyOf(input.driver), record)
          }
          if (input.banType === 'quali') record.quali = input.action === 'give'
          else record.race = input.action === 'give'
          return { ok: true, data: { driver: record.displayName, season, action: input.action, banType: input.banType, qualiBanned: record.quali, raceBanned: record.race, totalPoints: record.total } }
        })
      ),

    advanceRace: (guildId, input) =>
      ctx.api<AdvanceRaceResult>(() =>
        fiaGate(guildId, (state) => {
          if (!state.rules.configured) return failure('http', 'penalty_not_configured', 'The penalty points are not set up yet.', 409)
          const season = state.rules.currentSeason
          const expired: AdvanceRaceResult['expired'] = []
          const updated: AdvanceRaceResult['updated'] = []
          for (const [key, record] of state.penalties.get(season) ?? []) {
            const before = record.total
            const keep: PenaltyHistoryItem[] = []
            for (const item of record.history) {
              if (item.expiresAfterRace !== null && item.expiresAfterRace <= input.raceNumber) {
                expired.push({ key, displayName: record.displayName, points: item.points, race: item.race })
                record.total = Math.max(0, record.total - item.points)
              } else keep.push(item)
            }
            record.history = keep.map((item, position) => ({ ...item, index: position + 1 }))
            recalcBans(state, record)
            if (record.total !== before) updated.push({ key, displayName: record.displayName, oldTotal: before, newTotal: record.total })
          }
          return { ok: true, data: { raceNumber: input.raceNumber, season, expired, updated } }
        })
      ),

    // ── Dirty drivers ──
    dirtyDrivers: (guildId) =>
      ctx.api<DirtyDriver[]>(() =>
        gate(guildId, (state) => ({
          ok: true,
          data: [...state.dirty.entries()]
            .map(([key, value]): DirtyDriver => ({ key, displayName: value.displayName, reportCount: value.reports.length, latest: { ...(value.reports[value.reports.length - 1] as DirtyReportBody) } }))
            .sort((a, b) => b.latest.timestamp.localeCompare(a.latest.timestamp))
        }))
      ),

    dirtyHistory: (guildId, driver) =>
      ctx.api<DirtyHistory>(() =>
        gate(guildId, (state) => {
          const found = state.dirty.get(keyOf(driver))
          if (!found) return notFound('driver_not_found', `${driver} has no dirty-driver reports.`)
          return { ok: true, data: { key: keyOf(driver), displayName: found.displayName, total: found.reports.length, reports: dirtyReports(found) } }
        })
      ),

    addDirtyReport: (guildId, input) =>
      ctx.api<DirtyReportResult>(() =>
        gate(guildId, (state) => {
          const key = keyOf(input.driver)
          const found = state.dirty.get(key) ?? { displayName: input.driver.trim(), reports: [] }
          found.reports.push({ reason: input.reason, evidence: input.evidenceUrl, reportedBy: 'DemoStaff', relatedIncident: input.relatedIncident ?? null, timestamp: new Date().toISOString() })
          state.dirty.set(key, found)
          const report: DirtyReport = { index: found.reports.length, ...(found.reports[found.reports.length - 1] as DirtyReportBody) }
          if (/timeout/i.test(input.reason)) return timeoutFailure()
          return { ok: true, data: { displayName: found.displayName, totalReports: found.reports.length, report } }
        })
      ),

    removeDirtyReport: (guildId, driver, index) =>
      ctx.api<DirtyRemoveResult>(() =>
        gate(guildId, (state) => {
          const found = state.dirty.get(keyOf(driver))
          const removed = found?.reports[index - 1]
          if (!found || !removed) return notFound('report_not_found', `Report ${index} was not found.`)
          found.reports.splice(index - 1, 1) // later reports move up: the numbers shift
          const driverRemoved = found.reports.length === 0
          if (driverRemoved) state.dirty.delete(keyOf(driver))
          if (/timeout/i.test(removed.reason)) return timeoutFailure()
          return { ok: true, data: { displayName: found.displayName, removedIndex: index, driverRemoved, removed: { ...removed } } }
        })
      )
  }

  function settingsView(state: GuildState): PenaltySettings {
    const rules = state.rules
    return {
      configured: rules.configured,
      currentSeason: rules.currentSeason,
      expiryRaces: rules.configured ? rules.expiryRaces : null,
      qualiBanThreshold: rules.configured ? rules.quali : null,
      raceBanThreshold: rules.configured ? rules.race : null,
      setupBy: rules.configured ? rules.setupBy : null,
      setupAt: rules.configured ? rules.setupAt : null,
      defaults: { ...DEFAULTS }
    }
  }

  return {
    api,
    counts: (guildId) => {
      if (!(guildId in states)) return null
      const state = stateOf(guildId)
      return { reports: state.reports.length, pending: state.reports.filter((report) => !report.decided).length, penaltiesConfigured: state.rules.configured }
    }
  }
}
