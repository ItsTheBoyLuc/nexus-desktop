import { isMessageId, validateDivisionDraft, validatePage, validatePostDraft, validatePostFilters, validateQuestions, validateSignupDraft } from './attendanceValidation'
import type { Parsed } from './inputs'
import type { AttendancePostFilters, AttendancePostInput, DivisionInput, SignupInput } from './types'

/**
 * The main process never trusts what the renderer sends over IPC: every M4 argument is parsed again here, with the same
 * rules the forms use (shared/attendanceValidation.ts), before it can reach the API.
 *
 * A division is the one place where "absent" matters: a list that is not in the input is NOT sent, and the API keeps its
 * current value. A list is only passed on when the renderer actually included it.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const firstError = (errors: Record<string, string | undefined>): string => Object.values(errors).find((message) => message) ?? 'Check the form and try again.'

export function parseMessageId(value: unknown): Parsed<string> {
  return isMessageId(value) ? { ok: true, value } : { ok: false, message: 'That ID is not valid.' }
}

function idList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null
}

export function parseDivisionInput(input: unknown): Parsed<DivisionInput> {
  const record = isRecord(input) ? input : {}
  const regular = 'regularDrivers' in record ? idList(record['regularDrivers']) : []
  const reserve = 'reserveDrivers' in record ? idList(record['reserveDrivers']) : []
  if (regular === null || reserve === null) return { ok: false, message: 'The driver lists are not valid.' }
  const result = validateDivisionDraft({
    name: text(record['name']),
    regular,
    reserve,
    regularEdited: 'regularDrivers' in record,
    reserveEdited: 'reserveDrivers' in record,
    exists: false // whether the division exists is the server's business: it answers no_changes
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parsePostFiltersInput(input: unknown): Parsed<AttendancePostFilters> {
  const record = isRecord(input) ? input : {}
  const result = validatePostFilters({ division: text(record['division']), season: text(record['season']) })
  if (!result.ok) return { ok: false, message: firstError(result.errors) }
  const page = validatePage(record['limit'], record['offset'], 100)
  if (!page.ok) return page
  return { ok: true, value: { ...result.value, ...(page.limit !== undefined ? { limit: page.limit } : {}), ...(page.offset !== undefined ? { offset: page.offset } : {}) } }
}

export function parsePostInput(input: unknown): Parsed<AttendancePostInput> {
  const record = isRecord(input) ? input : {}
  const asText = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value)) // the modal accepts a number for season and round
  const result = validatePostDraft({
    channelId: text(record['channelId']),
    division: text(record['division']),
    season: asText(record['season']),
    round: asText(record['round']),
    circuit: text(record['circuit']),
    description: text(record['description'])
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

/** The sign-up questions: the limits of the server are applied by the server; here the documented maximums are the ceiling. */
export function parseQuestionsInput(input: unknown): Parsed<string[]> {
  const list = idList(input)
  if (list === null) return { ok: false, message: 'The questions are not valid.' }
  const result = validateQuestions(list)
  if (result.ok) return { ok: true, value: result.value }
  return { ok: false, message: result.general ?? Object.values(result.rows)[0] ?? 'The questions are not valid.' }
}

export function parseSignupInput(input: unknown): Parsed<SignupInput> {
  const record = isRecord(input) ? input : {}
  const result = validateSignupDraft({
    title: text(record['title']),
    description: text(record['description']),
    channelId: text(record['channelId']),
    confirmationChannelId: text(record['confirmationChannelId']),
    closeDate: text(record['closeDate'])
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parseSignupStatus(value: unknown): Parsed<'open' | 'closed' | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  return value === 'open' || value === 'closed' ? { ok: true, value } : { ok: false, message: 'Choose open or closed.' }
}

export function parseParticipantPage(input: unknown): Parsed<{ limit?: number; offset?: number }> {
  const record = isRecord(input) ? input : {}
  const page = validatePage(record['limit'], record['offset'])
  if (!page.ok) return page
  return { ok: true, value: { ...(page.limit !== undefined ? { limit: page.limit } : {}), ...(page.offset !== undefined ? { offset: page.offset } : {}) } }
}
