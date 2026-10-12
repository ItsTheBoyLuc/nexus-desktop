import { describe, expect, it } from 'vitest'
import { isCardId, parsePostTarget } from './pingRoles'
import { parseRacingEventInput, parseRacingEventPostInput, parseRacingResultInput, parseRacingResultPostInput, parseRacingTeamInput, parseRacingTeamPostInput } from './racingInputs'

const G = '555000000000000001'
const CH = '777000000000000001'
const R = ['820000000000000001', '820000000000000002', '820000000000000003', '820000000000000004']

describe('parsePostTarget', () => {
  it('no channel means do not post', () => {
    for (const channel of [undefined, null, '']) expect(parsePostTarget(channel, undefined, G)).toEqual({ ok: true, value: null })
    expect(parsePostTarget(undefined, [], G)).toEqual({ ok: true, value: null })
  })
  it('roles without a channel are refused, never dropped', () => {
    expect(parsePostTarget(undefined, [R[0]], G)).toMatchObject({ ok: false, problem: { code: 'invalid_channel' } })
    expect(parsePostTarget('', [R[0]], G)).toMatchObject({ ok: false, problem: { code: 'invalid_channel' } })
  })
  it('a channel with roles keeps both', () => {
    expect(parsePostTarget(CH, [R[0], R[1], R[0]], G)).toEqual({ ok: true, value: { channelId: CH, pingRoleIds: [R[0], R[1]] } })
    expect(parsePostTarget(CH, undefined, G)).toEqual({ ok: true, value: { channelId: CH, pingRoleIds: [] } })
  })
  it('refuses a channel that is not an id, @everyone, @here, mention text, the server id and more than 3 roles', () => {
    expect(parsePostTarget('general', [], G)).toMatchObject({ ok: false, problem: { code: 'invalid_channel' } })
    expect(parsePostTarget(CH, ['@everyone'], G)).toMatchObject({ ok: false, problem: { code: 'invalid_ping_roles' } })
    expect(parsePostTarget(CH, ['@here'], G)).toMatchObject({ ok: false, problem: { code: 'invalid_ping_roles' } })
    expect(parsePostTarget(CH, ['<@&820000000000000001>'], G)).toMatchObject({ ok: false, problem: { code: 'invalid_ping_roles' } })
    expect(parsePostTarget(CH, [G], G)).toMatchObject({ ok: false, problem: { code: 'role_not_pingable' } })
    expect(parsePostTarget(CH, R, G)).toMatchObject({ ok: false, problem: { code: 'too_many_ping_roles' } })
  })
})

describe('isCardId', () => {
  it.each(['a1b2c3d4e5f6', 'new-3-18f', 'lmu-res-001', 'x'.repeat(64)])('"%s" is a usable id', (id) => expect(isCardId(id)).toBe(true))
  it.each(['', 'x'.repeat(65), 'a b', 'a/b', '../x', 'a?b=1', 'a\nb', 5, null, undefined])('%j is not', (id) => expect(isCardId(id)).toBe(false))
})

describe('the IPC parsers of the creates carry the card through the same rules', () => {
  const team = { name: 'Apex Racing', color: '#1E41FF', focus: 'GT3' }
  const event = { name: 'Daytona 24', date: '2026-09-14', time: '20:00 UTC', class: 'GT3', notes: '' }
  const result = { team: 'Apex Racing', eventName: 'Daytona 24', result: 'P3', drivers: 'alice, bob', notes: '' }
  const cases: Array<[string, (input: unknown) => { ok: boolean; value?: unknown }, Record<string, unknown>]> = [
    ['team', parseRacingTeamInput, team],
    ['event', parseRacingEventInput, event],
    ['result', parseRacingResultInput, result]
  ]

  describe.each(cases)('%s', (_name, parse, base) => {
    it('without a channel there is no channelId and no pingRoleIds in the value', () => {
      const parsed = parse(base)
      expect(parsed.ok).toBe(true)
      expect(Object.keys(parsed.value as object)).not.toContain('channelId')
      expect(Object.keys(parsed.value as object)).not.toContain('pingRoleIds')
    })
    it('a channel and roles are kept', () => {
      expect(parse({ ...base, channelId: CH, pingRoleIds: [R[0]] })).toMatchObject({ ok: true, value: { channelId: CH, pingRoleIds: [R[0]] } })
      expect(parse({ ...base, channelId: CH })).toMatchObject({ ok: true, value: { channelId: CH } })
    })
    it('roles without a channel, @everyone, @here and too many roles are refused', () => {
      for (const extra of [{ pingRoleIds: [R[0]] }, { channelId: CH, pingRoleIds: ['@everyone'] }, { channelId: CH, pingRoleIds: ['@here'] }, { channelId: CH, pingRoleIds: R }, { channelId: 'general' }]) {
        expect(parse({ ...base, ...extra }).ok).toBe(false)
      }
    })
    it('an invalid form is still refused with a card', () => {
      expect(parse({ channelId: CH }).ok).toBe(false)
    })
  })
})

describe('the IPC parsers of the dedicated posts', () => {
  it('a team is posted by name, with a channel (required) and up to 3 roles', () => {
    expect(parseRacingTeamPostInput({ team: ' Apex Racing ', channelId: CH, pingRoleIds: [R[0]] })).toEqual({ ok: true, value: { team: 'Apex Racing', channelId: CH, pingRoleIds: [R[0]] } })
    expect(parseRacingTeamPostInput({ team: 'Apex Racing', channelId: CH })).toEqual({ ok: true, value: { team: 'Apex Racing', channelId: CH } })
    expect(parseRacingTeamPostInput({ team: 'Apex Racing' }).ok).toBe(false)
    expect(parseRacingTeamPostInput({ team: '', channelId: CH }).ok).toBe(false)
    expect(parseRacingTeamPostInput({ team: 'Apex', channelId: CH, pingRoleIds: ['@everyone'] }).ok).toBe(false)
  })
  it.each([
    ['event', parseRacingEventPostInput],
    ['result', parseRacingResultPostInput]
  ] as const)('an %s is posted by id, with a channel (required) and up to 3 roles', (_name, parse) => {
    expect(parse({ id: 'a1b2c3d4e5f6', channelId: CH, pingRoleIds: [R[0], R[1]] })).toEqual({ ok: true, value: { id: 'a1b2c3d4e5f6', channelId: CH, pingRoleIds: [R[0], R[1]] } })
    expect(parse({ id: 'a1b2c3d4e5f6', channelId: CH })).toEqual({ ok: true, value: { id: 'a1b2c3d4e5f6', channelId: CH } })
    for (const bad of [{ channelId: CH }, { id: '../x', channelId: CH }, { id: 'a1', channelId: '' }, { id: 'a1', channelId: CH, pingRoleIds: R }, { id: 'a1', channelId: CH, pingRoleIds: ['@here'] }, 'text', null]) expect(parse(bad).ok).toBe(false)
  })
})
