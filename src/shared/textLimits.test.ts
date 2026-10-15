import { describe, expect, it } from 'vitest'
import { parsePostInput, parseSignupInput } from './attendanceInputs'
import { validatePostDraft, validateSignupDraft } from './attendanceValidation'
import { parseClearInput, parseDecisionInput, parseManualPointsInput } from './penaltyInputs'
import { paragraphProblem, validateClearDraft, validateDecisionDraft, validateManualPointsDraft } from './penaltyValidation'
import { parseRacingAttendanceInput, parseRacingEventInput, parseRacingResultInput } from './racingInputs'
import { RACING_LIMITS, resultTextLength, validateRacingAttendanceDraft, validateRacingEventDraft, validateRacingResultDraft } from './racingValidation'
import { TEXT_LIMITS, utf16Units } from './textLimits'
import { codePointLength, escapedLength } from './validation'

/**
 * The long free-text limits of docs/APP_API.md ("Text limits", "Raised in this version"): every field accepts exactly its
 * limit and refuses one more, in the form check AND in the main-process re-check, and the old 300 (200, 500, 1000) boundary
 * is gone. The numbers come from TEXT_LIMITS, the one place that holds them; the literals below pin that file to the docs.
 */
const CH = '777000000000000001'
const x = (length: number): string => 'x'.repeat(length)
/** A refusal names the field it refused. */
const refusedFields = (result: { ok: boolean; errors?: Record<string, string | undefined> }): string[] => (result.ok ? [] : Object.keys(result.errors ?? {}))

describe('the numbers are the ones in docs/APP_API.md', () => {
  it('matches the table "Raised in this version"', () => {
    expect(TEXT_LIMITS).toEqual({
      eventNotes: 911,
      resultNotes: 714,
      resultCombined: 1014,
      racingAttendanceDescription: 3645,
      f1AttendanceDescription: 2520,
      signupDescription: 4096,
      penaltyPointsReason: 1024,
      penaltyClearReason: 4000,
      decisionExplanation: 1024,
      decisionDescription: 1024
    })
  })
  it('the 1014 of a result is 1024 minus 10 of layout, and the notes limit is that minus result (100) and drivers (200)', () => {
    expect(TEXT_LIMITS.resultCombined).toBe(1024 - 10)
    expect(TEXT_LIMITS.resultNotes).toBe(TEXT_LIMITS.resultCombined - 100 - 200)
    expect(TEXT_LIMITS.eventNotes).toBe(1024 - 113)
  })
  it('a parser keeps room for a text full of emoji (two UTF-16 units each)', () => {
    expect(utf16Units(TEXT_LIMITS.signupDescription)).toBe(8192)
  })
})

describe('each changed field accepts exactly the limit and refuses one more', () => {
  const event = { name: 'Daytona 24', date: '2030-09-14', time: '20:00', zone: 'UTC', class: '', notes: '' }
  const result = { team: 'Apex', eventName: 'Daytona 24', result: 'P3', drivers: 'alice', notes: '' }
  const post = { channelId: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort', description: '' }
  const signup = { title: 'Season 16', description: '', channelId: CH, confirmationChannelId: '', closeDate: '' }
  const decision = { decision: 'no_further_action' as const, description: '', explanation: '', driver: '', points: '', season: '' }
  const manual = { driver: 'alice', penaltyType: 'Drive-Through', points: '3', reason: '', season: '', channelId: '' }
  const clear = { driver: 'alice', mode: 'all' as const, points: '', reason: '', season: '' }

  it.each([
    ['events: notes', 911, (text: string) => validateRacingEventDraft({ ...event, notes: text }), 'notes'],
    ['results: notes', 714, (text: string) => validateRacingResultDraft({ ...result, notes: text }), 'notes'],
    ['esports attendance: description', 3645, (text: string) => validateRacingAttendanceDraft({ channelId: CH, name: 'Practice', date: 'Tuesday', description: text }), 'description'],
    ['F1 attendance post: description', 2520, (text: string) => validatePostDraft({ ...post, description: text }), 'description'],
    ['sign-up: description', 4096, (text: string) => validateSignupDraft({ ...signup, description: text }), 'description'],
    ['penalty points: reason', 1024, (text: string) => validateManualPointsDraft({ ...manual, reason: text }), 'reason'],
    ['clear points: reason', 4000, (text: string) => validateClearDraft({ ...clear, reason: text }), 'reason'],
    ['decision: explanation', 1024, (text: string) => validateDecisionDraft({ ...decision, explanation: text }), 'explanation'],
    ['decision: penalty description', 1024, (text: string) => validateDecisionDraft({ ...decision, decision: 'penalty_issued', description: text, driver: 'alice', points: '1' }), 'description']
  ])('%s (%i)', (_name, limit, validate, field) => {
    expect(validate(x(limit)).ok).toBe(true)
    expect(refusedFields(validate(x(limit + 1)))).toEqual([field])
  })

  it('the old boundaries are gone: 300, 200, 500 and 1000 characters are fine now', () => {
    expect(validateRacingEventDraft({ ...event, notes: x(301) }).ok).toBe(true)
    expect(validateRacingResultDraft({ ...result, notes: x(301) }).ok).toBe(true)
    expect(validateRacingAttendanceDraft({ channelId: CH, name: 'Practice', date: 'Tuesday', description: x(301) }).ok).toBe(true)
    expect(validatePostDraft({ ...post, description: x(201) }).ok).toBe(true)
    expect(validateSignupDraft({ ...signup, description: x(1001) }).ok).toBe(true)
    expect(validateManualPointsDraft({ ...manual, reason: x(301) }).ok).toBe(true)
    expect(validateClearDraft({ ...clear, reason: x(301) }).ok).toBe(true)
    expect(validateDecisionDraft({ ...decision, explanation: x(501) }).ok).toBe(true)
    expect(validateDecisionDraft({ ...decision, decision: 'penalty_issued', description: x(501), driver: 'alice', points: '1' }).ok).toBe(true)
  })

  it('the main process re-checks the same limits (what the renderer sends is not trusted)', () => {
    expect(parseRacingEventInput({ name: 'Daytona 24', date: '2030-09-14', time: '20:00 UTC', notes: x(911) }).ok).toBe(true)
    expect(parseRacingEventInput({ name: 'Daytona 24', date: '2030-09-14', time: '20:00 UTC', notes: x(912) }).ok).toBe(false)
    expect(parseRacingResultInput({ team: 'Apex', eventName: 'Daytona', result: 'P3', drivers: 'alice', notes: x(714) }).ok).toBe(true)
    expect(parseRacingResultInput({ team: 'Apex', eventName: 'Daytona', result: 'P3', drivers: 'alice', notes: x(715) }).ok).toBe(false)
    expect(parseRacingAttendanceInput({ channelId: CH, name: 'Practice', date: 'Tuesday', description: x(3645) }).ok).toBe(true)
    expect(parseRacingAttendanceInput({ channelId: CH, name: 'Practice', date: 'Tuesday', description: x(3646) }).ok).toBe(false)
    expect(parsePostInput({ channelId: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort', description: x(2520) }).ok).toBe(true)
    expect(parsePostInput({ channelId: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort', description: x(2521) }).ok).toBe(false)
    expect(parseSignupInput({ title: 'Season 16', channelId: CH, description: x(4096) }).ok).toBe(true)
    expect(parseSignupInput({ title: 'Season 16', channelId: CH, description: x(4097) }).ok).toBe(false)
    expect(parseManualPointsInput({ driver: 'alice', penaltyType: 'Drive-Through', points: 3, reason: x(1024) }).ok).toBe(true)
    expect(parseManualPointsInput({ driver: 'alice', penaltyType: 'Drive-Through', points: 3, reason: x(1025) }).ok).toBe(false)
    expect(parseClearInput({ driver: 'alice', reason: x(4000), confirm: true }).ok).toBe(true)
    expect(parseClearInput({ driver: 'alice', reason: x(4001), confirm: true }).ok).toBe(false)
    expect(parseDecisionInput({ decision: 'no_further_action', explanation: x(1024) }).ok).toBe(true)
    expect(parseDecisionInput({ decision: 'no_further_action', explanation: x(1025) }).ok).toBe(false)
    expect(parseDecisionInput({ decision: 'penalty_issued', description: x(1024), penaltyPoints: 0 }).ok).toBe(true)
    expect(parseDecisionInput({ decision: 'penalty_issued', description: x(1025), penaltyPoints: 0 }).ok).toBe(false)
  })

  it('the text is trimmed first: the limit applies to what is sent, not to the spaces around it', () => {
    expect(validateSignupDraft({ ...signup, description: `  ${x(4096)}  ` }).ok).toBe(true)
  })

  it('a character is one Unicode character: an emoji counts 1, so a full text of emoji is accepted', () => {
    expect(validateSignupDraft({ ...signup, description: '\u{1F3C1}'.repeat(4096) }).ok).toBe(true)
    expect(validateSignupDraft({ ...signup, description: '\u{1F3C1}'.repeat(4097) }).ok).toBe(false)
  })

  it('text stays plain text: markup is just characters and counts like any other', () => {
    expect(validateSignupDraft({ ...signup, description: '<b>x</b>'.repeat(10) })).toMatchObject({ ok: true, value: { description: '<b>x</b>'.repeat(10) } })
  })
})

describe('the fields marked with a star in the docs count each underscore as 2', () => {
  const event = { name: 'Daytona 24', date: '2030-09-14', time: '20:00', zone: 'UTC', class: '', notes: '' }
  const result = { team: 'Apex', eventName: 'Daytona 24', result: 'P3', drivers: 'alice', notes: '' }

  it('escapedLength', () => {
    expect(escapedLength('a_b')).toBe(4)
    expect(escapedLength('___')).toBe(6)
    expect(codePointLength('___')).toBe(3)
    expect(escapedLength('\u{1F3C1}_')).toBe(3)
  })

  it('event notes: 455 underscores fit (910), 456 do not (912), although 456 < 911 characters', () => {
    expect(validateRacingEventDraft({ ...event, notes: '_'.repeat(455) }).ok).toBe(true)
    expect(validateRacingEventDraft({ ...event, notes: `${'_'.repeat(455)}x` }).ok).toBe(true) // 911 exactly
    expect(refusedFields(validateRacingEventDraft({ ...event, notes: '_'.repeat(456) }))).toEqual(['notes'])
  })

  it('manual points reason and both decision texts count underscores twice too', () => {
    const manual = { driver: 'alice', penaltyType: 'Drive-Through', points: '3', reason: '', season: '', channelId: '' }
    expect(validateManualPointsDraft({ ...manual, reason: '_'.repeat(512) }).ok).toBe(true)
    expect(refusedFields(validateManualPointsDraft({ ...manual, reason: '_'.repeat(513) }))).toEqual(['reason'])
    const decision = { decision: 'no_further_action' as const, description: '', explanation: '', driver: '', points: '', season: '' }
    expect(validateDecisionDraft({ ...decision, explanation: '_'.repeat(512) }).ok).toBe(true)
    expect(refusedFields(validateDecisionDraft({ ...decision, explanation: '_'.repeat(513) }))).toEqual(['explanation'])
    expect(refusedFields(validateDecisionDraft({ ...decision, decision: 'penalty_issued', description: '_'.repeat(513), driver: 'alice', points: '1' }))).toEqual(['description'])
  })

  it('a field that is NOT marked counts an underscore as 1 (sign-up and attendance descriptions, the clear reason)', () => {
    expect(validateSignupDraft({ title: 'Season 16', description: '_'.repeat(4096), channelId: CH, confirmationChannelId: '', closeDate: '' }).ok).toBe(true)
    expect(validateClearDraft({ driver: 'alice', mode: 'all', points: '', reason: '_'.repeat(4000), season: '' }).ok).toBe(true)
  })

  it('result + drivers + notes share one field: together at most 1014 (underscores twice), on top of the 714 of the notes', () => {
    // 100 + 200 + 714 = 1014: all three at their own maximum just fit
    const full = { ...result, result: x(100), drivers: x(200), notes: x(714) }
    expect(resultTextLength(full)).toBe(1014)
    expect(validateRacingResultDraft(full).ok).toBe(true)
    // underscores in the result and drivers use up room of the notes
    const tight = { ...result, result: '_'.repeat(51), drivers: x(200), notes: x(714) }
    expect(resultTextLength(tight)).toBe(1016)
    expect(refusedFields(validateRacingResultDraft(tight))).toEqual(['notes'])
    expect(validateRacingResultDraft({ ...tight, notes: x(712) }).ok).toBe(true) // 102 + 200 + 712 = 1014
    // short result and drivers leave the rest unused: the notes alone stop at 714
    expect(refusedFields(validateRacingResultDraft({ ...result, notes: x(715) }))).toEqual(['notes'])
    expect(RACING_LIMITS.resultCombinedMax).toBe(TEXT_LIMITS.resultCombined)
  })

  it('the message says each underscore counts as 2 (so a refusal is understood)', () => {
    expect(paragraphProblem('_'.repeat(600), 1, 911, 'the notes', true)).toContain('underscore')
    expect(paragraphProblem(x(912), 1, 911, 'the notes')).not.toContain('underscore')
  })
})
