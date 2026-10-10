import type { Parsed } from './inputs'
import { isRacingGame, teamNameProblem, validateRacingEventDraft, validateRacingPage, validateRacingTeamDraft, validateRosterAddDraft } from './racingValidation'
import type { RacingEventInput, RacingGame, RacingTeamInput, RosterAddInput } from './types'
import { isValidSnowflake } from './validation'

/**
 * The main process never trusts what the renderer sends over IPC: every M5 argument is parsed again here, with the same
 * rules the forms use (shared/racingValidation.ts), before it can reach the API. The game is always checked first: it is
 * the `{game}` segment of the path, and it is what keeps one game's data apart from another's.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const firstError = (errors: Record<string, string | undefined>): string => Object.values(errors).find((message) => message) ?? 'Check the form and try again.'

export function parseRacingGame(value: unknown): Parsed<RacingGame> {
  return isRacingGame(value) ? { ok: true, value } : { ok: false, message: 'That game has no esports team module.' }
}

export function parseRacingTeamInput(input: unknown): Parsed<RacingTeamInput> {
  const record = isRecord(input) ? input : {}
  const result = validateRacingTeamDraft({ name: text(record['name']), color: text(record['color']), focus: text(record['focus']) })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parseRacingTeamName(value: unknown): Parsed<string> {
  if (typeof value !== 'string') return { ok: false, message: 'Enter a team name.' }
  const problem = teamNameProblem(value)
  return problem ? { ok: false, message: problem } : { ok: true, value: value.trim() }
}

export function parseRosterAddInput(input: unknown): Parsed<RosterAddInput> {
  const record = isRecord(input) ? input : {}
  const result = validateRosterAddDraft({ team: text(record['team']), userId: text(record['userId']), role: text(record['role']) })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parseRacingUserId(value: unknown): Parsed<string> {
  return isValidSnowflake(value) ? { ok: true, value } : { ok: false, message: 'That member ID is not valid.' }
}

/** The event as the form builds it: the date is YYYY-MM-DD and the time "HH:MM zone". */
export function parseRacingEventInput(input: unknown): Parsed<RacingEventInput> {
  const record = isRecord(input) ? input : {}
  const time = text(record['time']).trim()
  const split = /^(\S+)\s+(\S+)$/.exec(time)
  const result = validateRacingEventDraft({
    name: text(record['name']),
    date: text(record['date']),
    time: split?.[1] ?? '',
    zone: split?.[2] ?? '',
    class: text(record['class']),
    notes: text(record['notes'])
  })
  return result.ok ? result : { ok: false, message: firstError(result.errors) }
}

export function parseRacingPage(input: unknown): Parsed<{ limit?: number; offset?: number }> {
  const record = isRecord(input) ? input : {}
  const page = validateRacingPage(record['limit'], record['offset'])
  if (!page.ok) return page
  return { ok: true, value: { ...(page.limit !== undefined ? { limit: page.limit } : {}), ...(page.offset !== undefined ? { offset: page.offset } : {}) } }
}
