import {
  isTeamPathName,
  parseMemberQuery,
  validateDriverDraft,
  validatePointsDraft,
  validateResultsDraft,
  validateRoundDraft,
  validateRoundFields,
  validateTeamDraft
} from './f1Validation'
import type { RoundFields } from './f1Validation'
import type { AddDriverInput, CalendarPostInput, GameCreateInput, PanelInput, PointsSystemInput, ResultsInput, RoundInput, RoundPatch, ServerSettingsInput, TeamInput, TierCreateInput, TierUpdateInput } from './types'
import {
  codePointLength,
  isValidHexColor,
  isValidSnowflake,
  SETTINGS_LIMITS,
  TIER_LIMITS,
  validateGameDraft,
  validatePanelInput,
  validateTierDraft
} from './validation'

/**
 * The main process never trusts what the renderer sends over IPC: every argument is parsed again
 * here, with the same rules the forms use (shared/validation.ts), before it can reach the API.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
// eslint-disable-next-line no-control-regex
const CONTROL_OR_NEWLINE = /[\u0000-\u001f\u007f]/

function firstError(errors: Record<string, string | undefined>): string {
  return Object.values(errors).find((message) => message) ?? 'Check the form and try again.'
}

export function parseGameInput(input: unknown): Parsed<GameCreateInput> {
  const record = isRecord(input) ? input : {}
  const result = validateGameDraft({ gameKey: text(record['gameKey']), label: text(record['label']), category: text(record['category']) })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parseTierCreateInput(input: unknown): Parsed<TierCreateInput> {
  const record = isRecord(input) ? input : {}
  const result = validateTierDraft(
    { tierKey: text(record['tierKey']), roleId: text(record['roleId']), pointsSystem: text(record['pointsSystem']) },
    true
  )
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

/** A partial update: only the fields that are present are checked and passed on. */
export function parseTierUpdateInput(input: unknown): Parsed<TierUpdateInput> {
  if (!isRecord(input)) return { ok: false, message: 'Nothing to change.' }
  const value: TierUpdateInput = {}
  if ('roleId' in input) {
    if (!isValidSnowflake(input['roleId'])) return { ok: false, message: 'Choose a role.' }
    value.roleId = input['roleId']
  }
  if ('pointsSystem' in input) {
    const points = input['pointsSystem']
    if (points === null || points === '') value.pointsSystem = null
    else if (typeof points === 'string' && !CONTROL_OR_NEWLINE.test(points) && codePointLength(points.trim()) >= 1 && codePointLength(points.trim()) <= TIER_LIMITS.pointsSystemMax) {
      value.pointsSystem = points.trim()
    } else return { ok: false, message: `The points system can be at most ${TIER_LIMITS.pointsSystemMax} characters on a single line.` }
  }
  if ('signupChannelId' in input) {
    const channel = input['signupChannelId']
    if (channel === null) value.signupChannelId = null
    else if (isValidSnowflake(channel)) value.signupChannelId = channel
    else return { ok: false, message: 'Choose a channel.' }
  }
  return Object.keys(value).length > 0 ? { ok: true, value } : { ok: false, message: 'Nothing to change.' }
}

export function parseSettingsInput(input: unknown): Parsed<ServerSettingsInput> {
  if (!isRecord(input)) return { ok: false, message: 'Nothing to change.' }
  const value: ServerSettingsInput = {}
  if ('embedColor' in input) {
    if (!isValidHexColor(input['embedColor'])) return { ok: false, message: 'Use a colour like #FF6B00.' }
    value.embedColor = input['embedColor'].toUpperCase()
  }
  if ('footerName' in input) {
    const footer = input['footerName']
    if (typeof footer !== 'string' || CONTROL_OR_NEWLINE.test(footer) || codePointLength(footer.trim()) > SETTINGS_LIMITS.footerMax) {
      return { ok: false, message: `The footer name can be at most ${SETTINGS_LIMITS.footerMax} characters on a single line.` }
    }
    value.footerName = footer.trim()
  }
  if ('seasonNumber' in input) {
    const season = input['seasonNumber']
    if (typeof season !== 'number' || !Number.isInteger(season) || season < SETTINGS_LIMITS.seasonMin || season > SETTINGS_LIMITS.seasonMax) {
      return { ok: false, message: `The season must be a whole number from ${SETTINGS_LIMITS.seasonMin} to ${SETTINGS_LIMITS.seasonMax}.` }
    }
    value.seasonNumber = season
  }
  return Object.keys(value).length > 0 ? { ok: true, value } : { ok: false, message: 'Nothing to change.' }
}

export function parsePanelRequest(input: unknown): Parsed<PanelInput> {
  const record = isRecord(input) ? input : {}
  const result = validatePanelInput({ channelId: record['channelId'], ...('messageId' in record ? { messageId: record['messageId'] } : {}) })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

// ── F1 league (milestone 2) ─────────────────────────────────────────────────

const text2 = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A calendar round number as it appears in a path: a whole number from 1 to 99. */
export function parseRoundNumber(value: unknown): Parsed<number> {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99 ? { ok: true, value } : { ok: false, message: 'That round number is not valid.' }
}

export function parseTeamPathName(value: unknown): Parsed<string> {
  return typeof value === 'string' && isTeamPathName(value) ? { ok: true, value } : { ok: false, message: 'That team name cannot be used.' }
}

export function parseMemberSearchQuery(value: unknown): Parsed<string> {
  const query = typeof value === 'string' ? parseMemberQuery(value) : null
  return query !== null ? { ok: true, value: query } : { ok: false, message: 'Type 1 to 32 characters to search for a member.' }
}

export function parseRoundCreateInput(input: unknown): Parsed<RoundInput> {
  const record = isRecord(input) ? input : {}
  const round = record['round']
  const result = validateRoundDraft({
    name: text2(record['name']),
    date: text2(record['date']),
    dateTbd: false, // the date is sent as text ("TBD" or DD/MM/YYYY); the form already turned the checkbox into text
    time: text2(record['time']),
    flag: text2(record['flag']),
    eventType: text2(record['eventType']),
    round: typeof round === 'number' ? String(round) : ''
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

/** A partial round update: every present field is checked with the same rules as the form. */
export function parseRoundPatch(input: unknown): Parsed<RoundPatch> {
  if (!isRecord(input)) return { ok: false, message: 'Nothing to change.' }
  const fields: RoundFields = {}
  for (const key of ['name', 'date', 'time', 'flag', 'eventType'] as const) {
    if (key in input) fields[key] = text2(input[key])
  }
  const result = validateRoundFields(fields)
  if (!result.ok) return { ok: false, message: firstError(result.errors) }
  return Object.keys(result.value).length > 0 ? { ok: true, value: result.value } : { ok: false, message: 'Nothing to change.' }
}

export function parseCalendarPostRequest(input: unknown): Parsed<CalendarPostInput> {
  return parsePanelRequest(input)
}

export function parseTeamInput(input: unknown): Parsed<TeamInput> {
  const record = isRecord(input) ? input : {}
  const result = validateTeamDraft({ name: text2(record['name']), color: text2(record['color']), abbreviation: text2(record['abbreviation']) })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parseAddDriverInput(input: unknown): Parsed<AddDriverInput> {
  const record = isRecord(input) ? input : {}
  const number = record['number']
  const result = validateDriverDraft({
    userId: text2(record['userId']),
    number: typeof number === 'number' ? String(number) : ''
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parseResultsInput(input: unknown): Parsed<ResultsInput> {
  const record = isRecord(input) ? input : {}
  const results = Array.isArray(record['results']) ? (record['results'] as unknown[]) : []
  const result = validateResultsDraft({
    season: text2(record['season']),
    round: text2(record['round']),
    circuit: text2(record['circuit']),
    drivers: results.map((id) => text2(id)),
    fastestLap: text2(record['fastestLap']),
    pole: text2(record['pole']),
    channelId: text2(record['channelId'])
  })
  if (!result.ok) return { ok: false, message: firstError(result.errors) }
  // Only a literal true counts: the app sets it after the user confirmed the duplicate warning.
  const confirmDuplicate = record['confirmDuplicate']
  if (confirmDuplicate !== undefined && typeof confirmDuplicate !== 'boolean') return { ok: false, message: 'The duplicate confirmation is not valid.' }
  return { ok: true, value: { ...result.value, ...(confirmDuplicate === true ? { confirmDuplicate: true } : {}) } }
}

export function parsePointsSystemInput(input: unknown): Parsed<PointsSystemInput> {
  const record = isRecord(input) ? input : {}
  const points = Array.isArray(record['points']) ? (record['points'] as unknown[]) : []
  const asText = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '')
  const result = validatePointsDraft({ points: points.map(asText), pole: asText(record['pole']), fastestLap: asText(record['fastestLap']) })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}
