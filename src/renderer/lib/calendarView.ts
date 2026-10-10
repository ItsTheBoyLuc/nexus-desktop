import { ROUND_LIMITS } from '../../shared/f1Validation'
import type { Calendar, CalendarRound } from '../../shared/types'

/** Pure helpers of the calendar screen, kept free of React so they can be tested. */

export const isTbdDate = (date: string): boolean => date.trim().toUpperCase() === 'TBD'

/** A sortable number (yyyymmdd) for "DD/MM/YYYY"; null for TBD or anything unreadable, so those rows always sort last. */
export function dateSortValue(date: string): number | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date.trim())
  if (!match) return null
  return Number(match[3]) * 10_000 + Number(match[2]) * 100 + Number(match[1])
}

/** "HH:MM" as minutes; null when the time is TBD (empty). */
export function timeSortValue(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export type CalendarColumn = 'round' | 'name' | 'date' | 'time' | 'type'

export const ROUND_GETTERS: Record<CalendarColumn, (round: CalendarRound) => string | number | null> = {
  round: (round) => round.round,
  name: (round) => round.name,
  // A date sorts by its day, with the time as tie-break, so a sprint weekend with an earlier time comes first.
  date: (round) => {
    const day = dateSortValue(round.date)
    return day === null ? null : day * 10_000 + (timeSortValue(round.time) ?? 0)
  },
  time: (round) => timeSortValue(round.time),
  type: (round) => round.eventType
}

export type DateFilter = 'all' | 'dated' | 'tbd'

export function matchesDateFilter(round: CalendarRound, filter: DateFilter): boolean {
  if (filter === 'all') return true
  return filter === 'tbd' ? isTbdDate(round.date) || round.time === '' : !isTbdDate(round.date) && round.time !== ''
}

/** Why no round can be added, or null when one can. */
export function addRoundBlocker(calendar: Pick<Calendar, 'rounds'>): string | null {
  return calendar.rounds.length >= ROUND_LIMITS.maxRounds ? `The calendar already has the maximum of ${ROUND_LIMITS.maxRounds} rounds. Delete a round to add another.` : null
}

/** How a round is named in a sentence: "Round 3 - Dutch GP". The number is the one the server returned. */
export function roundLabel(round: Pick<CalendarRound, 'round' | 'name'>): string {
  return `Round ${round.round} - ${round.name}`
}
