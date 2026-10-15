import type { AnnouncementInput, GameCreateInput, PanelInput, ServerSettingsInput, TierCreateInput } from './types'

/** Limits mirror the backend (app_backend.py), so errors show up before a request is made. */
export const ANNOUNCEMENT_LIMITS = { titleMax: 150, messageMax: 1500, imageUrlMax: 500 } as const

export interface AnnouncementDraft {
  title: string
  message: string
  channelId: string
  imageUrl: string
}

export type AnnouncementField = 'title' | 'message' | 'channelId' | 'imageUrl'
export type AnnouncementErrors = Partial<Record<AnnouncementField, string>>

export type AnnouncementValidation = { ok: true; value: AnnouncementInput } | { ok: false; errors: AnnouncementErrors }

// Control characters except tab, LF and CR (same set the backend rejects).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const SNOWFLAKE = /^[0-9]{1,20}$/

/** Length in Unicode code points, like Python's len() on the backend (JS .length counts UTF-16 units). */
export function codePointLength(value: string): number {
  let count = 0
  for (const _ of value) count++
  return count
}

/**
 * Length for the fields the docs mark with ✱: the bot shows the text with Discord markdown escaped (every `_` becomes `\_`),
 * so the ESCAPED text must fit and each underscore counts as 2.
 */
export function escapedLength(value: string): number {
  let count = 0
  for (const char of value) count += char === '_' ? 2 : 1
  return count
}

export function isValidSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value)
}

/** https URL with a host, no credentials, no whitespace, at most 500 characters. */
export function isValidImageUrl(value: string): boolean {
  if (codePointLength(value) > ANNOUNCEMENT_LIMITS.imageUrlMax || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export function validateAnnouncement(draft: AnnouncementDraft): AnnouncementValidation {
  const errors: AnnouncementErrors = {}
  const title = draft.title.trim()
  const message = draft.message.trim()
  const imageUrl = draft.imageUrl.trim()

  const titleLength = codePointLength(title)
  if (titleLength === 0) errors.title = 'Enter a title.'
  else if (titleLength > ANNOUNCEMENT_LIMITS.titleMax) errors.title = `The title can be at most ${ANNOUNCEMENT_LIMITS.titleMax} characters.`
  else if (/[\r\n]/.test(title) || CONTROL_CHARS.test(title)) errors.title = 'The title must be a single line without special characters.'

  const messageLength = codePointLength(message)
  if (messageLength === 0) errors.message = 'Enter a message.'
  else if (messageLength > ANNOUNCEMENT_LIMITS.messageMax) errors.message = `The message can be at most ${ANNOUNCEMENT_LIMITS.messageMax} characters.`
  else if (CONTROL_CHARS.test(message)) errors.message = 'The message contains characters that cannot be sent.'

  if (!isValidSnowflake(draft.channelId)) errors.channelId = 'Choose a channel.'

  if (imageUrl !== '' && !isValidImageUrl(imageUrl)) {
    errors.imageUrl = `Use a full https:// link without spaces (at most ${ANNOUNCEMENT_LIMITS.imageUrlMax} characters).`
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: { title, message, channelId: draft.channelId, ...(imageUrl !== '' ? { imageUrl } : {}) }
  }
}

// ── League games, tiers, settings, panels (milestone 1) ─────────────────────
// Every rule below comes from docs/APP_API.md; the backend re-checks all of them.

export const KEY_LIMIT = 20
export const GAME_LIMITS = { labelMax: 50, categoryMax: 50 } as const
export const TIER_LIMITS = { pointsSystemMax: 100 } as const
export const SETTINGS_LIMITS = { footerMax: 50, seasonMin: 1, seasonMax: 99999 } as const
export const DEFAULT_FOOTER_NAME = 'Nexus'
export const DEFAULT_EMBED_COLOR = '#FF3333'

const KEY_PATTERN = /^[A-Za-z0-9_]{1,20}$/
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

/** game_key / tier_key: 1-20 characters, letters, digits and underscore. */
export function isValidKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_PATTERN.test(value)
}

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_PATTERN.test(value)
}

/** null when fine, else the reason. Single line, no control characters, length in code points. */
export function singleLineProblem(value: string, min: number, max: number, what: string): string | null {
  const length = codePointLength(value)
  if (length < min) return `Enter ${what}.`
  if (length > max) return `${what[0]!.toUpperCase()}${what.slice(1)} can be at most ${max} characters.`
  if (/[\r\n]/.test(value) || CONTROL_CHARS.test(value)) return `${what[0]!.toUpperCase()}${what.slice(1)} must be a single line without special characters.`
  return null
}

export type FormResult<TValue, TField extends string> = { ok: true; value: TValue } | { ok: false; errors: Partial<Record<TField, string>> }

// Game ------------------------------------------------------------------------

export interface GameDraft {
  gameKey: string
  label: string
  category: string
}
export type GameField = keyof GameDraft

export function validateGameDraft(draft: GameDraft): FormResult<GameCreateInput, GameField> {
  const errors: Partial<Record<GameField, string>> = {}
  const gameKey = draft.gameKey.trim()
  const label = draft.label.trim()
  const category = draft.category.trim()
  if (!isValidKey(gameKey)) errors.gameKey = `The game key must be 1-${KEY_LIMIT} characters: letters, digits and underscores only.`
  const labelProblem = singleLineProblem(label, 1, GAME_LIMITS.labelMax, 'a name')
  if (labelProblem) errors.label = labelProblem
  const categoryProblem = singleLineProblem(category, 1, GAME_LIMITS.categoryMax, 'a category')
  if (categoryProblem) errors.category = categoryProblem
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { gameKey, label, category } }
}

// Tier ------------------------------------------------------------------------

export interface TierDraft {
  tierKey: string
  roleId: string
  pointsSystem: string
}
export type TierField = keyof TierDraft

/** `keyEditable` is false when editing an existing tier (its key cannot change). */
export function validateTierDraft(draft: TierDraft, keyEditable: boolean): FormResult<TierCreateInput, TierField> {
  const errors: Partial<Record<TierField, string>> = {}
  const tierKey = draft.tierKey.trim()
  const pointsSystem = draft.pointsSystem.trim()
  if (keyEditable && !isValidKey(tierKey)) errors.tierKey = `The tier key must be 1-${KEY_LIMIT} characters: letters, digits and underscores only.`
  if (!isValidSnowflake(draft.roleId)) errors.roleId = 'Choose a role.'
  if (pointsSystem !== '') {
    const problem = singleLineProblem(pointsSystem, 1, TIER_LIMITS.pointsSystemMax, 'the points system')
    if (problem) errors.pointsSystem = problem
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { tierKey, roleId: draft.roleId, pointsSystem: pointsSystem === '' ? null : pointsSystem } }
}

// Server settings -------------------------------------------------------------

export interface SettingsDraft {
  embedColor: string
  footerName: string
  /** Text from the input; empty means "leave unchanged". */
  seasonNumber: string
}
export type SettingsField = keyof SettingsDraft

/** The validated draft. Fields that are empty or equal to `current` are left out, so only real changes are sent. */
export function validateSettingsDraft(
  draft: SettingsDraft,
  current: { embedColor: string; footerName: string; seasonNumber: number | null }
): FormResult<ServerSettingsInput, SettingsField> {
  const errors: Partial<Record<SettingsField, string>> = {}
  const value: ServerSettingsInput = {}

  const color = draft.embedColor.trim()
  if (!isValidHexColor(color)) errors.embedColor = 'Use a colour like #FF6B00 (a # and six hex digits).'
  else if (color.toUpperCase() !== current.embedColor.toUpperCase()) value.embedColor = color.toUpperCase()

  const footer = draft.footerName.trim()
  const footerProblem = footer === '' ? null : singleLineProblem(footer, 1, SETTINGS_LIMITS.footerMax, 'the footer name')
  if (footerProblem) errors.footerName = footerProblem
  // An empty footer resets to the default on the server ("Nexus"), exactly like /server settings.
  else if ((footer === '' ? DEFAULT_FOOTER_NAME : footer) !== current.footerName) value.footerName = footer

  const season = draft.seasonNumber.trim()
  if (season !== '') {
    const parsed = /^[0-9]{1,5}$/.test(season) ? Number(season) : NaN
    if (!Number.isInteger(parsed) || parsed < SETTINGS_LIMITS.seasonMin || parsed > SETTINGS_LIMITS.seasonMax) {
      errors.seasonNumber = `The season must be a whole number from ${SETTINGS_LIMITS.seasonMin} to ${SETTINGS_LIMITS.seasonMax}.`
    } else if (parsed !== current.seasonNumber) value.seasonNumber = parsed
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value }
}

// Panels ----------------------------------------------------------------------

export function validatePanelInput(input: { channelId: unknown; messageId?: unknown }): FormResult<PanelInput, 'channelId' | 'messageId'> {
  const errors: Partial<Record<'channelId' | 'messageId', string>> = {}
  if (!isValidSnowflake(input.channelId)) errors.channelId = 'Choose a channel.'
  if (input.messageId !== undefined && !isValidSnowflake(input.messageId)) errors.messageId = 'The stored panel is not valid. Post a new panel instead.'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: { channelId: input.channelId as string, ...(input.messageId !== undefined ? { messageId: input.messageId as string } : {}) }
  }
}
