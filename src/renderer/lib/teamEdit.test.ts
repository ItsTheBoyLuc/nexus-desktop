import { describe, expect, it, vi } from 'vitest'
import { hasTeamEditChanges, validateRacingTeamEditDraft } from '../../shared/racingValidation'
import { GAME_KEYS } from '../../shared/types'
import type { ApiErrorInfo, RacingTeam } from '../../shared/types'
import { cached } from './cache'
import { UiError } from './errors'
import { invalidateRacing, racingKey } from './racingScope'
import { describeSavedEdit, describeTeamEditError, judgeTeamEdit, selectedTeamView, selectionAfterRename, TEAM_EDIT_NOTE } from './teamEdit'

/**
 * Milestone 7: editing a team. The wording of the answers, the verdicts that decide what the dialog does, and above all what a RENAME does
 * to everything the app keeps under the team's name (the open team, the data read for it, the results filter).
 */
const err = (info: Partial<ApiErrorInfo> & Pick<ApiErrorInfo, 'kind' | 'code'>): UiError => new UiError({ message: 'backend text', ...info })
const http = (code: string, status = 403): UiError => err({ kind: 'http', code, status })
const team = (name: string): RacingTeam => ({ name, color: '#112233', focus: '', roleId: null, roleName: null, roleExists: true, memberCount: 0, createdBy: '1', createdAt: '2026-01-01T00:00:00Z' })

describe('the edit form keeps only what changed', () => {
  const base = { name: 'Apex Racing', focus: 'GT3' }

  it('nothing changed is an empty edit, which is never sent', () => {
    const result = validateRacingTeamEditDraft(base, { name: 'Apex Racing', focus: 'GT3' })
    expect(result).toEqual({ ok: true, value: {} })
    expect(hasTeamEditChanges({})).toBe(false)
    expect(validateRacingTeamEditDraft(base, { name: '  Apex Racing ', focus: ' GT3 ' })).toEqual({ ok: true, value: {} })
  })

  it('a rename alone sends only the name, a class alone only the focus', () => {
    expect(validateRacingTeamEditDraft(base, { name: 'Apex Motorsport', focus: 'GT3' })).toEqual({ ok: true, value: { newName: 'Apex Motorsport' } })
    expect(validateRacingTeamEditDraft(base, { name: 'Apex Racing', focus: 'Hypercar' })).toEqual({ ok: true, value: { focus: 'Hypercar' } })
  })

  it('changing only the capitals of the name IS a change (the server allows it for the team itself)', () => {
    expect(validateRacingTeamEditDraft(base, { name: 'APEX RACING', focus: 'GT3' })).toEqual({ ok: true, value: { newName: 'APEX RACING' } })
  })

  it('clearing the class sends focus null; an empty class on a team without one is not a change', () => {
    expect(validateRacingTeamEditDraft(base, { name: 'Apex Racing', focus: '  ' })).toEqual({ ok: true, value: { focus: null } })
    expect(validateRacingTeamEditDraft({ name: 'A', focus: '' }, { name: 'A', focus: '' })).toEqual({ ok: true, value: {} })
  })

  it('shows problems next to the field with the rules of the create form', () => {
    expect(validateRacingTeamEditDraft(base, { name: '', focus: '' })).toMatchObject({ ok: false, errors: { name: expect.any(String) } })
    expect(validateRacingTeamEditDraft(base, { name: 'x'.repeat(51), focus: '' })).toMatchObject({ ok: false, errors: { name: expect.any(String) } })
    expect(validateRacingTeamEditDraft(base, { name: 'A', focus: 'x'.repeat(31) })).toMatchObject({ ok: false, errors: { focus: expect.any(String) } })
  })
})

describe('what the dialog does with an answer', () => {
  it.each([
    [err({ kind: 'timeout', code: 'timeout', mayHaveBeenSent: true }), 'lost'],
    [err({ kind: 'network', code: 'network_error', mayHaveBeenSent: true }), 'lost'],
    [err({ kind: 'http', code: 'bot_timeout', status: 504 }), 'lost'],
    [err({ kind: 'http', code: 'discord_error', status: 502 }), 'lost'],
    [err({ kind: 'http', code: 'internal_error', status: 500 }), 'lost'],
    [err({ kind: 'invalid_response', code: 'invalid_response', mayHaveBeenSent: true }), 'lost'],
    [http('manage_server_required'), 'denied'],
    [http('team_exists', 409), 'field'],
    [http('invalid_name', 400), 'field'],
    [http('invalid_focus', 400), 'field'],
    [http('team_not_found', 404), 'gone'],
    [http('no_changes', 400), 'nothing'],
    [http('bot_missing_manage_roles'), 'rejected'],
    [http('role_not_assignable'), 'rejected'],
    [err({ kind: 'rate_limited', code: 'rate_limited', status: 429, retryAfter: 9 }), 'rejected']
  ])('%#: %s', (error, type) => {
    expect(judgeTeamEdit(error).type).toBe(type)
  })

  it('a refused name is shown at the name field, a refused class at the class field', () => {
    expect(judgeTeamEdit(http('team_exists', 409))).toEqual({ type: 'field', field: 'name' })
    expect(judgeTeamEdit(http('invalid_name', 400))).toEqual({ type: 'field', field: 'name' })
    expect(judgeTeamEdit(http('invalid_focus', 400))).toEqual({ type: 'field', field: 'focus' })
  })

  it('a lost answer is never anything the form can send again: every server-side failure is "lost"', () => {
    for (const status of [500, 502, 503, 504]) expect(judgeTeamEdit(err({ kind: 'http', code: 'x', status })).type).toBe('lost')
  })

  it('every refusal has its own words that say plainly that nothing was changed', () => {
    for (const code of ['no_changes', 'bot_missing_manage_roles', 'role_not_assignable', 'team_exists', 'team_not_found', 'manage_server_required']) {
      const text = describeTeamEditError(http(code), 'LMU')
      expect(text, code).not.toBe('backend text')
      expect(text.length, code).toBeGreaterThan(30)
    }
    for (const code of ['no_changes', 'bot_missing_manage_roles', 'role_not_assignable', 'team_exists']) expect(describeTeamEditError(http(code), 'LMU'), code).toMatch(/not changed|Nothing was changed/i)
    expect(describeTeamEditError(http('team_exists', 409), 'GT7')).toContain('GT7')
  })

  it('a rate limit is worded as a rate limit, not as "too many posts"', () => {
    const text = describeTeamEditError(err({ kind: 'rate_limited', code: 'rate_limited', status: 429, retryAfter: 9 }), 'LMU')
    expect(text).toContain('9 seconds')
    expect(text).not.toMatch(/posts/i)
  })

  it('says plainly what a rename does and does not do', () => {
    expect(TEAM_EDIT_NOTE).toBe("Renames the Discord role and updates this team's results. Messages already posted in Discord are not changed.")
  })

  it('the toast names what changed', () => {
    expect(describeSavedEdit('Apex', 'Apex 2', false, true)).toBe('Apex is now Apex 2, and its Discord role was renamed.')
    expect(describeSavedEdit('Apex', 'Apex 2', true, false)).toBe('Apex is now Apex 2; the class or category was updated.')
    expect(describeSavedEdit('Apex', 'Apex', true, false)).toBe('The class or category was updated.')
  })
})

describe('a rename and the state that is keyed by the team name', () => {
  it('the open team moves to the new name; another open team, or none, is left alone', () => {
    expect(selectionAfterRename('Apex Racing', 'Apex Racing', 'Apex Motorsport')).toBe('Apex Motorsport')
    expect(selectionAfterRename('apex racing', 'Apex Racing', 'Apex Motorsport')).toBe('Apex Motorsport') // names are compared ignoring capitals
    expect(selectionAfterRename('Other Team', 'Apex Racing', 'Apex Motorsport')).toBe('Other Team')
    expect(selectionAfterRename(null, 'Apex Racing', 'Apex Motorsport')).toBeNull()
  })

  it('after a rename the old list is not read as "the team was removed" while the new list is on its way', () => {
    const stale = [team('Apex Racing'), team('Other Team')]
    const selected = selectionAfterRename('Apex Racing', 'Apex Racing', 'Apex Motorsport')
    expect(selectedTeamView(stale, selected, true)).toEqual({ kind: 'refreshing' })
    const fresh = [team('Apex Motorsport'), team('Other Team')]
    expect(selectedTeamView(fresh, selected, false)).toEqual({ kind: 'found', team: fresh[0] })
  })

  it('a team that is really gone is reported as gone, but only once the list is fresh', () => {
    const list = [team('Other Team')]
    expect(selectedTeamView(list, 'Apex Racing', false)).toEqual({ kind: 'gone' })
    expect(selectedTeamView(list, null, false)).toEqual({ kind: 'none' })
    expect(selectedTeamView([team('Apex')], 'APEX', false)).toMatchObject({ kind: 'found' })
  })

  it('the read of a team, of its results and of the team roles are all dropped by the one invalidation a save does, for that game only', async () => {
    const G = '555000000000000001'
    const loaders = new Map<string, ReturnType<typeof vi.fn<() => Promise<string>>>>()
    const keys = GAME_KEYS.flatMap((game) => [
      racingKey(G, game, 'team', 'apex racing'), // the detail of the team, by the old name
      racingKey(G, game, 'results', 'apex racing'), // the results filtered to the team (the team stats)
      racingKey(G, game, 'results', ''), // the whole archive, whose rows carry the team name
      racingKey(G, game, 'team-roles'), // the role of the team, listed by name
      racingKey(G, game, 'teams')
    ])
    for (const key of keys) {
      const loader = vi.fn(async () => key)
      loaders.set(key, loader)
      await cached(key, loader, 60_000)
    }
    invalidateRacing(G, 'lmu')
    for (const key of keys) {
      await cached(key, loaders.get(key)!, 60_000)
      const dropped = key.startsWith(`racing:${G}:lmu:`)
      expect(loaders.get(key)!, key).toHaveBeenCalledTimes(dropped ? 2 : 1)
    }
  })
})
