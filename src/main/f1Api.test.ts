import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from './apiClient'
import type { RequestOptions } from './apiClient'
import { createF1Api } from './f1Api'

const G = '555000000000000001'
const U1 = '200000000000000001'
const U2 = '200000000000000002'
const BASE = `/api/app/v1/guilds/${G}`

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
  return { api: createF1Api({ request } as unknown as ApiClient), calls, request }
}

const roundJson = (over: Record<string, unknown> = {}) => ({ round: 1, name: 'Australian GP', date: '15/03/2026', time: '19:30', flag: 'AU', event_type: 'Normal Race', ...over })
const calendarJson = (rounds: unknown[] = [roundJson()]) => ({ name: '2026 Season', setup_in_progress: false, rounds })
const driverJson = (over: Record<string, unknown> = {}) => ({ user_id: U1, username: 'alice', display_name: 'Ally', number: 7, points: 40, wins: 1, podiums: 2, ...over })
const teamJson = (over: Record<string, unknown> = {}) => ({
  name: 'Red Racing', abbreviation: 'RED', color: '#ff0000', role_id: '910000000000000001', role_name: 'Red Racing', channel_id: '930000000000000001', channel_name: 'red-racing',
  points: 80, drivers: [driverJson()], ...over
})
const standingsJson = () => ({
  drivers: [{ position: 1, user_id: U1, username: 'alice', team: 'Red Racing', points: 40, wins: 1, podiums: 2, gap: 0 }],
  constructors: [{ position: 1, team: 'Red Racing', points: 80, drivers: 2, gap: 0 }]
})
const pointsJson = (over: Record<string, unknown> = {}) => ({ points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], pole: 0, fastest_lap: 1, is_default: true, ...over })

describe('member search', () => {
  it('GET /members?q=, keeps well-formed members and the truncated flag', async () => {
    const { api, calls } = setup({
      members: [
        { id: U1, username: 'alice', display_name: 'Ally', avatar: 'https://cdn.discordapp.com/a.png', bot: false },
        { id: U2, username: 'bob', avatar: 'https://evil.example/a.png', bot: true },
        { id: 'nope', username: 'bad id' }
      ],
      truncated: true
    })
    const result = await api.members(G, ' al ice ')
    expect(calls[0]).toMatchObject({ path: `${BASE}/members?q=al%20ice` })
    expect(calls[0]?.method).toBeUndefined()
    expect(result.truncated).toBe(true)
    expect(result.members).toEqual([
      { id: U1, username: 'alice', displayName: 'Ally', avatar: 'https://cdn.discordapp.com/a.png', bot: false },
      { id: U2, username: 'bob', displayName: 'bob', avatar: null, bot: true } // only Discord CDN avatars are shown
    ])
  })

  it('refuses an empty or too long query before any request', async () => {
    const { api, request } = setup()
    await expect(api.members(G, '  ')).rejects.toMatchObject({ kind: 'validation' })
    await expect(api.members(G, 'x'.repeat(33))).rejects.toMatchObject({ kind: 'validation' })
    expect(request).not.toHaveBeenCalled()
  })
})

describe('calendar', () => {
  it('GET /f1/calendar parses rounds with their numbers as returned (gaps stay)', async () => {
    const { api, calls } = setup(calendarJson([roundJson({ round: 1 }), roundJson({ round: 4, name: 'Dutch GP', date: 'TBD', time: '', flag: '' })]))
    const calendar = await api.calendar(G)
    expect(calls[0]).toMatchObject({ path: `${BASE}/f1/calendar` })
    expect(calendar.rounds.map((r) => r.round)).toEqual([1, 4])
    expect(calendar.rounds[1]).toEqual({ round: 4, name: 'Dutch GP', date: 'TBD', time: '', flag: '', eventType: 'Normal Race' })
    expect(calendar).toMatchObject({ name: '2026 Season', setupInProgress: false })
  })

  it('accepts an empty calendar and rejects a malformed one instead of showing wrong data', async () => {
    expect(await setup({ name: 'F1 Season Calendar', rounds: [], setup_in_progress: false }).api.calendar(G)).toMatchObject({ rounds: [] })
    await expect(setup({ name: 'x' }).api.calendar(G)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup(calendarJson([{ round: 'one', name: 'x', date: 'TBD' }])).api.calendar(G)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('POST /f1/calendar/rounds sends the documented body and omits empty optional fields', async () => {
    const answer = { round: roundJson({ round: 3 }), calendar: calendarJson() }
    const { api, calls } = setup(answer, answer)
    await api.createRound(G, { name: 'Dutch GP', date: '30/08/2026', time: '', flag: '', eventType: 'Sprint Weekend' })
    await api.createRound(G, { name: 'Dutch GP', date: 'TBD', time: '19:30', flag: 'NL', eventType: 'Full Qualifying', round: 3 })
    expect(calls.map((c) => [c.method, c.path])).toEqual([['POST', `${BASE}/f1/calendar/rounds`], ['POST', `${BASE}/f1/calendar/rounds`]])
    expect(calls[0]?.body).toEqual({ name: 'Dutch GP', date: '30/08/2026', event_type: 'Sprint Weekend' })
    expect(calls[1]?.body).toEqual({ name: 'Dutch GP', date: 'TBD', time: '19:30', flag: 'NL', event_type: 'Full Qualifying', round: 3 })
  })

  it('PATCH /f1/calendar/rounds/{n} sends only the changed fields, in the backend names', async () => {
    const { api, calls } = setup({ round: roundJson({ round: 2 }), calendar: calendarJson() })
    await api.updateRound(G, 2, { eventType: 'Sprint Weekend', time: '' })
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: `${BASE}/f1/calendar/rounds/2`, body: { event_type: 'Sprint Weekend', time: '' } })
  })

  it('DELETE /f1/calendar/rounds/{n} returns the calendar; the others keep their numbers', async () => {
    const { api, calls } = setup({ ok: true, calendar: calendarJson([roundJson({ round: 1 }), roundJson({ round: 3 })]) })
    const calendar = await api.deleteRound(G, 2)
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/f1/calendar/rounds/2` })
    expect(calendar.rounds.map((r) => r.round)).toEqual([1, 3])
    await expect(setup({ ok: false }).api.deleteRound(G, 2)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('refuses round numbers outside 1-99 before any request', async () => {
    const { api, request } = setup()
    for (const round of [0, 100, 1.5, Number.NaN]) await expect(api.deleteRound(G, round)).rejects.toMatchObject({ kind: 'validation' })
    expect(request).not.toHaveBeenCalled()
  })

  it('POST /f1/calendar/post posts new, or edits with the stored message id', async () => {
    const answer = { ok: true, message_id: '999000000000000001', channel_id: '777000000000000001', refreshed: false }
    const { api, calls } = setup(answer, { ...answer, refreshed: true })
    expect(await api.postCalendar(G, { channelId: '777000000000000001' })).toEqual({ messageId: '999000000000000001', channelId: '777000000000000001', refreshed: false })
    expect(await api.postCalendar(G, { channelId: '777000000000000001', messageId: '999000000000000001' })).toMatchObject({ refreshed: true })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/calendar/post`, body: { channel_id: '777000000000000001' } })
    expect(calls[1]?.body).toEqual({ channel_id: '777000000000000001', message_id: '999000000000000001' })
    await expect(setup({ ok: true, message_id: 'abc', channel_id: '1', refreshed: false }).api.postCalendar(G, { channelId: '1' })).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('GET /f1/next-race, with and without a countdown', async () => {
    const upcoming = { calendar_name: '2026 Season', race: roundJson({ round: 2 }), upcoming: true, countdown_hours: 121, countdown: { days: 5, hours: 1 } }
    const past = { calendar_name: '2026 Season', race: roundJson({ round: 9 }), upcoming: false, countdown_hours: null, countdown: null }
    const { api, calls } = setup(upcoming, past)
    expect(await api.nextRace(G)).toMatchObject({ upcoming: true, countdownHours: 121, countdown: { days: 5, hours: 1 }, race: { round: 2 } })
    expect(await api.nextRace(G)).toMatchObject({ upcoming: false, countdownHours: null, countdown: null, race: { round: 9 } })
    expect(calls[0]).toMatchObject({ path: `${BASE}/f1/next-race` })
  })
})

describe('teams and drivers', () => {
  it('GET /f1/teams parses colour, roster and the points as returned', async () => {
    const { api, calls } = setup({ teams: [teamJson(), teamJson({ name: 'Empty', drivers: [], role_id: null, role_name: null, channel_id: null, channel_name: null, color: 'red', points: 0 })] })
    const teams = await api.teams(G)
    expect(calls[0]).toMatchObject({ path: `${BASE}/f1/teams` })
    expect(teams[0]).toMatchObject({ name: 'Red Racing', color: '#FF0000', points: 80, roleName: 'Red Racing', channelName: 'red-racing' })
    expect(teams[0]?.drivers[0]).toEqual({ userId: U1, username: 'alice', displayName: 'Ally', number: 7, points: 40, wins: 1, podiums: 2 })
    expect(teams[1]).toMatchObject({ drivers: [], color: null, roleId: null, roleName: null, channelId: null, channelName: null })
  })

  it('POST /f1/teams sends name, colour and abbreviation and returns the team', async () => {
    const { api, calls } = setup({ team: teamJson(), announce_error: null })
    const team = await api.createTeam(G, { name: 'Red Racing', color: '#FF0000', abbreviation: 'RED' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/teams`, body: { name: 'Red Racing', color: '#FF0000', abbreviation: 'RED' } })
    expect(team.name).toBe('Red Racing')
  })

  it('POST drivers URL-encodes the team name and sends the user id and the optional number', async () => {
    const answer = { team: teamJson(), user_id: U1, announce_error: null }
    const { api, calls } = setup(answer, answer)
    await api.addDriver(G, 'Red Racing & Co', { userId: U1, number: 7 })
    await api.addDriver(G, 'Red Racing', { userId: U1, number: null })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/teams/Red%20Racing%20%26%20Co/drivers`, body: { user_id: U1, number: 7 } })
    expect(calls[1]?.body).toEqual({ user_id: U1 })
  })

  it('DELETE a driver returns what the API says, including a driver who left the server', async () => {
    const { api, calls } = setup({ team: teamJson(), role_removed: false, member_in_server: false, announce_error: null })
    const result = await api.removeDriver(G, 'Red Racing', U1)
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/f1/teams/Red%20Racing/drivers/${U1}` })
    expect(calls[0]?.body).toBeUndefined()
    expect(result).toMatchObject({ roleRemoved: false, memberInServer: false })
  })

  it('refuses team names that cannot be a path segment, and bad ids, before any request', async () => {
    const { api, request } = setup()
    for (const name of ['a/b', 'a\\b', '', 'x'.repeat(101)]) await expect(api.addDriver(G, name, { userId: U1 })).rejects.toMatchObject({ kind: 'validation' })
    await expect(api.removeDriver(G, 'Red', '../x')).rejects.toMatchObject({ kind: 'validation' })
    await expect(api.driver(G, 'abc')).rejects.toMatchObject({ kind: 'validation' })
    expect(request).not.toHaveBeenCalled()
  })

  it('GET /f1/drivers/{id}: a driver on no team has team "—", no number is null', async () => {
    const { api, calls } = setup({ user_id: U1, username: 'alice', display_name: 'Ally', team: '—', points: 40, wins: 1, podiums: 2, number: null })
    expect(await api.driver(G, U1)).toEqual({ userId: U1, username: 'alice', displayName: 'Ally', team: '—', points: 40, wins: 1, podiums: 2, number: null })
    expect(calls[0]).toMatchObject({ path: `${BASE}/f1/drivers/${U1}` })
  })
})

describe('standings, race results and the points system', () => {
  it('GET /f1/standings keeps the order and the numbers exactly as returned', async () => {
    const { api, calls } = setup(standingsJson())
    const standings = await api.standings(G)
    expect(calls[0]).toMatchObject({ path: `${BASE}/f1/standings` })
    expect(standings.drivers[0]).toEqual({ position: 1, userId: U1, username: 'alice', team: 'Red Racing', points: 40, wins: 1, podiums: 2, gap: 0 })
    expect(standings.constructors[0]).toEqual({ position: 1, team: 'Red Racing', points: 80, drivers: 2, gap: 0 })
    await expect(setup({ drivers: [] }).api.standings(G)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  const outcome = {
    race_title: 'Season 5 Round 3 — Zandvoort',
    results: [{ position: 1, name: 'alice', points: 25, matched: true }, { position: 2, name: 'ghost', points: 0, matched: false }],
    not_found: ['ghost'],
    standings: standingsJson(),
    posted: null,
    announce_error: null
  }

  it('POST /f1/standings/results sends drivers by user id and returns the server points untouched', async () => {
    const { api, calls } = setup(outcome)
    const result = await api.recordResults(G, { season: '5', round: '3', circuit: 'Zandvoort', results: [U1, U2], fastestLap: U2, pole: U1 })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/standings/results` })
    expect(calls[0]?.body).toEqual({
      season: '5', round: '3', circuit: 'Zandvoort', results: [{ user_id: U1 }, { user_id: U2 }], fastest_lap: { user_id: U2 }, pole: { user_id: U1 }
    })
    expect(result.raceTitle).toBe('Season 5 Round 3 — Zandvoort')
    expect(result.results.map((line) => [line.position, line.points, line.matched])).toEqual([[1, 25, true], [2, 0, false]])
    expect(result.notFound).toEqual(['ghost'])
  })

  it('leaves fastest lap and pole out when none was chosen, and sends no channel (nothing is posted)', async () => {
    const { api, calls } = setup(outcome)
    await api.recordResults(G, { season: '5', round: '3', circuit: 'Zandvoort', results: [U1] })
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['circuit', 'results', 'round', 'season'])
  })

  it('rejects a response that does not look like a race result (the race itself may still be recorded)', async () => {
    await expect(setup({ race_title: 'x' }).api.recordResults(G, { season: '5', round: '3', circuit: 'Z', results: [U1] })).rejects.toMatchObject({ kind: 'invalid_response', mayHaveBeenSent: true })
  })

  it('GET /f1/points-system always has 20 entries; PUT sends all of them', async () => {
    const { api, calls } = setup(pointsJson(), pointsJson({ pole: 2, fastest_lap: 3, is_default: false }))
    expect(await api.pointsSystem(G)).toMatchObject({ pole: 0, fastestLap: 1, isDefault: true })
    const saved = await api.savePointsSystem(G, { points: pointsJson().points, pole: 2, fastestLap: 3 })
    expect(calls[1]).toMatchObject({ method: 'PUT', path: `${BASE}/f1/points-system`, body: { pole: 2, fastest_lap: 3 } })
    expect((calls[1]?.body as { points: number[] }).points).toHaveLength(20)
    expect(saved).toMatchObject({ pole: 2, fastestLap: 3, isDefault: false })
    await expect(setup(pointsJson({ points: [1, 2, 3] })).api.pointsSystem(G)).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('race results are sent exactly once (never replayed, whatever goes wrong)', () => {
  const VALID = { season: '5', round: '3', circuit: 'Zandvoort', results: [U1, U2] }

  function realClient(handler: (signal: AbortSignal | undefined) => Promise<Response>) {
    let calls = 0
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls++
      return handler(init?.signal ?? undefined)
    }) as typeof fetch
    const client = new ApiClient({ baseUrl: 'https://api.test', fetchImpl, timeoutMs: 30, wakeAfterMs: 1000, sleep: async () => undefined })
    client.setSession({ access_token: 'access', refresh_token: 'refresh' })
    return { api: createF1Api(client), calls: () => calls }
  }
  const hang = (signal: AbortSignal | undefined): Promise<Response> =>
    new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('a timeout is reported once and the request is not repeated', async () => {
    const { api, calls } = realClient(hang)
    await expect(api.recordResults(G, VALID)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it('a connection that dropped mid-request is not repeated', async () => {
    const { api, calls } = realClient(async () => {
      const error = new TypeError('fetch failed')
      ;(error as { cause?: unknown }).cause = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
      throw error
    })
    await expect(api.recordResults(G, VALID)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it('bot_timeout (504), internal_error (500) and discord_error (502) from the backend are not repeated either', async () => {
    for (const [status, code] of [[504, 'bot_timeout'], [500, 'internal_error'], [502, 'discord_error']] as const) {
      const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
      await expect(api.recordResults(G, VALID), code).rejects.toMatchObject({ kind: 'http', code, status })
      expect(calls(), code).toBe(1)
    }
  })

  it('a refusal (fia_required) is reported as is, once', async () => {
    const { api, calls } = realClient(async () => json(403, { error: 'fia_required', message: 'FIA role required.' }))
    await expect(api.recordResults(G, VALID)).rejects.toBeInstanceOf(ApiError)
    expect(calls()).toBe(1)
  })
})
