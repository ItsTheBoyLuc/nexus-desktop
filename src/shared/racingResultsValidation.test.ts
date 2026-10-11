import { describe, expect, it } from 'vitest'
import { parseRacingResultInput, parseRacingResultQuery } from './racingInputs'
import { RACING_LIMITS, validateRacingResultDraft, validateRacingResultQuery } from './racingValidation'

const good = { team: 'Fake Team Alpha', eventName: 'Fake Round 1', result: 'P3 in GT3', drivers: 'Fake Driver 001, Fake Driver 002', notes: '' }

describe('validateRacingResultDraft', () => {
  it('accepts a complete result and trims it; empty notes are left out', () => {
    const result = validateRacingResultDraft({ ...good, team: ' Fake Team Alpha ', eventName: '  Fake Round 1 ' })
    expect(result).toEqual({ ok: true, value: { team: 'Fake Team Alpha', eventName: 'Fake Round 1', result: 'P3 in GT3', drivers: 'Fake Driver 001, Fake Driver 002' } })
  })

  it('keeps notes when given, with line breaks', () => {
    expect(validateRacingResultDraft({ ...good, notes: 'line one\nline two' })).toMatchObject({ ok: true, value: { notes: 'line one\nline two' } })
  })

  it('applies the backend limits exactly: event 100, result 100, drivers 200, notes 300', () => {
    expect(validateRacingResultDraft({ ...good, eventName: 'x'.repeat(RACING_LIMITS.resultEventMax) }).ok).toBe(true)
    expect(validateRacingResultDraft({ ...good, eventName: 'x'.repeat(101) })).toMatchObject({ ok: false, errors: { eventName: expect.stringContaining('100') } })
    expect(validateRacingResultDraft({ ...good, result: 'x'.repeat(100) }).ok).toBe(true)
    expect(validateRacingResultDraft({ ...good, result: 'x'.repeat(101) })).toMatchObject({ ok: false, errors: { result: expect.any(String) } })
    expect(validateRacingResultDraft({ ...good, drivers: 'x'.repeat(200) }).ok).toBe(true)
    expect(validateRacingResultDraft({ ...good, drivers: 'x'.repeat(201) })).toMatchObject({ ok: false, errors: { drivers: expect.stringContaining('200') } })
    expect(validateRacingResultDraft({ ...good, notes: 'x'.repeat(300) }).ok).toBe(true)
    expect(validateRacingResultDraft({ ...good, notes: 'x'.repeat(301) })).toMatchObject({ ok: false, errors: { notes: expect.stringContaining('300') } })
  })

  it('counts characters like the backend (code points), so an emoji is one', () => {
    expect(validateRacingResultDraft({ ...good, result: '\u{1F3C1}'.repeat(100) }).ok).toBe(true)
    expect(validateRacingResultDraft({ ...good, result: '\u{1F3C1}'.repeat(101) }).ok).toBe(false)
  })

  it('requires the team, the event, the result and the drivers, and reports every missing field', () => {
    const result = validateRacingResultDraft({ team: '', eventName: ' ', result: '', drivers: '', notes: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['drivers', 'eventName', 'result', 'team'])
  })

  it('refuses line breaks in the one-line fields and control characters everywhere', () => {
    expect(validateRacingResultDraft({ ...good, eventName: 'a\nb' }).ok).toBe(false)
    expect(validateRacingResultDraft({ ...good, drivers: 'a\nb' }).ok).toBe(false)
    expect(validateRacingResultDraft({ ...good, notes: 'bad\u0007bell' }).ok).toBe(false)
  })

  it('refuses a team name over 50 characters', () => {
    expect(validateRacingResultDraft({ ...good, team: 'x'.repeat(51) })).toMatchObject({ ok: false, errors: { team: expect.any(String) } })
  })

  it('does not interpret the text: html and markdown stay exactly as typed', () => {
    const typed = '<b>Fake</b> **bold** :emoji:'
    expect(validateRacingResultDraft({ ...good, result: typed })).toMatchObject({ ok: true, value: { result: typed } })
  })
})

describe('validateRacingResultQuery', () => {
  it('accepts no team, a team and a page', () => {
    expect(validateRacingResultQuery(undefined, undefined, undefined)).toEqual({ ok: true, value: {} })
    expect(validateRacingResultQuery(' Fake Team ', 100, 200)).toEqual({ ok: true, value: { team: 'Fake Team', limit: 100, offset: 200 } })
    expect(validateRacingResultQuery('', 25, 0)).toEqual({ ok: true, value: { limit: 25, offset: 0 } })
  })

  it('refuses a page size outside 1 to 100, a bad offset and a bad team', () => {
    expect(validateRacingResultQuery(undefined, 0, 0).ok).toBe(false)
    expect(validateRacingResultQuery(undefined, 101, 0).ok).toBe(false)
    expect(validateRacingResultQuery(undefined, 25, -1).ok).toBe(false)
    expect(validateRacingResultQuery('x'.repeat(51), 25, 0).ok).toBe(false)
    expect(validateRacingResultQuery(5, 25, 0).ok).toBe(false)
  })
})

describe('what the main process accepts over IPC (parsed again)', () => {
  it('parseRacingResultInput applies the same rules and ignores unknown fields', () => {
    expect(parseRacingResultInput({ ...good, extra: 'ignored', game: 'gt7' })).toEqual({ ok: true, value: { team: 'Fake Team Alpha', eventName: 'Fake Round 1', result: 'P3 in GT3', drivers: 'Fake Driver 001, Fake Driver 002' } })
    expect(parseRacingResultInput(null).ok).toBe(false)
    expect(parseRacingResultInput('nope').ok).toBe(false)
    expect(parseRacingResultInput({ ...good, drivers: 42 }).ok).toBe(false)
  })

  it('parseRacingResultQuery passes only team, limit and offset', () => {
    expect(parseRacingResultQuery({ team: 'T', limit: 10, offset: 5, other: 1 })).toEqual({ ok: true, value: { team: 'T', limit: 10, offset: 5 } })
    expect(parseRacingResultQuery(undefined)).toEqual({ ok: true, value: {} })
    expect(parseRacingResultQuery({ limit: 1000 }).ok).toBe(false)
  })
})
