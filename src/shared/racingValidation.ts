import { isRealDate } from './f1Validation'
import type { RacingAttendanceInput, RacingEventInput, RacingGame, RacingResultInput, RacingResultQuery, RacingRole, RacingTeamEditInput, RacingTeamInput, RosterAddInput } from './types'
import { GAME_KEYS, isGameKey, isRacingRole } from './types'
import { codePointLength, escapedLength, isValidHexColor, isValidSnowflake, singleLineProblem } from './validation'
import type { FormResult } from './validation'
import { paragraphProblem } from './penaltyValidation'
import { TEXT_LIMITS } from './textLimits'

/**
 * Validation of the esports team forms (milestone 5). Every limit comes from docs/APP_API.md, so a mistake shows up next
 * to the field before a request is made; the backend checks all of them again, and the main process re-checks everything
 * the renderer sends (racingInputs.ts).
 */

export const RACING_LIMITS = {
  teamNameMax: 50,
  focusMax: 30,
  eventNameMax: 100,
  dateMax: 20,
  timeMax: 20,
  classMax: 30,
  eventNotesMax: TEXT_LIMITS.eventNotes,
  resultNotesMax: TEXT_LIMITS.resultNotes,
  /** `result` + `drivers` + `notes` together (underscores count twice), one Discord field. */
  resultCombinedMax: TEXT_LIMITS.resultCombined,
  resultEventMax: 100,
  resultMax: 100,
  driversMax: 200,
  attendanceNameMax: 100,
  attendanceDateMax: 20,
  attendanceDescriptionMax: TEXT_LIMITS.racingAttendanceDescription,
  pageMin: 1,
  pageMax: 100
} as const

/** The five games with an esports team. Any other `{game}` is `404 unknown_game` on the server and refused before a request here. */
export const RACING_GAMES: readonly RacingGame[] = GAME_KEYS

export function isRacingGame(value: unknown): value is RacingGame {
  return isGameKey(value)
}

// ── Teams ───────────────────────────────────────────────────────────────────

export interface RacingTeamDraft {
  name: string
  color: string
  /** Free text, optional. */
  focus: string
}
export type RacingTeamField = keyof RacingTeamDraft

/** The class or category is free text for EVERY game: 30 characters on one line, never a fixed list. */
export function validateRacingTeamDraft(draft: RacingTeamDraft): FormResult<RacingTeamInput, RacingTeamField> {
  const errors: Partial<Record<RacingTeamField, string>> = {}
  const name = draft.name.trim()
  const color = draft.color.trim()
  const focus = draft.focus.trim()

  const nameProblem = singleLineProblem(name, 1, RACING_LIMITS.teamNameMax, 'a team name')
  if (nameProblem) errors.name = nameProblem
  if (!isValidHexColor(color)) errors.color = 'Use a colour like #1E41FF (a # and six hex digits).'
  if (focus !== '') {
    const problem = singleLineProblem(focus, 1, RACING_LIMITS.focusMax, 'a class or category')
    if (problem) errors.focus = problem
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { name, color: color.toUpperCase(), ...(focus !== '' ? { focus } : {}) } }
}

// ── Edit a team (M7) ────────────────────────────────────────────────────────

export interface RacingTeamEditDraft {
  name: string
  /** Free text; empty clears the class or category. */
  focus: string
}
export type RacingTeamEditField = keyof RacingTeamEditDraft

/** What the team is now, as the list or the detail shows it: the edit is compared against this, so only real changes are sent. */
export interface RacingTeamEditBase {
  name: string
  focus: string
}

/** The fields of an edit that really differ from the team as it is now (a different capitalisation of the name IS a change, like the server). */
export type RacingTeamEditChanges = Pick<RacingTeamEditInput, 'newName' | 'focus'>

export function hasTeamEditChanges(changes: RacingTeamEditChanges): boolean {
  return changes.newName !== undefined || changes.focus !== undefined
}

/**
 * Checks the edit form and keeps only what changed: `newName` when the trimmed name differs from the current one, `focus` when the trimmed
 * class differs (empty text becomes `null`, which clears it). Nothing changed gives an empty value, which the dialog answers with
 * "nothing to save" and never sends (the server would answer 400 no_changes).
 */
export function validateRacingTeamEditDraft(base: RacingTeamEditBase, draft: RacingTeamEditDraft): FormResult<RacingTeamEditChanges, RacingTeamEditField> {
  const errors: Partial<Record<RacingTeamEditField, string>> = {}
  const name = draft.name.trim()
  const focus = draft.focus.trim()
  const nameProblem = singleLineProblem(name, 1, RACING_LIMITS.teamNameMax, 'a team name')
  if (nameProblem) errors.name = nameProblem
  if (focus !== '') {
    const problem = singleLineProblem(focus, 1, RACING_LIMITS.focusMax, 'a class or category')
    if (problem) errors.focus = problem
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const changes: RacingTeamEditChanges = {}
  if (name !== base.name) changes.newName = name
  if (focus !== base.focus.trim()) changes.focus = focus === '' ? null : focus
  return { ok: true, value: changes }
}

/** A team name in a query parameter: 1 to 50 characters, one line. */
export function teamNameProblem(name: string): string | null {
  return singleLineProblem(name.trim(), 1, RACING_LIMITS.teamNameMax, 'a team name')
}

// ── Roster ──────────────────────────────────────────────────────────────────

export interface RosterAddDraft {
  team: string
  userId: string
  /** The dropdown value: one of the four roles, or "" while nothing is chosen. */
  role: string
}
export type RosterAddField = keyof RosterAddDraft

export function validateRosterAddDraft(draft: RosterAddDraft): FormResult<RosterAddInput, RosterAddField> {
  const errors: Partial<Record<RosterAddField, string>> = {}
  const team = draft.team.trim()
  const teamProblem = teamNameProblem(team)
  if (teamProblem) errors.team = teamProblem
  if (!isValidSnowflake(draft.userId)) errors.userId = 'Choose a member.'
  if (!isRacingRole(draft.role)) errors.role = 'Choose Race Driver, Reserve, Coach or Manager.'
  if (Object.keys(errors).length > 0 || !isRacingRole(draft.role)) return { ok: false, errors }
  const role: RacingRole = draft.role
  return { ok: true, value: { team, userId: draft.userId, role } }
}

// ── Event dates ─────────────────────────────────────────────────────────────

/**
 * The formats the bot reads, in the order it tries them (docs/APP_API.md). The first one that gives a real date wins, which
 * is why `03/04/2026` is March 4th: MM/DD/YYYY comes before DD/MM/YYYY.
 */
const DATE_FORMATS: ReadonlyArray<{ name: string; pattern: RegExp; read: (match: RegExpExecArray) => [number, number, number] }> = [
  { name: 'YYYY-MM-DD', pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, read: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  { name: 'DD-MM-YYYY', pattern: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, read: (m) => [Number(m[3]), Number(m[2]), Number(m[1])] },
  { name: 'MM/DD/YYYY', pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, read: (m) => [Number(m[3]), Number(m[1]), Number(m[2])] },
  { name: 'DD/MM/YYYY', pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, read: (m) => [Number(m[3]), Number(m[2]), Number(m[1])] },
  { name: 'YYYY/MM/DD', pattern: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, read: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] }
]

const isoOf = (year: number, month: number, day: number): string => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

export interface ParsedEventDate {
  /** The date the bot understands, as YYYY-MM-DD. */
  iso: string
  /** The format that matched first. */
  format: string
  /** The same text is a real date in a second reading that gives another day (e.g. 03/04/2026: 4 March or 3 April). */
  ambiguous: boolean
}

/** Reads a date exactly like the bot does; null when none of the five formats gives a real date (the server would keep it and list it last). */
export function parseEventDate(text: string): ParsedEventDate | null {
  const value = text.trim()
  const reads = DATE_FORMATS.flatMap((format) => {
    const match = format.pattern.exec(value)
    if (!match) return []
    const [year, month, day] = format.read(match)
    return isRealDate(day, month, year) ? [{ format: format.name, iso: isoOf(year, month, day) }] : []
  })
  const first = reads[0]
  if (!first) return null
  return { iso: first.iso, format: first.format, ambiguous: reads.some((read) => read.iso !== first.iso) }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

/** "Wednesday 4 March 2026" for a YYYY-MM-DD date. Fixed English names, so the text is the same on every computer (no locale or ICU differences). */
export function longDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (!isRealDate(day, month, year)) return iso
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? ''
  return `${weekday} ${day} ${MONTHS[month - 1] ?? ''} ${year}`
}

export type DatePreview =
  | { ok: true; iso: string; label: string; ambiguous: boolean }
  | { ok: false; message: string }

/** What the form shows under the date: "Interpreted as: <full date>", or why the date cannot be used. */
export function previewEventDate(text: string): DatePreview {
  if (text.trim() === '') return { ok: false, message: 'Choose a date.' }
  const parsed = parseEventDate(text)
  if (!parsed) return { ok: false, message: 'That is not a date the bot can read. The server would keep it forever and list the event last. Pick a date with the date picker.' }
  return { ok: true, iso: parsed.iso, label: longDate(parsed.iso), ambiguous: parsed.ambiguous }
}

/** True when the date is before `today` (a YYYY-MM-DD string): the list only shows upcoming events, so it would not appear. */
export function isPastDate(iso: string, today: string): boolean {
  return iso < today
}

// ── Events ──────────────────────────────────────────────────────────────────

export interface RacingEventDraft {
  name: string
  /** What the date picker gives: YYYY-MM-DD. */
  date: string
  /** 24-hour HH:MM from the time picker. */
  time: string
  /** A short time zone, for example UTC or CET. */
  zone: string
  class: string
  notes: string
}
export type RacingEventField = keyof RacingEventDraft

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const ZONE_PATTERN = /^[A-Za-z0-9+:-]{1,10}$/

/**
 * The event as the API takes it. The date is sent as YYYY-MM-DD only (the first format the bot tries, so it can never be
 * read the other way round) and must be a real date; the time is "HH:MM zone" (free text for the server, 20 characters at most).
 */
export function validateRacingEventDraft(draft: RacingEventDraft): FormResult<RacingEventInput, RacingEventField> {
  const errors: Partial<Record<RacingEventField, string>> = {}
  const name = draft.name.trim()
  const zone = draft.zone.trim()
  const className = draft.class.trim()
  const notes = draft.notes.trim()

  const nameProblem = singleLineProblem(name, 1, RACING_LIMITS.eventNameMax, 'an event name')
  if (nameProblem) errors.name = nameProblem

  const preview = previewEventDate(draft.date)
  if (!preview.ok) errors.date = preview.message
  else if (preview.iso !== draft.date.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date.trim())) errors.date = 'Use the date picker: the date is sent as YYYY-MM-DD only.'

  if (!TIME_PATTERN.test(draft.time.trim())) errors.time = 'Choose a time (24-hour, for example 20:00).'
  if (!ZONE_PATTERN.test(zone)) errors.zone = 'Enter a short time zone of up to 10 characters, for example UTC or CET.'
  const timeText = `${draft.time.trim()} ${zone}`
  if (!errors.time && !errors.zone && codePointLength(timeText) > RACING_LIMITS.timeMax) errors.zone = `Time and zone together can be at most ${RACING_LIMITS.timeMax} characters.`

  if (className !== '') {
    const problem = singleLineProblem(className, 1, RACING_LIMITS.classMax, 'a class')
    if (problem) errors.class = problem
  }
  if (notes !== '') {
    const problem = paragraphProblem(notes, 1, RACING_LIMITS.eventNotesMax, 'the notes', true)
    if (problem) errors.notes = problem
  }
  if (Object.keys(errors).length > 0 || !preview.ok) return { ok: false, errors }
  return { ok: true, value: { name, date: preview.iso, time: timeText, ...(className !== '' ? { class: className } : {}), ...(notes !== '' ? { notes } : {}) } }
}

/** A page request: `limit` 1-100, `offset` 0 or more. */
export function validateRacingPage(limit: unknown, offset: unknown): { ok: true; limit?: number; offset?: number } | { ok: false; message: string } {
  const result: { ok: true; limit?: number; offset?: number } = { ok: true }
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < RACING_LIMITS.pageMin || limit > RACING_LIMITS.pageMax) return { ok: false, message: `The page size must be a whole number from ${RACING_LIMITS.pageMin} to ${RACING_LIMITS.pageMax}.` }
    result.limit = limit
  }
  if (offset !== undefined) {
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return { ok: false, message: 'The page offset is not valid.' }
    result.offset = offset
  }
  return result
}

// ── Results archive ─────────────────────────────────────────────────────────

export interface RacingResultDraft {
  /** The team's name as the server spells it (picked from the team list). */
  team: string
  eventName: string
  result: string
  drivers: string
  notes: string
}
export type RacingResultField = keyof RacingResultDraft

/** What the three texts of a result take of their shared Discord field (trimmed, underscores counted twice). */
export function resultTextLength(draft: Pick<RacingResultDraft, 'result' | 'drivers' | 'notes'>): number {
  return escapedLength(draft.result.trim()) + escapedLength(draft.drivers.trim()) + escapedLength(draft.notes.trim())
}

/**
 * Logging a result (/racing {game} results-log). The archive is append-only and the same result twice is two entries, so every
 * limit is checked here before anything is sent: event name 1-100, result 1-100, drivers 1-200 (free text), notes up to 714, and the three together up to 1014.
 */
export function validateRacingResultDraft(draft: RacingResultDraft): FormResult<RacingResultInput, RacingResultField> {
  const errors: Partial<Record<RacingResultField, string>> = {}
  const team = draft.team.trim()
  const eventName = draft.eventName.trim()
  const result = draft.result.trim()
  const drivers = draft.drivers.trim()
  const notes = draft.notes.trim()

  if (team === '') errors.team = 'Choose a team.'
  else {
    const problem = teamNameProblem(team)
    if (problem) errors.team = problem
  }
  const eventProblem = singleLineProblem(eventName, 1, RACING_LIMITS.resultEventMax, 'an event name')
  if (eventProblem) errors.eventName = eventProblem
  const resultProblem = singleLineProblem(result, 1, RACING_LIMITS.resultMax, 'the result')
  if (resultProblem) errors.result = resultProblem
  const driversProblem = singleLineProblem(drivers, 1, RACING_LIMITS.driversMax, 'the drivers involved')
  if (driversProblem) errors.drivers = driversProblem
  if (notes !== '') {
    const problem = paragraphProblem(notes, 1, RACING_LIMITS.resultNotesMax, 'the notes', true)
    if (problem) errors.notes = problem
  }
  // The three texts share ONE Discord field: together they may take at most 1014 characters, underscores counted twice.
  if (!errors.result && !errors.drivers && !errors.notes && resultTextLength(draft) > RACING_LIMITS.resultCombinedMax) {
    errors.notes = `The result, the drivers and the notes together can be at most ${RACING_LIMITS.resultCombinedMax} characters (each underscore counts as 2). Shorten the notes.`
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { team, eventName, result, drivers, ...(notes !== '' ? { notes } : {}) } }
}

/** The query of the archive: an optional team, `limit` 1-100 and `offset` 0 or more. */
export function validateRacingResultQuery(team: unknown, limit: unknown, offset: unknown): { ok: true; value: RacingResultQuery } | { ok: false; message: string } {
  const page = validateRacingPage(limit, offset)
  if (!page.ok) return page
  const value: RacingResultQuery = { ...(page.limit !== undefined ? { limit: page.limit } : {}), ...(page.offset !== undefined ? { offset: page.offset } : {}) }
  if (team !== undefined && team !== null && team !== '') {
    if (typeof team !== 'string') return { ok: false, message: 'Enter a team name.' }
    const problem = teamNameProblem(team)
    if (problem) return { ok: false, message: problem }
    value.team = team.trim()
  }
  return { ok: true, value }
}

// ── Attendance posts ────────────────────────────────────────────────────────

export interface RacingAttendanceDraft {
  channelId: string
  name: string
  date: string
  description: string
}
export type RacingAttendanceField = keyof RacingAttendanceDraft

/** Creating an attendance post: name 1-100, date 1-20 (free text, shown as typed), description up to 3645, and a channel. */
export function validateRacingAttendanceDraft(draft: RacingAttendanceDraft): FormResult<RacingAttendanceInput, RacingAttendanceField> {
  const errors: Partial<Record<RacingAttendanceField, string>> = {}
  const name = draft.name.trim()
  const date = draft.date.trim()
  const description = draft.description.trim()

  if (!isValidSnowflake(draft.channelId)) errors.channelId = 'Choose a channel.'
  const nameProblem = singleLineProblem(name, 1, RACING_LIMITS.attendanceNameMax, 'a name for the post')
  if (nameProblem) errors.name = nameProblem
  const dateProblem = singleLineProblem(date, 1, RACING_LIMITS.attendanceDateMax, 'a date')
  if (dateProblem) errors.date = dateProblem
  if (description !== '') {
    const problem = paragraphProblem(description, 1, RACING_LIMITS.attendanceDescriptionMax, 'the description')
    if (problem) errors.description = problem
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { channelId: draft.channelId, name, date, ...(description !== '' ? { description } : {}) } }
}
