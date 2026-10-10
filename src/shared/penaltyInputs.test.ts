import { describe, expect, it } from 'vitest'
import { parseResultsInput } from './inputs'
import {
  parseAdvanceInput,
  parseBanInput,
  parseClearInput,
  parseDecisionInput,
  parseDirtyReportInput,
  parseDriverName,
  parseLedgerQuery,
  parseManualPointsInput,
  parseOptionalSeason,
  parsePenaltySettingsInput,
  parseReportFiltersInput,
  parseReportId,
  parseReportIndex,
  parseReportOverviewQuery
} from './penaltyInputs'

/**
 * The main process re-checks everything the renderer sends over IPC. The destructive actions need a literal
 * `confirm: true`, which the screens only set after their confirm dialog.
 */
describe('destructive actions are refused without a literal confirm: true', () => {
  const clear = { driver: 'alice', reason: 'Appeal upheld' }
  const ban = { driver: 'alice', banType: 'race', action: 'give' }
  const advance = { raceNumber: 6 }

  it.each([
    ['clear points', parseClearInput, clear],
    ['bans', parseBanInput, ban],
    ['advance race', parseAdvanceInput, advance]
  ])('%s: missing, false, "true" and 1 are all refused', (_name, parse, base) => {
    for (const confirm of [undefined, false, 'true', 1, null, {}]) {
      const result = (parse as (input: unknown) => { ok: boolean; message?: string })({ ...base, confirm })
      expect(result.ok, String(confirm)).toBe(false)
      expect(result.message).toMatch(/confirmed/)
    }
    expect((parse as (input: unknown) => { ok: boolean })({ ...base, confirm: true }).ok).toBe(true)
  })

  it('a confirmed action is passed on with confirm: true and the validated values only', () => {
    expect(parseClearInput({ ...clear, points: 3, season: 5, confirm: true })).toEqual({ ok: true, value: { driver: 'alice', reason: 'Appeal upheld', points: 3, season: 5, confirm: true } })
    expect(parseBanInput({ ...ban, confirm: true })).toEqual({ ok: true, value: { driver: 'alice', banType: 'race', action: 'give', confirm: true } })
    expect(parseAdvanceInput({ raceNumber: 0, confirm: true })).toEqual({ ok: true, value: { raceNumber: 0, confirm: true } })
  })

  it('a confirmed action with invalid fields is still refused', () => {
    expect(parseClearInput({ driver: '', reason: 'x', confirm: true }).ok).toBe(false)
    expect(parseClearInput({ ...clear, points: 0, confirm: true }).ok).toBe(false) // a partial clear removes 1 or more
    expect(parseBanInput({ ...ban, banType: 'pit', confirm: true }).ok).toBe(false)
    expect(parseAdvanceInput({ raceNumber: 10000, confirm: true }).ok).toBe(false)
  })
})

describe('report decisions', () => {
  it('re-validates the decision exactly like the form', () => {
    expect(parseDecisionInput({ decision: 'no_further_action', explanation: 'Racing incident.' })).toEqual({ ok: true, value: { decision: 'no_further_action', explanation: 'Racing incident.' } })
    expect(parseDecisionInput({ decision: 'penalty_issued', description: '5s', driver: 'alice', penaltyPoints: 2, season: 5 })).toEqual({
      ok: true,
      value: { decision: 'penalty_issued', description: '5s', driver: 'alice', penaltyPoints: 2, season: 5 }
    })
    for (const bad of [
      {},
      { decision: 'ban_forever' },
      { decision: 'no_further_action', explanation: '' },
      { decision: 'penalty_issued', description: '5s', penaltyPoints: 2 }, // points without a driver
      { decision: 'penalty_issued', description: '5s', penaltyPoints: 1000, driver: 'a' },
      { decision: 'penalty_issued', description: '5s', penaltyPoints: 1.5, driver: 'a' }
    ]) {
      expect(parseDecisionInput(bad).ok, JSON.stringify(bad)).toBe(false)
    }
    expect(parseDecisionInput('nope').ok).toBe(false)
  })

  it('report ids are plain tokens', () => {
    expect(parseReportId('9f1c2a').ok).toBe(true)
    for (const bad of ['', '../etc', 'a/b', 'a b', 7, undefined]) expect(parseReportId(bad).ok, String(bad)).toBe(false)
  })
})

describe('reading reports and the overview', () => {
  it('filters: only valid ones pass; the page size is 1-100 and the offset 0 or more', () => {
    expect(parseReportFiltersInput({})).toEqual({ ok: true, value: {} })
    expect(parseReportFiltersInput({ season: '5', status: 'pending', limit: 100, offset: 100 })).toEqual({ ok: true, value: { season: '5', status: 'pending', limit: 100, offset: 100 } })
    for (const bad of [{ status: 'old' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 'x' }]) expect(parseReportFiltersInput(bad).ok, JSON.stringify(bad)).toBe(false)
  })

  it('the round overview needs a season AND a round, or neither', () => {
    expect(parseReportOverviewQuery({})).toEqual({ ok: true, value: null })
    expect(parseReportOverviewQuery({ season: '5', round: '3' })).toEqual({ ok: true, value: { season: '5', round: '3' } })
    expect(parseReportOverviewQuery({ season: '5' }).ok).toBe(false)
    expect(parseReportOverviewQuery({ round: '3' }).ok).toBe(false)
  })

  it('the ledger query keeps only what is filled in', () => {
    expect(parseLedgerQuery({ season: ' 5 ', round: '' })).toEqual({ ok: true, value: { season: '5' } })
    expect(parseLedgerQuery(undefined)).toEqual({ ok: true, value: {} })
    expect(parseLedgerQuery({ season: 'x'.repeat(21) }).ok).toBe(false)
  })
})

describe('penalty points, settings and dirty drivers', () => {
  it('manual points: the same rules as the form (0 points need a channel)', () => {
    const base = { driver: 'Max_V', penaltyType: 'Drive-Through', points: 3, reason: 'Contact' }
    expect(parseManualPointsInput(base)).toEqual({ ok: true, value: base })
    expect(parseManualPointsInput({ ...base, points: 0 }).ok).toBe(false)
    expect(parseManualPointsInput({ ...base, points: 0, channelId: '777000000000000001' }).ok).toBe(true)
    expect(parseManualPointsInput({ ...base, points: 'many' }).ok).toBe(false)
  })

  it('settings: all four fields are required', () => {
    expect(parsePenaltySettingsInput({ currentSeason: 5, expiryRaces: 15, qualiBanThreshold: 8, raceBanThreshold: 13 }).ok).toBe(true)
    expect(parsePenaltySettingsInput({ currentSeason: 5, expiryRaces: 15, qualiBanThreshold: 8 }).ok).toBe(false)
    expect(parsePenaltySettingsInput(null).ok).toBe(false)
  })

  it('seasons are optional but must be real when given', () => {
    expect(parseOptionalSeason(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseOptionalSeason(5)).toEqual({ ok: true, value: 5 })
    for (const bad of [0, 100000, 1.5, '5']) expect(parseOptionalSeason(bad).ok, String(bad)).toBe(false)
  })

  it('driver names and report numbers', () => {
    expect(parseDriverName('  Max_V ')).toEqual({ ok: true, value: 'Max_V' })
    for (const bad of ['', '   ', 'x'.repeat(101), 'two\nlines', 5]) expect(parseDriverName(bad).ok, String(bad)).toBe(false)
    expect(parseReportIndex(3)).toEqual({ ok: true, value: 3 })
    for (const bad of [0, -1, 1.5, '3', 1_000_000]) expect(parseReportIndex(bad).ok, String(bad)).toBe(false)
  })

  it('a dirty-driver report needs an http(s) evidence link', () => {
    const base = { driver: 'Bob_B', reason: 'Rammed him', evidenceUrl: 'https://example.com/clip' }
    expect(parseDirtyReportInput(base).ok).toBe(true)
    expect(parseDirtyReportInput({ ...base, evidenceUrl: 'javascript:alert(1)' }).ok).toBe(false)
    expect(parseDirtyReportInput({ ...base, reason: '' }).ok).toBe(false)
  })
})

describe('race results from the renderer: channel and the duplicate confirmation', () => {
  const base = { season: '5', round: '3', circuit: 'Zandvoort', results: ['200000000000000001'] }

  it('passes an optional channel and a literal confirmDuplicate: true, nothing else', () => {
    expect(parseResultsInput(base)).toEqual({ ok: true, value: base })
    expect(parseResultsInput({ ...base, channelId: '777000000000000002', confirmDuplicate: true })).toEqual({ ok: true, value: { ...base, channelId: '777000000000000002', confirmDuplicate: true } })
    expect(parseResultsInput({ ...base, confirmDuplicate: false })).toEqual({ ok: true, value: base }) // false is dropped, never sent
  })

  it('refuses a channel that is not an id and a confirmation that is not a boolean', () => {
    expect(parseResultsInput({ ...base, channelId: 'results' }).ok).toBe(false)
    expect(parseResultsInput({ ...base, confirmDuplicate: 'yes' }).ok).toBe(false)
    expect(parseResultsInput({ ...base, confirmDuplicate: 1 }).ok).toBe(false)
  })
})
