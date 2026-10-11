import { describe, expect, it } from 'vitest'
import { GAME_KEYS } from '../shared/types'
import type { RacingGame } from '../shared/types'
import { createRacingApi } from './racingApi'
import { dropped, hang, json, realClient, setup } from './racingApiTestKit'

/**
 * Milestone 5, part 2: the results archive, attendance posts and announcements of every one of the five games.
 * The paths, bodies and answers follow docs/APP_API.md only; every write is sent exactly once.
 */
const G = '555000000000000001'
const BASE = `/api/app/v1/guilds/${G}/racing`

const resultJson = (over: Record<string, unknown> = {}) => ({
  id: 'r1', event_name: 'Fake Round 1', team_name: 'Fake Team Alpha', result: 'P3 in GT3', drivers: 'Fake Driver 001, Fake Driver 002', notes: 'fake notes', logged_by: '1001', logged_at: '2026-01-01T00:00:00Z', ...over
})

describe.each(GAME_KEYS)('results archive of %s', (game: RacingGame) => {
  it('GET results without a team reads the whole archive, with the page in the query, and keeps the order the API returns (oldest first)', async () => {
    const { api, calls } = setup({ game, team: null, total: 120, limit: 100, offset: 100, results: [resultJson({ id: 'a' }), resultJson({ id: 'b', notes: '' })] })
    const page = await api.racingResults(G, game, { limit: 100, offset: 100 })
    expect(calls[0]?.path).toBe(`${BASE}/${game}/results?limit=100&offset=100`)
    expect(calls[0]?.method).toBeUndefined()
    expect(page).toMatchObject({ team: null, total: 120, limit: 100, offset: 100 })
    expect(page.results.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(page.results[0]).toEqual({ id: 'a', eventName: 'Fake Round 1', teamName: 'Fake Team Alpha', result: 'P3 in GT3', drivers: 'Fake Driver 001, Fake Driver 002', notes: 'fake notes', loggedBy: '1001', loggedAt: '2026-01-01T00:00:00Z' })
  })

  it('GET results with a team sends it as the team query parameter (the team stats)', async () => {
    const { api, calls } = setup({ game, team: 'Fake Team & Co', total: 1, limit: 25, offset: 0, results: [resultJson()] })
    const page = await api.racingResults(G, game, { team: ' Fake Team & Co ' })
    expect(calls[0]?.path).toBe(`${BASE}/${game}/results?team=Fake+Team+%26+Co`)
    expect(page.team).toBe('Fake Team & Co')
  })

  it('keeps html in the text of an entry as plain text and never builds markup', async () => {
    const { api } = setup({ game, team: null, total: 1, limit: 25, offset: 0, results: [resultJson({ event_name: '<b>x</b><script>alert(1)</script>', notes: '<img src=x onerror=alert(1)>' })] })
    const page = await api.racingResults(G, game)
    expect(page.results[0]?.eventName).toBe('<b>x</b><script>alert(1)</script>')
    expect(page.results[0]?.notes).toBe('<img src=x onerror=alert(1)>')
  })

  it('POST results sends team, event_name, result, drivers and the optional notes, using the same field names for every game', async () => {
    const { api, calls } = setup({ game, result: resultJson() }, { game, result: resultJson() })
    await api.logRacingResult(G, game, { team: 'Fake Team Alpha', eventName: 'Fake Round 1', result: 'P3 in GT3', drivers: 'a, b' })
    const entry = await api.logRacingResult(G, game, { team: 'Fake Team Alpha', eventName: 'Fake Round 1', result: 'P3 in GT3', drivers: 'a, b', notes: 'fake notes' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/${game}/results`, body: { team: 'Fake Team Alpha', event_name: 'Fake Round 1', result: 'P3 in GT3', drivers: 'a, b' } })
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['drivers', 'event_name', 'result', 'team'])
    expect(calls[1]?.body).toMatchObject({ notes: 'fake notes' })
    expect(entry).toMatchObject({ id: 'r1', teamName: 'Fake Team Alpha' })
  })

  it('has no edit and no delete: the API object offers nothing that changes or removes an entry', () => {
    const { api } = setup()
    const names = Object.keys(api).filter((name) => /result/i.test(name))
    expect(names.sort()).toEqual(['logRacingResult', 'racingResults'])
  })
})

describe('results: input checks and shapes', () => {
  it('refuses a bad team name before any request and rejects answers that are not shaped like the documentation', async () => {
    const { api, request } = setup()
    await expect(api.racingResults(G, 'lmu', { team: '   ' })).rejects.toMatchObject({ code: 'invalid_name' })
    await expect(api.logRacingResult(G, 'lmu', { team: 'x'.repeat(51), eventName: 'e', result: 'r', drivers: 'd' })).rejects.toMatchObject({ code: 'invalid_name' })
    expect(request).not.toHaveBeenCalled()
    await expect(setup({ nope: [] }).api.racingResults(G, 'lmu')).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ total: 1, results: [{ event_name: 'no id' }] }).api.racingResults(G, 'lmu')).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ game: 'lmu' }).api.logRacingResult(G, 'lmu', { team: 'T', eventName: 'e', result: 'r', drivers: 'd' })).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe.each(GAME_KEYS)('logging a result in %s is sent exactly once', (game: RacingGame) => {
  const log = (api: ReturnType<typeof createRacingApi>) => api.logRacingResult(G, game, { team: 'Fake Team Alpha', eventName: 'Fake Round 1', result: 'P3 in GT3', drivers: 'a, b' })

  it('a timeout is reported once and never repeated', async () => {
    const { api, calls } = realClient(hang)
    await expect(log(api)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it('a dropped connection is not repeated', async () => {
    const { api, calls } = realClient(dropped)
    await expect(log(api)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it.each([[504, 'bot_timeout'], [502, 'discord_error'], [500, 'internal_error']] as const)('%i %s is reported as it is, once', async (status, code) => {
    const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
    await expect(log(api)).rejects.toMatchObject({ kind: 'http', code, status })
    expect(calls()).toBe(1)
  })

  it.each([[403, 'manage_server_required'], [404, 'team_not_found'], [404, 'unknown_game'], [400, 'invalid_drivers']])('%i %s comes through with its code', async (status, code) => {
    const { api } = realClient(async () => json(status, { error: code, message: code }))
    await expect(log(api)).rejects.toMatchObject({ kind: 'http', code, status })
  })
})

describe('the game is checked first for the results calls too', () => {
  it.each(['', 'f2', 'F1', '../iracing', 'gt7 '])('"%s" is refused with unknown_game and nothing is sent', async (game) => {
    const { api, request } = setup()
    await expect(api.racingResults(G, game as RacingGame)).rejects.toMatchObject({ kind: 'validation', code: 'unknown_game', mayHaveBeenSent: false })
    await expect(api.logRacingResult(G, game as RacingGame, { team: 'T', eventName: 'e', result: 'r', drivers: 'd' })).rejects.toMatchObject({ kind: 'validation', code: 'unknown_game' })
    expect(request).not.toHaveBeenCalled()
  })
})
