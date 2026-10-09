import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FOOTER_NAME,
  isValidHexColor,
  isValidKey,
  validateGameDraft,
  validatePanelInput,
  validateSettingsDraft,
  validateTierDraft
} from './validation'

const ROLE = '800000000000000001'
const CH = '777000000000000001'

describe('keys and colours', () => {
  it('accepts 1-20 letters, digits and underscores only', () => {
    for (const key of ['f1', 'F1_PRO', 'a', 'x'.repeat(20), '1', '_']) expect(isValidKey(key), key).toBe(true)
    for (const key of ['', 'x'.repeat(21), 'a b', 'a-b', 'a/b', '../x', 'ünï', 'a\n', 5, null, undefined]) expect(isValidKey(key), String(key)).toBe(false)
  })

  it('accepts #RRGGBB only', () => {
    for (const color of ['#ff6b00', '#FF6B00', '#000000']) expect(isValidHexColor(color), color).toBe(true)
    for (const color of ['ff6b00', '#ff6b0', '#ff6b000', '#gggggg', '#ff6b00\n', '', 16711680, null]) expect(isValidHexColor(color), String(color)).toBe(false)
  })
})

describe('game form (create / enable)', () => {
  const ok = { gameKey: 'f1', label: 'Formula 1', category: 'Open Wheel' }

  it('trims and accepts valid input', () => {
    expect(validateGameDraft({ gameKey: ' f1 ', label: '  Formula 1 ', category: ' Open Wheel ' })).toEqual({ ok: true, value: ok })
  })

  it('enforces the backend limits: label and category 1-50 characters on one line', () => {
    expect(validateGameDraft({ ...ok, label: 'x'.repeat(50) }).ok).toBe(true)
    const result = validateGameDraft({ gameKey: 'a b', label: 'x'.repeat(51), category: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['category', 'gameKey', 'label'])
    for (const bad of ['a\nb', 'a\u0000b']) expect(validateGameDraft({ ...ok, label: bad }).ok, JSON.stringify(bad)).toBe(false)
  })

  it('counts characters like the backend (code points, so an emoji is one)', () => {
    expect(validateGameDraft({ ...ok, label: '\u{1F3CE}'.repeat(50) }).ok).toBe(true)
    expect(validateGameDraft({ ...ok, label: '\u{1F3CE}'.repeat(51) }).ok).toBe(false)
  })
})

describe('tier form', () => {
  const ok = { tierKey: 'T1', roleId: ROLE, pointsSystem: 'F1 2025' }

  it('accepts a valid tier and turns an empty points system into null', () => {
    expect(validateTierDraft(ok, true)).toEqual({ ok: true, value: ok })
    expect(validateTierDraft({ ...ok, pointsSystem: '   ' }, true)).toEqual({ ok: true, value: { ...ok, pointsSystem: null } })
  })

  it('requires a role (picked from the list, never typed) and a valid key', () => {
    const result = validateTierDraft({ tierKey: 'bad key', roleId: '', pointsSystem: '' }, true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['roleId', 'tierKey'])
  })

  it('does not check the key when editing (it cannot change)', () => {
    expect(validateTierDraft({ ...ok, tierKey: '' }, false).ok).toBe(true)
  })

  it('limits the points system to 100 single-line characters', () => {
    expect(validateTierDraft({ ...ok, pointsSystem: 'x'.repeat(100) }, true).ok).toBe(true)
    expect(validateTierDraft({ ...ok, pointsSystem: 'x'.repeat(101) }, true).ok).toBe(false)
    expect(validateTierDraft({ ...ok, pointsSystem: 'a\nb' }, true).ok).toBe(false)
  })
})

describe('settings form', () => {
  const current = { embedColor: '#FF3333', footerName: 'Nexus', seasonNumber: null as number | null }
  const draft = { embedColor: '#FF3333', footerName: 'Nexus', seasonNumber: '' }

  it('sends nothing when nothing changed', () => {
    expect(validateSettingsDraft(draft, current)).toEqual({ ok: true, value: {} })
  })

  it('sends only the fields that changed, colour upper-cased', () => {
    expect(validateSettingsDraft({ ...draft, embedColor: '#ff6b00' }, current)).toEqual({ ok: true, value: { embedColor: '#FF6B00' } })
    expect(validateSettingsDraft({ ...draft, footerName: ' My League ' }, current)).toEqual({ ok: true, value: { footerName: 'My League' } })
    expect(validateSettingsDraft({ ...draft, seasonNumber: '4' }, current)).toEqual({ ok: true, value: { seasonNumber: 4 } })
    expect(validateSettingsDraft({ ...draft, seasonNumber: '4' }, { ...current, seasonNumber: 4 })).toEqual({ ok: true, value: {} })
  })

  it('an empty footer means the default, so it is only a change when the footer is not already the default', () => {
    expect(validateSettingsDraft({ ...draft, footerName: '' }, current)).toEqual({ ok: true, value: {} })
    expect(validateSettingsDraft({ ...draft, footerName: '' }, { ...current, footerName: 'Custom' })).toEqual({ ok: true, value: { footerName: '' } })
    expect(DEFAULT_FOOTER_NAME).toBe('Nexus')
  })

  it('rejects what the backend rejects', () => {
    const bad = (over: Partial<typeof draft>) => validateSettingsDraft({ ...draft, ...over }, current)
    for (const embedColor of ['', 'ff0000', '#ff00', '#gggggg', 'red']) expect(bad({ embedColor }).ok, embedColor).toBe(false)
    expect(bad({ footerName: 'x'.repeat(51) }).ok).toBe(false)
    expect(bad({ footerName: 'x'.repeat(50) }).ok).toBe(true)
    expect(bad({ footerName: 'a\nb' }).ok).toBe(false)
    for (const seasonNumber of ['0', '-1', '100000', '1.5', 'abc', '1e3', '٣', '12345678']) expect(bad({ seasonNumber }).ok, seasonNumber).toBe(false)
    for (const seasonNumber of ['1', '99999']) expect(bad({ seasonNumber }).ok, seasonNumber).toBe(true)
  })
})

describe('panel request', () => {
  it('a new panel needs a channel; a refresh also carries the stored message id', () => {
    expect(validatePanelInput({ channelId: CH })).toEqual({ ok: true, value: { channelId: CH } })
    expect(validatePanelInput({ channelId: CH, messageId: '999000000000000001' })).toEqual({ ok: true, value: { channelId: CH, messageId: '999000000000000001' } })
    expect(validatePanelInput({ channelId: '' }).ok).toBe(false)
    expect(validatePanelInput({ channelId: CH, messageId: 'abc' }).ok).toBe(false)
    expect(validatePanelInput({ channelId: CH, messageId: null }).ok).toBe(false)
  })
})
