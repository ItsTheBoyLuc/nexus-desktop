import type { Parsed } from './inputs'
import {
  driverNameProblem,
  isReportId,
  REPORT_FILTER_LIMITS,
  validateAdvanceDraft,
  validateBanDraft,
  validateClearDraft,
  validateDecisionDraft,
  validateDirtyReportDraft,
  validateManualPointsDraft,
  validatePenaltySettingsDraft,
  validateReportFilters,
  SEASON_LIMITS,
  wholeNumber
} from './penaltyValidation'
import type { AdvanceRaceInput, BanInput, ClearPointsInput, DecisionInput, DirtyReportInput, ManualPointsInput, PenaltySettingsInput, ReportFilters } from './types'

/**
 * The main process never trusts what the renderer sends over IPC: every M3 argument is parsed again here, with
 * the same rules the forms use (shared/penaltyValidation.ts), before it can reach the API. The destructive
 * actions additionally need a literal `confirm: true`, which the screens only set after their confirm dialog.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const numberText = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '')
const firstError = (errors: Record<string, string | undefined>): string => Object.values(errors).find((message) => message) ?? 'Check the form and try again.'

const CONFIRM_MESSAGE = 'This action has to be confirmed first.'

export function parseReportId(value: unknown): Parsed<string> {
  return isReportId(value) ? { ok: true, value } : { ok: false, message: 'That report ID is not valid.' }
}

export function parseSeasonNumber(value: unknown): Parsed<number> {
  return typeof value === 'number' && Number.isInteger(value) && value >= SEASON_LIMITS.min && value <= SEASON_LIMITS.max
    ? { ok: true, value }
    : { ok: false, message: `The season must be a whole number from ${SEASON_LIMITS.min} to ${SEASON_LIMITS.max}.` }
}

/** An optional season (absent = the server's current season). */
export function parseOptionalSeason(value: unknown): Parsed<number | undefined> {
  return value === undefined || value === null ? { ok: true, value: undefined } : parseSeasonNumber(value)
}

export function parseReportFiltersInput(input: unknown): Parsed<ReportFilters> {
  const record = isRecord(input) ? input : {}
  const result = validateReportFilters({ season: text(record['season']), round: text(record['round']), status: text(record['status']), driver: text(record['driver']) })
  if (!result.ok) return { ok: false, message: firstError(result.errors) }
  const value: ReportFilters = { ...result.value }
  const limit = record['limit']
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < REPORT_FILTER_LIMITS.pageMin || limit > REPORT_FILTER_LIMITS.pageMax) {
      return { ok: false, message: `The page size must be a whole number from ${REPORT_FILTER_LIMITS.pageMin} to ${REPORT_FILTER_LIMITS.pageMax}.` }
    }
    value.limit = limit
  }
  const offset = record['offset']
  if (offset !== undefined) {
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return { ok: false, message: 'The page offset is not valid.' }
    value.offset = offset
  }
  return { ok: true, value }
}

/** GET /reports/overview: season and round together, or neither. */
export function parseReportOverviewQuery(input: unknown): Parsed<{ season: string; round: string } | null> {
  const record = isRecord(input) ? input : {}
  const season = text(record['season']).trim()
  const round = text(record['round']).trim()
  if (season === '' && round === '') return { ok: true, value: null }
  const result = validateReportFilters({ season, round, status: '', driver: '' })
  if (!result.ok) return { ok: false, message: firstError(result.errors) }
  if (season === '' || round === '') return { ok: false, message: 'Give both the season and the round, or neither.' }
  return { ok: true, value: { season, round } }
}

export function parseDecisionInput(input: unknown): Parsed<DecisionInput> {
  const record = isRecord(input) ? input : {}
  const decision = record['decision']
  if (decision !== 'penalty_issued' && decision !== 'no_further_action') return { ok: false, message: 'Choose "Penalty issued" or "No further action".' }
  const result = validateDecisionDraft({
    decision,
    description: text(record['description']),
    explanation: text(record['explanation']),
    driver: text(record['driver']),
    points: numberText(record['penaltyPoints']),
    season: numberText(record['season'])
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parsePenaltySettingsInput(input: unknown): Parsed<PenaltySettingsInput> {
  const record = isRecord(input) ? input : {}
  const result = validatePenaltySettingsDraft({
    currentSeason: numberText(record['currentSeason']),
    expiryRaces: numberText(record['expiryRaces']),
    qualiBanThreshold: numberText(record['qualiBanThreshold']),
    raceBanThreshold: numberText(record['raceBanThreshold'])
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parseManualPointsInput(input: unknown): Parsed<ManualPointsInput> {
  const record = isRecord(input) ? input : {}
  const result = validateManualPointsDraft({
    driver: text(record['driver']),
    penaltyType: text(record['penaltyType']),
    points: numberText(record['points']),
    reason: text(record['reason']),
    season: numberText(record['season']),
    channelId: text(record['channelId'])
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parseClearInput(input: unknown): Parsed<ClearPointsInput> {
  const record = isRecord(input) ? input : {}
  if (record['confirm'] !== true) return { ok: false, message: CONFIRM_MESSAGE }
  const result = validateClearDraft({
    driver: text(record['driver']),
    mode: record['points'] === undefined ? 'all' : 'partial',
    points: numberText(record['points']),
    reason: text(record['reason']),
    season: numberText(record['season'])
  })
  return result.ok ? { ok: true, value: { ...result.value, confirm: true } } : { ok: false, message: firstError(result.errors) }
}

export function parseBanInput(input: unknown): Parsed<BanInput> {
  const record = isRecord(input) ? input : {}
  if (record['confirm'] !== true) return { ok: false, message: CONFIRM_MESSAGE }
  const result = validateBanDraft({
    driver: text(record['driver']),
    banType: text(record['banType']),
    action: text(record['action']),
    reason: text(record['reason']),
    season: numberText(record['season'])
  })
  return result.ok ? { ok: true, value: { ...result.value, confirm: true } } : { ok: false, message: firstError(result.errors) }
}

export function parseAdvanceInput(input: unknown): Parsed<AdvanceRaceInput> {
  const record = isRecord(input) ? input : {}
  if (record['confirm'] !== true) return { ok: false, message: CONFIRM_MESSAGE }
  const result = validateAdvanceDraft({ raceNumber: numberText(record['raceNumber']) })
  return result.ok ? { ok: true, value: { ...result.value, confirm: true } } : { ok: false, message: firstError(result.errors) }
}

export function parseDirtyReportInput(input: unknown): Parsed<DirtyReportInput> {
  const record = isRecord(input) ? input : {}
  const result = validateDirtyReportDraft({
    driver: text(record['driver']),
    reason: text(record['reason']),
    evidenceUrl: text(record['evidenceUrl']),
    relatedIncident: text(record['relatedIncident'])
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

/** A driver name given on its own (a query parameter): trimmed, 1-100 characters, single line. */
export function parseDriverName(value: unknown): Parsed<string> {
  if (typeof value !== 'string') return { ok: false, message: 'Enter a driver name.' }
  const problem = driverNameProblem(value)
  return problem ? { ok: false, message: problem } : { ok: true, value: value.trim() }
}

/** The 1-based number of a dirty-driver report. */
export function parseReportIndex(value: unknown): Parsed<number> {
  const parsed = typeof value === 'number' ? wholeNumber(String(value), 1, 100_000) : null
  return parsed !== null ? { ok: true, value: parsed } : { ok: false, message: 'That report number is not valid.' }
}

/** The optional season and round filters of GET /standings/results-ledger. */
export function parseLedgerQuery(input: unknown): Parsed<{ season?: string; round?: string }> {
  const record = isRecord(input) ? input : {}
  const season = text(record['season']).trim()
  const round = text(record['round']).trim()
  const result = validateReportFilters({ season, round, status: '', driver: '' })
  if (!result.ok) return { ok: false, message: firstError(result.errors) }
  return { ok: true, value: { ...(season !== '' ? { season } : {}), ...(round !== '' ? { round } : {}) } }
}
