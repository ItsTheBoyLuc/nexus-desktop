import type { GameCreateInput, PanelInput, ServerSettingsInput, TierCreateInput, TierUpdateInput } from './types'
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
