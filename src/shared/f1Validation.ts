import type { AddDriverInput, CalendarRound, EventType, PointsSystemInput, ResultsInput, RoundInput, RoundPatch, TeamInput } from './types'
import { isEventType } from './types'
import { codePointLength, isValidHexColor, isValidSnowflake, singleLineProblem } from './validation'
import type { FormResult } from './validation'

/**
 * Validation of the F1 league forms (milestone 2). Every limit comes from docs/APP_API.md, so mistakes show
 * up next to the field before a request is made; the backend checks all of them again.
 */

export const ROUND_LIMITS = { nameMax: 100, flagMax: 8, roundMin: 1, roundMax: 99, maxRounds: 25 } as const
export const TEAM_LIMITS = { nameMax: 50, abbreviationMax: 6, numberMin: 0, numberMax: 999 } as const
export const RESULT_LIMITS = { seasonMax: 20, roundMax: 10, circuitMax: 60, minDrivers: 1, maxDrivers: 20 } as const
export const POINTS_LIMITS = { slots: 20, min: 0, max: 1000 } as const
export const MEMBER_QUERY_LIMITS = { min: 1, max: 32 } as const

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const DATE_PATTERN = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})$/
const ABBREVIATION_PATTERN = /^[A-Za-z0-9]{1,6}$/

// ── Dates and times ─────────────────────────────────────────────────────────

/** A real calendar date (leap years included). */
export function isRealDate(day: number, month: number, year: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** "DD/MM/YYYY" (one-digit day or month is padded) or "TBD" (any case); null when it is neither, or not a real date. */
export function normaliseRoundDate(text: string): string | null {
  const value = text.trim()
  if (value.toUpperCase() === 'TBD') return 'TBD'
  const match = DATE_PATTERN.exec(value)
  if (!match) return null
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (!isRealDate(day, month, year)) return null
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

export function isValidRoundTime(text: string): boolean {
  return TIME_PATTERN.test(text)
}

// ── Calendar round ──────────────────────────────────────────────────────────

export interface RoundDraft {
  name: string
  date: string
  /** "Date to be decided": the date is sent as TBD and the date text is ignored. */
  dateTbd: boolean
  time: string
  flag: string
  eventType: string
  /** Create only; empty = the next free number. */
  round: string
}
export type RoundField = 'name' | 'date' | 'time' | 'flag' | 'eventType' | 'round'
type RoundErrors = Partial<Record<RoundField, string>>

function nameProblem(name: string): string | null {
  return singleLineProblem(name, 1, ROUND_LIMITS.nameMax, 'a name')
}

function dateProblem(draft: Pick<RoundDraft, 'date' | 'dateTbd'>): { value: string } | { error: string } {
  if (draft.dateTbd) return { value: 'TBD' }
  const date = normaliseRoundDate(draft.date)
  if (date === null) return { error: draft.date.trim() === '' ? 'Enter a date as DD/MM/YYYY, or tick "Date to be decided".' : 'Use a real date as DD/MM/YYYY, for example 15/03/2026.' }
  return { value: date }
}

function timeProblem(time: string): string | null {
  return time === '' || isValidRoundTime(time) ? null : 'Use a 24-hour time as HH:MM, for example 19:30, or leave it empty for TBD.'
}

function flagProblem(flag: string): string | null {
  if (CONTROL_CHARS.test(flag)) return 'The flag must be a single line without special characters.'
  if (codePointLength(flag) > ROUND_LIMITS.flagMax) return `The flag can be at most ${ROUND_LIMITS.flagMax} characters.`
  return null
}

function eventTypeProblem(eventType: string): string | null {
  return isEventType(eventType) ? null : 'Choose Normal Race, Sprint Weekend or Full Qualifying.'
}

/** A new round: name and date are required, the rest is optional. */
export function validateRoundDraft(draft: RoundDraft): FormResult<RoundInput, RoundField> {
  const errors: RoundErrors = {}
  const name = draft.name.trim()
  const time = draft.time.trim()
  const flag = draft.flag.trim()
  const roundText = draft.round.trim()

  const nameError = nameProblem(name)
  if (nameError) errors.name = nameError
  const date = dateProblem(draft)
  if ('error' in date) errors.date = date.error
  const timeError = timeProblem(time)
  if (timeError) errors.time = timeError
  const flagError = flagProblem(flag)
  if (flagError) errors.flag = flagError
  const typeError = eventTypeProblem(draft.eventType)
  if (typeError) errors.eventType = typeError

  let round: number | undefined
  if (roundText !== '') {
    const parsed = /^[0-9]{1,2}$/.test(roundText) ? Number(roundText) : NaN
    if (!Number.isInteger(parsed) || parsed < ROUND_LIMITS.roundMin || parsed > ROUND_LIMITS.roundMax) {
      errors.round = `The round number must be a whole number from ${ROUND_LIMITS.roundMin} to ${ROUND_LIMITS.roundMax}.`
    } else round = parsed
  }

  if (Object.keys(errors).length > 0 || 'error' in date || !isEventType(draft.eventType)) return { ok: false, errors }
  return { ok: true, value: { name, date: date.value, time, flag, eventType: draft.eventType, ...(round !== undefined ? { round } : {}) } }
}

/** The form fields of an existing round. */
export function draftOfRound(round: CalendarRound): RoundDraft {
  const tbd = round.date.trim().toUpperCase() === 'TBD'
  return {
    name: round.name,
    date: tbd ? '' : round.date,
    dateTbd: tbd,
    time: round.time,
    flag: round.flag,
    eventType: isEventType(round.eventType) ? round.eventType : 'Normal Race',
    round: ''
  }
}

/** The fields of a PATCH: every field that is present is validated and cleaned; absent fields are left alone. */
export interface RoundFields {
  name?: string
  date?: string
  time?: string
  flag?: string
  eventType?: string
}

export function validateRoundFields(fields: RoundFields): FormResult<RoundPatch, RoundField> {
  const errors: RoundErrors = {}
  const patch: RoundPatch = {}

  if (fields.name !== undefined) {
    const name = fields.name.trim()
    const problem = nameProblem(name)
    if (problem) errors.name = problem
    else patch.name = name
  }
  if (fields.date !== undefined) {
    const date = dateProblem({ date: fields.date, dateTbd: false })
    if ('error' in date) errors.date = date.error
    else patch.date = date.value
  }
  if (fields.time !== undefined) {
    const time = fields.time.trim()
    const problem = timeProblem(time)
    if (problem) errors.time = problem
    else patch.time = time
  }
  if (fields.flag !== undefined) {
    const flag = fields.flag.trim()
    const problem = flagProblem(flag)
    if (problem) errors.flag = problem
    else patch.flag = flag
  }
  if (fields.eventType !== undefined) {
    const problem = eventTypeProblem(fields.eventType)
    if (problem) errors.eventType = problem
    else patch.eventType = fields.eventType as EventType
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: patch }
}

/**
 * An edit: only the fields that really changed are checked and sent, so a round with an odd legacy value
 * in one field can still be edited elsewhere. `{}` means nothing changed.
 */
export function validateRoundEdit(draft: RoundDraft, current: CalendarRound): FormResult<RoundPatch, RoundField> {
  const changed: RoundFields = {}
  if (draft.name.trim() !== current.name) changed.name = draft.name
  if (draft.time.trim() !== current.time) changed.time = draft.time
  if (draft.flag.trim() !== current.flag) changed.flag = draft.flag
  if (draft.eventType !== current.eventType) changed.eventType = draft.eventType

  const currentDate = current.date.trim().toUpperCase() === 'TBD' ? 'TBD' : current.date
  const dateText = draft.dateTbd ? 'TBD' : draft.date.trim()
  const normalised = normaliseRoundDate(dateText)
  // A date that does not parse counts as changed only when it differs from what is stored: untouched legacy text passes.
  if (normalised === null ? dateText !== currentDate : normalised !== currentDate) changed.date = dateText

  return validateRoundFields(changed)
}

// ── Team ────────────────────────────────────────────────────────────────────

export interface TeamDraft {
  name: string
  color: string
  abbreviation: string
}
export type TeamField = keyof TeamDraft

/** The team name is part of a URL path: `/` and `\` are refused (the API refuses them too). */
export function teamNameProblem(name: string): string | null {
  const problem = singleLineProblem(name, 1, TEAM_LIMITS.nameMax, 'a team name')
  if (problem) return problem
  return /[/\\]/.test(name) ? 'The team name cannot contain / or \\.' : null
}

export function validateTeamDraft(draft: TeamDraft): FormResult<TeamInput, TeamField> {
  const errors: Partial<Record<TeamField, string>> = {}
  const name = draft.name.trim()
  const color = draft.color.trim()
  const abbreviation = draft.abbreviation.trim()

  const nameError = teamNameProblem(name)
  if (nameError) errors.name = nameError
  if (!isValidHexColor(color)) errors.color = 'Use a colour like #FF0000 (a # and six hex digits).'
  if (!ABBREVIATION_PATTERN.test(abbreviation)) {
    errors.abbreviation = abbreviation === '' ? 'Enter an abbreviation.' : `Use 1-${TEAM_LIMITS.abbreviationMax} letters or digits, for example RED.`
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { name, color: color.toUpperCase(), abbreviation: abbreviation.toUpperCase() } }
}

/** True when the team can be addressed by name in an API path (no `/` or `\`, 1-50 characters). */
export function isTeamPathName(name: string): boolean {
  return teamNameProblem(name) === null && name === name.trim()
}

// ── Driver ──────────────────────────────────────────────────────────────────

export interface DriverDraft {
  userId: string
  /** Empty = no number. */
  number: string
}
export type DriverField = 'userId' | 'number'

export function parseDriverNumber(text: string): number | null | undefined {
  const value = text.trim()
  if (value === '') return null
  if (!/^[0-9]{1,3}$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed >= TEAM_LIMITS.numberMin && parsed <= TEAM_LIMITS.numberMax ? parsed : undefined
}

export function validateDriverDraft(draft: DriverDraft): FormResult<AddDriverInput, DriverField> {
  const errors: Partial<Record<DriverField, string>> = {}
  if (!isValidSnowflake(draft.userId)) errors.userId = 'Choose a member.'
  const number = parseDriverNumber(draft.number)
  if (number === undefined) errors.number = `Use a whole number from ${TEAM_LIMITS.numberMin} to ${TEAM_LIMITS.numberMax}, or leave it empty.`
  if (Object.keys(errors).length > 0 || number === undefined) return { ok: false, errors }
  return { ok: true, value: { userId: draft.userId, ...(number !== null ? { number } : {}) } }
}

/** The member search needs 1-32 characters (a leading @ is ignored by the server). */
export function parseMemberQuery(text: string): string | null {
  const query = text.trim()
  const length = codePointLength(query)
  if (length < MEMBER_QUERY_LIMITS.min || length > MEMBER_QUERY_LIMITS.max || CONTROL_CHARS.test(query)) return null
  return query
}

// ── Race results ────────────────────────────────────────────────────────────

export interface ResultsDraft {
  season: string
  round: string
  circuit: string
  /** One user id per position, in finishing order; "" = a row with nobody chosen yet. */
  drivers: string[]
  /** User id, or "" for none. Must be one of `drivers`. */
  fastestLap: string
  pole: string
}
export type ResultsField = 'season' | 'round' | 'circuit' | 'positions' | 'fastestLap' | 'pole'

export function validateResultsDraft(draft: ResultsDraft): FormResult<ResultsInput, ResultsField> {
  const errors: Partial<Record<ResultsField, string>> = {}
  const season = draft.season.trim()
  const round = draft.round.trim()
  const circuit = draft.circuit.trim()

  const seasonError = singleLineProblem(season, 1, RESULT_LIMITS.seasonMax, 'a season')
  if (seasonError) errors.season = seasonError
  const roundError = singleLineProblem(round, 1, RESULT_LIMITS.roundMax, 'a round')
  if (roundError) errors.round = roundError
  const circuitError = singleLineProblem(circuit, 1, RESULT_LIMITS.circuitMax, 'a circuit')
  if (circuitError) errors.circuit = circuitError

  const chosen = draft.drivers
  if (chosen.length < RESULT_LIMITS.minDrivers) errors.positions = 'Add at least one finishing position.'
  else if (chosen.length > RESULT_LIMITS.maxDrivers) errors.positions = `A race can have at most ${RESULT_LIMITS.maxDrivers} positions.`
  else if (chosen.some((id) => !isValidSnowflake(id))) errors.positions = 'Choose a driver for every position, or remove the empty positions.'
  else if (new Set(chosen).size !== chosen.length) errors.positions = 'A driver can only finish once. Remove the duplicate.'

  const inRace = new Set(chosen)
  if (draft.fastestLap !== '' && !inRace.has(draft.fastestLap)) errors.fastestLap = 'The fastest lap must belong to a driver in the results.'
  if (draft.pole !== '' && !inRace.has(draft.pole)) errors.pole = 'The pole position must belong to a driver in the results.'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      season,
      round,
      circuit,
      results: [...chosen],
      ...(draft.fastestLap !== '' ? { fastestLap: draft.fastestLap } : {}),
      ...(draft.pole !== '' ? { pole: draft.pole } : {})
    }
  }
}

// ── Points system ───────────────────────────────────────────────────────────

export interface PointsDraft {
  /** P1 to P20 as typed. */
  points: string[]
  pole: string
  fastestLap: string
}
export type PointsField = 'pole' | 'fastestLap' | `p${number}`

function pointsValue(text: string): number | null {
  const value = text.trim()
  if (!/^[0-9]{1,4}$/.test(value)) return null
  const parsed = Number(value)
  return parsed >= POINTS_LIMITS.min && parsed <= POINTS_LIMITS.max ? parsed : null
}

const POINTS_MESSAGE = `Use a whole number from ${POINTS_LIMITS.min} to ${POINTS_LIMITS.max} (0 = no points).`

/** Always sends all 20 positions, so the saved system is exactly what the form shows. */
export function validatePointsDraft(draft: PointsDraft): FormResult<PointsSystemInput, PointsField> {
  const errors: Partial<Record<PointsField, string>> = {}
  const points: number[] = []
  for (let index = 0; index < POINTS_LIMITS.slots; index++) {
    const value = pointsValue(draft.points[index] ?? '')
    if (value === null) errors[`p${index + 1}`] = POINTS_MESSAGE
    else points.push(value)
  }
  const pole = pointsValue(draft.pole)
  if (pole === null) errors.pole = POINTS_MESSAGE
  const fastestLap = pointsValue(draft.fastestLap)
  if (fastestLap === null) errors.fastestLap = POINTS_MESSAGE
  if (Object.keys(errors).length > 0 || pole === null || fastestLap === null) return { ok: false, errors }
  return { ok: true, value: { points, pole, fastestLap } }
}

export function draftOfPoints(system: PointsSystemInput): PointsDraft {
  return { points: system.points.map(String), pole: String(system.pole), fastestLap: String(system.fastestLap) }
}

/** True when the validated draft differs from what the server holds. */
export function pointsChanged(value: PointsSystemInput, current: PointsSystemInput): boolean {
  return value.pole !== current.pole || value.fastestLap !== current.fastestLap || value.points.length !== current.points.length || value.points.some((points, index) => points !== current.points[index])
}
