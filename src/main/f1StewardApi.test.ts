import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from './apiClient'
import type { RequestOptions } from './apiClient'
import { createStewardApi } from './f1StewardApi'

const G = '555000000000000001'
const CH = '777000000000000002'
const BASE = `/api/app/v1/guilds/${G}`
const RID = '9f1c2ab3d4'

/** An ApiClient whose answers are scripted; records every request so paths, methods and bodies can be checked. */
function setup(...answers: unknown[]) {
  const calls: RequestOptions[] = []
  const queue = [...answers]
  const request = vi.fn(async (options: RequestOptions) => {
    calls.push(options)
    const next = queue.shift()
    if (next instanceof Error) throw next
    return next
  })
  return { api: createStewardApi({ request } as unknown as ApiClient), calls, request }
}

const reportJson = (over: Record<string, unknown> = {}) => ({
  id: RID, number: 1, round_key: 'S5R3', season: '5', round: '3', circuit: 'Zandvoort', reporter: 'alice', reporter_id: '200000000000000001',
  drivers_involved: 'alice, bob', lap: '4', description: 'Contact <b>at</b> T1', evidence_url: 'https://example.com/clip', evidence_img: 'https://cdn.discordapp.com/a.png',
  status: 'pending', status_label: '⏳ Awaiting Review', decided: false, penalty: null, decision: null, thread_name: 'Report #1 - S5R3 - Zandvoort',
  message_id: '123456789012345678', timestamp: '2026-01-01T00:00:00Z', ...over
})
const decisionJson = (over: Record<string, unknown> = {}) => ({
  decision: 'penalty_issued',
  report: reportJson({ status: 'penalty_issued', decided: true, penalty: '5s', decision: { type: 'penalty_issued', penalty: '5s' } }),
  points: { applied: true, driver: 'alice', added: 3, season: 5, total: 9, quali_banned: true, race_banned: false, ban_notice: '⚠️ **QUALI BAN** — x', ban_notice_posted: true },
  warnings: [],
  ...over
})

describe('reports', () => {
  it('GET /f1/reports sends the filters that are set, as query parameters, and parses the page', async () => {
    const { api, calls } = setup({ total: 120, limit: 100, offset: 100, reports: [reportJson()] })
    const page = await api.reports(G, { season: '5', round: '3', status: 'pending', driver: 'al ice', limit: 100, offset: 100 })
    expect(calls[0]?.path).toBe(`${BASE}/f1/reports?season=5&round=3&status=pending&driver=al+ice&limit=100&offset=100`)
    expect(calls[0]?.method).toBeUndefined()
    expect(page).toMatchObject({ total: 120, limit: 100, offset: 100 })
    expect(page.reports[0]).toMatchObject({ id: RID, number: 1, roundKey: 'S5R3', driversInvolved: 'alice, bob', status: 'pending', decided: false, evidenceUrl: 'https://example.com/clip' })
  })

  it('has no query without filters, and keeps untrusted text exactly as text (no interpretation)', async () => {
    const { api, calls } = setup({ total: 1, limit: 50, offset: 0, reports: [reportJson({ description: '<script>alert(1)</script>', drivers_involved: '<img src=x onerror=1>' })] })
    const page = await api.reports(G)
    expect(calls[0]?.path).toBe(`${BASE}/f1/reports`)
    expect(page.reports[0]?.description).toBe('<script>alert(1)</script>')
    expect(page.reports[0]?.driversInvolved).toBe('<img src=x onerror=1>')
  })

  it('reads a decided report: the penalty text and the decision, but no invented explanation or points', async () => {
    const { api } = setup(reportJson({ status: 'no_further_action', decided: true, decision: { type: 'no_further_action', penalty: null } }), reportJson({ status: 'penalty_issued', decided: true, penalty: '5s', decision: { type: 'penalty_issued', penalty: '5s' } }))
    const nfa = await api.report(G, RID)
    expect(nfa).toMatchObject({ status: 'no_further_action', decided: true, penalty: null, decision: { type: 'no_further_action', penalty: null } })
    expect(nfa).not.toHaveProperty('explanation')
    expect(nfa).not.toHaveProperty('points')
    expect((await api.report(G, RID)).penalty).toBe('5s')
  })

  it('rejects a report with an unknown status or without an id instead of showing wrong data', async () => {
    await expect(setup({ total: 1, limit: 50, offset: 0, reports: [reportJson({ status: 'archived' })] }).api.reports(G)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup(reportJson({ id: '../x' })).api.report(G, RID)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ reports: [] }).api.reports(G)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('a report id that could change the path is refused before any request', async () => {
    const { api, request } = setup()
    for (const bad of ['', '../settings', 'a/b', 'a?b=1', 'a b']) await expect(api.report(G, bad), bad).rejects.toMatchObject({ kind: 'validation', code: 'invalid_report_id' })
    await expect(api.decideReport(G, '../x', { decision: 'no_further_action', explanation: 'x' })).rejects.toMatchObject({ kind: 'validation' })
    expect(request).not.toHaveBeenCalled()
  })

  it('GET /f1/reports/overview: one row per round, and the reports of one round (an empty round is count 0)', async () => {
    const { api, calls } = setup(
      { rounds: [{ season: '5', round: '3', round_key: 'S5R3', circuit: 'Zandvoort', total: 4, pending: 2, under_investigation: 0, penalty_issued: 1, no_further_action: 1 }] },
      { season: '5', round: '3', round_key: 'S5R3', circuit: 'Zandvoort', count: 1, reports: [reportJson()] },
      { season: '5', round: '9', round_key: 'S5R9', circuit: '', count: 0, reports: [] }
    )
    const rounds = await api.reportRounds(G)
    expect(calls[0]?.path).toBe(`${BASE}/f1/reports/overview`)
    expect(rounds[0]).toEqual({ season: '5', round: '3', roundKey: 'S5R3', circuit: 'Zandvoort', total: 4, pending: 2, underInvestigation: 0, penaltyIssued: 1, noFurtherAction: 1 })
    const detail = await api.reportRound(G, '5', '3')
    expect(calls[1]?.path).toBe(`${BASE}/f1/reports/overview?season=5&round=3`)
    expect(detail.reports).toHaveLength(1)
    expect((await api.reportRound(G, '5', '9')).count).toBe(0)
  })
})

describe('deciding a report: POST /f1/reports/{id}/decision', () => {
  it('no further action sends the explanation only', async () => {
    const { api, calls } = setup(decisionJson({ decision: 'no_further_action', report: reportJson({ status: 'no_further_action', decided: true }), points: { applied: false } }))
    const result = await api.decideReport(G, RID, { decision: 'no_further_action', explanation: 'No infringement found.' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/reports/${RID}/decision`, body: { decision: 'no_further_action', explanation: 'No infringement found.' } })
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['decision', 'explanation'])
    expect(result.decision).toBe('no_further_action')
    expect(result.points.applied).toBe(false)
    expect(result.points.banNotice).toBeNull()
  })

  it('a penalty sends description, penalty_points, driver and season, and leaves out what is empty', async () => {
    const { api, calls } = setup(decisionJson(), decisionJson({ points: { applied: false } }))
    const result = await api.decideReport(G, RID, { decision: 'penalty_issued', description: '5 second time penalty', driver: 'alice', penaltyPoints: 3, season: 5 })
    expect(calls[0]?.body).toEqual({ decision: 'penalty_issued', description: '5 second time penalty', penalty_points: 3, driver: 'alice', season: 5 })
    expect(result.points).toEqual({ applied: true, driver: 'alice', added: 3, season: 5, total: 9, qualiBanned: true, raceBanned: false, banNotice: '⚠️ **QUALI BAN** — x', banNoticePosted: true })
    await api.decideReport(G, RID, { decision: 'penalty_issued', description: 'Reprimand', penaltyPoints: 0 })
    expect(calls[1]?.body).toEqual({ decision: 'penalty_issued', description: 'Reprimand', penalty_points: 0 })
  })

  it('returns the warnings of steps that failed after the decision was applied', async () => {
    const { api } = setup(decisionJson({ warnings: ['ban_notice_failed:bot_cannot_send', 'points_field_failed:discord_error', 5] }))
    expect((await api.decideReport(G, RID, { decision: 'penalty_issued', description: 'x', driver: 'a', penaltyPoints: 1 })).warnings).toEqual(['ban_notice_failed:bot_cannot_send', 'points_field_failed:discord_error'])
  })

  it('rejects an answer that is not a decision (the decision itself may still be applied, so it counts as unknown)', async () => {
    await expect(setup({ ok: true }).api.decideReport(G, RID, { decision: 'no_further_action', explanation: 'x' })).rejects.toMatchObject({ kind: 'invalid_response', mayHaveBeenSent: true })
  })

  describe('never sent twice (no replay), whatever goes wrong', () => {
    function realClient(handler: (signal: AbortSignal | undefined) => Promise<Response>) {
      let calls = 0
      const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
        calls++
        return handler(init?.signal ?? undefined)
      }) as typeof fetch
      const client = new ApiClient({ baseUrl: 'https://api.test', fetchImpl, timeoutMs: 30, wakeAfterMs: 1000, sleep: async () => undefined })
      client.setSession({ access_token: 'access', refresh_token: 'refresh' })
      return { api: createStewardApi(client), calls: () => calls }
    }
    const hang = (signal: AbortSignal | undefined): Promise<Response> =>
      new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const decide = { decision: 'penalty_issued', description: '5s', driver: 'alice', penaltyPoints: 3 } as const

    it('a timeout is reported once; the request is not repeated', async () => {
      const { api, calls } = realClient(hang)
      await expect(api.decideReport(G, RID, decide)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
      expect(calls()).toBe(1)
    })

    it('a dropped connection is not repeated', async () => {
      const { api, calls } = realClient(async () => {
        const error = new TypeError('fetch failed')
        ;(error as { cause?: unknown }).cause = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
        throw error
      })
      await expect(api.decideReport(G, RID, decide)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
      expect(calls()).toBe(1)
    })

    it.each([
      [409, 'already_decided'],
      [409, 'penalty_not_configured'],
      [404, 'report_message_not_found'],
      [409, 'report_message_not_found'],
      [500, 'penalty_points_failed'],
      [500, 'internal_error'],
      [504, 'bot_timeout'],
      [502, 'discord_error']
    ])('%i %s from the backend is reported as it is, with the code, and not repeated', async (status, code) => {
      const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
      await expect(api.decideReport(G, RID, decide), code).rejects.toMatchObject({ kind: 'http', code, status })
      expect(calls(), code).toBe(1)
    })
  })
})

describe('penalty settings', () => {
  it('GET reads a configured server and a server that was never set up (null values, the season is still given)', async () => {
    const { api, calls } = setup(
      { configured: true, current_season: 5, expiry_races: 15, quali_ban_threshold: 8, race_ban_threshold: 13, setup_by: 'boss', setup_at: '2026-01-01T00:00:00Z', defaults: { current_season: 1, expiry_races: 15, quali_ban_threshold: 8, race_ban_threshold: 13 } },
      { configured: false, current_season: 3, expiry_races: null, quali_ban_threshold: null, race_ban_threshold: null, setup_by: null, setup_at: null, defaults: { current_season: 1, expiry_races: 15, quali_ban_threshold: 8, race_ban_threshold: 13 } }
    )
    expect(await api.penaltySettings(G)).toEqual({
      configured: true, currentSeason: 5, expiryRaces: 15, qualiBanThreshold: 8, raceBanThreshold: 13, setupBy: 'boss', setupAt: '2026-01-01T00:00:00Z',
      defaults: { currentSeason: 1, expiryRaces: 15, qualiBanThreshold: 8, raceBanThreshold: 13 }
    })
    expect(calls[0]?.path).toBe(`${BASE}/f1/penalties/settings`)
    expect(await api.penaltySettings(G)).toMatchObject({ configured: false, currentSeason: 3, expiryRaces: null, qualiBanThreshold: null, raceBanThreshold: null, setupBy: null })
  })

  it('PUT sends all four fields and nothing about points', async () => {
    const { api, calls } = setup({ configured: true, current_season: 6, expiry_races: 10, quali_ban_threshold: 6, race_ban_threshold: 12, setup_by: 'boss', setup_at: 'x' })
    const saved = await api.savePenaltySettings(G, { currentSeason: 6, expiryRaces: 10, qualiBanThreshold: 6, raceBanThreshold: 12 })
    expect(calls[0]).toMatchObject({ method: 'PUT', path: `${BASE}/f1/penalties/settings`, body: { current_season: 6, expiry_races: 10, quali_ban_threshold: 6, race_ban_threshold: 12 } })
    expect(Object.keys(calls[0]?.body as object)).toHaveLength(4)
    expect(saved.currentSeason).toBe(6)
  })
})

describe('penalty points', () => {
  const rowJson = (over: Record<string, unknown> = {}) => ({ position: 1, key: 'max_v', display_name: 'Max_V', total_points: 14, incidents: 2, ban: 'race', quali_banned: true, race_banned: true, reported_count: 2, ...over })

  it('GET /f1/penalties/overview: the season is optional, rows keep the server order, the Reported flag is read', async () => {
    const { api, calls } = setup(
      { season: 5, current_season: 5, is_current: true, settings: { expiry_races: 15, quali_ban_threshold: 8, race_ban_threshold: 13 }, drivers: [rowJson(), rowJson({ position: 2, key: 'bob', display_name: 'bob', total_points: 3, ban: 'none', quali_banned: false, race_banned: false, reported_count: 0 })] },
      { season: 4, current_season: 5, is_current: false, settings: { expiry_races: 15, quali_ban_threshold: 8, race_ban_threshold: 13 }, drivers: [] }
    )
    const current = await api.penaltyOverview(G)
    expect(calls[0]?.path).toBe(`${BASE}/f1/penalties/overview`)
    expect(current.drivers.map((row) => [row.displayName, row.totalPoints, row.ban, row.reportedCount])).toEqual([['Max_V', 14, 'race', 2], ['bob', 3, 'none', 0]])
    expect(current).toMatchObject({ season: 5, isCurrent: true, settings: { qualiBanThreshold: 8, raceBanThreshold: 13 } })
    const older = await api.penaltyOverview(G, 4)
    expect(calls[1]?.path).toBe(`${BASE}/f1/penalties/overview?season=4`)
    expect(older).toMatchObject({ isCurrent: false, drivers: [] })
  })

  it('the not-configured 404 of the overview reaches the caller as an error with its code (the screen explains it)', async () => {
    const { api } = setup(new ApiError({ kind: 'http', code: 'penalty_not_configured', message: 'Not set up.', status: 404 }))
    await expect(api.penaltyOverview(G)).rejects.toMatchObject({ kind: 'http', code: 'penalty_not_configured', status: 404 })
  })

  it('refuses a ban state it does not know and an invalid season before any request', async () => {
    await expect(setup({ season: 5, current_season: 5, is_current: true, settings: {}, drivers: [rowJson({ ban: 'forever' })] }).api.penaltyOverview(G)).rejects.toMatchObject({ kind: 'invalid_response' })
    const { api, request } = setup()
    await expect(api.penaltyOverview(G, 0)).rejects.toMatchObject({ kind: 'validation', code: 'invalid_season' })
    await expect(api.penaltyOverview(G, 100000)).rejects.toMatchObject({ kind: 'validation' })
    expect(request).not.toHaveBeenCalled()
  })

  it('GET /f1/penalties/history: the driver and season go in the query; negative points (an admin removal) are kept', async () => {
    const { api, calls } = setup({
      season: 5, key: 'max_v', display_name: 'Max_V', total_points: 3, incidents: 1, ban: 'none', quali_banned: false, race_banned: false,
      history: [{ index: 1, points: 5, reason: 'Contact', race: 'Season 5 Round 1 — Spa', expires_after_race: 16, timestamp: 't1' }, { index: 2, points: -2, reason: 'Admin removed 2 pts', race: 'x', expires_after_race: null, timestamp: 't2' }]
    })
    const history = await api.penaltyHistory(G, ' Max V&co ', 5)
    expect(calls[0]?.path).toBe(`${BASE}/f1/penalties/history?driver=Max+V%26co&season=5`)
    expect(history.history.map((item) => [item.points, item.expiresAfterRace])).toEqual([[5, 16], [-2, null]])
    await expect(setup().api.penaltyHistory(G, '   ')).rejects.toMatchObject({ kind: 'validation', code: 'invalid_driver' })
  })

  it('POST /f1/penalties/points sends the documented body; the ban text is returned, and a channel is optional', async () => {
    const answer = { driver: 'Max_V', season: 5, saved: true, points_added: 3, total_points: 11, quali_banned: true, race_banned: false, ban_notice: '⚠️ **QUALI BAN** — **Max\\_V**', posted: null, announce_error: null }
    const { api, calls } = setup(answer, { ...answer, posted: { channel_id: CH, message_id: '900000000000000001' }, announce_error: 'bot_cannot_send', ban_notice: null })
    const first = await api.addPenaltyPoints(G, { driver: 'Max_V', penaltyType: 'Drive-Through', points: 3, reason: 'Contact at T1', season: 5 })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/penalties/points`, body: { driver: 'Max_V', penalty_type: 'Drive-Through', points: 3, reason: 'Contact at T1', season: 5 } })
    expect(calls[0]?.body).not.toHaveProperty('channel_id')
    expect(first).toMatchObject({ saved: true, pointsAdded: 3, totalPoints: 11, qualiBanned: true, banNotice: '⚠️ **QUALI BAN** — **Max\\_V**', posted: null })
    const second = await api.addPenaltyPoints(G, { driver: 'Max_V', penaltyType: 'x', points: 1, reason: 'y', channelId: CH })
    expect(calls[1]?.body).toMatchObject({ channel_id: CH })
    expect(second).toMatchObject({ posted: { channelId: CH, messageId: '900000000000000001' }, announceError: 'bot_cannot_send', banNotice: null })
  })

  it('refuses a bad channel id before any request', async () => {
    const { api, request } = setup()
    await expect(api.addPenaltyPoints(G, { driver: 'a', penaltyType: 'b', points: 1, reason: 'c', channelId: 'general' })).rejects.toMatchObject({ kind: 'validation', code: 'invalid_channel' })
    expect(request).not.toHaveBeenCalled()
  })
})

describe('the destructive actions only go out with confirm: true', () => {
  it('clear points: refused before any request without confirm, sends confirm: true after it', async () => {
    const { api, calls, request } = setup({ driver: 'alice', season: 5, mode: 'partial', points_removed: 3, remaining: 4 }, { driver: 'alice', season: 5, mode: 'all', points_removed: 7, remaining: 0 })
    await expect(api.clearPenaltyPoints(G, { driver: 'alice', reason: 'Appeal', confirm: undefined as unknown as true })).rejects.toMatchObject({ kind: 'validation', code: 'confirm_required', mayHaveBeenSent: false })
    await expect(api.clearPenaltyPoints(G, { driver: 'alice', reason: 'Appeal', confirm: false as unknown as true })).rejects.toMatchObject({ code: 'confirm_required' })
    expect(request).not.toHaveBeenCalled()

    const partial = await api.clearPenaltyPoints(G, { driver: 'alice', points: 3, reason: 'Appeal upheld', season: 5, confirm: true })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/penalties/clear`, body: { driver: 'alice', points: 3, reason: 'Appeal upheld', season: 5, confirm: true } })
    expect(partial).toEqual({ driver: 'alice', season: 5, mode: 'partial', pointsRemoved: 3, remaining: 4 })
    await api.clearPenaltyPoints(G, { driver: 'alice', reason: 'Reset', confirm: true })
    expect(calls[1]?.body).toEqual({ driver: 'alice', reason: 'Reset', confirm: true }) // no points: all of them
  })

  it('bans: refused without confirm, sends confirm: true and the ban type and action', async () => {
    const { api, calls, request } = setup({ driver: 'alice', season: 5, action: 'give', ban_type: 'race', quali_banned: false, race_banned: true, total_points: 4 })
    await expect(api.setBan(G, { driver: 'alice', banType: 'race', action: 'give', confirm: undefined as unknown as true })).rejects.toMatchObject({ code: 'confirm_required' })
    expect(request).not.toHaveBeenCalled()
    const result = await api.setBan(G, { driver: 'alice', banType: 'race', action: 'give', reason: 'Dangerous driving', confirm: true })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/penalties/bans`, body: { driver: 'alice', ban_type: 'race', action: 'give', reason: 'Dangerous driving', confirm: true } })
    expect(result).toEqual({ driver: 'alice', season: 5, action: 'give', banType: 'race', qualiBanned: false, raceBanned: true, totalPoints: 4 })
  })

  it('advance race: refused without confirm, sends the race number and confirm: true, and lists what expired', async () => {
    const { api, calls, request } = setup({
      race_number: 6, season: 5, expired: [{ key: 'max_v', display_name: 'Max_V', points: 5, race: 'Season 5 Round 2 — Bahrain' }], updated: [{ key: 'max_v', display_name: 'Max_V', old_total: 14, new_total: 9 }]
    })
    await expect(api.advanceRace(G, { raceNumber: 6, confirm: undefined as unknown as true })).rejects.toMatchObject({ code: 'confirm_required' })
    expect(request).not.toHaveBeenCalled()
    const result = await api.advanceRace(G, { raceNumber: 6, confirm: true })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/penalties/advance-race`, body: { race_number: 6, confirm: true } })
    expect(result).toEqual({
      raceNumber: 6, season: 5, expired: [{ key: 'max_v', displayName: 'Max_V', points: 5, race: 'Season 5 Round 2 — Bahrain' }], updated: [{ key: 'max_v', displayName: 'Max_V', oldTotal: 14, newTotal: 9 }]
    })
  })

  it('a destructive action is not repeated after a lost answer either', async () => {
    let attempts = 0
    const fetchImpl = (async () => {
      attempts++
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) })
    }) as typeof fetch
    const client = new ApiClient({ baseUrl: 'https://api.test', fetchImpl, timeoutMs: 30, sleep: async () => undefined })
    client.setSession({ access_token: 'a', refresh_token: 'r' })
    const api = createStewardApi(client)
    await expect(api.advanceRace(G, { raceNumber: 6, confirm: true })).rejects.toMatchObject({ kind: 'network' })
    expect(attempts).toBe(1)
  })
})

describe('dirty drivers', () => {
  const body = (over: Record<string, unknown> = {}) => ({ reason: 'Rammed him', evidence: 'https://example.com/clip', reported_by: 'boss', related_incident: null, timestamp: '2026-01-01T00:00:00Z', ...over })

  it('GET list and history: the numbers remove-report takes are the indexes of the history', async () => {
    const { api, calls } = setup(
      { drivers: [{ key: 'max_v', display_name: 'Max_V', report_count: 2, latest: body() }] },
      { key: 'max_v', display_name: 'Max_V', total: 2, reports: [{ index: 1, ...body() }, { index: 2, ...body({ related_incident: 'Race 5' }) }] }
    )
    const list = await api.dirtyDrivers(G)
    expect(calls[0]?.path).toBe(`${BASE}/f1/dirty-drivers`)
    expect(list).toEqual([{ key: 'max_v', displayName: 'Max_V', reportCount: 2, latest: { reason: 'Rammed him', evidence: 'https://example.com/clip', reportedBy: 'boss', relatedIncident: null, timestamp: '2026-01-01T00:00:00Z' } }])
    const history = await api.dirtyHistory(G, 'Max_V')
    expect(calls[1]?.path).toBe(`${BASE}/f1/dirty-drivers/history?driver=Max_V`)
    expect(history.reports.map((report) => [report.index, report.relatedIncident])).toEqual([[1, null], [2, 'Race 5']])
  })

  it('an empty list is a normal answer', async () => {
    expect(await setup({ drivers: [] }).api.dirtyDrivers(G)).toEqual([])
  })

  it('POST /f1/dirty-drivers/reports sends the documented body (related incident only when given)', async () => {
    const answer = { display_name: 'Bob_B', total_reports: 1, report: { index: 1, ...body() } }
    const { api, calls } = setup(answer, answer)
    await api.addDirtyReport(G, { driver: 'Bob_B', reason: 'Rammed him on purpose', evidenceUrl: 'https://example.com/clip' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/dirty-drivers/reports`, body: { driver: 'Bob_B', reason: 'Rammed him on purpose', evidence_url: 'https://example.com/clip' } })
    expect(calls[0]?.body).not.toHaveProperty('related_incident')
    const result = await api.addDirtyReport(G, { driver: 'Bob_B', reason: 'x', evidenceUrl: 'https://e.co', relatedIncident: 'Race 5 — Silverstone' })
    expect(calls[1]?.body).toMatchObject({ related_incident: 'Race 5 — Silverstone' })
    expect(result).toMatchObject({ displayName: 'Bob_B', totalReports: 1, report: { index: 1 } })
  })

  it('DELETE /f1/dirty-drivers/reports/{index}?driver= removes that number, and reports whether the driver left the list', async () => {
    const { api, calls } = setup({ ok: true, display_name: 'Max_V', removed_index: 2, driver_removed: true, removed: body() })
    const result = await api.removeDirtyReport(G, 'Max V', 2)
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/f1/dirty-drivers/reports/2?driver=Max+V` })
    expect(result).toMatchObject({ displayName: 'Max_V', removedIndex: 2, driverRemoved: true })
  })

  it('refuses an invalid report number or driver before any request', async () => {
    const { api, request } = setup()
    for (const index of [0, -1, 1.5, 1_000_000]) await expect(api.removeDirtyReport(G, 'Max', index), String(index)).rejects.toMatchObject({ kind: 'validation' })
    await expect(api.removeDirtyReport(G, '', 1)).rejects.toMatchObject({ kind: 'validation', code: 'invalid_driver' })
    expect(request).not.toHaveBeenCalled()
  })

  it('a removal is not repeated after a timeout: a second DELETE could remove a different report (the numbers shift)', async () => {
    let attempts = 0
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      attempts++
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }) as typeof fetch
    const client = new ApiClient({ baseUrl: 'https://api.test', fetchImpl, timeoutMs: 30, sleep: async () => undefined })
    client.setSession({ access_token: 'a', refresh_token: 'r' })
    await expect(createStewardApi(client).removeDirtyReport(G, 'Max_V', 1)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
    expect(attempts).toBe(1)
  })

  it('rejects malformed answers', async () => {
    await expect(setup({ drivers: [{ key: '', report_count: 1, latest: body() }] }).api.dirtyDrivers(G)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ key: 'x', total: 1, reports: [{ index: 0, ...body() }] }).api.dirtyHistory(G, 'x')).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})
