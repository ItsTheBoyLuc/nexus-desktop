import { describe, expect, it } from 'vitest'
import { parseGameInput, parsePanelRequest, parseSettingsInput, parseTierCreateInput, parseTierUpdateInput } from './inputs'

const ROLE = '800000000000000001'
const CH = '777000000000000001'

/** The main process re-parses everything the renderer sends: nothing malformed may reach the API. */
describe('IPC input parsing', () => {
  it('game: accepts a valid form, rejects garbage of any type', () => {
    expect(parseGameInput({ gameKey: 'f1', label: 'Formula 1', category: 'Open Wheel' })).toEqual({ ok: true, value: { gameKey: 'f1', label: 'Formula 1', category: 'Open Wheel' } })
    for (const input of [null, undefined, 'text', 42, [], {}, { gameKey: 5, label: {}, category: [] }, { gameKey: '../x', label: 'a', category: 'b' }]) {
      expect(parseGameInput(input).ok, JSON.stringify(input)).toBe(false)
    }
  })

  it('tier create: needs key and role; points system optional', () => {
    expect(parseTierCreateInput({ tierKey: 'T1', roleId: ROLE })).toEqual({ ok: true, value: { tierKey: 'T1', roleId: ROLE, pointsSystem: null } })
    expect(parseTierCreateInput({ tierKey: 'T1', roleId: 'abc' }).ok).toBe(false)
    expect(parseTierCreateInput({ tierKey: 'a b', roleId: ROLE }).ok).toBe(false)
    expect(parseTierCreateInput({ tierKey: 'T1', roleId: ROLE, pointsSystem: 'x'.repeat(101) }).ok).toBe(false)
  })

  it('tier update: partial, null clears, empty and unknown are refused', () => {
    expect(parseTierUpdateInput({ roleId: ROLE })).toEqual({ ok: true, value: { roleId: ROLE } })
    expect(parseTierUpdateInput({ pointsSystem: null })).toEqual({ ok: true, value: { pointsSystem: null } })
    expect(parseTierUpdateInput({ pointsSystem: '' })).toEqual({ ok: true, value: { pointsSystem: null } })
    expect(parseTierUpdateInput({ signupChannelId: null })).toEqual({ ok: true, value: { signupChannelId: null } })
    expect(parseTierUpdateInput({ signupChannelId: CH, roleId: ROLE })).toEqual({ ok: true, value: { roleId: ROLE, signupChannelId: CH } })
    for (const input of [{}, { unknown: 1 }, null, 'x', { roleId: 'abc' }, { roleId: null }, { pointsSystem: 5 }, { pointsSystem: 'a\nb' }, { signupChannelId: 'abc' }]) {
      expect(parseTierUpdateInput(input).ok, JSON.stringify(input)).toBe(false)
    }
  })

  it('settings: partial, typed and range-checked', () => {
    expect(parseSettingsInput({ embedColor: '#ff6b00', footerName: ' Hi ', seasonNumber: 3 })).toEqual({ ok: true, value: { embedColor: '#FF6B00', footerName: 'Hi', seasonNumber: 3 } })
    expect(parseSettingsInput({ footerName: '' })).toEqual({ ok: true, value: { footerName: '' } })
    for (const input of [{}, null, { embedColor: 'red' }, { footerName: 5 }, { footerName: 'x'.repeat(51) }, { seasonNumber: '3' }, { seasonNumber: 0 }, { seasonNumber: 100000 }, { seasonNumber: 1.5 }, { seasonNumber: NaN }]) {
      expect(parseSettingsInput(input).ok, JSON.stringify(input)).toBe(false)
    }
  })

  it('panel request: channel required, message id optional but valid when present', () => {
    expect(parsePanelRequest({ channelId: CH })).toEqual({ ok: true, value: { channelId: CH } })
    expect(parsePanelRequest({ channelId: CH, messageId: '999000000000000001' }).ok).toBe(true)
    for (const input of [null, {}, { channelId: 5 }, { channelId: CH, messageId: 'x' }, { channelId: CH, messageId: 7 }]) {
      expect(parsePanelRequest(input).ok, JSON.stringify(input)).toBe(false)
    }
  })
})
