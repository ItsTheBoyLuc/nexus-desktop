import type { DecisionField } from '../../shared/penaltyValidation'
import type { DecisionInput, DecisionResult, IpcResult, Report } from '../../shared/types'
import { describeError, errorCode, outcomeUnknown, unwrap } from './errors'
import { seasonFromReport } from './reportView'

/**
 * The rules of deciding a report, free of React so they can be tested. The thing to get right is what the
 * screen does after every kind of answer, because a decision cannot be undone from the app:
 *
 *  - the decision request is sent EXACTLY ONCE. There is no retry, not after a timeout, a dropped connection or a
 *    5xx. A lost answer means "this report may already be decided": the only way forward is to read it again.
 *  - 409 already_decided: it was decided meanwhile (maybe in Discord). Refresh the report; nothing was applied twice.
 *  - 409 penalty_not_configured: nothing was changed. Blocking message + the way to the Penalty settings.
 *  - report_message_not_found (404 or 409): the bot cannot find the report's message/thread; the decision was
 *    refused and nothing changed.
 *  - 500 penalty_points_failed: the report IS decided but the points are NOT saved. The decision is never
 *    resent (it would answer 409 already_decided); the points are added with the manual points dialog, prefilled.
 */

export interface ManualPointsPrefill {
  driver: string
  points: number
  /** Absent: the current season (the server's default). */
  season?: number
  penaltyType: string
  reason: string
}

export type DecisionRun =
  | { kind: 'decided'; result: DecisionResult }
  | { kind: 'already_decided' }
  | { kind: 'penalty_not_configured' }
  | { kind: 'message_not_found' }
  /** Decided, points NOT saved: carries what the manual points dialog is filled with. */
  | { kind: 'points_failed'; prefill: ManualPointsPrefill }
  /** The outcome is unknown: the report may be decided. */
  | { kind: 'lost' }
  | { kind: 'field'; field: DecisionField; message: string }
  /** A refusal that proves nothing changed, with the text to show. */
  | { kind: 'refused'; message: string }

const FIELD_OF_CODE: Readonly<Record<string, DecisionField>> = {
  invalid_explanation: 'explanation',
  invalid_description: 'description',
  invalid_driver: 'driver',
  driver_required: 'driver',
  invalid_penalty_points: 'points',
  invalid_season: 'season'
}

/** Refusals that need their own wording here (the generic texts talk about panels or channels). */
function refusalText(error: unknown): string {
  switch (errorCode(error)) {
    case 'not_a_bot_message':
      return "The report's message in Discord was not posted by Nexus, so it cannot be edited. Nothing was changed."
    case 'bot_cannot_send':
      return "Nexus cannot post in the report's thread (it needs that for a possible ban notice), so the decision was refused. Nothing was changed."
    case 'report_embed_missing':
      return 'The report message in Discord no longer has its report embed, so the decision was refused. Nothing was changed.'
    case 'report_not_found':
      return 'That report no longer exists. Nothing was changed.'
    default:
      return describeError(error)
  }
}

/** What the manual points dialog is filled with when the points of a decided report could not be saved. */
export function pointsFallbackPrefill(report: Report, input: Extract<DecisionInput, { decision: 'penalty_issued' }>): ManualPointsPrefill {
  const season = input.season ?? seasonFromReport(report) ?? undefined
  return {
    driver: input.driver ?? '',
    points: input.penaltyPoints,
    ...(season !== undefined ? { season } : {}),
    penaltyType: input.description.trim().slice(0, 100),
    reason: `Report #${report.number} (${report.roundKey}, ${report.circuit})`.slice(0, 300)
  }
}

interface DecisionApi {
  decideReport: (guildId: string, reportId: string, input: DecisionInput) => Promise<IpcResult<DecisionResult>>
}

/** Sends the decision once and sorts every possible answer into what the screen has to do next. Never throws. */
export async function runDecision(api: DecisionApi, guildId: string, report: Report, input: DecisionInput): Promise<DecisionRun> {
  try {
    return { kind: 'decided', result: await unwrap(api.decideReport(guildId, report.id, input)) }
  } catch (error) {
    const code = errorCode(error)
    // The codes the backend documents for a decision come first: penalty_points_failed is a 500, yet the report IS decided.
    if (code === 'already_decided') return { kind: 'already_decided' }
    if (code === 'penalty_not_configured') return { kind: 'penalty_not_configured' }
    if (code === 'report_message_not_found') return { kind: 'message_not_found' }
    if (code === 'penalty_points_failed') {
      return input.decision === 'penalty_issued' ? { kind: 'points_failed', prefill: pointsFallbackPrefill(report, input) } : { kind: 'lost' }
    }
    if (outcomeUnknown(error)) return { kind: 'lost' }
    const field = code === null ? undefined : FIELD_OF_CODE[code]
    if (field) return { kind: 'field', field, message: describeError(error) }
    return { kind: 'refused', message: refusalText(error) }
  }
}

// ── What the confirm dialog tells the user ──────────────────────────────────

/** The lines under "What happens in Discord", for the confirm dialog. */
export function describeEffects(report: Pick<Report, 'season'>, input: DecisionInput): string[] {
  const lines = [
    input.decision === 'penalty_issued'
      ? 'The report message in Discord is updated: its status, the penalty details and the reviewer line.'
      : 'The report message in Discord is updated: its status, your explanation and the reviewer line.',
    'The buttons are removed from the report message, so it can no longer be decided in Discord.'
  ]
  if (input.decision === 'no_further_action') return lines
  if (input.penaltyPoints > 0) {
    const season = input.season ?? seasonFromReport(report)
    const where = input.season !== undefined ? `season ${input.season}` : season !== null ? `season ${season} (taken from the report)` : 'the current season'
    lines.push(`${input.penaltyPoints} penalty ${input.penaltyPoints === 1 ? 'point is' : 'points are'} saved for ${input.driver ?? 'the driver'} in ${where}.`)
    lines.push("If that reaches a ban threshold, an automatic ban notice may be posted in the report's thread.")
  } else {
    lines.push('No penalty points are saved.')
  }
  return lines
}

/** A warning of a step that failed after the decision was applied, in words. */
export function describeWarning(warning: string): string {
  const [step, code = ''] = warning.split(':')
  const reason = code === '' ? '' : ` (${code.slice(0, 40)})`
  if (step === 'points_field_failed') return `The decision and the points are saved, but the "Penalty Points" field could not be added to the report message${reason}.`
  if (step === 'ban_notice_failed') return `The decision and the points are saved, but the ban notice could not be posted in the report thread${reason}. Post it yourself using the text below.`
  return `A step after the decision failed${reason}. The decision itself is saved.`
}

/** What the result dialog says about the points of a decision. */
export function describePointsOutcome(result: DecisionResult): string[] {
  const { points } = result
  if (!points.applied) return result.decision === 'penalty_issued' ? ['No penalty points were saved.'] : []
  const lines = [`${points.added} penalty ${points.added === 1 ? 'point' : 'points'} saved for ${points.driver ?? 'the driver'}${points.season !== null ? ` in season ${points.season}` : ''}.`]
  if (points.total !== null) lines.push(`Their total is now ${points.total}.`)
  // A ban text means a threshold was crossed by these points; without one, a flag just states the current ban.
  if (points.banNotice !== null) lines.push('A ban threshold was reached with these points.')
  else if (points.raceBanned) lines.push('They currently have a race ban.')
  else if (points.qualiBanned) lines.push('They currently have a qualifying ban.')
  return lines
}
