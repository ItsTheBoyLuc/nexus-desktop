import { describe, expect, it } from 'vitest'
import { validateResultsDraft } from './f1Validation'
import {
  evidenceUrlProblem,
  isReportId,
  paragraphProblem,
  validateAdvanceDraft,
  validateBanDraft,
  validateClearDraft,
  validateDecisionDraft,
  validateDirtyReportDraft,
  validateManualPointsDraft,
  validatePenaltySettingsDraft,
  validateReportFilters,
  wholeNumber
} from './penaltyValidation'
import type { DecisionDraft } from './penaltyValidation'

/**
 * The limits of the M3 forms, taken from docs/APP_API.md: the forms show the mistake next to the field before a
 * request is made, and the backend checks all of it again.
 */
const D1 = '200000000000000001'
const D2 = '200000000000000002'
const long = (length: number): string => 'x'.repeat(length)

const errorsOf = (result: { ok: boolean; errors?: Record<string, string | undefined> }): string[] => (result.ok ? [] : Object.keys(result.errors ?? {}))

describe('small helpers', () => {
  it('wholeNumber accepts digits only, inside the range', () => {
    expect(wholeNumber(' 12 ', 0, 999)).toBe(12)
    expect(wholeNumber('0', 0, 999)).toBe(0)
    for (const text of ['', '1.5', '-1', '1e3', '12a', '1000', '٣']) expect(wholeNumber(text, 0, 999), text).toBeNull()
  })

  it('paragraphs may have line breaks, but not other control characters, and are limited in code points', () => {
    expect(paragraphProblem('line one\nline two', 1, 500, 'a text')).toBeNull()
    expect(paragraphProblem('bad\u0007bell', 1, 500, 'a text')).toMatch(/cannot be sent/)
    expect(paragraphProblem('', 1, 500, 'a text')).toMatch(/Enter a text/)
    expect(paragraphProblem(long(501), 1, 500, 'a text')).toMatch(/at most 500/)
    expect(paragraphProblem('😀'.repeat(500), 1, 500, 'a text')).toBeNull() // code points, not UTF-16 units
  })

  it('report ids are plain tokens only (they end up in a URL path)', () => {
    expect(isReportId('9f1c2ab3')).toBe(true)
    expect(isReportId('rep_1-b')).toBe(true)
    for (const bad of ['', 'a/b', '../x', 'a b', 'a?b', long(65), 5, null]) expect(isReportId(bad), String(bad)).toBe(false)
  })
})

describe('report filters', () => {
  const draft = { season: '', round: '', status: '', driver: '' }

  it('sends only the filters that are filled in', () => {
    expect(validateReportFilters(draft)).toEqual({ ok: true, value: {} })
    expect(validateReportFilters({ season: ' 5 ', round: '3', status: 'pending', driver: ' alice ' })).toEqual({
      ok: true,
      value: { season: '5', round: '3', driver: 'alice', status: 'pending' }
    })
  })

  it('refuses an unknown status and over-long values', () => {
    expect(errorsOf(validateReportFilters({ ...draft, status: 'archived' }))).toEqual(['status'])
    expect(errorsOf(validateReportFilters({ ...draft, season: long(21), round: long(11), driver: long(101) })).sort()).toEqual(['driver', 'round', 'season'])
  })
})

describe('the decision form', () => {
  const nfa: DecisionDraft = { decision: 'no_further_action', description: '', explanation: 'No infringement found.', driver: '', points: '', season: '' }
  const penalty: DecisionDraft = { decision: 'penalty_issued', description: '5 second time penalty', explanation: '', driver: 'alice', points: '3', season: '5' }

  it('no further action needs an explanation of 1 to 500 characters and sends nothing else', () => {
    expect(validateDecisionDraft(nfa)).toEqual({ ok: true, value: { decision: 'no_further_action', explanation: 'No infringement found.' } })
    expect(errorsOf(validateDecisionDraft({ ...nfa, explanation: '   ' }))).toEqual(['explanation'])
    expect(errorsOf(validateDecisionDraft({ ...nfa, explanation: long(501) }))).toEqual(['explanation'])
    expect(validateDecisionDraft({ ...nfa, explanation: long(500) }).ok).toBe(true)
    // the other mode's fields do not matter
    expect(validateDecisionDraft({ ...nfa, driver: long(500), points: 'x', season: 'y' }).ok).toBe(true)
  })

  it('a penalty needs a description; points, driver and season are checked as the API does', () => {
    expect(validateDecisionDraft(penalty)).toEqual({ ok: true, value: { decision: 'penalty_issued', description: '5 second time penalty', driver: 'alice', penaltyPoints: 3, season: 5 } })
    expect(errorsOf(validateDecisionDraft({ ...penalty, description: '' }))).toEqual(['description'])
    expect(errorsOf(validateDecisionDraft({ ...penalty, description: long(501) }))).toEqual(['description'])
  })

  it('0 points (or none) needs no driver and no season: the points are simply not applied', () => {
    expect(validateDecisionDraft({ ...penalty, driver: '', points: '', season: '' })).toEqual({ ok: true, value: { decision: 'penalty_issued', description: '5 second time penalty', penaltyPoints: 0 } })
    expect(validateDecisionDraft({ ...penalty, driver: '', points: '0' }).ok).toBe(true)
  })

  it('more than 0 points requires the driver who receives them', () => {
    expect(errorsOf(validateDecisionDraft({ ...penalty, driver: '' }))).toEqual(['driver'])
    expect(errorsOf(validateDecisionDraft({ ...penalty, driver: long(101) }))).toEqual(['driver'])
  })

  it('points are whole numbers from 0 to 999 and the season from 1 to 99999', () => {
    for (const points of ['-1', '1000', '2.5', 'two']) expect(errorsOf(validateDecisionDraft({ ...penalty, points })), points).toEqual(['points'])
    expect(validateDecisionDraft({ ...penalty, points: '999' }).ok).toBe(true)
    for (const season of ['0', '100000', 'five']) expect(errorsOf(validateDecisionDraft({ ...penalty, season })), season).toEqual(['season'])
    expect(validateDecisionDraft({ ...penalty, season: '99999' }).ok).toBe(true)
  })

  it('driver names and texts are untrusted text: validated as text, never interpreted', () => {
    const result = validateDecisionDraft({ ...penalty, driver: '<img src=x onerror=alert(1)>', description: '<script>alert(1)</script>' })
    expect(result).toMatchObject({ ok: true, value: { driver: '<img src=x onerror=alert(1)>', description: '<script>alert(1)</script>' } })
  })
})

describe('manual penalty points', () => {
  const draft = { driver: 'Max_V', penaltyType: 'Drive-Through', points: '3', reason: 'Contact at T1', season: '', channelId: '' }

  it('builds the request and leaves the season and channel out when empty', () => {
    expect(validateManualPointsDraft(draft)).toEqual({ ok: true, value: { driver: 'Max_V', penaltyType: 'Drive-Through', points: 3, reason: 'Contact at T1' } })
    expect(validateManualPointsDraft({ ...draft, season: '5', channelId: D1 })).toMatchObject({ ok: true, value: { season: 5, channelId: D1 } })
  })

  it('applies the documented limits (driver 100, type 100, reason 300, points 0-999)', () => {
    expect(errorsOf(validateManualPointsDraft({ ...draft, driver: '' }))).toEqual(['driver'])
    expect(errorsOf(validateManualPointsDraft({ ...draft, driver: long(101) }))).toEqual(['driver'])
    expect(errorsOf(validateManualPointsDraft({ ...draft, penaltyType: long(101) }))).toEqual(['penaltyType'])
    expect(errorsOf(validateManualPointsDraft({ ...draft, reason: long(301) }))).toEqual(['reason'])
    expect(validateManualPointsDraft({ ...draft, reason: long(300), penaltyType: long(100), driver: long(100) }).ok).toBe(true)
    expect(errorsOf(validateManualPointsDraft({ ...draft, points: '1000' }))).toEqual(['points'])
    expect(errorsOf(validateManualPointsDraft({ ...draft, season: '0' }))).toEqual(['season'])
    expect(errorsOf(validateManualPointsDraft({ ...draft, channelId: 'general' }))).toEqual(['channelId'])
  })

  it('0 points records nothing: it is only allowed together with a channel (the embed is all it does)', () => {
    expect(errorsOf(validateManualPointsDraft({ ...draft, points: '0' }))).toEqual(['points'])
    expect(validateManualPointsDraft({ ...draft, points: '0', channelId: D1 }).ok).toBe(true)
  })
})

describe('clearing points', () => {
  const all = { driver: 'alice', mode: 'all' as const, points: '', reason: 'Appeal upheld', season: '' }

  it('clears everything when no amount is given, or only the amount that was entered', () => {
    expect(validateClearDraft(all)).toEqual({ ok: true, value: { driver: 'alice', reason: 'Appeal upheld' } })
    expect(validateClearDraft({ ...all, mode: 'partial', points: '3', season: '5' })).toEqual({ ok: true, value: { driver: 'alice', reason: 'Appeal upheld', points: 3, season: 5 } })
  })

  it('a partial clear needs 1 to 99999 points; "all" ignores a typed amount', () => {
    for (const points of ['', '0', '100000', '1.5']) expect(errorsOf(validateClearDraft({ ...all, mode: 'partial', points })), points).toEqual(['points'])
    expect(validateClearDraft({ ...all, points: 'nonsense' }).ok).toBe(true)
  })

  it('the reason is required (1 to 300) and never contains the confirm flag: the screen adds that after its dialog', () => {
    expect(errorsOf(validateClearDraft({ ...all, reason: '' }))).toEqual(['reason'])
    expect(errorsOf(validateClearDraft({ ...all, reason: long(301) }))).toEqual(['reason'])
    const ok = validateClearDraft(all)
    expect(ok.ok && 'confirm' in ok.value).toBe(false)
  })
})

describe('bans', () => {
  const draft = { driver: 'alice', banType: 'quali', action: 'give', reason: '', season: '' }

  it('needs a driver, a ban type and an action; the reason is optional (up to 300)', () => {
    expect(validateBanDraft(draft)).toEqual({ ok: true, value: { driver: 'alice', banType: 'quali', action: 'give' } })
    expect(validateBanDraft({ ...draft, banType: 'race', action: 'remove', reason: 'Served', season: '4' })).toEqual({
      ok: true,
      value: { driver: 'alice', banType: 'race', action: 'remove', reason: 'Served', season: 4 }
    })
    expect(errorsOf(validateBanDraft({ ...draft, banType: 'pit' }))).toEqual(['banType'])
    expect(errorsOf(validateBanDraft({ ...draft, action: 'toggle' }))).toEqual(['action'])
    expect(errorsOf(validateBanDraft({ ...draft, reason: long(301) }))).toEqual(['reason'])
    expect(errorsOf(validateBanDraft({ ...draft, driver: ' ' }))).toEqual(['driver'])
  })
})

describe('advance race and the penalty settings', () => {
  it('the race number is a whole number from 0 to 9999', () => {
    expect(validateAdvanceDraft({ raceNumber: '6' })).toEqual({ ok: true, value: { raceNumber: 6 } })
    expect(validateAdvanceDraft({ raceNumber: '0' }).ok).toBe(true)
    for (const raceNumber of ['', '-1', '10000', '6.5']) expect(validateAdvanceDraft({ raceNumber }).ok, raceNumber).toBe(false)
  })

  const settings = { currentSeason: '5', expiryRaces: '15', qualiBanThreshold: '8', raceBanThreshold: '13' }
  it('all four settings are required whole numbers: the season 1-99999, the others 1-999', () => {
    expect(validatePenaltySettingsDraft(settings)).toEqual({ ok: true, value: { currentSeason: 5, expiryRaces: 15, qualiBanThreshold: 8, raceBanThreshold: 13 } })
    expect(errorsOf(validatePenaltySettingsDraft({ currentSeason: '', expiryRaces: '0', qualiBanThreshold: '1000', raceBanThreshold: 'x' })).sort()).toEqual(['currentSeason', 'expiryRaces', 'qualiBanThreshold', 'raceBanThreshold'])
    expect(validatePenaltySettingsDraft({ ...settings, currentSeason: '99999', expiryRaces: '999' }).ok).toBe(true)
    expect(errorsOf(validatePenaltySettingsDraft({ ...settings, currentSeason: '100000' }))).toEqual(['currentSeason'])
  })
})

describe('dirty-driver reports', () => {
  const draft = { driver: 'Bob_B', reason: 'Rammed him on purpose', evidenceUrl: 'https://example.com/clip', relatedIncident: '' }

  it('needs a driver, a reason and an evidence link; the related incident is optional', () => {
    expect(validateDirtyReportDraft(draft)).toEqual({ ok: true, value: { driver: 'Bob_B', reason: 'Rammed him on purpose', evidenceUrl: 'https://example.com/clip' } })
    expect(validateDirtyReportDraft({ ...draft, relatedIncident: ' Race 5 — Silverstone ' })).toMatchObject({ ok: true, value: { relatedIncident: 'Race 5 — Silverstone' } })
  })

  it('applies the limits: driver 100, reason 1000, evidence 300, related incident 200', () => {
    expect(errorsOf(validateDirtyReportDraft({ ...draft, driver: long(101) }))).toEqual(['driver'])
    expect(errorsOf(validateDirtyReportDraft({ ...draft, reason: long(1001) }))).toEqual(['reason'])
    expect(validateDirtyReportDraft({ ...draft, reason: long(1000) }).ok).toBe(true)
    expect(errorsOf(validateDirtyReportDraft({ ...draft, evidenceUrl: `https://e.co/${long(300)}` }))).toEqual(['evidenceUrl'])
    expect(errorsOf(validateDirtyReportDraft({ ...draft, relatedIncident: long(201) }))).toEqual(['relatedIncident'])
  })

  it('the evidence link must start with http:// or https:// and contain no spaces', () => {
    expect(evidenceUrlProblem('https://youtu.be/x')).toBeNull()
    expect(evidenceUrlProblem('http://example.com/x')).toBeNull()
    for (const bad of ['', 'ftp://x.test/a', 'javascript:alert(1)', 'example.com/x', 'https://a b.test', 'file:///c:/x']) expect(evidenceUrlProblem(bad), bad).not.toBeNull()
  })
})

describe('the optional results channel of the race results form', () => {
  const race = { season: '5', round: '3', circuit: 'Zandvoort', drivers: [D1, D2], fastestLap: '', pole: '' }

  it('is sent only when a channel was chosen: the default is no channel', () => {
    expect(validateResultsDraft(race)).toMatchObject({ ok: true })
    const none = validateResultsDraft({ ...race, channelId: '' })
    expect(none.ok && 'channelId' in none.value).toBe(false)
    expect(validateResultsDraft({ ...race, channelId: '777000000000000002' })).toMatchObject({ ok: true, value: { channelId: '777000000000000002' } })
  })

  it('refuses something that is not a channel id', () => {
    const bad = validateResultsDraft({ ...race, channelId: 'results' })
    expect(bad.ok).toBe(false)
    expect(!bad.ok && Object.keys(bad.errors)).toEqual(['channelId'])
  })
})
