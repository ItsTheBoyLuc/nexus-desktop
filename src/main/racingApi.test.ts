import { describe, expect, it, vi } from 'vitest'
import { GAME_KEYS } from '../shared/types'
import type { RacingGame } from '../shared/types'
import { ApiClient } from './apiClient'
import type { RequestOptions } from './apiClient'
import { createRacingApi } from './racingApi'

const G = '555000000000000001'
const U1 = '200000000000000001'
const BASE = `/api/app/v1/guilds/${G}/racing`

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
  return { api: createRacingApi({ request } as unknown as ApiClient), calls, request }
}

const rosterJson = (over: Record<string, unknown> = {}) => ({ user_id: U1, username: 'fake_user_001', display_name: 'Fake Driver 001', current_name: 'Fake Driver 001', in_server: true, role: 'Race Driver', joined_at: '2026-01-02T00:00:00Z', ...over })
const teamJson = (over: Record<string, unknown> = {}) => ({
  name: 'Fake Team Alpha', color: '#1e41ff', focus: 'GT3', role_id: '910000000000000001', role_name: 'Fake Team Alpha', role_exists: true, member_count: 3, created_by: '1001', created_at: '2026-01-01T00:00:00Z', ...over
})
const eventJson = (over: Record<string, unknown> = {}) => ({ id: '3fa9', name: 'Fake_Event', date: '2026-09-14', time: '20:00 UTC', class: 'GT3', notes: 'fake notes', date_iso: '2026-09-14', created_by: '1001', created_at: '2026-01-01T00:00:00Z', ...over })

describe.each(GAME_KEYS)('esports teams of %s', (game: RacingGame) => {
  it('GET teams uses the game in the path, is a plain read and parses focus, colour, role and member count', async () => {
    const { api, calls } = setup({ game, teams: [teamJson(), teamJson({ name: 'Fake Team Beta', color: 'blue', focus: '', role_exists: false, member_count: 0 })] })
    const teams = await api.racingTeams(G, game)
    expect(calls[0]?.path).toBe(`${BASE}/${game}/teams`)
    expect(calls[0]?.method).toBeUndefined()
    expect(teams[0]).toEqual({
      name: 'Fake Team Alpha', color: '#1E41FF', focus: 'GT3', roleId: '910000000000000001', roleName: 'Fake Team Alpha', roleExists: true, memberCount: 3, createdBy: '1001', createdAt: '2026-01-01T00:00:00Z'
    })
    expect(teams[1]).toMatchObject({ color: null, focus: '', roleExists: false, memberCount: 0 })
  })

  it('GET team sends the name as a query parameter and parses the roster, with the stored name and the current name', async () => {
    const { api, calls } = setup({ game, team: { ...teamJson(), roster: [rosterJson(), rosterJson({ user_id: '200000000000000002', current_name: null, in_server: false, role: 'Manager' })] } })
    const team = await api.racingTeam(G, game, ' Fake Team & Co ')
    expect(calls[0]?.path).toBe(`${BASE}/${game}/team?name=Fake+Team+%26+Co`)
    expect(team.roster).toHaveLength(2)
    expect(team.roster[0]).toMatchObject({ userId: U1, displayName: 'Fake Driver 001', currentName: 'Fake Driver 001', inServer: true, role: 'Race Driver', joinedAt: '2026-01-02T00:00:00Z' })
    expect(team.roster[1]).toMatchObject({ inServer: false, currentName: null, role: 'Manager' })
  })

  it('POST team sends name, colour and the optional free-text focus only when given', async () => {
    const answer = { game, team: { ...teamJson(), roster: [] } }
    const { api, calls } = setup(answer, answer)
    await api.createRacingTeam(G, game, { name: 'Fake Team Alpha', color: '#1E41FF' })
    const created = await api.createRacingTeam(G, game, { name: 'Fake Team Alpha', color: '#1E41FF', focus: 'Any free text 123' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/teams`, body: { name: 'Fake Team Alpha', color: '#1E41FF' } })
    expect(calls[0]?.body).not.toHaveProperty('focus')
    expect(calls[1]?.body).toMatchObject({ focus: 'Any free text 123' })
    expect(created.roster).toEqual([])
  })

  it('POST roster sends the team, the member id and the role; the answer says whether the role was assigned', async () => {
    const { api, calls } = setup({ game, team: 'Fake Team Alpha', entry: rosterJson({ role: 'Reserve', current_name: undefined }), role_assigned: true })
    const result = await api.addRosterMember(G, game, { team: 'Fake Team Alpha', userId: U1, role: 'Reserve' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/roster`, body: { team: 'Fake Team Alpha', user_id: U1, role: 'Reserve' } })
    expect(result).toMatchObject({ roleAssigned: true, entry: { userId: U1, role: 'Reserve' } })
  })

  it('DELETE roster sends team and user id as query parameters, no body, and reports whether the role could be taken away', async () => {
    const { api, calls } = setup({ ok: true, game, team: 'Fake Team Alpha', removed: rosterJson(), role_removed: false, role_error: 'bot_cannot_remove_role' })
    const result = await api.removeRosterMember(G, game, 'Fake Team Alpha', U1)
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/${game}/roster?team=Fake+Team+Alpha&user_id=${U1}` })
    expect(calls[0]?.body).toBeUndefined()
    expect(result).toMatchObject({ roleRemoved: false, roleError: 'bot_cannot_remove_role', removed: { userId: U1 } })
  })

  it('GET driver profile lists every team and role of the member in THIS game', async () => {
    const { api, calls } = setup({ game, user_id: U1, display_name: 'Fake Driver 001', in_server: true, memberships: [{ team: 'Fake Team Alpha', role: 'Race Driver', joined_at: '2026-01-02T00:00:00Z', joined: '2026-01-02' }] })
    const profile = await api.racingDriver(G, game, U1)
    expect(calls[0]?.path).toBe(`${BASE}/${game}/drivers/${U1}`)
    expect(profile).toMatchObject({ userId: U1, displayName: 'Fake Driver 001', inServer: true })
    expect(profile.memberships).toEqual([{ team: 'Fake Team Alpha', role: 'Race Driver', joinedAt: '2026-01-02T00:00:00Z', joined: '2026-01-02' }])
  })

  it('GET events keeps the order the API returns, with the page in the query and date_iso null for an unparseable date', async () => {
    const { api, calls } = setup({ game, total: 3, limit: 25, offset: 0, events: [eventJson(), eventJson({ id: 'b', date: '03/04/2026', date_iso: '2026-03-04' }), eventJson({ id: 'c', date: 'next friday', date_iso: null })] })
    const page = await api.racingEvents(G, game, { limit: 100, offset: 25 })
    expect(calls[0]?.path).toBe(`${BASE}/${game}/events?limit=100&offset=25`)
    expect(page.events.map((event) => event.id)).toEqual(['3fa9', 'b', 'c'])
    expect(page.events[1]).toMatchObject({ date: '03/04/2026', dateIso: '2026-03-04', class: 'GT3' })
    expect(page.events[2]?.dateIso).toBeNull()
  })

  it('POST event sends name, date, time and the optional class and notes, using the same field names for every game', async () => {
    const { api, calls } = setup({ game, event: eventJson() }, { game, event: eventJson() })
    await api.addRacingEvent(G, game, { name: 'Fake_Event', date: '2026-09-14', time: '20:00 UTC' })
    const event = await api.addRacingEvent(G, game, { name: 'Fake_Event', date: '2026-09-14', time: '20:00 UTC', class: 'GT3', notes: 'fake notes' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/events`, body: { name: 'Fake_Event', date: '2026-09-14', time: '20:00 UTC' } })
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['date', 'name', 'time'])
    expect(calls[1]?.body).toMatchObject({ class: 'GT3', notes: 'fake notes' })
    expect(Object.keys(calls[1]?.body as object)).not.toContain('series') // the API hides that lmu stores class and the others series
    expect(event.id).toBe('3fa9')
  })
})

describe('the game is always checked, before any request', () => {
  it.each(['', 'f2', 'F1', 'lmu/../x', 'racing', '../iracing', 'gt7 '])('"%s" is refused with unknown_game and nothing is sent', async (game) => {
    const { api, request } = setup()
    const calls = [
      () => api.racingTeams(G, game as RacingGame),
      () => api.racingTeam(G, game as RacingGame, 'Team'),
      () => api.createRacingTeam(G, game as RacingGame, { name: 'Team', color: '#112233' }),
      () => api.addRosterMember(G, game as RacingGame, { team: 'Team', userId: U1, role: 'Manager' }),
      () => api.removeRosterMember(G, game as RacingGame, 'Team', U1),
      () => api.racingDriver(G, game as RacingGame, U1),
      () => api.racingEvents(G, game as RacingGame),
      () => api.addRacingEvent(G, game as RacingGame, { name: 'E', date: '2026-01-01', time: '20:00 UTC' })
    ]
    for (const call of calls) await expect(call()).rejects.toMatchObject({ kind: 'validation', code: 'unknown_game', mayHaveBeenSent: false })
    expect(request).not.toHaveBeenCalled()
  })

  it('every game gets its own path: a call for one game never names another', async () => {
    const paths: string[] = []
    for (const game of GAME_KEYS) {
      const { api, calls } = setup({ game, teams: [] })
      await api.racingTeams(G, game)
      paths.push(calls[0]?.path ?? '')
    }
    expect(paths).toEqual(GAME_KEYS.map((game) => `${BASE}/${game}/teams`))
    expect(new Set(paths).size).toBe(5)
  })

  it('f1 esports uses /racing/f1, never the league /f1 endpoints', async () => {
    const { api, calls } = setup({ game: 'f1', teams: [] })
    await api.racingTeams(G, 'f1')
    expect(calls[0]?.path).toContain('/racing/f1/')
    expect(calls[0]?.path).not.toMatch(/guilds\/\d+\/f1\//)
  })
})

describe('input checks before any request', () => {
  it('refuses a bad guild, member or team name', async () => {
    const { api, request } = setup()
    await expect(api.racingTeams('abc', 'lmu')).rejects.toMatchObject({ code: 'invalid_guild_id' })
    await expect(api.racingDriver(G, 'lmu', '../x')).rejects.toMatchObject({ code: 'invalid_user_id' })
    await expect(api.racingTeam(G, 'lmu', '  ')).rejects.toMatchObject({ code: 'invalid_name' })
    await expect(api.racingTeam(G, 'lmu', 'x'.repeat(51))).rejects.toMatchObject({ code: 'invalid_name' })
    await expect(api.removeRosterMember(G, 'lmu', 'Team', 'nope')).rejects.toMatchObject({ code: 'invalid_user_id' })
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects answers that are not shaped like the documentation', async () => {
    await expect(setup({ nope: [] }).api.racingTeams(G, 'lmu')).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ team: teamJson() }).api.racingTeam(G, 'lmu', 'x')).rejects.toMatchObject({ kind: 'invalid_response' }) // no roster
    await expect(setup({ total: 1, events: [{ name: 'x' }] }).api.racingEvents(G, 'lmu')).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe.each(GAME_KEYS)('writes of %s are sent exactly once (never replayed, whatever goes wrong)', (game: RacingGame) => {
  function realClient(handler: (signal: AbortSignal | undefined) => Promise<Response>) {
    let calls = 0
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls++
      return handler(init?.signal ?? undefined)
    }) as typeof fetch
    const client = new ApiClient({ baseUrl: 'https://api.test', fetchImpl, timeoutMs: 30, wakeAfterMs: 1000, sleep: async () => undefined })
    client.setSession({ access_token: 'access', refresh_token: 'refresh' })
    return { api: createRacingApi(client), calls: () => calls }
  }
  const hang = (signal: AbortSignal | undefined): Promise<Response> =>
    new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  const dropped = async (): Promise<Response> => {
    const error = new TypeError('fetch failed')
    ;(error as { cause?: unknown }).cause = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
    throw error
  }
  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const writes: Array<[string, (api: ReturnType<typeof createRacingApi>) => Promise<unknown>]> = [
    ['create a team', (api) => api.createRacingTeam(G, game, { name: 'Fake Team Alpha', color: '#1E41FF' })],
    ['add a roster member', (api) => api.addRosterMember(G, game, { team: 'Fake Team Alpha', userId: U1, role: 'Manager' })],
    ['remove a roster member', (api) => api.removeRosterMember(G, game, 'Fake Team Alpha', U1)],
    ['add an event', (api) => api.addRacingEvent(G, game, { name: 'Fake_Event', date: '2026-09-14', time: '20:00 UTC' })]
  ]

  it.each(writes)('%s: a timeout is reported once and not repeated', async (_name, run) => {
    const { api, calls } = realClient(hang)
    await expect(run(api)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it.each(writes)('%s: a dropped connection is not repeated', async (_name, run) => {
    const { api, calls } = realClient(dropped)
    await expect(run(api)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it.each([[504, 'bot_timeout'], [502, 'discord_error'], [500, 'internal_error']] as const)('creating a team after %i %s is reported as it is, once', async (status, code) => {
    const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
    await expect(writes[0]![1](api)).rejects.toMatchObject({ kind: 'http', code, status })
    expect(calls()).toBe(1)
  })

  it.each([
    [403, 'manage_server_required'],
    [403, 'bot_missing_manage_roles'],
    [403, 'role_not_assignable'],
    [403, 'bot_cannot_assign_role'],
    [409, 'team_exists'],
    [409, 'already_on_roster'],
    [404, 'team_not_found'],
    [404, 'member_not_found'],
    [404, 'not_on_roster'],
    [404, 'unknown_game']
  ])('%i %s comes through with its code', async (status, code) => {
    const { api } = realClient(async () => json(status, { error: code, message: code }))
    await expect(api.createRacingTeam(G, game, { name: 'Fake Team Alpha', color: '#1E41FF' })).rejects.toMatchObject({ kind: 'http', code, status })
  })
})
