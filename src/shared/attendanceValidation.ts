import type { AttendancePostFilters, AttendancePostInput, DivisionInput, SignupInput } from './types'
import { codePointLength, isValidSnowflake, singleLineProblem } from './validation'
import type { FormResult } from './validation'
import { paragraphProblem } from './penaltyValidation'
import { TEXT_LIMITS } from './textLimits'

/**
 * Validation of the attendance and sign-up forms (milestone 4). Every limit comes from docs/APP_API.md, so a mistake
 * shows up next to the field before a request is made; the backend checks all of them again, and the main process
 * re-checks everything the renderer sends (attendanceInputs.ts).
 */

export const DIVISION_LIMITS = { nameMax: 50, listMax: 25 } as const
export const ATTENDANCE_POST_LIMITS = { seasonMax: 10, roundMax: 10, circuitMax: 100, descriptionMax: TEXT_LIMITS.f1AttendanceDescription, pageMin: 1, pageMax: 100 } as const
export const SIGNUP_LIMITS = { titleMax: 150, descriptionMax: TEXT_LIMITS.signupDescription, closeDateMax: 50, pageMin: 1, pageMax: 100 } as const
/** The documented defaults, used only when the server's own `max_questions` / `max_question_length` are not known yet. */
export const QUESTION_DEFAULTS = { max: 2, length: 45 } as const
/** A Discord form label is cut at 45 characters and the label is the key of the answer: two labels that share their first 45 collide. */
export const QUESTION_KEY_LENGTH = 45

// ── Divisions (PUT /f1/attendance/divisions) ────────────────────────────────

export interface DivisionDraft {
  name: string
  /** User ids, in the order they were picked. */
  regular: readonly string[]
  reserve: readonly string[]
  /** The user changed that list. Only an edited list is sent: a list that is left out keeps its value on the server. */
  regularEdited: boolean
  reserveEdited: boolean
  /** The division exists already (its name cannot change and at least one list has to). */
  exists: boolean
}
export type DivisionField = 'name' | 'regular' | 'reserve' | 'lists'

function listProblem(ids: readonly string[], what: string): string | null {
  if (ids.length > DIVISION_LIMITS.listMax) return `The ${what} list can hold at most ${DIVISION_LIMITS.listMax} drivers.`
  if (ids.some((id) => !isValidSnowflake(id))) return `The ${what} list contains a member that cannot be used. Remove it and pick the member again.`
  if (new Set(ids).size !== ids.length) return `A driver is in the ${what} list twice.`
  return null
}

/** Builds the PUT body: the name, plus ONLY the lists that were edited. */
export function validateDivisionDraft(draft: DivisionDraft): FormResult<DivisionInput, DivisionField> {
  const errors: Partial<Record<DivisionField, string>> = {}
  const name = draft.name.trim()
  const nameProblem = singleLineProblem(name, 1, DIVISION_LIMITS.nameMax, 'a division name')
  if (nameProblem) errors.name = nameProblem
  if (draft.regularEdited) {
    const problem = listProblem(draft.regular, 'regular drivers')
    if (problem) errors.regular = problem
  }
  if (draft.reserveEdited) {
    const problem = listProblem(draft.reserve, 'reserve drivers')
    if (problem) errors.reserve = problem
  }
  if (draft.exists && !draft.regularEdited && !draft.reserveEdited) errors.lists = 'Change at least one of the two lists first: there is nothing to save.'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      name,
      ...(draft.regularEdited ? { regularDrivers: [...draft.regular] } : {}),
      ...(draft.reserveEdited ? { reserveDrivers: [...draft.reserve] } : {})
    }
  }
}

/** The user ids that are in both lists (the API reports them as `overlap`; the dialog can warn before saving too). */
export function findOverlap(regular: readonly string[], reserve: readonly string[]): string[] {
  const reserved = new Set(reserve)
  return [...new Set(regular)].filter((id) => reserved.has(id))
}

// ── Attendance posts ────────────────────────────────────────────────────────

export interface PostFilterDraft {
  /** "" = every division. */
  division: string
  season: string
}
export type PostFilterField = keyof PostFilterDraft

export function validatePostFilters(draft: PostFilterDraft): FormResult<AttendancePostFilters, PostFilterField> {
  const errors: Partial<Record<PostFilterField, string>> = {}
  const division = draft.division.trim()
  const season = draft.season.trim()
  if (division !== '') {
    const problem = singleLineProblem(division, 1, DIVISION_LIMITS.nameMax, 'a division name')
    if (problem) errors.division = problem
  }
  if (season !== '') {
    const problem = singleLineProblem(season, 1, ATTENDANCE_POST_LIMITS.seasonMax, 'a season')
    if (problem) errors.season = problem
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { ...(division !== '' ? { division } : {}), ...(season !== '' ? { season } : {}) } }
}

export interface PostDraft {
  channelId: string
  division: string
  season: string
  round: string
  circuit: string
  description: string
}
export type PostField = keyof PostDraft

export function validatePostDraft(draft: PostDraft): FormResult<AttendancePostInput, PostField> {
  const errors: Partial<Record<PostField, string>> = {}
  const division = draft.division.trim()
  const season = draft.season.trim()
  const round = draft.round.trim()
  const circuit = draft.circuit.trim()
  const description = draft.description.trim()

  if (!isValidSnowflake(draft.channelId)) errors.channelId = 'Choose a channel.'
  const divisionProblem = division === '' ? 'Choose a division.' : singleLineProblem(division, 1, DIVISION_LIMITS.nameMax, 'a division')
  if (divisionProblem) errors.division = divisionProblem
  const seasonProblem = singleLineProblem(season, 1, ATTENDANCE_POST_LIMITS.seasonMax, 'a season')
  if (seasonProblem) errors.season = seasonProblem
  const roundProblem = singleLineProblem(round, 1, ATTENDANCE_POST_LIMITS.roundMax, 'a round')
  if (roundProblem) errors.round = roundProblem
  const circuitProblem = singleLineProblem(circuit, 1, ATTENDANCE_POST_LIMITS.circuitMax, 'a circuit')
  if (circuitProblem) errors.circuit = circuitProblem
  if (description !== '') {
    const problem = paragraphProblem(description, 1, ATTENDANCE_POST_LIMITS.descriptionMax, 'a description')
    if (problem) errors.description = problem
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { channelId: draft.channelId, division, season, round, circuit, ...(description !== '' ? { description } : {}) } }
}

// ── Sign-up questions (PUT /league/signup-questions) ────────────────────────

export interface QuestionsValidation {
  ok: boolean
  /** Per question (by position): what is wrong with it. */
  rows: Record<number, string>
  /** Something about the list as a whole (too many questions). */
  general: string | null
  /** The trimmed questions to send, when ok. */
  value: string[]
}

/** The documented first-45-characters rule: the label is also the key of the answer, so two labels that start the same collide. */
const keyOf = (question: string): string => [...question].slice(0, QUESTION_KEY_LENGTH).join('')

/**
 * The rules of the sign-up questions, from the backend report: at most `max` questions, each 1 to `length` characters,
 * single line, NO commas (the settings modal splits on them), unique, and no two questions that share their first
 * `length` characters (they would overwrite each other's answer). An empty list is valid: it restores the defaults.
 */
export function validateQuestions(questions: readonly string[], max: number = QUESTION_DEFAULTS.max, length: number = QUESTION_DEFAULTS.length): QuestionsValidation {
  const rows: Record<number, string> = {}
  const trimmed = questions.map((question) => question.trim())
  let general: string | null = null
  if (trimmed.length > max) general = `At most ${max} questions can be kept. Remove ${trimmed.length - max} of them.`

  trimmed.forEach((question, index) => {
    const size = codePointLength(question)
    if (size === 0) rows[index] = 'Fill in the question, or remove it.'
    else if (size > length) rows[index] = `A question can be at most ${length} characters (Discord cuts a form label there). This one has ${size}.`
    else if (question.includes(',')) rows[index] = 'A question cannot contain a comma: the settings split the list on commas, so the question would be cut in two.'
    else {
      const problem = singleLineProblem(question, 1, length, 'the question')
      if (problem) rows[index] = problem
    }
  })
  // Duplicates and first-N-character collisions (checked among the questions that are otherwise fine).
  const seen = new Map<string, number>()
  trimmed.forEach((question, index) => {
    if (rows[index] !== undefined || question === '') return
    const key = keyOf(question)
    const earlier = seen.get(key)
    if (earlier !== undefined) {
      rows[index] =
        trimmed[earlier] === question
          ? `The same question is already number ${earlier + 1}. Questions have to be unique.`
          : `This question starts with the same ${QUESTION_KEY_LENGTH} characters as question ${earlier + 1}: they would overwrite each other's answer. Make the beginnings different.`
    } else seen.set(key, index)
  })
  const ok = general === null && Object.keys(rows).length === 0
  return { ok, rows, general, value: ok ? trimmed : [] }
}

// ── Sign-ups (POST /league/signups) ─────────────────────────────────────────

export interface SignupDraft {
  title: string
  description: string
  channelId: string
  /** "" = the command's default confirmation channel (`signup-confirmations`). */
  confirmationChannelId: string
  closeDate: string
}
export type SignupField = keyof SignupDraft

export function validateSignupDraft(draft: SignupDraft): FormResult<SignupInput, SignupField> {
  const errors: Partial<Record<SignupField, string>> = {}
  const title = draft.title.trim()
  const description = draft.description.trim()
  const closeDate = draft.closeDate.trim()

  const titleProblem = singleLineProblem(title, 1, SIGNUP_LIMITS.titleMax, 'a title')
  if (titleProblem) errors.title = titleProblem
  if (description !== '') {
    const problem = paragraphProblem(description, 1, SIGNUP_LIMITS.descriptionMax, 'a description')
    if (problem) errors.description = problem
  }
  if (!isValidSnowflake(draft.channelId)) errors.channelId = 'Choose the channel to post the sign-up in.'
  if (draft.confirmationChannelId !== '' && !isValidSnowflake(draft.confirmationChannelId)) errors.confirmationChannelId = 'Choose a channel from the list, or leave it on the default.'
  if (closeDate !== '') {
    const problem = singleLineProblem(closeDate, 1, SIGNUP_LIMITS.closeDateMax, 'a close date')
    if (problem) errors.closeDate = problem
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      title,
      channelId: draft.channelId,
      ...(description !== '' ? { description } : {}),
      ...(draft.confirmationChannelId !== '' ? { confirmationChannelId: draft.confirmationChannelId } : {}),
      ...(closeDate !== '' ? { closeDate } : {})
    }
  }
}

/** A page request: `limit` 1-100, `offset` 0 or more. */
export function validatePage(limit: unknown, offset: unknown, max: number = SIGNUP_LIMITS.pageMax): { ok: true; limit?: number; offset?: number } | { ok: false; message: string } {
  const result: { ok: true; limit?: number; offset?: number } = { ok: true }
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > max) return { ok: false, message: `The page size must be a whole number from 1 to ${max}.` }
    result.limit = limit
  }
  if (offset !== undefined) {
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return { ok: false, message: 'The page offset is not valid.' }
    result.offset = offset
  }
  return result
}

/** A sign-up id and an attendance message id are Discord message ids. */
export function isMessageId(value: unknown): value is string {
  return isValidSnowflake(value)
}
