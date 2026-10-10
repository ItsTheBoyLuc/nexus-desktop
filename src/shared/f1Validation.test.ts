import { describe, expect, it } from 'vitest'
import {
  draftOfPoints,
  draftOfRound,
  isRealDate,
  normaliseRoundDate,
  parseDriverNumber,
  parseMemberQuery,
  pointsChanged,
  validateDriverDraft,
  validatePointsDraft,
  validateResultsDraft,
  validateRoundDraft,
  validateRoundEdit,
  validateTeamDraft
} from './f1Validation'
import type { PointsDraft, ResultsDraft, RoundDraft } from './f1Validation'
import {
  parseAddDriverInput,
  parseMemberSearchQuery,
  parsePointsSystemInput,
  parseResultsInput,
  parseRoundCreateInput,
  parseRoundNumber,
  parseRoundPatch,
  parseTeamInput,
  parseTeamPathName
} from './inputs'
import type { CalendarRound } from './types'

const U = (n: number): string => `20000000000000000${n}`.slice(-18)

describe('round dates', () => {
  it('accepts real DD/MM/YYYY dates (leap years included) and TBD in any case, and pads one-digit parts', () => {
    expect(normaliseRoundDate('15/03/2026')).toBe('15/03/2026')
    expect(normaliseRoundDate('29/02/2028')).toBe('29/02/2028')
    expect(normaliseRoundDate('5/3/2026')).toBe('05/03/2026')
    expect(normaliseRoundDate(' tbd ')).toBe('TBD')
    expect(normaliseRoundDate('TBD')).toBe('TBD')
  })

  it('refuses dates that do not exist or are not in the documented format', () => {
    for (const bad of ['31/02/2026', '29/02/2027', '00/01/2026', '32/01/2026', '15/13/2026', '15-03-2026', '2026-03-15', '15/03/26', '15/03/20266', '', 'soon', '15/03/2026 19:30']) {
      expect(normaliseRoundDate(bad), bad).toBeNull()
    }
    expect(isRealDate(31, 4, 2026)).toBe(false)
    expect(isRealDate(30, 4, 2026)).toBe(true)
  })
})

describe('calendar round form (create)', () => {
  const ok: RoundDraft = { name: 'Australian GP', date: '15/03/2026', dateTbd: false, time: '19:30', flag: 'AU', eventType: 'Sprint Weekend', round: '' }

  it('trims and accepts valid input; the round number is left out unless given', () => {
    expect(validateRoundDraft({ ...ok, name: '  Australian GP ', flag: ' AU ' })).toEqual({
      ok: true,
      value: { name: 'Australian GP', date: '15/03/2026', time: '19:30', flag: 'AU', eventType: 'Sprint Weekend' }
    })
    expect(validateRoundDraft({ ...ok, round: '7' })).toMatchObject({ ok: true, value: { round: 7 } })
  })

  it('"Date to be decided" sends TBD whatever is in the date box; time and flag may be empty', () => {
    expect(validateRoundDraft({ ...ok, dateTbd: true, date: 'garbage', time: '', flag: '' })).toMatchObject({ ok: true, value: { date: 'TBD', time: '', flag: '' } })
  })

  it('enforces the backend limits: name 1-100 on one line, real date, HH:MM, flag <= 8, exact event type, round 1-99', () => {
    expect(validateRoundDraft({ ...ok, name: 'x'.repeat(100) }).ok).toBe(true)
    const result = validateRoundDraft({ name: '', date: '31/02/2026', dateTbd: false, time: '7pm', flag: '123456789', eventType: 'sprint weekend', round: '100' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['date', 'eventType', 'flag', 'name', 'round', 'time'])
    for (const name of ['x'.repeat(101), 'a\nb', 'a\u0000b']) expect(validateRoundDraft({ ...ok, name }).ok, JSON.stringify(name)).toBe(false)
    for (const time of ['24:00', '19:60', '9:30', '19:30:00', '1930']) expect(validateRoundDraft({ ...ok, time }).ok, time).toBe(false)
    for (const round of ['0', '100', '-1', '1.5', 'a', '007']) expect(validateRoundDraft({ ...ok, round }).ok, round).toBe(false)
    for (const eventType of ['Normal Race', 'Sprint Weekend', 'Full Qualifying']) expect(validateRoundDraft({ ...ok, eventType }).ok, eventType).toBe(true)
    for (const eventType of ['', 'Race', 'normal race', 'Sprint']) expect(validateRoundDraft({ ...ok, eventType }).ok, eventType).toBe(false)
  })

  it('counts characters like the backend: a flag emoji is one character, not two', () => {
    expect(validateRoundDraft({ ...ok, flag: '\u{1F1E6}\u{1F1FA}' }).ok).toBe(true) // regional indicators A + U
    expect(validateRoundDraft({ ...ok, flag: '\u{1F1E6}'.repeat(8) }).ok).toBe(true)
    expect(validateRoundDraft({ ...ok, flag: '\u{1F1E6}'.repeat(9) }).ok).toBe(false)
  })
})

describe('calendar round form (edit)', () => {
  const current: CalendarRound = { round: 3, name: 'Dutch GP', date: '30/08/2026', time: '19:30', flag: 'NL', eventType: 'Normal Race' }

  it('sends only the fields that really changed; no change means an empty patch', () => {
    expect(validateRoundEdit(draftOfRound(current), current)).toEqual({ ok: true, value: {} })
    expect(validateRoundEdit({ ...draftOfRound(current), name: ' Zandvoort GP ', eventType: 'Sprint Weekend' }, current)).toEqual({
      ok: true,
      value: { name: 'Zandvoort GP', eventType: 'Sprint Weekend' }
    })
  })

  it('can clear the time and the flag, and switch a date to TBD and back', () => {
    expect(validateRoundEdit({ ...draftOfRound(current), time: '', flag: '' }, current)).toEqual({ ok: true, value: { time: '', flag: '' } })
    expect(validateRoundEdit({ ...draftOfRound(current), dateTbd: true }, current)).toEqual({ ok: true, value: { date: 'TBD' } })
    const tbd = { ...current, date: 'TBD' }
    expect(draftOfRound(tbd)).toMatchObject({ dateTbd: true, date: '' })
    expect(validateRoundEdit({ ...draftOfRound(tbd), dateTbd: false, date: '01/09/2026' }, tbd)).toEqual({ ok: true, value: { date: '01/09/2026' } })
  })

  it('checks the fields that changed, and lets odd legacy values in untouched fields pass', () => {
    expect(validateRoundEdit({ ...draftOfRound(current), time: '25:00' }, current).ok).toBe(false)
    const legacy = { ...current, date: 'next week' }
    expect(validateRoundEdit({ ...draftOfRound(legacy), name: 'Renamed' }, legacy)).toEqual({ ok: true, value: { name: 'Renamed' } })
    expect(validateRoundEdit({ ...draftOfRound(legacy), date: 'still not a date' }, legacy).ok).toBe(false)
  })

  it('an event type the backend does not know falls back to Normal Race in the form', () => {
    expect(draftOfRound({ ...current, eventType: 'Endurance' }).eventType).toBe('Normal Race')
  })
})

describe('team form', () => {
  it('trims, upper-cases the colour and the abbreviation', () => {
    expect(validateTeamDraft({ name: ' Red Racing ', color: '#ff0000', abbreviation: ' red ' })).toEqual({ ok: true, value: { name: 'Red Racing', color: '#FF0000', abbreviation: 'RED' } })
  })

  it('name 1-50 on one line without / or \\; colour #RRGGBB; abbreviation 1-6 letters or digits', () => {
    expect(validateTeamDraft({ name: 'x'.repeat(50), color: '#000000', abbreviation: 'A1B2C3' }).ok).toBe(true)
    for (const name of ['', 'x'.repeat(51), 'a/b', 'a\\b', 'a\nb']) expect(validateTeamDraft({ name, color: '#000000', abbreviation: 'RED' }).ok, JSON.stringify(name)).toBe(false)
    for (const color of ['red', '#ff00', '#ff00000', 'ff0000', '#gg0000', '']) expect(validateTeamDraft({ name: 'T', color, abbreviation: 'RED' }).ok, color).toBe(false)
    for (const abbreviation of ['', 'ABCDEFG', 'AB-C', 'A B', 'É']) expect(validateTeamDraft({ name: 'T', color: '#000000', abbreviation }).ok, abbreviation).toBe(false)
  })

  it('team names that cannot be a URL segment are not addressable', () => {
    expect(parseTeamPathName('Red Racing').ok).toBe(true)
    for (const name of ['a/b', 'a\\b', '', ' padded ', 'x'.repeat(51), 5, null]) expect(parseTeamPathName(name).ok, String(name)).toBe(false)
  })
})

describe('driver form', () => {
  it('needs a chosen member; the number is optional, 0-999', () => {
    expect(validateDriverDraft({ userId: U(1), number: '' })).toEqual({ ok: true, value: { userId: U(1) } })
    expect(validateDriverDraft({ userId: U(1), number: ' 44 ' })).toEqual({ ok: true, value: { userId: U(1), number: 44 } })
    expect(validateDriverDraft({ userId: U(1), number: '0' })).toEqual({ ok: true, value: { userId: U(1), number: 0 } })
    expect(validateDriverDraft({ userId: U(1), number: '999' }).ok).toBe(true)
    for (const number of ['1000', '-1', '4.5', 'x', '1e2']) expect(validateDriverDraft({ userId: U(1), number }).ok, number).toBe(false)
    const result = validateDriverDraft({ userId: '', number: 'x' })
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['number', 'userId'])
    expect(parseDriverNumber('')).toBeNull()
    expect(parseDriverNumber('12')).toBe(12)
    expect(parseDriverNumber('1000')).toBeUndefined()
  })

  it('the member search takes 1-32 characters', () => {
    expect(parseMemberQuery(' al ')).toBe('al')
    expect(parseMemberQuery('x'.repeat(32))).toBe('x'.repeat(32))
    for (const q of ['', '   ', 'x'.repeat(33), 'a\nb']) expect(parseMemberQuery(q), JSON.stringify(q)).toBeNull()
    expect(parseMemberSearchQuery('al').ok).toBe(true)
    expect(parseMemberSearchQuery(5).ok).toBe(false)
  })
})

describe('race results form', () => {
  const ok: ResultsDraft = { season: '5', round: '3', circuit: 'Zandvoort', drivers: [U(1), U(2), U(3)], fastestLap: U(2), pole: U(1) }

  it('accepts a complete race; fastest lap and pole are optional', () => {
    expect(validateResultsDraft(ok)).toEqual({ ok: true, value: { season: '5', round: '3', circuit: 'Zandvoort', results: [U(1), U(2), U(3)], fastestLap: U(2), pole: U(1) } })
    expect(validateResultsDraft({ ...ok, fastestLap: '', pole: '' })).toEqual({ ok: true, value: { season: '5', round: '3', circuit: 'Zandvoort', results: [U(1), U(2), U(3)] } })
  })

  it('season <= 20, round <= 10, circuit <= 60 characters, all required and on one line', () => {
    expect(validateResultsDraft({ ...ok, season: 'x'.repeat(20), round: 'y'.repeat(10), circuit: 'z'.repeat(60) }).ok).toBe(true)
    for (const patch of [{ season: '' }, { season: 'x'.repeat(21) }, { round: '' }, { round: 'y'.repeat(11) }, { circuit: '' }, { circuit: 'z'.repeat(61) }, { circuit: 'a\nb' }]) {
      expect(validateResultsDraft({ ...ok, ...patch }).ok, JSON.stringify(patch)).toBe(false)
    }
  })

  it('1-20 distinct drivers, every position filled', () => {
    const twenty = Array.from({ length: 20 }, (_, index) => U(index + 1))
    expect(validateResultsDraft({ ...ok, drivers: twenty, fastestLap: '', pole: '' }).ok).toBe(true)
    expect(validateResultsDraft({ ...ok, drivers: [...twenty, U(21)], fastestLap: '', pole: '' }).ok).toBe(false)
    expect(validateResultsDraft({ ...ok, drivers: [], fastestLap: '', pole: '' }).ok).toBe(false)
    expect(validateResultsDraft({ ...ok, drivers: [U(1), '', U(3)] }).ok).toBe(false) // an empty position
    const twice = validateResultsDraft({ ...ok, drivers: [U(1), U(2), U(1)] })
    expect(twice.ok).toBe(false)
    if (!twice.ok) expect(twice.errors.positions).toMatch(/once/)
  })

  it('fastest lap and pole must be drivers in the results (chosen from the picker, never free text)', () => {
    const result = validateResultsDraft({ ...ok, fastestLap: U(9), pole: 'Max' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['fastestLap', 'pole'])
  })
})

describe('points system form', () => {
  const system = { points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], pole: 0, fastestLap: 1 }
  const draft = (): PointsDraft => draftOfPoints(system)

  it('round-trips what the server holds and sends all 20 positions', () => {
    const result = validatePointsDraft(draft())
    expect(result).toEqual({ ok: true, value: system })
    expect(pointsChanged(system, system)).toBe(false)
  })

  it('whole numbers 0-1000 for every position, the pole and the fastest lap', () => {
    const high = draft()
    high.points[0] = '1000'
    high.pole = '1000'
    expect(validatePointsDraft(high).ok).toBe(true)
    for (const bad of ['', '-1', '1001', '1.5', 'x', '1e2', ' ']) {
      const attempt = draft()
      attempt.points[4] = bad
      attempt.fastestLap = bad
      const result = validatePointsDraft(attempt)
      expect(result.ok, JSON.stringify(bad)).toBe(false)
      if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['fastestLap', 'p5'])
    }
    const short = draft()
    short.points = short.points.slice(0, 19)
    expect(validatePointsDraft(short).ok).toBe(false) // all 20 are required
  })

  it('detects a real change', () => {
    const edited = { ...system, points: [...system.points] }
    edited.points[2] = 14
    expect(pointsChanged(edited, system)).toBe(true)
    expect(pointsChanged({ ...system, pole: 1 }, system)).toBe(true)
  })
})

describe('IPC inputs are re-checked in the main process', () => {
  it('round create / patch / number', () => {
    expect(parseRoundCreateInput({ name: 'A', date: '15/03/2026', time: '', flag: '', eventType: 'Normal Race' }).ok).toBe(true)
    expect(parseRoundCreateInput({ name: 'A', date: '15/03/2026', time: '', flag: '', eventType: 'Hill Climb' }).ok).toBe(false)
    expect(parseRoundCreateInput({ name: 'A', date: 'TBD', time: '', flag: '', eventType: 'Normal Race', round: 100 }).ok).toBe(false)
    expect(parseRoundCreateInput(null).ok).toBe(false)
    expect(parseRoundPatch({ time: '' })).toEqual({ ok: true, value: { time: '' } })
    expect(parseRoundPatch({ date: '31/02/2026' }).ok).toBe(false)
    expect(parseRoundPatch({}).ok).toBe(false)
    expect(parseRoundPatch({ name: '' }).ok).toBe(false)
    expect(parseRoundNumber(3).ok).toBe(true)
    for (const bad of [0, 100, 1.5, '3', null]) expect(parseRoundNumber(bad).ok, String(bad)).toBe(false)
  })

  it('team, driver, results and points', () => {
    expect(parseTeamInput({ name: 'Red', color: '#ff0000', abbreviation: 'red' }).ok).toBe(true)
    expect(parseTeamInput({ name: 'a/b', color: '#ff0000', abbreviation: 'red' }).ok).toBe(false)
    expect(parseAddDriverInput({ userId: U(1), number: 7 })).toEqual({ ok: true, value: { userId: U(1), number: 7 } })
    expect(parseAddDriverInput({ userId: 'alice' }).ok).toBe(false)
    expect(parseResultsInput({ season: '5', round: '3', circuit: 'Z', results: [U(1)] }).ok).toBe(true)
    expect(parseResultsInput({ season: '5', round: '3', circuit: 'Z', results: ['alice'] }).ok).toBe(false) // a name instead of an id
    expect(parseResultsInput({ season: '5', round: '3', circuit: 'Z', results: [U(1)], fastestLap: 'Max' }).ok).toBe(false)
    expect(parseResultsInput({ season: '5', round: '3', circuit: 'Z', results: 'x' }).ok).toBe(false)
    const points = { points: Array(20).fill(1) as number[], pole: 0, fastestLap: 1 }
    expect(parsePointsSystemInput(points)).toEqual({ ok: true, value: points })
    expect(parsePointsSystemInput({ ...points, points: [1, 2] }).ok).toBe(false)
    expect(parsePointsSystemInput({ ...points, pole: -1 }).ok).toBe(false)
    expect(parsePointsSystemInput({ ...points, fastestLap: '1' }).ok).toBe(false)
  })
})
