import { describe, expect, it } from 'vitest'
import type { CalendarRound } from '../../shared/types'
import { sortRows } from './tableView'
import { addRoundBlocker, dateSortValue, matchesDateFilter, ROUND_GETTERS, roundLabel, timeSortValue } from './calendarView'

const round = (over: Partial<CalendarRound> = {}): CalendarRound => ({ round: 1, name: 'Australian GP', date: '15/03/2026', time: '19:30', flag: 'AU', eventType: 'Normal Race', ...over })

describe('calendar sorting', () => {
  it('sorts dates by day, not as text, and TBD always last (also when descending)', () => {
    const rounds = [round({ round: 1, date: '02/12/2026' }), round({ round: 2, date: 'TBD', time: '' }), round({ round: 3, date: '15/03/2027' }), round({ round: 4, date: '28/02/2026' })]
    expect(sortRows(rounds, { key: 'date', direction: 'asc' }, ROUND_GETTERS).map((r) => r.round)).toEqual([4, 1, 3, 2])
    expect(sortRows(rounds, { key: 'date', direction: 'desc' }, ROUND_GETTERS).map((r) => r.round)).toEqual([3, 1, 4, 2])
  })

  it('uses the time as tie-break on the same day, and an empty time sorts last in the time column', () => {
    const rounds = [round({ round: 1, time: '20:00' }), round({ round: 2, time: '' }), round({ round: 3, time: '09:15' })]
    expect(sortRows(rounds, { key: 'date', direction: 'asc' }, ROUND_GETTERS).map((r) => r.round)).toEqual([2, 3, 1])
    expect(sortRows(rounds, { key: 'time', direction: 'asc' }, ROUND_GETTERS).map((r) => r.round)).toEqual([3, 1, 2])
  })

  it('sorts round numbers numerically and keeps the gaps', () => {
    const rounds = [round({ round: 10 }), round({ round: 2 }), round({ round: 1 }), round({ round: 9 })]
    expect(sortRows(rounds, { key: 'round', direction: 'asc' }, ROUND_GETTERS).map((r) => r.round)).toEqual([1, 2, 9, 10])
  })

  it('reads dates and times, and refuses garbage', () => {
    expect(dateSortValue('15/03/2026')).toBe(20260315)
    expect(dateSortValue('TBD')).toBeNull()
    expect(dateSortValue('next week')).toBeNull()
    expect(timeSortValue('19:30')).toBe(1170)
    expect(timeSortValue('')).toBeNull()
  })
})

describe('calendar filters and limits', () => {
  it('TBD filter finds rounds with a TBD date or time', () => {
    expect(matchesDateFilter(round({ date: 'TBD' }), 'tbd')).toBe(true)
    expect(matchesDateFilter(round({ time: '' }), 'tbd')).toBe(true)
    expect(matchesDateFilter(round(), 'tbd')).toBe(false)
    expect(matchesDateFilter(round(), 'dated')).toBe(true)
    expect(matchesDateFilter(round({ time: '' }), 'dated')).toBe(false)
    expect(matchesDateFilter(round({ date: 'TBD' }), 'all')).toBe(true)
  })

  it('blocks adding a round at 25 rounds, and says why', () => {
    expect(addRoundBlocker({ rounds: Array.from({ length: 24 }, (_, index) => round({ round: index + 1 })) })).toBeNull()
    expect(addRoundBlocker({ rounds: Array.from({ length: 25 }, (_, index) => round({ round: index + 1 })) })).toMatch(/maximum of 25/)
  })

  it('names a round with the number the server returned', () => {
    expect(roundLabel({ round: 4, name: 'Dutch GP' })).toBe('Round 4 - Dutch GP')
  })
})
