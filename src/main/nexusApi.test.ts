import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './apiClient'
import type { ApiClient, RequestOptions } from './apiClient'
import { createNexusApi } from './nexusApi'

const G = '555000000000000001'
const ROLE = '800000000000000001'
const CH = '777000000000000001'
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
  return { api: createNexusApi({ request } as unknown as ApiClient), calls, request }
}

const tierJson = (over: Record<string, unknown> = {}) => ({
  role_id: ROLE,
  signup_panel_posted: false,
  signup_channel_id: null,
  points_system: 'F1 2025',
  driver_count: 12,
  role_name: 'Tier 1 Drivers',
  ...over
})
const gameJson = (over: Record<string, unknown> = {}) => ({ label: 'Formula 1', category: 'Open Wheel', active: true, tiers: { T1: tierJson() }, ...over })

describe('roles', () => {
  it('GET /roles, keeps the picker flags and the M6 member counts, drops malformed rows', async () => {
    const { api, calls } = setup({
      roles: [
        { id: ROLE, name: 'Tier 1', color: '#ff8800', position: 5, managed: false, assignable: true, privileged: false, mentionable: true, member_count: 12, member_count_approximate: false },
        { id: ROLE, name: 'Bot', color: null, position: 3, managed: true, assignable: false, privileged: false, mentionable: false, member_count: 1, member_count_approximate: true },
        { id: 'abc', name: 'bad id' },
        { name: 'no id' }
      ]
    })
    const roles = await api.roles(G)
    expect(calls[0]).toMatchObject({ path: `${BASE}/roles` })
    expect(calls[0]?.method).toBeUndefined() // GET
    expect(roles).toEqual([
      { id: ROLE, name: 'Tier 1', color: '#FF8800', position: 5, managed: false, assignable: true, privileged: false, mentionable: true, memberCount: 12, memberCountApproximate: false },
      { id: ROLE, name: 'Bot', color: null, position: 3, managed: true, assignable: false, privileged: false, mentionable: false, memberCount: 1, memberCountApproximate: true }
    ])
  })

  it('a role without the M6 fields is not mentionable, and its count is unknown (never 0)', async () => {
    const { api } = setup({ roles: [{ id: ROLE, name: 'Old', color: null, position: 1, managed: false, assignable: true, privileged: false }] })
    expect(await api.roles(G)).toEqual([{ id: ROLE, name: 'Old', color: null, position: 1, managed: false, assignable: true, privileged: false, mentionable: false, memberCount: null, memberCountApproximate: true }])
  })

  it.each([[-1], [1.5], ['12'], [null], [1e12]])('a member count of %j is unknown, not a number', async (count) => {
    const { api } = setup({ roles: [{ id: ROLE, name: 'Odd', color: null, position: 1, managed: false, assignable: true, privileged: false, mentionable: true, member_count: count, member_count_approximate: false }] })
    const [role] = await api.roles(G)
    expect(role).toMatchObject({ memberCount: null, memberCountApproximate: true })
  })

  it('only a real true counts as mentionable', async () => {
    const { api } = setup({ roles: [{ id: ROLE, name: 'Odd', color: null, position: 1, managed: false, assignable: true, privileged: false, mentionable: 'true', member_count: 3 }] })
    expect((await api.roles(G))[0]?.mentionable).toBe(false)
  })
})

describe('overview', () => {
  const full = {
    guild: { id: G, name: 'Apex', icon: null, member_count: 120 },
    season: 4,
    counts: {
      games: 2, active_games: 1, tiers: 2, tiers_with_panel: 1, tier_drivers: 3, teams: 2,
      team_drivers: 3, calendar_rounds: 3, open_signups: 1, reports: 2, pending_reports: 1
    },
    next_event: { round: 2, name: 'Next GP', flag: '', date: '20/11/2023', time: '20:00', event_type: 'Sprint Weekend', countdown_hours: 121 },
    checklist: [
      { key: 'appearance', label: 'Embed color or footer set', done: true, detail: null },
      { key: 'tier_roles', label: 'Every tier is linked to a real role', done: false, detail: '1/2 roles found' }
    ],
    setup_complete: false,
    member_cache_complete: false
  }

  it('GET /overview and maps every field, including the checklist exactly as sent', async () => {
    const { api, calls } = setup(full)
    const overview = await api.overview(G)
    expect(calls[0]).toMatchObject({ path: `${BASE}/overview` })
    expect(overview.counts).toEqual({
      games: 2, activeGames: 1, tiers: 2, tiersWithPanel: 1, tierDrivers: 3, teams: 2,
      teamDrivers: 3, calendarRounds: 3, openSignups: 1, reports: 2, pendingReports: 1
    })
    expect(overview.checklist).toEqual([
      { key: 'appearance', label: 'Embed color or footer set', done: true, detail: null },
      { key: 'tier_roles', label: 'Every tier is linked to a real role', done: false, detail: '1/2 roles found' }
    ])
    expect(overview.nextEvent).toEqual({ round: 2, name: 'Next GP', flag: null, date: '20/11/2023', time: '20:00', eventType: 'Sprint Weekend', countdownHours: 121 })
    expect(overview).toMatchObject({ memberCount: 120, season: 4, setupComplete: false, memberCacheComplete: false })
  })

  it('accepts next_event null and any number of checklist items (nothing is hard-coded)', async () => {
    const { api } = setup({ ...full, next_event: null, checklist: [], setup_complete: true })
    const overview = await api.overview(G)
    expect(overview.nextEvent).toBeNull()
    expect(overview.checklist).toEqual([])
  })

  it('rejects a response with a missing count instead of showing wrong numbers', async () => {
    const counts: Record<string, unknown> = { ...full.counts }
    delete counts['tiers']
    const { api } = setup({ ...full, counts })
    await expect(api.overview(G)).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('server settings', () => {
  const settings = { embed_color: '#ff6b00', footer_name: 'My League', season_number: 7, effective_season: 9, season_source: 'penalty_settings' }

  it('GET /settings', async () => {
    const { api, calls } = setup(settings)
    expect(await api.serverSettings(G)).toEqual({ embedColor: '#FF6B00', footerName: 'My League', seasonNumber: 7, effectiveSeason: 9, seasonSource: 'penalty_settings', canEdit: null })
    expect(calls[0]).toMatchObject({ path: `${BASE}/settings` })
  })

  it('reads can_edit so the screen can be read-only up front (null when an older backend does not send it)', async () => {
    expect(await setup({ ...settings, can_edit: false }).api.serverSettings(G)).toMatchObject({ canEdit: false })
    expect(await setup({ ...settings, can_edit: true }).api.serverSettings(G)).toMatchObject({ canEdit: true })
    expect(await setup(settings).api.serverSettings(G)).toMatchObject({ canEdit: null })
    expect(await setup({ ...settings, can_edit: 'yes' }).api.serverSettings(G)).toMatchObject({ canEdit: null })
  })

  it('PUT /settings sends only the given fields, in the backend field names', async () => {
    const { api, calls } = setup(settings, settings, settings)
    await api.saveServerSettings(G, { embedColor: '#112233' })
    await api.saveServerSettings(G, { footerName: '' })
    await api.saveServerSettings(G, { embedColor: '#112233', footerName: 'F', seasonNumber: 3 })
    expect(calls.map((c) => [c.method, c.path])).toEqual([['PUT', `${BASE}/settings`], ['PUT', `${BASE}/settings`], ['PUT', `${BASE}/settings`]])
    expect(calls.map((c) => c.body)).toEqual([
      { embed_color: '#112233' },
      { footer_name: '' },
      { embed_color: '#112233', footer_name: 'F', season_number: 3 }
    ])
  })

  it('rejects unknown season sources and bad colours', async () => {
    await expect(setup({ ...settings, season_source: 'magic' }).api.serverSettings(G)).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(setup({ ...settings, embed_color: 'red' }).api.serverSettings(G)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('accepts a never-set season (null)', async () => {
    const { api } = setup({ ...settings, season_number: null, effective_season: 1, season_source: 'default' })
    expect(await api.serverSettings(G)).toMatchObject({ seasonNumber: null, effectiveSeason: 1, seasonSource: 'default' })
  })
})

describe('league games', () => {
  it('GET /league/games turns the keyed objects into lists and carries the live counts', async () => {
    const { api, calls } = setup({ games: { f1_2025: gameJson(), LMU: gameJson({ label: 'Le Mans', active: false, tiers: {} }) }, member_cache_complete: true })
    const result = await api.leagueGames(G)
    expect(calls[0]).toMatchObject({ path: `${BASE}/league/games` })
    expect(result.memberCacheComplete).toBe(true)
    expect(result.games.map((g) => [g.key, g.active, g.tiers.length])).toEqual([['f1_2025', true, 1], ['LMU', false, 0]])
    expect(result.games[0]?.tiers[0]).toEqual({
      key: 'T1', roleId: ROLE, signupPanelPosted: false, signupChannelId: null, pointsSystem: 'F1 2025', driverCount: 12, roleName: 'Tier 1 Drivers'
    })
  })

  it('a tier whose role was deleted has null count and name', async () => {
    const { api } = setup({ games: { f1: gameJson({ tiers: { T1: tierJson({ driver_count: null, role_name: null }) } }) } })
    expect((await api.leagueGames(G)).games[0]?.tiers[0]).toMatchObject({ driverCount: null, roleName: null })
  })

  it('POST /league/games (create) with the backend field names', async () => {
    const { api, calls } = setup({ game_key: 'f1', game: gameJson({ tiers: {} }) })
    const game = await api.createGame(G, { gameKey: 'f1', label: 'Formula 1', category: 'Open Wheel' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/league/games`, body: { game_key: 'f1', label: 'Formula 1', category: 'Open Wheel' } })
    expect(game).toMatchObject({ key: 'f1', label: 'Formula 1', active: true, tiers: [] })
  })

  it('PATCH /league/games/{key} (enable / disable)', async () => {
    const { api, calls } = setup({ game_key: 'LMU', game: gameJson({ active: true }) }, { game_key: 'LMU', game: gameJson({ active: false }) })
    expect((await api.setGameActive(G, 'LMU', true)).active).toBe(true)
    expect((await api.setGameActive(G, 'LMU', false)).active).toBe(false)
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', `${BASE}/league/games/LMU`, { active: true }],
      ['PATCH', `${BASE}/league/games/LMU`, { active: false }]
    ])
  })

  it('DELETE /league/games/{key}', async () => {
    const { api, calls } = setup({ ok: true })
    await expect(api.deleteGame(G, 'LMU')).resolves.toBeUndefined()
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/league/games/LMU` })
    await expect(setup({ ok: false }).api.deleteGame(G, 'LMU')).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('tiers', () => {
  it('POST .../tiers', async () => {
    const { api, calls } = setup({ game_key: 'f1', tier_key: 'T1', tier: tierJson() }, { game_key: 'f1', tier_key: 'T2', tier: tierJson({ points_system: null }) })
    expect(await api.createTier(G, 'f1', { tierKey: 'T1', roleId: ROLE, pointsSystem: 'F1 2025' })).toMatchObject({ key: 'T1', pointsSystem: 'F1 2025' })
    expect(await api.createTier(G, 'f1', { tierKey: 'T2', roleId: ROLE, pointsSystem: null })).toMatchObject({ key: 'T2', pointsSystem: null })
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', `${BASE}/league/games/f1/tiers`, { tier_key: 'T1', role_id: ROLE, points_system: 'F1 2025' }],
      ['POST', `${BASE}/league/games/f1/tiers`, { tier_key: 'T2', role_id: ROLE }]
    ])
  })

  it('PATCH .../tiers/{key} sends only what changed, and null clears a field', async () => {
    const { api, calls } = setup(
      { game_key: 'f1', tier_key: 'T1', tier: tierJson() },
      { game_key: 'f1', tier_key: 'T1', tier: tierJson() }
    )
    await api.updateTier(G, 'f1', 'T1', { roleId: ROLE, signupChannelId: CH })
    await api.updateTier(G, 'f1', 'T1', { pointsSystem: null })
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', `${BASE}/league/games/f1/tiers/T1`, { role_id: ROLE, signup_channel_id: CH }],
      ['PATCH', `${BASE}/league/games/f1/tiers/T1`, { points_system: null }]
    ])
  })

  it('DELETE .../tiers/{key}', async () => {
    const { api, calls } = setup({ ok: true })
    await api.deleteTier(G, 'f1', 'T1')
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/league/games/f1/tiers/T1` })
  })

  it('passes backend errors (e.g. role_too_privileged) through untouched', async () => {
    const error = new ApiError({ kind: 'http', code: 'role_too_privileged', message: 'elevated', status: 403 })
    await expect(setup(error).api.createTier(G, 'f1', { tierKey: 'T1', roleId: ROLE })).rejects.toBe(error)
  })
})

describe('post-panel', () => {
  const posted = { ok: true, message_id: '999000000000000001', channel_id: CH, refreshed: false, tier: tierJson({ signup_panel_posted: true, signup_channel_id: CH }) }

  it('POST .../post-panel without message_id posts a new panel', async () => {
    const { api, calls } = setup(posted)
    const result = await api.postPanel(G, 'f1', 'T1', { channelId: CH })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/league/games/f1/tiers/T1/post-panel`, body: { channel_id: CH } })
    expect(result).toMatchObject({ messageId: '999000000000000001', channelId: CH, refreshed: false })
    expect(result.tier).toMatchObject({ key: 'T1', signupPanelPosted: true, signupChannelId: CH })
  })

  it('with message_id it refreshes in place', async () => {
    const { api, calls } = setup({ ...posted, refreshed: true })
    const result = await api.postPanel(G, 'f1', 'T1', { channelId: CH, messageId: '999000000000000001' })
    expect(calls[0]?.body).toEqual({ channel_id: CH, message_id: '999000000000000001' })
    expect(result.refreshed).toBe(true)
  })

  it('rejects an answer without a valid message id', async () => {
    await expect(setup({ ...posted, message_id: 'oops' }).api.postPanel(G, 'f1', 'T1', { channelId: CH })).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('inputs that could change the request path are refused before anything is sent', () => {
  it.each([
    ['server id', (a: ReturnType<typeof setup>['api']) => a.roles('../../x')],
    ['game key', (a: ReturnType<typeof setup>['api']) => a.setGameActive(G, '../x', true)],
    ['game key with slash', (a: ReturnType<typeof setup>['api']) => a.deleteGame(G, 'a/b')],
    ['tier key', (a: ReturnType<typeof setup>['api']) => a.deleteTier(G, 'f1', 'T1/../..')],
    ['key too long', (a: ReturnType<typeof setup>['api']) => a.postPanel(G, 'f1', 'T'.repeat(21), { channelId: CH })]
  ])('%s', async (_name, run) => {
    const { api, request } = setup()
    await expect(run(api)).rejects.toMatchObject({ kind: 'validation', mayHaveBeenSent: false })
    expect(request).not.toHaveBeenCalled()
  })
})
