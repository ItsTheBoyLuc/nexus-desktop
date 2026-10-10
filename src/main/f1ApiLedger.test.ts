import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from './apiClient'
import type { RequestOptions } from './apiClient'
import { createF1Api } from './f1Api'

/**
 * The carry-over of milestone 2 in the API client: the optional results channel, the server's duplicate
 * guard (`confirm_duplicate`, the results ledger) and the points system's `defaults`.
 */
const G = '555000000000000001'
const U1 = '200000000000000001'
const CH = '777000000000000002'
const BASE = `/api/app/v1/guilds/${G}`

function setup(...answers: unknown[]) {
  const calls: RequestOptions[] = []
  const queue = [...answers]
  const request = vi.fn(async (options: RequestOptions) => {
    calls.push(options)
    const next = queue.shift()
    if (next instanceof Error) throw next
    return next
  })
  return { api: createF1Api({ request } as unknown as ApiClient), calls, request }
}

const standings = { drivers: [], constructors: [] }
const outcomeJson = (over: Record<string, unknown> = {}) => ({
  race_title: 'Season 5 Round 3 — Zandvoort',
  results: [{ position: 1, name: 'alice', points: 25, matched: true }],
  not_found: [],
  standings,
  posted: null,
  announce_error: null,
  ledger: { recorded: true, entry: { season: '5', round: '3', circuit: 'Zandvoort', recorded_by: 'boss', timestamp: '2026-01-01T00:00:00Z' }, duplicate: false },
  ...over
})
const race = { season: '5', round: '3', circuit: 'Zandvoort', results: [U1] }

describe('POST /f1/standings/results: results channel and confirm_duplicate', () => {
  it('sends channel_id only when a channel was chosen, and never confirm_duplicate by default', async () => {
    const { api, calls } = setup(outcomeJson(), outcomeJson())
    await api.recordResults(G, race)
    await api.recordResults(G, { ...race, channelId: CH })
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['circuit', 'results', 'round', 'season'])
    expect(calls[1]?.body).toMatchObject({ channel_id: CH })
    expect(calls[1]?.body).not.toHaveProperty('confirm_duplicate')
  })

  it('sends confirm_duplicate: true only when the request carries the confirmation (and never confirm_duplicate: false)', async () => {
    const { api, calls } = setup(outcomeJson({ ledger: { recorded: true, duplicate: true } }))
    await api.recordResults(G, { ...race, confirmDuplicate: true })
    expect((calls[0]?.body as Record<string, unknown>)['confirm_duplicate']).toBe(true)
    const second = setup(outcomeJson())
    await second.api.recordResults(G, { ...race, confirmDuplicate: false })
    expect(second.calls[0]?.body).not.toHaveProperty('confirm_duplicate')
  })

  it('refuses an invalid channel id before any request', async () => {
    const { api, request } = setup()
    await expect(api.recordResults(G, { ...race, channelId: 'not-an-id' })).rejects.toMatchObject({ kind: 'validation', code: 'invalid_channel' })
    expect(request).not.toHaveBeenCalled()
  })

  it('reads posted, announce_error and the ledger state; a failed post leaves the recorded points as they are', async () => {
    const posted = { channel_id: CH, message_ids: ['900000000000000001', '900000000000000002', '900000000000000003'] }
    const { api } = setup(outcomeJson({ posted }), outcomeJson({ announce_error: 'bot_cannot_send' }), outcomeJson({ ledger: { recorded: false, duplicate: false } }))
    const withPost = await api.recordResults(G, { ...race, channelId: CH })
    expect(withPost.posted).toEqual({ channelId: CH, messageIds: posted.message_ids })
    expect(withPost.announceError).toBeNull()
    expect(withPost.ledger).toEqual({ recorded: true, duplicate: false })

    const failedPost = await api.recordResults(G, { ...race, channelId: CH })
    expect(failedPost.announceError).toBe('bot_cannot_send')
    expect(failedPost.results).toHaveLength(1) // the points are in the answer: the race is recorded

    const noLedger = await api.recordResults(G, race)
    expect(noLedger.ledger).toEqual({ recorded: false, duplicate: false }) // points applied, ledger write failed
  })

  it('is tolerant of an answer without the new fields (older server): nothing posted, no ledger info', async () => {
    const { api } = setup({ race_title: 'x', results: [], standings })
    expect(await api.recordResults(G, race)).toMatchObject({ posted: null, announceError: null, ledger: null })
  })
})

describe('GET /f1/standings/results-ledger', () => {
  const entry = (over: Record<string, unknown> = {}) => ({ season: '5', round: '3', circuit: 'Zandvoort', recorded_by: 'boss', timestamp: '2026-01-02T03:04:05Z', ...over })

  it('lists the entries as returned, newest first, with the optional season and round filters in the query', async () => {
    const { api, calls } = setup({ entries: [entry({ round: '4', circuit: 'Monza' }), entry()] })
    const entries = await api.resultsLedger(G, { season: '5', round: '3' })
    expect(calls[0]).toMatchObject({ path: `${BASE}/f1/standings/results-ledger?season=5&round=3` })
    expect(calls[0]?.method).toBeUndefined() // a GET
    expect(entries.map((item) => item.round)).toEqual(['4', '3'])
    expect(entries[1]).toEqual({ season: '5', round: '3', circuit: 'Zandvoort', recordedBy: 'boss', timestamp: '2026-01-02T03:04:05Z' })
  })

  it('has no query without filters, encodes the ones it has, and drops malformed entries', async () => {
    const { api, calls } = setup({ entries: [entry(), { season: 5 }, 'nope'] }, { entries: [] })
    expect(await api.resultsLedger(G)).toHaveLength(1)
    await api.resultsLedger(G, { season: 'S 5', round: 'a&b' })
    expect(calls[0]?.path).toBe(`${BASE}/f1/standings/results-ledger`)
    expect(calls[1]?.path).toBe(`${BASE}/f1/standings/results-ledger?season=S+5&round=a%26b`)
  })

  it('rejects an answer that is not a list of entries', async () => {
    await expect(setup({ nope: [] }).api.resultsLedger(G)).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('GET /f1/points-system: the defaults for "Reset to defaults"', () => {
  const table = (over: Record<string, unknown> = {}) => ({ points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], pole: 0, fastest_lap: 1, ...over })

  it('reads the defaults object, which is returned even after a custom system was saved', async () => {
    const custom = table({ points: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], pole: 2, fastest_lap: 3 })
    const { api } = setup({ ...custom, is_default: false, defaults: table() })
    const system = await api.pointsSystem(G)
    expect(system.isDefault).toBe(false)
    expect(system.pole).toBe(2)
    expect(system.defaults).toEqual({ points: table().points, pole: 0, fastestLap: 1 })
  })

  it('the PUT answer carries the defaults too', async () => {
    const { api } = setup({ ...table(), is_default: false, announce_error: null, defaults: table() })
    expect((await api.savePointsSystem(G, { points: table().points, pole: 0, fastestLap: 1 })).defaults).not.toBeNull()
  })

  it('a missing or malformed defaults object only switches the reset off; the system itself still loads', async () => {
    expect((await setup({ ...table(), is_default: true }).api.pointsSystem(G)).defaults).toBeNull()
    expect((await setup({ ...table(), is_default: true, defaults: { points: [1, 2, 3], pole: 0, fastest_lap: 1 } }).api.pointsSystem(G)).defaults).toBeNull()
  })
})
