import { describe, expect, it, vi } from 'vitest'
import type { ApiErrorInfo, DecisionInput, DecisionResult, IpcResult, Report } from '../../shared/types'
import { describeEffects, describePointsOutcome, describeWarning, pointsFallbackPrefill, runDecision } from './decisionFlow'

const G = '555000000000000001'

const report = (over: Partial<Report> = {}): Report => ({
  id: 'abc123', number: 2, roundKey: 'S5R3', season: '5', round: '3', circuit: 'Zandvoort', reporter: 'alice', reporterId: null, driversInvolved: 'alice, bob', lap: '4',
  description: 'Contact', evidenceUrl: null, evidenceImg: null, status: 'pending', decided: false, penalty: null, decision: null, threadName: 't', messageId: '1', timestamp: '2026-01-01T00:00:00Z', ...over
})
const PENALTY: DecisionInput = { decision: 'penalty_issued', description: '5 second time penalty', driver: 'alice', penaltyPoints: 3, season: 5 }
const NFA: DecisionInput = { decision: 'no_further_action', explanation: 'No infringement.' }
const decided: DecisionResult = {
  decision: 'penalty_issued', report: report({ status: 'penalty_issued', decided: true }), warnings: [],
  points: { applied: true, driver: 'alice', added: 3, season: 5, total: 9, qualiBanned: true, raceBanned: false, banNotice: 'ban text', banNoticePosted: true }
}

const fail = (info: Pick<ApiErrorInfo, 'kind' | 'code'> & Partial<ApiErrorInfo>): IpcResult<never> => ({ ok: false, error: { message: `backend says ${info.code}`, ...info } })
const api = (answer: () => IpcResult<DecisionResult> | Promise<IpcResult<DecisionResult>>) => ({ decideReport: vi.fn(async (_guild: string, _id: string, _input: DecisionInput) => answer()) })

describe('a successful decision', () => {
  it('is sent once, to the right report, with the input as it is', async () => {
    const deps = api(() => ({ ok: true, data: decided }))
    expect(await runDecision(deps, G, report(), PENALTY)).toEqual({ kind: 'decided', result: decided })
    expect(deps.decideReport).toHaveBeenCalledTimes(1)
    expect(deps.decideReport).toHaveBeenCalledWith(G, 'abc123', PENALTY)
  })
})

describe('what each failure means for the screen', () => {
  it('409 already_decided: the report was decided meanwhile (maybe in Discord); nothing is applied or sent again', async () => {
    const deps = api(() => fail({ kind: 'http', code: 'already_decided', status: 409 }))
    expect(await runDecision(deps, G, report(), PENALTY)).toEqual({ kind: 'already_decided' })
    expect(deps.decideReport).toHaveBeenCalledTimes(1)
  })

  it('409 penalty_not_configured: nothing was changed, the penalty rules have to be set up first', async () => {
    const deps = api(() => fail({ kind: 'http', code: 'penalty_not_configured', status: 409 }))
    expect(await runDecision(deps, G, report(), PENALTY)).toEqual({ kind: 'penalty_not_configured' })
    expect(deps.decideReport).toHaveBeenCalledTimes(1)
  })

  it('report_message_not_found is the same whether the server answers 404 or 409', async () => {
    for (const status of [404, 409]) {
      const deps = api(() => fail({ kind: 'http', code: 'report_message_not_found', status }))
      expect(await runDecision(deps, G, report(), NFA), String(status)).toEqual({ kind: 'message_not_found' })
      expect(deps.decideReport).toHaveBeenCalledTimes(1)
    }
  })

  it('500 penalty_points_failed: the report IS decided; the points dialog is prefilled and the decision is never resent', async () => {
    const deps = api(() => fail({ kind: 'http', code: 'penalty_points_failed', status: 500 }))
    const run = await runDecision(deps, G, report(), PENALTY)
    expect(run).toEqual({
      kind: 'points_failed',
      prefill: { driver: 'alice', points: 3, season: 5, penaltyType: '5 second time penalty', reason: 'Report #2 (S5R3, Zandvoort)' }
    })
    expect(deps.decideReport).toHaveBeenCalledTimes(1) // a second send would only answer 409 already_decided
  })

  it('penalty_points_failed is not mistaken for a lost answer even though it is a 5xx, and no other 5xx is mistaken for it', async () => {
    expect((await runDecision(api(() => fail({ kind: 'http', code: 'penalty_points_failed', status: 500 })), G, report(), PENALTY)).kind).toBe('points_failed')
    for (const [code, status] of [['internal_error', 500], ['discord_error', 502], ['bot_timeout', 504]] as const) {
      expect((await runDecision(api(() => fail({ kind: 'http', code, status })), G, report(), PENALTY)).kind, code).toBe('lost')
    }
  })

  it('a lost answer (timeout, dropped connection, unreadable answer) means "may be decided": exactly one request, never a second', async () => {
    for (const info of [
      { kind: 'timeout', code: 'timeout', mayHaveBeenSent: true },
      { kind: 'network', code: 'network_error', mayHaveBeenSent: true },
      { kind: 'invalid_response', code: 'invalid_response' }
    ] as const) {
      const deps = api(() => fail(info))
      expect(await runDecision(deps, G, report(), PENALTY), info.code).toEqual({ kind: 'lost' })
      expect(deps.decideReport, info.code).toHaveBeenCalledTimes(1)
    }
  })

  it('a request that provably never left (offline before sending) is a plain refusal: nothing happened, the user may try again', async () => {
    const run = await runDecision(api(() => fail({ kind: 'network', code: 'network_error', mayHaveBeenSent: false })), G, report(), NFA)
    expect(run.kind).toBe('refused')
  })

  it('rate limiting and an offline bot are refusals that changed nothing', async () => {
    expect((await runDecision(api(() => fail({ kind: 'rate_limited', code: 'rate_limited', status: 429, retryAfter: 5 })), G, report(), NFA)).kind).toBe('refused')
    expect((await runDecision(api(() => fail({ kind: 'http', code: 'bot_unavailable', status: 503 })), G, report(), NFA)).kind).toBe('refused')
  })

  it('field errors of the backend are shown under their field', async () => {
    for (const [code, field] of [['invalid_explanation', 'explanation'], ['invalid_description', 'description'], ['invalid_driver', 'driver'], ['driver_required', 'driver'], ['invalid_penalty_points', 'points'], ['invalid_season', 'season']] as const) {
      expect(await runDecision(api(() => fail({ kind: 'http', code, status: 400 })), G, report(), PENALTY), code).toMatchObject({ kind: 'field', field })
    }
  })

  it('403 and bot problems are definite refusals with their own wording', async () => {
    for (const [code, status, text] of [
      ['bot_cannot_send', 403, /thread/],
      ['not_a_bot_message', 400, /not posted by Nexus/],
      ['report_embed_missing', 409, /embed/],
      ['forbidden', 403, /STAFF/]
    ] as const) {
      const run = await runDecision(api(() => fail({ kind: 'http', code, status })), G, report(), NFA)
      expect(run, code).toMatchObject({ kind: 'refused' })
      expect(run.kind === 'refused' ? run.message : '', code).toMatch(text)
    }
  })

  it('a decision for a no-points penalty has nothing to fall back on if the server claims a points failure', async () => {
    // An NFA decision cannot fail on points; if the server says so anyway the outcome is unknown, not a prefilled dialog.
    expect((await runDecision(api(() => fail({ kind: 'http', code: 'penalty_points_failed', status: 500 })), G, report(), NFA)).kind).toBe('lost')
  })
})

describe('the fallback for penalty_points_failed', () => {
  it('prefills driver, points and season; the season comes from the input, else the report title, else the current season', () => {
    const input = (over: Partial<Extract<DecisionInput, { decision: 'penalty_issued' }>> = {}): Extract<DecisionInput, { decision: 'penalty_issued' }> => ({ decision: 'penalty_issued', description: '5s', driver: 'bob', penaltyPoints: 2, ...over })
    expect(pointsFallbackPrefill(report(), input({ season: 7 })).season).toBe(7)
    expect(pointsFallbackPrefill(report({ season: '5' }), input()).season).toBe(5)
    expect(pointsFallbackPrefill(report({ season: 'Spring' }), input())).not.toHaveProperty('season')
    expect(pointsFallbackPrefill(report(), input())).toMatchObject({ driver: 'bob', points: 2 })
  })

  it('fits the limits of the manual points form (type 100, reason 300)', () => {
    const prefill = pointsFallbackPrefill(report({ circuit: 'c'.repeat(500) }), { decision: 'penalty_issued', description: 'x'.repeat(500), driver: 'bob', penaltyPoints: 1 })
    expect(prefill.penaltyType.length).toBeLessThanOrEqual(100)
    expect(prefill.reason.length).toBeLessThanOrEqual(300)
  })
})

describe('what the confirm dialog says happens', () => {
  it('names the report update, the removed buttons, the points with driver and season, and the possible ban notice', () => {
    const lines = describeEffects(report(), PENALTY).join(' | ')
    expect(lines).toMatch(/report message in Discord is updated/)
    expect(lines).toMatch(/buttons are removed/)
    expect(lines).toMatch(/3 penalty points are saved for alice in season 5/)
    expect(lines).toMatch(/ban notice may be posted in the report's thread/)
  })

  it('says where the season comes from when it was not chosen', () => {
    const noSeason: DecisionInput = { decision: 'penalty_issued', description: 'x', driver: 'alice', penaltyPoints: 1 }
    expect(describeEffects(report({ season: '5' }), noSeason).join(' ')).toMatch(/1 penalty point is saved for alice in season 5 \(taken from the report\)/)
    expect(describeEffects(report({ season: 'Spring' }), noSeason).join(' ')).toMatch(/in the current season/)
  })

  it('a penalty without points saves none, and no further action never mentions points or a ban', () => {
    expect(describeEffects(report(), { decision: 'penalty_issued', description: 'Reprimand', penaltyPoints: 0 }).join(' ')).toMatch(/No penalty points are saved/)
    const nfa = describeEffects(report(), NFA).join(' ')
    expect(nfa).toMatch(/explanation/)
    expect(nfa).not.toMatch(/ban|points/i)
  })
})

describe('the result of a decision', () => {
  it('describes the points, the new total and a ban threshold that was crossed', () => {
    expect(describePointsOutcome(decided)).toEqual(['3 penalty points saved for alice in season 5.', 'Their total is now 9.', 'A ban threshold was reached with these points.'])
  })

  it('without a ban text a ban flag is only the current state; without points there is nothing to describe', () => {
    expect(describePointsOutcome({ ...decided, points: { ...decided.points, banNotice: null, banNoticePosted: false, raceBanned: true } })).toContain('They currently have a race ban.')
    expect(describePointsOutcome({ ...decided, decision: 'no_further_action', points: { ...decided.points, applied: false } })).toEqual([])
    expect(describePointsOutcome({ ...decided, points: { ...decided.points, applied: false } })).toEqual(['No penalty points were saved.'])
  })

  it('turns the warnings of steps that failed afterwards into words and says the decision is saved', () => {
    expect(describeWarning('ban_notice_failed:bot_cannot_send')).toMatch(/decision and the points are saved.*ban notice could not be posted/)
    expect(describeWarning('points_field_failed:discord_error')).toMatch(/Penalty Points/)
    expect(describeWarning('something_new')).toMatch(/decision itself is saved/)
  })
})
