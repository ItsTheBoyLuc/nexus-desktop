import { describe, expect, it } from 'vitest'
import { parseRacingTeamEditInput } from '../shared/racingInputs'
import { GAME_KEYS } from '../shared/types'
import type { RacingGame } from '../shared/types'
import { createRacingApi } from './racingApi'
import { dropped, hang, json, realClient, setup } from './racingApiTestKit'

/**
 * Milestone 7: editing a team of every one of the five games (`PATCH /racing/{game}/teams`). Paths, bodies and answers follow
 * docs/APP_API.md only. Only fields that change are sent, `focus` is the only class field, and the write is sent exactly once.
 */
const G = '555000000000000001'
const BASE = `/api/app/v1/guilds/${G}/racing`
const teamJson = (over: Record<string, unknown> = {}) => ({
  name: 'Apex Motorsport', color: '#1e41ff', focus: 'Hypercar', role_id: '910000000000000001', role_name: 'Apex Motorsport', role_exists: true, member_count: 1, created_by: '1001', created_at: '2026-01-01T00:00:00Z', roster: [], ...over
})
const answer = (game: string, over: Record<string, unknown> = {}) => ({ game, team: teamJson(), role_updated: true, ...over })

describe.each(GAME_KEYS)('editing a team of %s', (game: RacingGame) => {
  it('PATCHes teams of THIS game with the current name, and only the fields that change', async () => {
    const { api, calls } = setup(answer(game), answer(game), answer(game))
    const renamed = await api.editRacingTeam(G, game, { team: 'Apex Racing', newName: 'Apex Motorsport' })
    await api.editRacingTeam(G, game, { team: 'Apex Racing', focus: 'Hypercar' })
    await api.editRacingTeam(G, game, { team: ' Apex Racing ', newName: ' Apex Motorsport ', focus: ' GT3 ' })
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: `${BASE}/${game}/teams`, body: { team: 'Apex Racing', new_name: 'Apex Motorsport' } })
    expect(Object.keys(calls[0]?.body as object).sort()).toEqual(['new_name', 'team'])
    expect(Object.keys(calls[1]?.body as object).sort()).toEqual(['focus', 'team'])
    expect(calls[2]?.body).toEqual({ team: 'Apex Racing', new_name: 'Apex Motorsport', focus: 'GT3' })
    expect(renamed.roleUpdated).toBe(true)
    expect(renamed.team).toMatchObject({ name: 'Apex Motorsport', focus: 'Hypercar', color: '#1E41FF', roster: [] })
  })

  it('the class is the focus field: null and empty text clear it, and there is no "class" key', async () => {
    const { api, calls } = setup(answer(game, { role_updated: false }), answer(game), answer(game))
    const cleared = await api.editRacingTeam(G, game, { team: 'Apex Racing', focus: null })
    await api.editRacingTeam(G, game, { team: 'Apex Racing', focus: '' })
    await api.editRacingTeam(G, game, { team: 'Apex Racing', focus: '   ' })
    for (const call of calls) expect(call.body).toEqual({ team: 'Apex Racing', focus: null })
    for (const call of calls) expect(Object.keys(call.body as object)).not.toContain('class')
    expect(cleared.roleUpdated).toBe(false)
  })

  it('a request that changes nothing is refused before any request (no_changes), the same code the server uses', async () => {
    const { api, request } = setup()
    await expect(api.editRacingTeam(G, game, { team: 'Apex Racing' })).rejects.toMatchObject({ kind: 'validation', code: 'no_changes', mayHaveBeenSent: false })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    [{ team: '', newName: 'X' }, 'invalid_name'],
    [{ team: 'Apex', newName: '' }, 'invalid_name'],
    [{ team: 'Apex', newName: 'x'.repeat(51) }, 'invalid_name'],
    [{ team: 'Apex', focus: 'x'.repeat(31) }, 'invalid_focus'],
    [{ team: 'Apex', focus: 'two\nlines' }, 'invalid_focus']
  ] as const)('refuses %j before any request (%s)', async (input, code) => {
    const { api, request } = setup()
    await expect(api.editRacingTeam(G, game, input)).rejects.toMatchObject({ kind: 'validation', code })
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects an answer that is not shaped like the documentation', async () => {
    await expect(setup({ game, team: teamJson() }).api.editRacingTeam(G, game, { team: 'A', newName: 'B' })).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ game, role_updated: true }).api.editRacingTeam(G, game, { team: 'A', newName: 'B' })).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ game, team: { roster: [] }, role_updated: true }).api.editRacingTeam(G, game, { team: 'A', newName: 'B' })).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe.each(GAME_KEYS)('editing a team of %s is sent exactly once', (game: RacingGame) => {
  const edit = (api: ReturnType<typeof createRacingApi>) => api.editRacingTeam(G, game, { team: 'Apex Racing', newName: 'Apex Motorsport' })

  it('a timeout is reported once and never repeated: the role and the results may already be renamed', async () => {
    const { api, calls } = realClient(hang)
    await expect(edit(api)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it('a dropped connection is not repeated', async () => {
    const { api, calls } = realClient(dropped)
    await expect(edit(api)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it.each([[504, 'bot_timeout'], [502, 'discord_error'], [500, 'internal_error']] as const)('%i %s is reported as it is, once', async (status, code) => {
    const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
    await expect(edit(api)).rejects.toMatchObject({ kind: 'http', code, status })
    expect(calls()).toBe(1)
  })

  it.each([
    [403, 'manage_server_required'],
    [403, 'bot_missing_manage_roles'],
    [403, 'role_not_assignable'],
    [404, 'team_not_found'],
    [409, 'team_exists'],
    [400, 'no_changes'],
    [400, 'invalid_name'],
    [400, 'invalid_focus']
  ])('%i %s comes through with its code', async (status, code) => {
    const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
    await expect(edit(api)).rejects.toMatchObject({ kind: 'http', code, status })
    expect(calls()).toBe(1)
  })

  it('429 is reported once with its Retry-After and not repeated', async () => {
    const { api, calls } = realClient(async () => new Response(JSON.stringify({ error: 'rate_limited', message: 'slow' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '7' } }))
    await expect(edit(api)).rejects.toMatchObject({ kind: 'rate_limited', retryAfter: 7 })
    expect(calls()).toBe(1)
  })
})

describe('the game is checked first for the edit too', () => {
  it.each(['', 'f2', 'F1', '../iracing', 'gt7 '])('"%s" is refused with unknown_game and nothing is sent', async (game) => {
    const { api, request } = setup()
    await expect(api.editRacingTeam(G, game as RacingGame, { team: 'A', newName: 'B' })).rejects.toMatchObject({ kind: 'validation', code: 'unknown_game', mayHaveBeenSent: false })
    expect(request).not.toHaveBeenCalled()
  })
})

describe('what the main process lets through from the renderer', () => {
  it('keeps the current name and only the fields present; null or empty focus becomes null', () => {
    expect(parseRacingTeamEditInput({ team: ' Apex ', newName: ' Apex 2 ' })).toEqual({ ok: true, value: { team: 'Apex', newName: 'Apex 2' } })
    expect(parseRacingTeamEditInput({ team: 'Apex', focus: null })).toEqual({ ok: true, value: { team: 'Apex', focus: null } })
    expect(parseRacingTeamEditInput({ team: 'Apex', focus: '  ' })).toEqual({ ok: true, value: { team: 'Apex', focus: null } })
    expect(parseRacingTeamEditInput({ team: 'Apex', focus: ' GT3 ', newName: 'B' })).toEqual({ ok: true, value: { team: 'Apex', newName: 'B', focus: 'GT3' } })
  })

  it('drops everything else: no class key, no colour, no role id can be smuggled in', () => {
    const parsed = parseRacingTeamEditInput({ team: 'Apex', newName: 'B', class: 'GT3', color: '#000000', roleId: '1', channelId: '2' })
    expect(parsed).toEqual({ ok: true, value: { team: 'Apex', newName: 'B' } })
  })

  it.each([
    [undefined],
    [{}],
    [{ team: 'Apex' }],
    [{ team: '', newName: 'B' }],
    [{ team: 'Apex', newName: 5 }],
    [{ team: 'Apex', newName: '' }],
    [{ team: 'Apex', newName: 'x'.repeat(51) }],
    [{ team: 'Apex', focus: 7 }],
    [{ team: 'Apex', focus: 'x'.repeat(31) }],
    [{ team: 'Apex', focus: 'a\nb' }]
  ])('refuses %j', (input) => {
    expect(parseRacingTeamEditInput(input).ok).toBe(false)
  })
})
