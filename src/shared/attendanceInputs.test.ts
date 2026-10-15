import { describe, expect, it } from 'vitest'
import { TEXT_LIMITS } from './textLimits'
import { parseDivisionInput, parseMessageId, parseParticipantPage, parsePostFiltersInput, parsePostInput, parseQuestionsInput, parseSignupInput, parseSignupStatus } from './attendanceInputs'

/** The main process re-checks everything the renderer sends over IPC, with the same rules as the forms. */
const CH = '777000000000000002'

describe('a division reaches the API with only the lists the renderer included', () => {
  it('passes a list on only when it is there (a missing list is not turned into an empty one)', () => {
    expect(parseDivisionInput({ name: 'Elite', regularDrivers: ['2001'] })).toEqual({ ok: true, value: { name: 'Elite', regularDrivers: ['2001'] } })
    expect(parseDivisionInput({ name: 'Elite', reserveDrivers: ['2003'] })).toEqual({ ok: true, value: { name: 'Elite', reserveDrivers: ['2003'] } })
    expect(parseDivisionInput({ name: 'Elite' })).toEqual({ ok: true, value: { name: 'Elite' } })
    expect(parseDivisionInput({ name: 'Elite', regularDrivers: [] })).toEqual({ ok: true, value: { name: 'Elite', regularDrivers: [] } })
  })

  it('refuses lists that are not lists of valid ids, too long, or with a duplicate', () => {
    for (const bad of [{ regularDrivers: 'alice' }, { regularDrivers: [5] }, { regularDrivers: ['x'] }, { reserveDrivers: ['2001', '2001'] }, { regularDrivers: Array.from({ length: 26 }, (_, i) => String(2000 + i)) }]) {
      expect(parseDivisionInput({ name: 'Elite', ...bad }).ok, JSON.stringify(bad)).toBe(false)
    }
    expect(parseDivisionInput({ name: '', regularDrivers: [] }).ok).toBe(false)
    expect(parseDivisionInput(null).ok).toBe(false)
  })
})

describe('attendance posts', () => {
  const post = { channelId: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort' }
  it('re-validates the post, and accepts a number for season and round like the modal', () => {
    expect(parsePostInput(post)).toEqual({ ok: true, value: post })
    expect(parsePostInput({ ...post, season: 16, round: 5 })).toEqual({ ok: true, value: post })
    for (const bad of [{ channelId: 'x' }, { division: '' }, { circuit: '' }, { season: 'x'.repeat(11) }, { description: 'x'.repeat(TEXT_LIMITS.f1AttendanceDescription + 1) }]) expect(parsePostInput({ ...post, ...bad }).ok, JSON.stringify(bad)).toBe(false)
  })

  it('filters and page size', () => {
    expect(parsePostFiltersInput(undefined)).toEqual({ ok: true, value: {} })
    expect(parsePostFiltersInput({ division: 'Elite', season: '16', limit: 100, offset: 0 })).toEqual({ ok: true, value: { division: 'Elite', season: '16', limit: 100, offset: 0 } })
    for (const bad of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { division: 'x'.repeat(51) }]) expect(parsePostFiltersInput(bad).ok, JSON.stringify(bad)).toBe(false)
  })

  it('a message id is digits only', () => {
    expect(parseMessageId('700000000000000001').ok).toBe(true)
    for (const bad of ['', '../x', 'a/b', 12, undefined]) expect(parseMessageId(bad).ok, String(bad)).toBe(false)
  })
})

describe('sign-up questions, sign-ups and participants', () => {
  it('questions: up to two, no comma, unique, 45 characters', () => {
    expect(parseQuestionsInput(['What is your team?'])).toEqual({ ok: true, value: ['What is your team?'] })
    expect(parseQuestionsInput([])).toEqual({ ok: true, value: [] })
    for (const bad of [['a', 'b', 'c'], ['a,b'], ['x', 'x'], ['x'.repeat(46)], [''], 'text', [5]]) expect(parseQuestionsInput(bad).ok, JSON.stringify(bad)).toBe(false)
  })

  it('a sign-up needs a title and a channel and nothing else; custom per-sign-up questions are not a field', () => {
    expect(parseSignupInput({ title: 'Season 16', channelId: CH })).toEqual({ ok: true, value: { title: 'Season 16', channelId: CH } })
    const withFields = parseSignupInput({ title: 'Season 16', channelId: CH, fields: ['own question'], confirmationChannelId: '777000000000000003', closeDate: '1 June' })
    expect(withFields).toEqual({ ok: true, value: { title: 'Season 16', channelId: CH, confirmationChannelId: '777000000000000003', closeDate: '1 June' } })
    expect(parseSignupInput({ title: '', channelId: CH }).ok).toBe(false)
    expect(parseSignupInput({ title: 'x', channelId: '' }).ok).toBe(false)
  })

  it('status filter and participant page', () => {
    expect(parseSignupStatus(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseSignupStatus('open')).toEqual({ ok: true, value: 'open' })
    expect(parseSignupStatus('archived').ok).toBe(false)
    expect(parseParticipantPage({ limit: 100, offset: 200 })).toEqual({ ok: true, value: { limit: 100, offset: 200 } })
    expect(parseParticipantPage(undefined)).toEqual({ ok: true, value: {} })
    expect(parseParticipantPage({ limit: 500 }).ok).toBe(false)
  })
})
