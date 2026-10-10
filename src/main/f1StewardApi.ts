import { isReportId, isReportStatus } from '../shared/penaltyValidation'
import type {
  AdvanceRaceInput,
  AdvanceRaceResult,
  BanInput,
  BanResult,
  BanState,
  ClearPointsInput,
  ClearPointsResult,
  DecisionInput,
  DecisionPoints,
  DecisionResult,
  DirtyDriver,
  DirtyHistory,
  DirtyRemoveResult,
  DirtyReport,
  DirtyReportBody,
  DirtyReportInput,
  DirtyReportResult,
  ManualPointsInput,
  ManualPointsResult,
  PenaltyDefaults,
  PenaltyHistory,
  PenaltyHistoryItem,
  PenaltyOverview,
  PenaltyRow,
  PenaltySettings,
  PenaltySettingsInput,
  Report,
  ReportFilters,
  ReportPage,
  ReportRoundDetail,
  ReportRoundRow
} from '../shared/types'
import { isValidSnowflake } from '../shared/validation'
import type { ApiClient } from './apiClient'
import { clientError, invalid, isCount, isRecord, list } from './apiParse'

/**
 * The reports, penalty and dirty-driver endpoints of docs/APP_API.md (milestone 3). Paths, methods, bodies and
 * response shapes follow that document and nothing else; every response is validated before the UI sees it.
 *
 * Every write here goes out exactly once: the ApiClient never replays a POST / PUT / DELETE after a timeout or a
 * lost answer, so a report decision, penalty points or a removal can never be applied twice by a retry.
 * The destructive endpoints (clear, bans, advance race) additionally refuse to be called without `confirm: true`.
 */
export interface StewardApi {
  reports: (guildId: string, filters?: ReportFilters) => Promise<ReportPage>
  /** One row per round that has reports (GET /reports/overview without a season and round). */
  reportRounds: (guildId: string) => Promise<ReportRoundRow[]>
  /** The reports of one round (GET /reports/overview?season&round). An empty round is count 0, not an error. */
  reportRound: (guildId: string, season: string, round: string) => Promise<ReportRoundDetail>
  report: (guildId: string, reportId: string) => Promise<Report>
  decideReport: (guildId: string, reportId: string, input: DecisionInput) => Promise<DecisionResult>

  penaltySettings: (guildId: string) => Promise<PenaltySettings>
  savePenaltySettings: (guildId: string, input: PenaltySettingsInput) => Promise<PenaltySettings>
  penaltyOverview: (guildId: string, season?: number) => Promise<PenaltyOverview>
  penaltyHistory: (guildId: string, driver: string, season?: number) => Promise<PenaltyHistory>
  addPenaltyPoints: (guildId: string, input: ManualPointsInput) => Promise<ManualPointsResult>
  clearPenaltyPoints: (guildId: string, input: ClearPointsInput) => Promise<ClearPointsResult>
  setBan: (guildId: string, input: BanInput) => Promise<BanResult>
  advanceRace: (guildId: string, input: AdvanceRaceInput) => Promise<AdvanceRaceResult>

  dirtyDrivers: (guildId: string) => Promise<DirtyDriver[]>
  dirtyHistory: (guildId: string, driver: string) => Promise<DirtyHistory>
  addDirtyReport: (guildId: string, input: DirtyReportInput) => Promise<DirtyReportResult>
  removeDirtyReport: (guildId: string, driver: string, index: number) => Promise<DirtyRemoveResult>
}

// ── Small readers ───────────────────────────────────────────────────────────

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 1_000_000_000
const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value).slice(0, max) : '')
const optionalText = (value: unknown, max: number): string | null => (typeof value === 'string' && value !== '' ? value.slice(0, max) : null)
const intOrNull = (value: unknown): number | null => (isInt(value) ? value : null)
const countOr = (value: unknown, fallback: number): number => (isCount(value) ? value : fallback)

const TEXT_MAX = 2000

function parseBan(value: unknown): BanState {
  if (value === 'race' || value === 'quali' || value === 'none') return value
  throw invalid('penalty')
}

// ── Reports ─────────────────────────────────────────────────────────────────

function parseReport(json: unknown): Report {
  if (!isRecord(json) || !isReportId(json['id']) || !isInt(json['number']) || !isReportStatus(json['status'])) throw invalid('report')
  const status = json['status']
  const decision = json['decision']
  return {
    id: json['id'],
    number: json['number'],
    roundKey: str(json['round_key'], 60),
    season: str(json['season'], 60),
    round: str(json['round'], 60),
    circuit: str(json['circuit'], 200),
    reporter: str(json['reporter'], 100),
    reporterId: isValidSnowflake(json['reporter_id']) ? json['reporter_id'] : null,
    driversInvolved: str(json['drivers_involved'], 500),
    lap: str(json['lap'], 60),
    description: str(json['description'], TEXT_MAX),
    evidenceUrl: optionalText(json['evidence_url'], 1000),
    evidenceImg: optionalText(json['evidence_img'], 1000),
    status,
    decided: typeof json['decided'] === 'boolean' ? json['decided'] : status === 'penalty_issued' || status === 'no_further_action',
    penalty: optionalText(json['penalty'], 600),
    decision: isRecord(decision) ? { type: str(decision['type'], 40), penalty: optionalText(decision['penalty'], 600) } : null,
    threadName: str(json['thread_name'], 200),
    messageId: isValidSnowflake(json['message_id']) ? json['message_id'] : null,
    timestamp: str(json['timestamp'], 40)
  }
}

function parseReportList(json: unknown, key: string, what: string): Report[] {
  return list(json, key, what).map(parseReport)
}

function parseRoundRow(json: unknown): ReportRoundRow {
  if (!isRecord(json)) throw invalid('report overview')
  return {
    season: str(json['season'], 60),
    round: str(json['round'], 60),
    roundKey: str(json['round_key'], 60),
    circuit: str(json['circuit'], 200),
    total: countOr(json['total'], 0),
    pending: countOr(json['pending'], 0),
    underInvestigation: countOr(json['under_investigation'], 0),
    penaltyIssued: countOr(json['penalty_issued'], 0),
    noFurtherAction: countOr(json['no_further_action'], 0)
  }
}

function parseDecisionPoints(json: unknown): DecisionPoints {
  if (!isRecord(json)) return { applied: false, driver: null, added: 0, season: null, total: null, qualiBanned: false, raceBanned: false, banNotice: null, banNoticePosted: false }
  return {
    applied: json['applied'] === true,
    driver: optionalText(json['driver'], 100),
    added: countOr(json['added'], 0),
    season: intOrNull(json['season']),
    total: intOrNull(json['total']),
    qualiBanned: json['quali_banned'] === true,
    raceBanned: json['race_banned'] === true,
    banNotice: optionalText(json['ban_notice'], 4000),
    banNoticePosted: json['ban_notice_posted'] === true
  }
}

// ── Penalties ───────────────────────────────────────────────────────────────

function parsePenaltyDefaults(json: unknown): PenaltyDefaults | null {
  if (!isRecord(json) || !isCount(json['current_season']) || !isCount(json['expiry_races']) || !isCount(json['quali_ban_threshold']) || !isCount(json['race_ban_threshold'])) return null
  return {
    currentSeason: json['current_season'],
    expiryRaces: json['expiry_races'],
    qualiBanThreshold: json['quali_ban_threshold'],
    raceBanThreshold: json['race_ban_threshold']
  }
}

function parsePenaltySettings(json: unknown): PenaltySettings {
  if (!isRecord(json) || typeof json['configured'] !== 'boolean' || !isCount(json['current_season'])) throw invalid('penalty settings')
  return {
    configured: json['configured'],
    currentSeason: json['current_season'],
    expiryRaces: isCount(json['expiry_races']) ? json['expiry_races'] : null,
    qualiBanThreshold: isCount(json['quali_ban_threshold']) ? json['quali_ban_threshold'] : null,
    raceBanThreshold: isCount(json['race_ban_threshold']) ? json['race_ban_threshold'] : null,
    setupBy: optionalText(json['setup_by'], 100),
    setupAt: optionalText(json['setup_at'], 40),
    defaults: parsePenaltyDefaults(json['defaults'])
  }
}

function parsePenaltyRow(json: unknown): PenaltyRow {
  if (!isRecord(json) || typeof json['key'] !== 'string' || json['key'] === '' || !isInt(json['total_points'])) throw invalid('penalty overview')
  return {
    position: countOr(json['position'], 0),
    key: json['key'].slice(0, 100),
    displayName: str(json['display_name'], 100) || json['key'].slice(0, 100),
    totalPoints: json['total_points'],
    incidents: countOr(json['incidents'], 0),
    ban: parseBan(json['ban']),
    qualiBanned: json['quali_banned'] === true,
    raceBanned: json['race_banned'] === true,
    reportedCount: countOr(json['reported_count'], 0)
  }
}

function parseHistoryItem(json: unknown): PenaltyHistoryItem {
  if (!isRecord(json) || !isInt(json['points'])) throw invalid('penalty history')
  return {
    index: countOr(json['index'], 0),
    points: json['points'],
    reason: str(json['reason'], TEXT_MAX),
    race: str(json['race'], 300),
    expiresAfterRace: intOrNull(json['expires_after_race']),
    timestamp: str(json['timestamp'], 40)
  }
}

// ── Dirty drivers ───────────────────────────────────────────────────────────

function parseDirtyBody(json: unknown): DirtyReportBody {
  if (!isRecord(json)) throw invalid('dirty driver')
  return {
    reason: str(json['reason'], TEXT_MAX),
    evidence: str(json['evidence'], 1000),
    reportedBy: str(json['reported_by'], 100),
    relatedIncident: optionalText(json['related_incident'], 500),
    timestamp: str(json['timestamp'], 40)
  }
}

function parseDirtyReport(json: unknown): DirtyReport {
  if (!isRecord(json) || !isCount(json['index']) || json['index'] < 1) throw invalid('dirty driver')
  return { index: json['index'], ...parseDirtyBody(json) }
}

export function createStewardApi(client: ApiClient): StewardApi {
  const guildPath = (guildId: string, suffix: string): string => {
    if (!isValidSnowflake(guildId)) throw clientError('invalid_guild_id', 'That server ID is not valid.')
    return `/api/app/v1/guilds/${guildId}/${suffix}`
  }
  const reportPath = (guildId: string, reportId: string, suffix = ''): string => {
    if (!isReportId(reportId)) throw clientError('invalid_report_id', 'That report ID is not valid.')
    return guildPath(guildId, `f1/reports/${encodeURIComponent(reportId)}${suffix}`)
  }
  const query = (params: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
    const text = search.toString()
    return text === '' ? '' : `?${text}`
  }
  const seasonOf = (season: number | undefined): number | undefined => {
    if (season !== undefined && (!Number.isInteger(season) || season < 1 || season > 99999)) throw clientError('invalid_season', 'That season is not valid.')
    return season
  }
  const driverOf = (driver: string): string => {
    const name = driver.trim()
    if (name === '' || [...name].length > 100) throw clientError('invalid_driver', 'Enter a driver name of 1 to 100 characters.')
    return name
  }
  const needConfirm = (confirm: unknown): void => {
    // The server refuses these without it (400 confirm_required); the client refuses first, so a missing dialog can never reach it.
    if (confirm !== true) throw clientError('confirm_required', 'This action has to be confirmed first.')
  }

  return {
    // ── Reports ──
    async reports(guildId, filters = {}) {
      const json = await client.request({
        path: `${guildPath(guildId, 'f1/reports')}${query({ season: filters.season, round: filters.round, status: filters.status, driver: filters.driver, limit: filters.limit, offset: filters.offset })}`
      })
      if (!isRecord(json) || !isCount(json['total'])) throw invalid('report list')
      return { total: json['total'], limit: countOr(json['limit'], 50), offset: countOr(json['offset'], 0), reports: parseReportList(json, 'reports', 'report list') }
    },

    async reportRounds(guildId) {
      return list(await client.request({ path: guildPath(guildId, 'f1/reports/overview') }), 'rounds', 'report overview').map(parseRoundRow)
    },

    async reportRound(guildId, season, round) {
      const json = await client.request({ path: `${guildPath(guildId, 'f1/reports/overview')}${query({ season, round })}` })
      if (!isRecord(json) || !isCount(json['count'])) throw invalid('report overview')
      return {
        season: str(json['season'], 60),
        round: str(json['round'], 60),
        roundKey: str(json['round_key'], 60),
        circuit: str(json['circuit'], 200),
        count: json['count'],
        reports: parseReportList(json, 'reports', 'report overview')
      }
    },

    async report(guildId, reportId) {
      return parseReport(await client.request({ path: reportPath(guildId, reportId) }))
    },

    async decideReport(guildId, reportId, input) {
      const body: Record<string, unknown> =
        input.decision === 'no_further_action'
          ? { decision: 'no_further_action', explanation: input.explanation }
          : {
              decision: 'penalty_issued',
              description: input.description,
              penalty_points: input.penaltyPoints,
              ...(input.driver !== undefined && input.driver !== '' ? { driver: input.driver } : {}),
              ...(input.season !== undefined ? { season: seasonOf(input.season) } : {})
            }
      // One attempt, never replayed: a lost answer may still have decided the report (a second try would answer 409 already_decided).
      const json = await client.request({ method: 'POST', path: reportPath(guildId, reportId, '/decision'), body })
      if (!isRecord(json) || (json['decision'] !== 'penalty_issued' && json['decision'] !== 'no_further_action')) throw invalid('decision')
      return {
        decision: json['decision'],
        report: parseReport(json['report']),
        points: parseDecisionPoints(json['points']),
        warnings: Array.isArray(json['warnings']) ? json['warnings'].filter((item): item is string => typeof item === 'string').slice(0, 10).map((item) => item.slice(0, 120)) : []
      }
    },

    // ── Penalty settings ──
    async penaltySettings(guildId) {
      return parsePenaltySettings(await client.request({ path: guildPath(guildId, 'f1/penalties/settings') }))
    },

    async savePenaltySettings(guildId, input) {
      const json = await client.request({
        method: 'PUT',
        path: guildPath(guildId, 'f1/penalties/settings'),
        body: {
          current_season: input.currentSeason,
          expiry_races: input.expiryRaces,
          quali_ban_threshold: input.qualiBanThreshold,
          race_ban_threshold: input.raceBanThreshold
        }
      })
      return parsePenaltySettings(json)
    },

    // ── Penalty points ──
    async penaltyOverview(guildId, season) {
      const json = await client.request({ path: `${guildPath(guildId, 'f1/penalties/overview')}${query({ season: seasonOf(season) })}` })
      if (!isRecord(json) || !isCount(json['season']) || !isCount(json['current_season']) || !isRecord(json['settings'])) throw invalid('penalty overview')
      const settings = json['settings']
      return {
        season: json['season'],
        currentSeason: json['current_season'],
        isCurrent: json['is_current'] === true,
        settings: {
          expiryRaces: isCount(settings['expiry_races']) ? settings['expiry_races'] : null,
          qualiBanThreshold: isCount(settings['quali_ban_threshold']) ? settings['quali_ban_threshold'] : null,
          raceBanThreshold: isCount(settings['race_ban_threshold']) ? settings['race_ban_threshold'] : null
        },
        drivers: list(json, 'drivers', 'penalty overview').map(parsePenaltyRow)
      }
    },

    async penaltyHistory(guildId, driver, season) {
      const json = await client.request({ path: `${guildPath(guildId, 'f1/penalties/history')}${query({ driver: driverOf(driver), season: seasonOf(season) })}` })
      if (!isRecord(json) || !isCount(json['season']) || typeof json['key'] !== 'string' || !isInt(json['total_points'])) throw invalid('penalty history')
      return {
        season: json['season'],
        key: json['key'].slice(0, 100),
        displayName: str(json['display_name'], 100) || json['key'].slice(0, 100),
        totalPoints: json['total_points'],
        incidents: countOr(json['incidents'], 0),
        ban: parseBan(json['ban']),
        qualiBanned: json['quali_banned'] === true,
        raceBanned: json['race_banned'] === true,
        history: list(json, 'history', 'penalty history').map(parseHistoryItem)
      }
    },

    async addPenaltyPoints(guildId, input) {
      if (input.channelId !== undefined && !isValidSnowflake(input.channelId)) throw clientError('invalid_channel', 'That channel is not valid.')
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'f1/penalties/points'),
        body: {
          driver: driverOf(input.driver),
          penalty_type: input.penaltyType,
          points: input.points,
          reason: input.reason,
          ...(input.season !== undefined ? { season: seasonOf(input.season) } : {}),
          ...(input.channelId !== undefined ? { channel_id: input.channelId } : {})
        }
      })
      if (!isRecord(json) || !isCount(json['season']) || typeof json['saved'] !== 'boolean') throw invalid('penalty points')
      const posted = json['posted']
      return {
        driver: str(json['driver'], 100),
        season: json['season'],
        saved: json['saved'],
        pointsAdded: countOr(json['points_added'], 0),
        totalPoints: intOrNull(json['total_points']),
        qualiBanned: json['quali_banned'] === true,
        raceBanned: json['race_banned'] === true,
        banNotice: optionalText(json['ban_notice'], 4000),
        posted: isRecord(posted) && isValidSnowflake(posted['channel_id']) && isValidSnowflake(posted['message_id']) ? { channelId: posted['channel_id'], messageId: posted['message_id'] } : null,
        announceError: optionalText(json['announce_error'], 64)
      }
    },

    async clearPenaltyPoints(guildId, input) {
      needConfirm(input.confirm)
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'f1/penalties/clear'),
        body: {
          driver: driverOf(input.driver),
          reason: input.reason,
          ...(input.points !== undefined ? { points: input.points } : {}),
          ...(input.season !== undefined ? { season: seasonOf(input.season) } : {}),
          confirm: true
        }
      })
      if (!isRecord(json) || !isCount(json['season']) || (json['mode'] !== 'all' && json['mode'] !== 'partial') || !isCount(json['points_removed']) || !isCount(json['remaining'])) throw invalid('clear points')
      return { driver: str(json['driver'], 100), season: json['season'], mode: json['mode'], pointsRemoved: json['points_removed'], remaining: json['remaining'] }
    },

    async setBan(guildId, input) {
      needConfirm(input.confirm)
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'f1/penalties/bans'),
        body: {
          driver: driverOf(input.driver),
          ban_type: input.banType,
          action: input.action,
          ...(input.season !== undefined ? { season: seasonOf(input.season) } : {}),
          ...(input.reason !== undefined && input.reason !== '' ? { reason: input.reason } : {}),
          confirm: true
        }
      })
      if (
        !isRecord(json) ||
        !isCount(json['season']) ||
        (json['action'] !== 'give' && json['action'] !== 'remove') ||
        (json['ban_type'] !== 'quali' && json['ban_type'] !== 'race') ||
        typeof json['quali_banned'] !== 'boolean' ||
        typeof json['race_banned'] !== 'boolean' ||
        !isInt(json['total_points'])
      ) {
        throw invalid('ban')
      }
      return {
        driver: str(json['driver'], 100),
        season: json['season'],
        action: json['action'],
        banType: json['ban_type'],
        qualiBanned: json['quali_banned'],
        raceBanned: json['race_banned'],
        totalPoints: json['total_points']
      }
    },

    async advanceRace(guildId, input) {
      needConfirm(input.confirm)
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'f1/penalties/advance-race'),
        body: { race_number: input.raceNumber, confirm: true }
      })
      if (!isRecord(json) || !isCount(json['race_number']) || !isCount(json['season'])) throw invalid('advance race')
      const expired = list(json, 'expired', 'advance race').map((item) => {
        if (!isRecord(item) || !isInt(item['points'])) throw invalid('advance race')
        return { key: str(item['key'], 100), displayName: str(item['display_name'], 100) || str(item['key'], 100), points: item['points'], race: str(item['race'], 300) }
      })
      const updated = list(json, 'updated', 'advance race').map((item) => {
        if (!isRecord(item) || !isInt(item['old_total']) || !isInt(item['new_total'])) throw invalid('advance race')
        return { key: str(item['key'], 100), displayName: str(item['display_name'], 100) || str(item['key'], 100), oldTotal: item['old_total'], newTotal: item['new_total'] }
      })
      return { raceNumber: json['race_number'], season: json['season'], expired, updated }
    },

    // ── Dirty drivers ──
    async dirtyDrivers(guildId) {
      return list(await client.request({ path: guildPath(guildId, 'f1/dirty-drivers') }), 'drivers', 'dirty driver list').map((item): DirtyDriver => {
        if (!isRecord(item) || typeof item['key'] !== 'string' || item['key'] === '' || !isCount(item['report_count'])) throw invalid('dirty driver list')
        return {
          key: item['key'].slice(0, 100),
          displayName: str(item['display_name'], 100) || item['key'].slice(0, 100),
          reportCount: item['report_count'],
          latest: parseDirtyBody(item['latest'])
        }
      })
    },

    async dirtyHistory(guildId, driver) {
      const json = await client.request({ path: `${guildPath(guildId, 'f1/dirty-drivers/history')}${query({ driver: driverOf(driver) })}` })
      if (!isRecord(json) || typeof json['key'] !== 'string' || !isCount(json['total'])) throw invalid('dirty driver history')
      return {
        key: json['key'].slice(0, 100),
        displayName: str(json['display_name'], 100) || json['key'].slice(0, 100),
        total: json['total'],
        reports: list(json, 'reports', 'dirty driver history').map(parseDirtyReport)
      }
    },

    async addDirtyReport(guildId, input) {
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'f1/dirty-drivers/reports'),
        body: {
          driver: driverOf(input.driver),
          reason: input.reason,
          evidence_url: input.evidenceUrl,
          ...(input.relatedIncident !== undefined && input.relatedIncident !== '' ? { related_incident: input.relatedIncident } : {})
        }
      })
      if (!isRecord(json) || !isCount(json['total_reports'])) throw invalid('dirty driver report')
      return { displayName: str(json['display_name'], 100), totalReports: json['total_reports'], report: parseDirtyReport(json['report']) }
    },

    async removeDirtyReport(guildId, driver, index) {
      if (!Number.isInteger(index) || index < 1 || index > 100_000) throw clientError('invalid_report_index', 'That report number is not valid.')
      const json = await client.request({
        method: 'DELETE',
        path: `${guildPath(guildId, `f1/dirty-drivers/reports/${index}`)}${query({ driver: driverOf(driver) })}`
      })
      if (!isRecord(json) || json['ok'] !== true || !isCount(json['removed_index']) || typeof json['driver_removed'] !== 'boolean') throw invalid('dirty driver removal')
      return { displayName: str(json['display_name'], 100), removedIndex: json['removed_index'], driverRemoved: json['driver_removed'], removed: parseDirtyBody(json['removed']) }
    }
  }
}
