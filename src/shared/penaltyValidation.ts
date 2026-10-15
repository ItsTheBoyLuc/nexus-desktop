import type {
  AdvanceRaceInput,
  BanAction,
  BanInput,
  BanType,
  ClearPointsInput,
  DecisionInput,
  DirtyReportInput,
  ManualPointsInput,
  PenaltyDefaults,
  PenaltySettingsInput,
  ReportFilters,
  ReportStatus
} from './types'
import { REPORT_STATUSES } from './types'
import { TEXT_LIMITS } from './textLimits'
import { codePointLength, escapedLength, isValidSnowflake, singleLineProblem } from './validation'
import type { FormResult } from './validation'

/**
 * Validation of the report, penalty and dirty-driver forms (milestone 3). Every limit comes from
 * docs/APP_API.md, so a mistake shows up next to the field before a request is made; the backend checks all
 * of them again, and the main process re-checks everything the renderer sends (see penaltyInputs.ts).
 */

export const DECISION_LIMITS = { explanationMax: TEXT_LIMITS.decisionExplanation, descriptionMax: TEXT_LIMITS.decisionDescription, driverMax: 100, pointsMin: 0, pointsMax: 999 } as const
export const SEASON_LIMITS = { min: 1, max: 99999 } as const
export const MANUAL_LIMITS = { driverMax: 100, typeMax: 100, reasonMax: TEXT_LIMITS.penaltyPointsReason, pointsMin: 0, pointsMax: 999 } as const
export const CLEAR_LIMITS = { reasonMax: TEXT_LIMITS.penaltyClearReason, pointsMin: 1, pointsMax: 99999 } as const
export const BAN_LIMITS = { reasonMax: 300 } as const
export const ADVANCE_LIMITS = { min: 0, max: 9999 } as const
export const PENALTY_SETTINGS_LIMITS = { seasonMin: 1, seasonMax: 99999, otherMin: 1, otherMax: 999 } as const
export const DIRTY_LIMITS = { driverMax: 100, reasonMax: 1000, evidenceMax: 300, incidentMax: 200 } as const
export const REPORT_FILTER_LIMITS = { seasonMax: 20, roundMax: 10, driverMax: 100, pageMin: 1, pageMax: 100 } as const

// Control characters except tab, LF and CR: the same set the backend refuses in free text.
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/**
 * null when fine, else the reason. Newlines are allowed (a paragraph), other control characters are not.
 * `escaped` is for the fields the docs mark with ✱: each `_` counts as 2 (see escapedLength).
 */
export function paragraphProblem(value: string, min: number, max: number, what: string, escaped = false): string | null {
  const length = escaped ? escapedLength(value) : codePointLength(value)
  const capital = `${what[0]!.toUpperCase()}${what.slice(1)}`
  if (length < min) return `Enter ${what}.`
  if (length > max) return `${capital} can be at most ${max} characters${escaped ? ' (each underscore counts as 2)' : ''}.`
  if (CONTROL_EXCEPT_NEWLINES.test(value)) return `${capital} contains characters that cannot be sent.`
  return null
}

/** A whole number written with digits only, in [min, max]; null otherwise. */
export function wholeNumber(text: string, min: number, max: number): number | null {
  const value = text.trim()
  if (!/^[0-9]{1,6}$/.test(value)) return null
  const parsed = Number(value)
  return parsed >= min && parsed <= max ? parsed : null
}

const rangeMessage = (what: string, min: number, max: number): string => `${what} must be a whole number from ${min} to ${max}.`

/** An optional season: empty = the server's default (the current season). */
function optionalSeason(text: string, errors: Record<string, string | undefined>, field: string): number | undefined {
  const value = text.trim()
  if (value === '') return undefined
  const season = wholeNumber(value, SEASON_LIMITS.min, SEASON_LIMITS.max)
  if (season === null) errors[field] = rangeMessage('The season', SEASON_LIMITS.min, SEASON_LIMITS.max)
  return season ?? undefined
}

// ── Report id (a path segment) ──────────────────────────────────────────────

/** The server's report ids are opaque; only a plain token may ever be put in a URL path. */
export function isReportId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

// ── Report filters (GET /f1/reports) ────────────────────────────────────────

export interface ReportFilterDraft {
  season: string
  round: string
  /** "" = every status. */
  status: string
  driver: string
}
export type ReportFilterField = keyof ReportFilterDraft

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value)
}

/** Only the filters that are filled in are sent. */
export function validateReportFilters(draft: ReportFilterDraft): FormResult<ReportFilters, ReportFilterField> {
  const errors: Partial<Record<ReportFilterField, string>> = {}
  const season = draft.season.trim()
  const round = draft.round.trim()
  const driver = draft.driver.trim()
  if (season !== '') {
    const problem = singleLineProblem(season, 1, REPORT_FILTER_LIMITS.seasonMax, 'a season')
    if (problem) errors.season = problem
  }
  if (round !== '') {
    const problem = singleLineProblem(round, 1, REPORT_FILTER_LIMITS.roundMax, 'a round')
    if (problem) errors.round = problem
  }
  if (driver !== '') {
    const problem = singleLineProblem(driver, 1, REPORT_FILTER_LIMITS.driverMax, 'a driver name')
    if (problem) errors.driver = problem
  }
  if (draft.status !== '' && !isReportStatus(draft.status)) errors.status = 'Choose a status from the list.'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      ...(season !== '' ? { season } : {}),
      ...(round !== '' ? { round } : {}),
      ...(driver !== '' ? { driver } : {}),
      ...(isReportStatus(draft.status) ? { status: draft.status } : {})
    }
  }
}

// ── Decision (POST /f1/reports/{id}/decision) ───────────────────────────────

export interface DecisionDraft {
  decision: 'penalty_issued' | 'no_further_action'
  /** Penalty description. */
  description: string
  /** No further action: the explanation. */
  explanation: string
  driver: string
  /** Text, "" = 0. */
  points: string
  /** Text, "" = the server decides (the season of the report's title, then the current season). */
  season: string
}
export type DecisionField = 'description' | 'explanation' | 'driver' | 'points' | 'season'

export function validateDecisionDraft(draft: DecisionDraft): FormResult<DecisionInput, DecisionField> {
  const errors: Partial<Record<DecisionField, string>> = {}

  if (draft.decision === 'no_further_action') {
    const explanation = draft.explanation.trim()
    const problem = paragraphProblem(explanation, 1, DECISION_LIMITS.explanationMax, 'an explanation', true)
    if (problem) errors.explanation = problem
    if (Object.keys(errors).length > 0) return { ok: false, errors }
    return { ok: true, value: { decision: 'no_further_action', explanation } }
  }

  const description = draft.description.trim()
  const descriptionProblem = paragraphProblem(description, 1, DECISION_LIMITS.descriptionMax, 'a description of the penalty', true)
  if (descriptionProblem) errors.description = descriptionProblem

  const pointsText = draft.points.trim()
  const points = pointsText === '' ? 0 : wholeNumber(pointsText, DECISION_LIMITS.pointsMin, DECISION_LIMITS.pointsMax)
  if (points === null) errors.points = rangeMessage('The penalty points', DECISION_LIMITS.pointsMin, DECISION_LIMITS.pointsMax)

  const driver = draft.driver.trim()
  if (points !== null && points > 0) {
    const problem = singleLineProblem(driver, 1, DECISION_LIMITS.driverMax, 'the driver who receives the points')
    if (problem) errors.driver = problem
  } else if (driver !== '') {
    const problem = singleLineProblem(driver, 1, DECISION_LIMITS.driverMax, 'a driver name')
    if (problem) errors.driver = problem
  }

  const loose: Record<string, string | undefined> = {}
  const season = optionalSeason(draft.season, loose, 'season')
  if (loose['season']) errors.season = loose['season']

  if (Object.keys(errors).length > 0 || points === null) return { ok: false, errors }
  return {
    ok: true,
    value: {
      decision: 'penalty_issued',
      description,
      ...(points > 0 || driver !== '' ? { driver } : {}),
      penaltyPoints: points,
      ...(season !== undefined ? { season } : {})
    }
  }
}

// ── Manual penalty points (POST /f1/penalties/points) ───────────────────────

export interface ManualPointsDraft {
  driver: string
  penaltyType: string
  points: string
  reason: string
  season: string
  /** "" = do not post. */
  channelId: string
}
export type ManualPointsField = keyof ManualPointsDraft

export function validateManualPointsDraft(draft: ManualPointsDraft): FormResult<ManualPointsInput, ManualPointsField> {
  const errors: Partial<Record<ManualPointsField, string>> = {}
  const driver = draft.driver.trim()
  const penaltyType = draft.penaltyType.trim()
  const reason = draft.reason.trim()

  const driverProblem = singleLineProblem(driver, 1, MANUAL_LIMITS.driverMax, 'a driver name')
  if (driverProblem) errors.driver = driverProblem
  const typeProblem = singleLineProblem(penaltyType, 1, MANUAL_LIMITS.typeMax, 'a penalty type')
  if (typeProblem) errors.penaltyType = typeProblem
  const reasonProblem = paragraphProblem(reason, 1, MANUAL_LIMITS.reasonMax, 'a reason', true)
  if (reasonProblem) errors.reason = reasonProblem

  const points = wholeNumber(draft.points, MANUAL_LIMITS.pointsMin, MANUAL_LIMITS.pointsMax)
  if (points === null) errors.points = rangeMessage('The points', MANUAL_LIMITS.pointsMin, MANUAL_LIMITS.pointsMax)

  const season = optionalSeason(draft.season, errors, 'season')
  if (draft.channelId !== '' && !isValidSnowflake(draft.channelId)) errors.channelId = 'Choose a channel from the list.'
  // 0 points records nothing: it only makes sense together with a channel (the Stewards Decision embed).
  if (points === 0 && draft.channelId === '') errors.points = '0 points record nothing. Enter at least 1 point, or choose a channel to only post the Stewards Decision.'

  if (Object.keys(errors).length > 0 || points === null) return { ok: false, errors }
  return {
    ok: true,
    value: { driver, penaltyType, points, reason, ...(season !== undefined ? { season } : {}), ...(draft.channelId !== '' ? { channelId: draft.channelId } : {}) }
  }
}

// ── Clear points (POST /f1/penalties/clear) ─────────────────────────────────

export interface ClearDraft {
  driver: string
  /** "all" or "partial". */
  mode: 'all' | 'partial'
  points: string
  reason: string
  season: string
}
export type ClearField = 'driver' | 'points' | 'reason' | 'season'

/** The value never contains `confirm`: the screen adds it only after the confirm dialog. */
export type ClearValue = Omit<ClearPointsInput, 'confirm'>

export function validateClearDraft(draft: ClearDraft): FormResult<ClearValue, ClearField> {
  const errors: Partial<Record<ClearField, string>> = {}
  const driver = draft.driver.trim()
  const reason = draft.reason.trim()
  const driverProblem = singleLineProblem(driver, 1, MANUAL_LIMITS.driverMax, 'a driver name')
  if (driverProblem) errors.driver = driverProblem
  const reasonProblem = paragraphProblem(reason, 1, CLEAR_LIMITS.reasonMax, 'a reason')
  if (reasonProblem) errors.reason = reasonProblem

  let points: number | undefined
  if (draft.mode === 'partial') {
    const parsed = wholeNumber(draft.points, CLEAR_LIMITS.pointsMin, CLEAR_LIMITS.pointsMax)
    if (parsed === null) errors.points = rangeMessage('The points to remove', CLEAR_LIMITS.pointsMin, CLEAR_LIMITS.pointsMax)
    else points = parsed
  }
  const season = optionalSeason(draft.season, errors, 'season')

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { driver, reason, ...(points !== undefined ? { points } : {}), ...(season !== undefined ? { season } : {}) } }
}

// ── Bans (POST /f1/penalties/bans) ──────────────────────────────────────────

export interface BanDraft {
  driver: string
  banType: string
  action: string
  reason: string
  season: string
}
export type BanField = keyof BanDraft
export type BanValue = Omit<BanInput, 'confirm'>

export const isBanType = (value: unknown): value is BanType => value === 'quali' || value === 'race'
export const isBanAction = (value: unknown): value is BanAction => value === 'give' || value === 'remove'

export function validateBanDraft(draft: BanDraft): FormResult<BanValue, BanField> {
  const errors: Partial<Record<BanField, string>> = {}
  const driver = draft.driver.trim()
  const reason = draft.reason.trim()
  const driverProblem = singleLineProblem(driver, 1, MANUAL_LIMITS.driverMax, 'a driver name')
  if (driverProblem) errors.driver = driverProblem
  if (!isBanType(draft.banType)) errors.banType = 'Choose a qualifying ban or a race ban.'
  if (!isBanAction(draft.action)) errors.action = 'Choose whether to give or remove the ban.'
  if (reason !== '') {
    const problem = singleLineProblem(reason, 1, BAN_LIMITS.reasonMax, 'a reason')
    if (problem) errors.reason = problem
  }
  const season = optionalSeason(draft.season, errors, 'season')
  if (Object.keys(errors).length > 0 || !isBanType(draft.banType) || !isBanAction(draft.action)) return { ok: false, errors }
  return { ok: true, value: { driver, banType: draft.banType, action: draft.action, ...(reason !== '' ? { reason } : {}), ...(season !== undefined ? { season } : {}) } }
}

// ── Advance race (POST /f1/penalties/advance-race) ──────────────────────────

export type AdvanceValue = Omit<AdvanceRaceInput, 'confirm'>

export function validateAdvanceDraft(draft: { raceNumber: string }): FormResult<AdvanceValue, 'raceNumber'> {
  const raceNumber = wholeNumber(draft.raceNumber, ADVANCE_LIMITS.min, ADVANCE_LIMITS.max)
  if (raceNumber === null) return { ok: false, errors: { raceNumber: rangeMessage('The race number', ADVANCE_LIMITS.min, ADVANCE_LIMITS.max) } }
  return { ok: true, value: { raceNumber } }
}

// ── Penalty settings (PUT /f1/penalties/settings) ───────────────────────────

export interface PenaltySettingsDraft {
  currentSeason: string
  expiryRaces: string
  qualiBanThreshold: string
  raceBanThreshold: string
}
export type PenaltySettingsField = keyof PenaltySettingsDraft

export function validatePenaltySettingsDraft(draft: PenaltySettingsDraft): FormResult<PenaltySettingsInput, PenaltySettingsField> {
  const errors: Partial<Record<PenaltySettingsField, string>> = {}
  const { seasonMin, seasonMax, otherMin, otherMax } = PENALTY_SETTINGS_LIMITS
  const currentSeason = wholeNumber(draft.currentSeason, seasonMin, seasonMax)
  const expiryRaces = wholeNumber(draft.expiryRaces, otherMin, otherMax)
  const qualiBanThreshold = wholeNumber(draft.qualiBanThreshold, otherMin, otherMax)
  const raceBanThreshold = wholeNumber(draft.raceBanThreshold, otherMin, otherMax)
  if (currentSeason === null) errors.currentSeason = rangeMessage('The current season', seasonMin, seasonMax)
  if (expiryRaces === null) errors.expiryRaces = rangeMessage('The expiry', otherMin, otherMax)
  if (qualiBanThreshold === null) errors.qualiBanThreshold = rangeMessage('The qualifying ban threshold', otherMin, otherMax)
  if (raceBanThreshold === null) errors.raceBanThreshold = rangeMessage('The race ban threshold', otherMin, otherMax)
  if (currentSeason === null || expiryRaces === null || qualiBanThreshold === null || raceBanThreshold === null) return { ok: false, errors }
  return { ok: true, value: { currentSeason, expiryRaces, qualiBanThreshold, raceBanThreshold } }
}

export function draftOfPenaltySettings(values: PenaltyDefaults): PenaltySettingsDraft {
  return {
    currentSeason: String(values.currentSeason),
    expiryRaces: String(values.expiryRaces),
    qualiBanThreshold: String(values.qualiBanThreshold),
    raceBanThreshold: String(values.raceBanThreshold)
  }
}

export function penaltySettingsChanged(value: PenaltySettingsInput, current: PenaltyDefaults | null): boolean {
  return (
    current === null ||
    value.currentSeason !== current.currentSeason ||
    value.expiryRaces !== current.expiryRaces ||
    value.qualiBanThreshold !== current.qualiBanThreshold ||
    value.raceBanThreshold !== current.raceBanThreshold
  )
}

// ── Dirty drivers ───────────────────────────────────────────────────────────

export interface DirtyReportDraft {
  driver: string
  reason: string
  evidenceUrl: string
  relatedIncident: string
}
export type DirtyReportField = keyof DirtyReportDraft

/** `http://` or `https://`, no whitespace, at most 300 characters: the rule of the API. */
export function evidenceUrlProblem(value: string): string | null {
  if (value === '') return 'Enter the evidence link.'
  if (codePointLength(value) > DIRTY_LIMITS.evidenceMax) return `The evidence link can be at most ${DIRTY_LIMITS.evidenceMax} characters.`
  if (/\s/.test(value)) return 'The evidence link cannot contain spaces.'
  if (!/^https?:\/\/\S+$/i.test(value)) return 'Start the evidence link with https:// (or http://).'
  return null
}

export function validateDirtyReportDraft(draft: DirtyReportDraft): FormResult<DirtyReportInput, DirtyReportField> {
  const errors: Partial<Record<DirtyReportField, string>> = {}
  const driver = draft.driver.trim()
  const reason = draft.reason.trim()
  const evidenceUrl = draft.evidenceUrl.trim()
  const relatedIncident = draft.relatedIncident.trim()

  const driverProblem = singleLineProblem(driver, 1, DIRTY_LIMITS.driverMax, 'a driver name')
  if (driverProblem) errors.driver = driverProblem
  const reasonProblem = paragraphProblem(reason, 1, DIRTY_LIMITS.reasonMax, 'a reason')
  if (reasonProblem) errors.reason = reasonProblem
  const urlProblem = evidenceUrlProblem(evidenceUrl)
  if (urlProblem) errors.evidenceUrl = urlProblem
  if (relatedIncident !== '') {
    const problem = singleLineProblem(relatedIncident, 1, DIRTY_LIMITS.incidentMax, 'the related incident')
    if (problem) errors.relatedIncident = problem
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { driver, reason, evidenceUrl, ...(relatedIncident !== '' ? { relatedIncident } : {}) } }
}

/** A driver name as a query parameter or body field: 1-100 characters, single line. */
export function driverNameProblem(name: string): string | null {
  return singleLineProblem(name.trim(), 1, MANUAL_LIMITS.driverMax, 'a driver name')
}
