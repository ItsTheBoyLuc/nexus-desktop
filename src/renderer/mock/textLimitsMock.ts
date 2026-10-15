/**
 * The fake server's check of the long texts, as docs/APP_API.md ("Text limits") describes it, and the two scenarios that exercise it
 * (dev:mock only; never part of an Electron build).
 *
 *   ?scenario=maxtext    submits, through the fake bridge, every raised text at exactly its limit: all of them are accepted and
 *                        show up in the lists and dialogs (wrapping, truncated lines and the 1000px minimum width can be checked by eye)
 *   ?scenario=overtext   submits the same texts one character too long: the fake server refuses each with its invalid_* code
 *                        and stores nothing. (The forms never send such a text: the app's own check stops it first. This
 *                        proves the server side of the rule and what the app does when the server disagrees.)
 *
 * The outcome of every submission is written to the console, one line each.
 */
import type { NexusBridge } from '../../shared/bridge'
import { TEXT_LIMITS } from '../../shared/textLimits'
import type { IpcResult } from '../../shared/types'
import { codePointLength, escapedLength } from '../../shared/validation'
import { failure } from './common'

export type LongTextField = keyof typeof TEXT_LIMITS

/** The error code of the endpoint for each field, from the "Errors" lines of docs/APP_API.md. */
const CODES: Record<LongTextField, string> = {
  eventNotes: 'invalid_notes',
  resultNotes: 'invalid_notes',
  resultCombined: 'invalid_notes',
  racingAttendanceDescription: 'invalid_description',
  f1AttendanceDescription: 'invalid_description',
  signupDescription: 'invalid_description',
  penaltyPointsReason: 'invalid_reason',
  penaltyClearReason: 'invalid_reason',
  decisionExplanation: 'invalid_explanation',
  decisionDescription: 'invalid_description'
}
/** The fields the docs mark with a star: each `_` counts as 2. */
const ESCAPED = new Set<LongTextField>(['eventNotes', 'resultNotes', 'resultCombined', 'penaltyPointsReason', 'decisionExplanation', 'decisionDescription'])

/** The length the server compares with the limit: trimmed, one Unicode character is 1, underscores twice where marked. */
export function serverLength(field: LongTextField, text: string): number {
  const trimmed = text.trim()
  return ESCAPED.has(field) ? escapedLength(trimmed) : codePointLength(trimmed)
}

/** A 400 when the text is over the limit of the field, else null. An absent text is fine (these fields are optional or checked elsewhere). */
export function checkLongText(field: LongTextField, text: string | undefined): IpcResult<never> | null {
  if (text === undefined || serverLength(field, text) <= TEXT_LIMITS[field]) return null
  return failure('http', CODES[field], `The text can be at most ${TEXT_LIMITS[field]} characters.`, 400)
}

/** `result` + `drivers` + `notes` of a result share one Discord field: together at most 1014 (underscores twice). */
export function checkResultText(input: { result: string; drivers: string; notes?: string | undefined }): IpcResult<never> | null {
  const notes = checkLongText('resultNotes', input.notes)
  if (notes) return notes
  const together = serverLength('resultCombined', input.result) + serverLength('resultCombined', input.drivers) + serverLength('resultCombined', input.notes ?? '')
  return together > TEXT_LIMITS.resultCombined
    ? failure('http', CODES.resultCombined, `The result, the drivers and the notes together can be at most ${TEXT_LIMITS.resultCombined} characters.`, 400)
    : null
}

// ── The scenarios ───────────────────────────────────────────────────────────

const APEX = '555000000000000001'

/** A recognisable fill of exactly `length` characters: the start and the end carry a label, so a text that was cut off is easy to spot. Plain text only. */
export function fillerText(length: number, label: string): string {
  if (length <= 0) return ''
  const head = `[${label} start] `
  const tail = ` [${label} end]`
  if (length <= head.length + tail.length) return 'x'.repeat(length)
  const body = 'Fake long text, plain text only <b>no html</b>. '
  const middle = body.repeat(Math.ceil(length / body.length)).slice(0, length - head.length - tail.length)
  return `${head}${middle}${tail}`
}

export interface LongTextOutcome {
  field: string
  length: number
  result: string
}

/** Runs the nine submissions; resolves with what each one did (also written to the console). */
export async function runLongTextScenario(bridge: Pick<NexusBridge, 'api'>, scenario: 'maxtext' | 'overtext', marker: string): Promise<LongTextOutcome[]> {
  const extra = scenario === 'overtext' ? 1 : 0
  const outcomes: LongTextOutcome[] = []
  const record = (field: string, length: number, result: IpcResult<unknown>): void => {
    const outcome = { field, length, result: result.ok ? 'accepted' : `refused: ${result.error.code}` }
    outcomes.push(outcome)
    console.info(`[${marker}] ${scenario}: ${field} (${length} characters) -> ${outcome.result}`)
  }
  const text = (limit: number, label: string): string => fillerText(limit + extra, label)
  const api = bridge.api

  // What the submissions need from the fake data: a channel, a division, a team and a pending report.
  const channels = await api.channels(APEX)
  const channel = channels.ok ? channels.data[0]?.id : undefined
  const teams = await api.racingTeams(APEX, 'lmu')
  const team = teams.ok ? teams.data[0]?.name : undefined
  const divisions = await api.attendanceDivisions(APEX)
  const division = divisions.ok ? divisions.data.divisions[0]?.name : undefined
  const reports = await api.reports(APEX, { status: 'pending' })
  // A report can be decided once, so the two decisions need two pending reports.
  const report = reports.ok ? reports.data.reports[0]?.id : undefined
  const otherReport = reports.ok ? reports.data.reports[1]?.id : undefined
  if (!channel || !team || !division || !report || !otherReport) {
    console.info(`[${marker}] ${scenario}: the fake data has no channel, team, division or two pending reports, so nothing was submitted.`)
    return outcomes
  }

  const eventNotes = text(TEXT_LIMITS.eventNotes, 'event notes')
  record('events: notes', eventNotes.length, await api.addRacingEvent(APEX, 'lmu', { name: 'Fake Max Text Event', date: '2099-01-01', time: '20:00 UTC', notes: eventNotes }))

  // result (100) + drivers (200) + notes (714) at their own maximum are exactly the 1014 of the shared field; "one too long" is one more in the notes.
  const resultNotes = text(TEXT_LIMITS.resultNotes, 'result notes')
  record('results: notes', resultNotes.length, await api.logRacingResult(APEX, 'lmu', { team, eventName: 'Fake Max Text Event', result: 'x'.repeat(100), drivers: 'y'.repeat(200), notes: resultNotes }))

  const racingDescription = text(TEXT_LIMITS.racingAttendanceDescription, 'esports attendance')
  record('esports attendance: description', racingDescription.length, await api.createRacingAttendance(APEX, 'lmu', { channelId: channel, name: 'Fake Max Text Post', date: 'Tuesday', description: racingDescription }))

  const f1Description = text(TEXT_LIMITS.f1AttendanceDescription, 'F1 attendance')
  record('F1 attendance post: description', f1Description.length, await api.createAttendancePost(APEX, { channelId: channel, division, season: '16', round: '5', circuit: 'Zandvoort', description: f1Description }))

  const signupDescription = text(TEXT_LIMITS.signupDescription, 'sign-up')
  record('sign-up: description', signupDescription.length, await api.createSignup(APEX, { title: 'Fake Max Text Sign-up', channelId: channel, description: signupDescription }))

  const pointsReason = text(TEXT_LIMITS.penaltyPointsReason, 'points reason')
  record('penalty points: reason', pointsReason.length, await api.addPenaltyPoints(APEX, { driver: 'Fake Max Text Driver', penaltyType: 'Drive-Through', points: 1, reason: pointsReason }))

  const clearReason = text(TEXT_LIMITS.penaltyClearReason, 'clear reason')
  record('clear points: reason', clearReason.length, await api.clearPenaltyPoints(APEX, { driver: 'Fake Max Text Driver', reason: clearReason, confirm: true }))

  const explanation = text(TEXT_LIMITS.decisionExplanation, 'explanation')
  record('decision: explanation', explanation.length, await api.decideReport(APEX, report, { decision: 'no_further_action', explanation }))

  const penaltyText = text(TEXT_LIMITS.decisionDescription, 'penalty')
  record('decision: penalty description', penaltyText.length, await api.decideReport(APEX, otherReport, { decision: 'penalty_issued', description: penaltyText, penaltyPoints: 0 }))

  return outcomes
}
