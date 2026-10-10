import { describe, expect, it, vi } from 'vitest'
import type { ApiErrorInfo, IpcResult, LedgerEntry, RaceOutcome, ResultsInput, ServerLedgerEntry } from '../../shared/types'
import { availableActions } from './resultsFlow'
import { buildResultsRequest, outcomeNotes, planAfterConflict, planDuplicate, readLedger, sameRaceText, sendResults } from './resultsGuard'

const G = '555000000000000001'
const U1 = '200000000000000001'
const INPUT: ResultsInput = { season: '5', round: '3', circuit: 'Zandvoort', results: [U1] }

const serverEntry = (over: Partial<ServerLedgerEntry> = {}): ServerLedgerEntry => ({ season: '5', round: '3', circuit: 'Zandvoort', recordedBy: 'boss', timestamp: '2026-10-01T12:00:00.000Z', ...over })
const localEntry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({ guildId: G, season: '5', round: '3', circuit: 'Zandvoort', recordedAt: '2026-10-02T12:00:00.000Z', ...over })
const outcome: RaceOutcome = { raceTitle: 'Season 5 Round 3 — Zandvoort', results: [], notFound: [], standings: { drivers: [], constructors: [] }, posted: null, announceError: null, ledger: { recorded: true, duplicate: false } }

const fail = (info: Pick<ApiErrorInfo, 'kind' | 'code'> & Partial<ApiErrorInfo>): IpcResult<never> => ({ ok: false, error: { message: 'm', ...info } })
const done = <T,>(data: T): IpcResult<T> => ({ ok: true, data })

describe('the server compares season and round as trimmed, case-insensitive text', () => {
  it('ignores case and surrounding spaces, but "03" is not "3" (that is the server rule, unlike the local ledger)', () => {
    expect(sameRaceText(' Season 5 ', 'season 5')).toBe(true)
    expect(sameRaceText('3', '03')).toBe(false)
  })
})

describe('the warning before recording (planDuplicate)', () => {
  it('warns when the server ledger has the same season and round, and lists who recorded it', () => {
    const plan = planDuplicate({ ok: true, entries: [serverEntry(), serverEntry({ round: '4' })] }, [], G, ' 5 ', '3')
    expect(plan).toMatchObject({ repeat: true, source: 'server' })
    expect(plan.earlier).toEqual([{ season: '5', round: '3', circuit: 'Zandvoort', recordedBy: 'boss', at: '2026-10-01T12:00:00.000Z' }])
  })

  it('does not warn for a new round, and an empty server ledger beats an old local entry (the server is the authority)', () => {
    expect(planDuplicate({ ok: true, entries: [serverEntry()] }, [], G, '5', '4').repeat).toBe(false)
    expect(planDuplicate({ ok: true, entries: [] }, [localEntry()], G, '5', '3')).toMatchObject({ repeat: false, source: 'server' })
  })

  it('falls back to the local ledger only when the server ledger could not be read, and says so', () => {
    const plan = planDuplicate({ ok: false }, [localEntry(), localEntry({ guildId: '555000000000000002' })], G, '5', '3')
    expect(plan).toMatchObject({ repeat: true, source: 'local' })
    expect(plan.earlier).toHaveLength(1)
    expect(plan.earlier[0]?.recordedBy).toBeNull() // the local record does not know who
    expect(planDuplicate({ ok: false }, [], G, '5', '3')).toMatchObject({ repeat: false, source: 'local' })
  })

  it('after a 409 it is a repeat even when the earlier entry cannot be listed', () => {
    expect(planAfterConflict({ ok: true, entries: [] }, [], G, '5', '3')).toMatchObject({ repeat: true, earlier: [] })
    expect(planAfterConflict({ ok: false }, [], G, '5', '3').repeat).toBe(true)
  })
})

describe('reading the ledger never throws', () => {
  it('passes the trimmed season and round on and returns the entries', async () => {
    const resultsLedger = vi.fn(async () => done([serverEntry()]))
    expect(await readLedger({ resultsLedger }, G, ' 5 ', ' 3')).toEqual({ ok: true, entries: [serverEntry()] })
    expect(resultsLedger).toHaveBeenCalledWith(G, { season: '5', round: '3' })
  })

  it('a failed read (500, offline, anything) is just "not ok": the form falls back to the local ledger', async () => {
    expect(await readLedger({ resultsLedger: async () => fail({ kind: 'http', code: 'internal_error', status: 500 }) }, G, '5', '3')).toEqual({ ok: false })
    expect(await readLedger({ resultsLedger: async () => Promise.reject(new Error('boom')) }, G, '5', '3')).toEqual({ ok: false })
  })
})

describe('the request carries confirm_duplicate only after the warning was confirmed', () => {
  it('is absent by default, set by the confirmation, and a caller cannot smuggle it in', () => {
    expect(buildResultsRequest(INPUT, false)).not.toHaveProperty('confirmDuplicate')
    expect(buildResultsRequest(INPUT, true)).toMatchObject({ confirmDuplicate: true })
    expect(buildResultsRequest({ ...INPUT, confirmDuplicate: true }, false)).not.toHaveProperty('confirmDuplicate')
  })
})

describe('sending the race (sendResults)', () => {
  it('records the race with one request that has no confirm_duplicate', async () => {
    const recordResults = vi.fn(async (_guild: string, _input: ResultsInput) => done(outcome))
    expect(await sendResults({ recordResults }, G, INPUT, false)).toEqual({ kind: 'recorded', outcome })
    expect(recordResults).toHaveBeenCalledTimes(1)
    expect(recordResults.mock.calls[0]?.[1]).not.toHaveProperty('confirmDuplicate')
  })

  it('409 results_already_recorded is not an error and not a record: the user is asked; only the confirmed second request carries confirm_duplicate', async () => {
    const bodies: ResultsInput[] = []
    const recordResults = vi.fn(async (_guild: string, body: ResultsInput) => {
      bodies.push(body)
      return body.confirmDuplicate === true ? done({ ...outcome, ledger: { recorded: true, duplicate: true } }) : fail({ kind: 'http', code: 'results_already_recorded', status: 409 })
    })
    expect(await sendResults({ recordResults }, G, INPUT, false)).toEqual({ kind: 'duplicate' })
    const confirmed = await sendResults({ recordResults }, G, INPUT, true)
    expect(confirmed).toMatchObject({ kind: 'recorded', outcome: { ledger: { duplicate: true } } })
    expect(recordResults).toHaveBeenCalledTimes(2)
    expect(bodies[0]).not.toHaveProperty('confirmDuplicate')
    expect(bodies[1]).toMatchObject({ confirmDuplicate: true })
  })

  it('a lost answer or a 5xx is never retried: exactly one request, and the only way forward is refreshing the standings', async () => {
    for (const info of [
      { kind: 'timeout', code: 'timeout', mayHaveBeenSent: true },
      { kind: 'network', code: 'network_error', mayHaveBeenSent: true },
      { kind: 'http', code: 'bot_timeout', status: 504 },
      { kind: 'http', code: 'internal_error', status: 500 },
      { kind: 'http', code: 'discord_error', status: 502 },
      { kind: 'invalid_response', code: 'invalid_response' }
    ] as const) {
      const recordResults = vi.fn(async () => fail(info))
      expect(await sendResults({ recordResults }, G, INPUT, false), info.code).toMatchObject({ kind: 'lost' })
      expect(recordResults, info.code).toHaveBeenCalledTimes(1)
    }
    expect(availableActions('lost')).toEqual(['refresh-standings'])
  })

  it('a lost answer after the confirmed request is not retried either (the points may have been added twice already)', async () => {
    const recordResults = vi.fn(async () => fail({ kind: 'timeout', code: 'timeout', mayHaveBeenSent: true }))
    expect(await sendResults({ recordResults }, G, INPUT, true)).toMatchObject({ kind: 'lost' })
    expect(recordResults).toHaveBeenCalledTimes(1)
  })

  it('refusals that prove nothing was recorded come back as refused, with the backend code intact', async () => {
    for (const code of ['fia_required', 'channel_not_found', 'bot_cannot_send', 'forbidden', 'invalid_channel', 'ambiguous_name']) {
      const recordResults = vi.fn(async () => fail({ kind: 'http', code, status: 403 }))
      const answer = await sendResults({ recordResults }, G, INPUT, false)
      expect(answer.kind, code).toBe('refused')
      expect(recordResults, code).toHaveBeenCalledTimes(1)
    }
  })
})

describe('the whole guard, as the form runs it', () => {
  /** read the ledger, warn when it is a repeat, send once (confirmed only when the warning was shown). */
  async function run(api: { resultsLedger: () => Promise<IpcResult<ServerLedgerEntry[]>>; recordResults: (g: string, i: ResultsInput) => Promise<IpcResult<RaceOutcome>> }, local: LedgerEntry[] = []) {
    const read = await readLedger(api, G, INPUT.season, INPUT.round)
    const plan = planDuplicate(read, local, G, INPUT.season, INPUT.round)
    return { plan, answer: await sendResults(api, G, INPUT, plan.repeat) }
  }

  it('a race on the server ledger: the warning comes first and the confirmed request carries confirm_duplicate', async () => {
    const recordResults = vi.fn(async (_g: string, _i: ResultsInput) => done(outcome))
    const { plan } = await run({ resultsLedger: async () => done([serverEntry()]), recordResults })
    expect(plan.repeat).toBe(true)
    expect(recordResults.mock.calls[0]?.[1]).toMatchObject({ confirmDuplicate: true })
  })

  it('a new race: no warning and no confirm_duplicate', async () => {
    const recordResults = vi.fn(async (_g: string, _i: ResultsInput) => done(outcome))
    const { plan } = await run({ resultsLedger: async () => done([]), recordResults })
    expect(plan.repeat).toBe(false)
    expect(recordResults.mock.calls[0]?.[1]).not.toHaveProperty('confirmDuplicate')
  })

  it('the ledger endpoint is down: the local ledger decides, and a repeat is still caught', async () => {
    const recordResults = vi.fn(async (_g: string, _i: ResultsInput) => done(outcome))
    const { plan } = await run({ resultsLedger: async () => fail({ kind: 'http', code: 'internal_error', status: 500 }), recordResults }, [localEntry()])
    expect(plan).toMatchObject({ repeat: true, source: 'local' })
  })
})

describe('what the saved screen says about the channel post and the ledger', () => {
  it('reports a post, a failed post (points stay recorded) and a ledger write that failed', () => {
    expect(outcomeNotes({ ...outcome, posted: { channelId: '777000000000000001', messageIds: [] } })).toEqual({ posted: true, announceError: null, ledgerMissing: false })
    expect(outcomeNotes({ ...outcome, announceError: 'bot_cannot_send' })).toMatchObject({ posted: false, announceError: 'bot_cannot_send' })
    expect(outcomeNotes({ ...outcome, ledger: { recorded: false, duplicate: false } }).ledgerMissing).toBe(true)
    expect(outcomeNotes({ ...outcome, ledger: null }).ledgerMissing).toBe(false) // an older server that does not say
  })
})
