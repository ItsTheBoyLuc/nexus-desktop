import { describe, expect, it } from 'vitest'
import {
  findOverlap,
  validateDivisionDraft,
  validatePage,
  validatePostDraft,
  validatePostFilters,
  validateQuestions,
  validateSignupDraft
} from './attendanceValidation'
import type { DivisionDraft } from './attendanceValidation'

const CH = '777000000000000002'
import { TEXT_LIMITS } from './textLimits'
const long = (length: number): string => 'x'.repeat(length)
const errorKeys = (result: { ok: boolean; errors?: Record<string, string | undefined> }): string[] => (result.ok ? [] : Object.keys(result.errors ?? {}))

describe('a division: only the lists the user edited are sent', () => {
  const draft = (over: Partial<DivisionDraft> = {}): DivisionDraft => ({ name: 'Elite', regular: ['2001', '2002'], reserve: ['2003'], regularEdited: false, reserveEdited: false, exists: false, ...over })

  it('a list that was not edited is NOT in the value, so the server keeps it', () => {
    expect(validateDivisionDraft(draft({ exists: true, regularEdited: true }))).toEqual({ ok: true, value: { name: 'Elite', regularDrivers: ['2001', '2002'] } })
    expect(validateDivisionDraft(draft({ exists: true, reserveEdited: true }))).toEqual({ ok: true, value: { name: 'Elite', reserveDrivers: ['2003'] } })
    expect(validateDivisionDraft(draft({ exists: true, regularEdited: true, reserveEdited: true }))).toEqual({ ok: true, value: { name: 'Elite', regularDrivers: ['2001', '2002'], reserveDrivers: ['2003'] } })
  })

  it('an edited list that was emptied is sent as [] (that clears it), which is different from leaving it out', () => {
    const cleared = validateDivisionDraft(draft({ exists: true, reserve: [], reserveEdited: true }))
    expect(cleared).toEqual({ ok: true, value: { name: 'Elite', reserveDrivers: [] } })
    expect(cleared.ok && 'regularDrivers' in cleared.value).toBe(false)
  })

  it('changing an existing division without editing a list is refused here (the server would answer no_changes)', () => {
    expect(errorKeys(validateDivisionDraft(draft({ exists: true })))).toEqual(['lists'])
  })

  it('a new division may be created with no list at all (both start empty)', () => {
    expect(validateDivisionDraft(draft({ exists: false }))).toEqual({ ok: true, value: { name: 'Elite' } })
  })

  it('the name is 1 to 50 characters on a single line; a list holds at most 25 distinct valid ids', () => {
    expect(errorKeys(validateDivisionDraft(draft({ name: ' ' })))).toEqual(['name'])
    expect(errorKeys(validateDivisionDraft(draft({ name: long(51) })))).toEqual(['name'])
    expect(errorKeys(validateDivisionDraft(draft({ name: 'two\nlines' })))).toEqual(['name'])
    expect(validateDivisionDraft(draft({ name: long(50) })).ok).toBe(true)
    const ids = Array.from({ length: 26 }, (_, index) => String(2000 + index))
    expect(errorKeys(validateDivisionDraft(draft({ regular: ids, regularEdited: true })))).toEqual(['regular'])
    expect(validateDivisionDraft(draft({ regular: ids.slice(0, 25), regularEdited: true })).ok).toBe(true)
    expect(errorKeys(validateDivisionDraft(draft({ regular: ['2001', '2001'], regularEdited: true })))).toEqual(['regular'])
    expect(errorKeys(validateDivisionDraft(draft({ reserve: ['not-an-id'], reserveEdited: true })))).toEqual(['reserve'])
  })

  it('a list that was not edited is not checked (an old list with an odd entry can still be left alone)', () => {
    expect(validateDivisionDraft(draft({ exists: true, regular: ['bad'], regularEdited: false, reserveEdited: true })).ok).toBe(true)
  })

  it('finds the drivers that are in both lists', () => {
    expect(findOverlap(['2001', '2002', '2002'], ['2002', '2003', '2001'])).toEqual(['2001', '2002'])
    expect(findOverlap(['2001'], ['2003'])).toEqual([])
    expect(findOverlap([], [])).toEqual([])
  })
})

describe('attendance post filters and form', () => {
  it('filters keep only what is filled in', () => {
    expect(validatePostFilters({ division: '', season: '' })).toEqual({ ok: true, value: {} })
    expect(validatePostFilters({ division: ' Elite ', season: '16' })).toEqual({ ok: true, value: { division: 'Elite', season: '16' } })
    expect(errorKeys(validatePostFilters({ division: long(51), season: long(11) })).sort()).toEqual(['division', 'season'])
  })

  const draft = { channelId: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort', description: '' }
  it('builds the request; the description is left out when empty', () => {
    expect(validatePostDraft(draft)).toEqual({ ok: true, value: { channelId: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort' } })
    expect(validatePostDraft({ ...draft, description: ' Sprint weekend ' })).toMatchObject({ ok: true, value: { description: 'Sprint weekend' } })
  })

  it(`applies the documented limits: season and round 1-10, circuit 1-100, description at most ${TEXT_LIMITS.f1AttendanceDescription}, a channel and a division are required`, () => {
    expect(errorKeys(validatePostDraft({ ...draft, channelId: '' }))).toEqual(['channelId'])
    expect(errorKeys(validatePostDraft({ ...draft, division: '' }))).toEqual(['division'])
    expect(errorKeys(validatePostDraft({ ...draft, season: '' }))).toEqual(['season'])
    expect(errorKeys(validatePostDraft({ ...draft, season: long(11) }))).toEqual(['season'])
    expect(errorKeys(validatePostDraft({ ...draft, round: long(11) }))).toEqual(['round'])
    expect(errorKeys(validatePostDraft({ ...draft, circuit: long(101) }))).toEqual(['circuit'])
    expect(errorKeys(validatePostDraft({ ...draft, description: long(TEXT_LIMITS.f1AttendanceDescription + 1) }))).toEqual(['description'])
    expect(validatePostDraft({ ...draft, season: long(10), round: long(10), circuit: long(100), description: long(TEXT_LIMITS.f1AttendanceDescription) }).ok).toBe(true)
  })

  it('text is posted exactly as typed: formatting characters are valid input, nothing is stripped or escaped', () => {
    const result = validatePostDraft({ ...draft, circuit: '**Spa** _Francorchamps_', description: '`code` ~~x~~ <@everyone>' })
    expect(result).toMatchObject({ ok: true, value: { circuit: '**Spa** _Francorchamps_', description: '`code` ~~x~~ <@everyone>' } })
  })
})

describe('the sign-up question rules (comma, uniqueness, 45-character key, limits)', () => {
  it('accepts up to two questions of 1 to 45 characters, and an empty list (it restores the defaults)', () => {
    expect(validateQuestions([])).toMatchObject({ ok: true, value: [] })
    expect(validateQuestions(['What is your team?', 'Referred by'])).toMatchObject({ ok: true, value: ['What is your team?', 'Referred by'] })
    expect(validateQuestions([long(45)]).ok).toBe(true)
    expect(validateQuestions(['  What is your team?  '])).toMatchObject({ ok: true, value: ['What is your team?'] })
  })

  it('refuses a third question, using the limit the server reports', () => {
    const result = validateQuestions(['a', 'b', 'c'])
    expect(result.ok).toBe(false)
    expect(result.general).toMatch(/At most 2 questions/)
    expect(validateQuestions(['a', 'b', 'c'], 3).ok).toBe(true)
  })

  it('refuses a question over the length limit, naming how long it is', () => {
    const result = validateQuestions([long(46)])
    expect(result.rows[0]).toMatch(/at most 45 characters.*has 46/)
    expect(validateQuestions([long(46)], 2, 50).ok).toBe(true)
    expect(validateQuestions(['😀'.repeat(45)]).ok).toBe(true) // code points, like the server
  })

  it('refuses a comma anywhere in a question: the settings split the list on commas', () => {
    const result = validateQuestions(['Team, club or country?'])
    expect(result.ok).toBe(false)
    expect(result.rows[0]).toMatch(/comma/)
  })

  it('refuses an empty question and a question with a line break', () => {
    expect(validateQuestions(['What is your team?', '   ']).rows[1]).toMatch(/Fill in the question/)
    expect(validateQuestions(['two\nlines']).ok).toBe(false)
  })

  it('refuses the same question twice', () => {
    const result = validateQuestions(['Referred by', 'Referred by'])
    expect(result.ok).toBe(false)
    expect(result.rows[1]).toMatch(/already number 1.*unique/)
  })

  it('refuses two questions that share their first 45 characters: they would overwrite one another', () => {
    const stem = long(45)
    // Longer labels only exist when the server allows them; the collision rule is about the 45-character key either way.
    const collide = validateQuestions([`${stem}A`, `${stem}B`], 2, 100)
    expect(collide.ok).toBe(false)
    expect(collide.rows[1]).toMatch(/same 45 characters as question 1/)
    expect(validateQuestions([`${long(44)}A`, `${long(44)}B`], 2, 100).ok).toBe(true) // they differ inside the first 45
  })

  it('reports every problem at once, by position', () => {
    const result = validateQuestions(['a,b', '', 'c'])
    expect(Object.keys(result.rows).map(Number)).toEqual([0, 1])
    expect(result.general).toMatch(/At most 2/)
  })
})

describe('creating a sign-up', () => {
  const draft = { title: 'Season 16 Sign-up', description: '', channelId: CH, confirmationChannelId: '', closeDate: '' }

  it('needs a title and a channel; everything else is left out when empty', () => {
    expect(validateSignupDraft(draft)).toEqual({ ok: true, value: { title: 'Season 16 Sign-up', channelId: CH } })
    expect(validateSignupDraft({ ...draft, description: ' Rules ', confirmationChannelId: '777000000000000003', closeDate: ' 1 June ' })).toEqual({
      ok: true,
      value: { title: 'Season 16 Sign-up', channelId: CH, description: 'Rules', confirmationChannelId: '777000000000000003', closeDate: '1 June' }
    })
  })

  it(`applies the documented limits: title 1-150 on one line, description at most ${TEXT_LIMITS.signupDescription}, close date at most 50`, () => {
    expect(errorKeys(validateSignupDraft({ ...draft, title: '' }))).toEqual(['title'])
    expect(errorKeys(validateSignupDraft({ ...draft, title: long(151) }))).toEqual(['title'])
    expect(errorKeys(validateSignupDraft({ ...draft, title: 'a\nb' }))).toEqual(['title'])
    expect(validateSignupDraft({ ...draft, title: long(150), description: long(TEXT_LIMITS.signupDescription), closeDate: long(50) }).ok).toBe(true)
    expect(errorKeys(validateSignupDraft({ ...draft, description: long(TEXT_LIMITS.signupDescription + 1) }))).toEqual(['description'])
    expect(errorKeys(validateSignupDraft({ ...draft, closeDate: long(51) }))).toEqual(['closeDate'])
    expect(errorKeys(validateSignupDraft({ ...draft, channelId: '' }))).toEqual(['channelId'])
    expect(errorKeys(validateSignupDraft({ ...draft, confirmationChannelId: 'logs' }))).toEqual(['confirmationChannelId'])
  })
})

describe('page requests', () => {
  it('limit 1-100 and offset 0 or more', () => {
    expect(validatePage(undefined, undefined)).toEqual({ ok: true })
    expect(validatePage(100, 200)).toEqual({ ok: true, limit: 100, offset: 200 })
    for (const [limit, offset] of [[0, 0], [101, 0], [1.5, 0], [10, -1], ['10', 0], [10, 'x']]) expect(validatePage(limit, offset).ok, `${String(limit)} ${String(offset)}`).toBe(false)
  })
})
