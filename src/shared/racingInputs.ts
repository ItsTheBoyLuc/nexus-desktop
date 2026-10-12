import type { Parsed } from './inputs'
import { isCardId, parsePingRoleIds, parsePostTarget } from './pingRoles'
import { isRacingGame, teamNameProblem, validateRacingAttendanceDraft, validateRacingEventDraft, validateRacingPage, validateRacingResultDraft, validateRacingResultQuery, validateRacingTeamDraft, validateRosterAddDraft } from './racingValidation'
import type { RacingAnnouncementInput, RacingAttendanceInput, RacingEventInput, RacingEventPostInput, RacingGame, RacingResultInput, RacingResultPostInput, RacingResultQuery, RacingTeamInput, RacingTeamPostInput, RosterAddInput } from './types'
import { isValidSnowflake, validateAnnouncement } from './validation'

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

/** The optional card of a create (M6): `channelId` + `pingRoleIds`, parsed with the same rules as the posts. Nothing when no channel is given. */
function withCard<T extends object>(value: T, record: Record<string, unknown>): Parsed<T> {
  const target = parsePostTarget(record['channelId'], record['pingRoleIds'])
  if (!target.ok) return { ok: false, message: target.problem.message }
  if (target.value === null) return { ok: true, value }
  return { ok: true, value: { ...value, channelId: target.value.channelId, ...(target.value.pingRoleIds.length > 0 ? { pingRoleIds: target.value.pingRoleIds } : {}) } }
}

export function parseRacingTeamInput(input: unknown): Parsed<RacingTeamInput> {
  const record = isRecord(input) ? input : {}
  const result = validateRacingTeamDraft({ name: text(record['name']), color: text(record['color']), focus: text(record['focus']) })
  return result.ok ? withCard(result.value, record) : { ok: false, message: firstError(result.errors) }
}

/** Post the card of an existing team: the team (by name), a channel and up to 3 roles. */
export function parseRacingTeamPostInput(input: unknown): Parsed<RacingTeamPostInput> {
  const record = isRecord(input) ? input : {}
  const team = parseRacingTeamName(record['team'])
  if (!team.ok) return team
  const target = parsePostTarget(record['channelId'], record['pingRoleIds'])
  if (!target.ok) return { ok: false, message: target.problem.message }
  if (target.value === null) return { ok: false, message: 'Choose a channel to post in.' }
  return { ok: true, value: { team: team.value, channelId: target.value.channelId, ...(target.value.pingRoleIds.length > 0 ? { pingRoleIds: target.value.pingRoleIds } : {}) } }
}

function parseCardPost(record: Record<string, unknown>, what: string): Parsed<{ id: string; channelId: string; pingRoleIds?: string[] }> {
  if (!isCardId(record['id'])) return { ok: false, message: `That ${what} is not valid.` }
  const target = parsePostTarget(record['channelId'], record['pingRoleIds'])
  if (!target.ok) return { ok: false, message: target.problem.message }
  if (target.value === null) return { ok: false, message: 'Choose a channel to post in.' }
  return { ok: true, value: { id: record['id'], channelId: target.value.channelId, ...(target.value.pingRoleIds.length > 0 ? { pingRoleIds: target.value.pingRoleIds } : {}) } }
}

export function parseRacingEventPostInput(input: unknown): Parsed<RacingEventPostInput> {
  return parseCardPost(isRecord(input) ? input : {}, 'event')
}

export function parseRacingResultPostInput(input: unknown): Parsed<RacingResultPostInput> {
  return parseCardPost(isRecord(input) ? input : {}, 'result')
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
  return result.ok ? withCard(result.value, record) : { ok: false, message: firstError(result.errors) }
}

export function parseRacingPage(input: unknown): Parsed<{ limit?: number; offset?: number }> {
  const record = isRecord(input) ? input : {}
  const page = validateRacingPage(record['limit'], record['offset'])
  if (!page.ok) return page
  return { ok: true, value: { ...(page.limit !== undefined ? { limit: page.limit } : {}), ...(page.offset !== undefined ? { offset: page.offset } : {}) } }
}

export function parseRacingResultInput(input: unknown): Parsed<RacingResultInput> {
  const record = isRecord(input) ? input : {}
  const result = validateRacingResultDraft({
    team: text(record['team']),
    eventName: text(record['eventName']),
    result: text(record['result']),
    drivers: text(record['drivers']),
    notes: text(record['notes'])
  })
  return result.ok ? withCard(result.value, record) : { ok: false, message: firstError(result.errors) }
}

export function parseRacingResultQuery(input: unknown): Parsed<RacingResultQuery> {
  const record = isRecord(input) ? input : {}
  return validateRacingResultQuery(record['team'], record['limit'], record['offset'])
}

export function parseRacingAttendanceInput(input: unknown): Parsed<RacingAttendanceInput> {
  const record = isRecord(input) ? input : {}
  const result = validateRacingAttendanceDraft({ channelId: text(record['channelId']), name: text(record['name']), date: text(record['date']), description: text(record['description']) })
  if (!result.ok) return { ok: false, message: firstError(result.errors) }
  const pings = parsePingRoleIds(record['pingRoleIds'])
  if (!pings.ok) return { ok: false, message: pings.problem.message }
  return { ok: true, value: { ...result.value, ...(pings.value.length > 0 ? { pingRoleIds: pings.value } : {}) } }
}

/** The announcement of one game: the same fields and limits as the server-level announcement (title 150, message 1500, https image 500). */
export function parseRacingAnnouncementInput(input: unknown): Parsed<RacingAnnouncementInput> {
  const record = isRecord(input) ? input : {}
  const result = validateAnnouncement({ title: text(record['title']), message: text(record['message']), channelId: text(record['channelId']), imageUrl: text(record['imageUrl']) })
  if (!result.ok) return { ok: false, message: firstError(result.errors) }
  const pings = parsePingRoleIds(record['pingRoleIds'])
  if (!pings.ok) return { ok: false, message: pings.problem.message }
  return { ok: true, value: { ...result.value, ...(pings.value.length > 0 ? { pingRoleIds: pings.value } : {}) } }
}
