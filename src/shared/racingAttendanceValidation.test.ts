import { describe, expect, it } from 'vitest'
import { parseRacingAttendanceInput } from './racingInputs'
import { RACING_LIMITS, validateRacingAttendanceDraft } from './racingValidation'

const CH = '777000000000000001'
const good = { channelId: CH, name: 'Tuesday Practice', date: '2026-09-14', description: '' }

describe('validateRacingAttendanceDraft', () => {
  it('accepts a complete post and trims it; an empty description is left out', () => {
    expect(validateRacingAttendanceDraft({ ...good, name: '  Tuesday Practice ', date: ' 2026-09-14 ' })).toEqual({ ok: true, value: { channelId: CH, name: 'Tuesday Practice', date: '2026-09-14' } })
  })

  it('keeps a description, with line breaks', () => {
    expect(validateRacingAttendanceDraft({ ...good, description: 'line one\nline two' })).toMatchObject({ ok: true, value: { description: 'line one\nline two' } })
  })

  it('applies the backend limits exactly: name 100, date 20, description 300', () => {
    expect(validateRacingAttendanceDraft({ ...good, name: 'x'.repeat(RACING_LIMITS.attendanceNameMax) }).ok).toBe(true)
    expect(validateRacingAttendanceDraft({ ...good, name: 'x'.repeat(101) })).toMatchObject({ ok: false, errors: { name: expect.stringContaining('100') } })
    expect(validateRacingAttendanceDraft({ ...good, date: 'x'.repeat(20) }).ok).toBe(true)
    expect(validateRacingAttendanceDraft({ ...good, date: 'x'.repeat(21) })).toMatchObject({ ok: false, errors: { date: expect.stringContaining('20') } })
    expect(validateRacingAttendanceDraft({ ...good, description: 'x'.repeat(300) }).ok).toBe(true)
    expect(validateRacingAttendanceDraft({ ...good, description: 'x'.repeat(301) })).toMatchObject({ ok: false, errors: { description: expect.stringContaining('300') } })
  })

  it('requires a channel, a name and a date, and reports each missing field', () => {
    const result = validateRacingAttendanceDraft({ channelId: '', name: ' ', date: '', description: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['channelId', 'date', 'name'])
  })

  it('only takes a Discord id as the channel', () => {
    expect(validateRacingAttendanceDraft({ ...good, channelId: 'general' }).ok).toBe(false)
    expect(validateRacingAttendanceDraft({ ...good, channelId: '../1' }).ok).toBe(false)
  })

  it('refuses line breaks in the name and the date and control characters everywhere', () => {
    expect(validateRacingAttendanceDraft({ ...good, name: 'a\nb' }).ok).toBe(false)
    expect(validateRacingAttendanceDraft({ ...good, date: 'a\nb' }).ok).toBe(false)
    expect(validateRacingAttendanceDraft({ ...good, description: 'bad\u0007bell' }).ok).toBe(false)
  })

  it('posts the text as typed: formatting characters and emoji codes are not touched', () => {
    expect(validateRacingAttendanceDraft({ ...good, name: '**Practice** :flag:' })).toMatchObject({ ok: true, value: { name: '**Practice** :flag:' } })
  })
})

describe('what the main process accepts over IPC (parsed again)', () => {
  it('parseRacingAttendanceInput applies the same rules and ignores unknown fields', () => {
    expect(parseRacingAttendanceInput({ ...good, extra: 1, game: 'gt7' })).toEqual({ ok: true, value: { channelId: CH, name: 'Tuesday Practice', date: '2026-09-14' } })
    expect(parseRacingAttendanceInput(null).ok).toBe(false)
    expect(parseRacingAttendanceInput({ ...good, name: 5 }).ok).toBe(false)
    expect(parseRacingAttendanceInput({ ...good, channelId: 777 }).ok).toBe(false)
  })
})
