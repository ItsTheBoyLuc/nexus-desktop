import { describe, expect, it } from 'vitest'
import type { RacingAttendanceSummary, RacingResult } from '../../shared/types'
import {
  ANNOUNCEMENT_AS_TYPED_TEXT,
  announcementFooter,
  ATTENDANCE_DRIVERS_TOGGLE_TEXT,
  ATTENDANCE_FILTER_OPTIONS,
  ATTENDANCE_GETTERS,
  describeResultCount,
  discordMessageLink,
  matchesAttendanceFilter,
  RESULT_GETTERS,
  RESULT_LOST_TEXT,
  RESULT_TWICE_WARNING,
  resultSearchFields,
  RESULTS_APPEND_ONLY_TEXT
} from './racingView'
import { matchesQuery, nextSort, sortRows } from './tableView'

const result = (over: Partial<RacingResult> = {}): RacingResult => ({
  id: 'r', eventName: 'Fake Round 1', teamName: 'Fake Team Alpha', result: 'P3 in GT3', drivers: 'Fake Driver 001', notes: '', loggedBy: '1', loggedAt: '2026-03-01T10:00:00Z', ...over
})
const post = (over: Partial<RacingAttendanceSummary> = {}, counts = { available: 0, unavailable: 0 }): RacingAttendanceSummary => ({
  messageId: '700000000000000001', name: 'Fake Practice', date: '2026-09-14', description: '', createdBy: '1', createdAt: '2026-01-01T00:00:00Z', counts, ...over
})

describe('results of the archive', () => {
  it('keep the order the server returns until a column is chosen, then sort the loaded rows; entries without a time go last', () => {
    const rows = [result({ id: 'b', loggedAt: '2026-03-02T10:00:00Z' }), result({ id: 'a', loggedAt: '2026-03-01T10:00:00Z' }), result({ id: 'x', loggedAt: 'not a date' })]
    expect(sortRows(rows, null, RESULT_GETTERS).map((row) => row.id)).toEqual(['b', 'a', 'x'])
    const asc = sortRows(rows, nextSort(null, 'logged'), RESULT_GETTERS).map((row) => row.id)
    expect(asc).toEqual(['a', 'b', 'x'])
    const desc = sortRows(rows, { key: 'logged', direction: 'desc' }, RESULT_GETTERS).map((row) => row.id)
    expect(desc).toEqual(['b', 'a', 'x'])
  })

  it('sort by team, event and result as natural text', () => {
    const rows = [result({ id: '1', eventName: 'Round 10' }), result({ id: '2', eventName: 'Round 2' })]
    expect(sortRows(rows, { key: 'event', direction: 'asc' }, RESULT_GETTERS).map((row) => row.id)).toEqual(['2', '1'])
  })

  it('the search covers event, team, result, drivers and notes', () => {
    const entry = result({ notes: 'safety car on lap 4', drivers: 'Fake Driver 007' })
    expect(matchesQuery(resultSearchFields(entry), 'safety')).toBe(true)
    expect(matchesQuery(resultSearchFields(entry), 'driver 007')).toBe(true)
    expect(matchesQuery(resultSearchFields(entry), 'alpha p3')).toBe(true)
    expect(matchesQuery(resultSearchFields(entry), 'nothing like this')).toBe(false)
  })

  it('the team stats line only repeats what the server says: the total, never a calculated standing', () => {
    expect(describeResultCount(1, null)).toBe('1 result in the archive')
    expect(describeResultCount(54, null)).toBe('54 results in the archive')
    expect(describeResultCount(3, 'Fake Team Alpha')).toBe('3 results logged for Fake Team Alpha')
    expect(describeResultCount(1, 'Fake Team Alpha')).toBe('1 result logged for Fake Team Alpha')
  })

  it('the texts say what the archive cannot do', () => {
    expect(RESULTS_APPEND_ONLY_TEXT).toMatch(/append-only/)
    expect(RESULTS_APPEND_ONLY_TEXT).toMatch(/cannot be edited or deleted/)
    expect(RESULT_TWICE_WARNING).toMatch(/twice creates two entries/)
    expect(RESULT_LOST_TEXT).toMatch(/may already be logged/)
    expect(RESULT_LOST_TEXT).toMatch(/not sent again/)
    expect(RESULT_LOST_TEXT).not.toMatch(/try again|retry/i)
  })
})

describe('attendance posts', () => {
  it('sort by the counts and keep the server order (newest first) by default', () => {
    const rows = [post({ messageId: '1' }, { available: 1, unavailable: 5 }), post({ messageId: '2' }, { available: 9, unavailable: 0 }), post({ messageId: '3' }, { available: 4, unavailable: 2 })]
    expect(sortRows(rows, null, ATTENDANCE_GETTERS).map((row) => row.messageId)).toEqual(['1', '2', '3'])
    expect(sortRows(rows, { key: 'available', direction: 'desc' }, ATTENDANCE_GETTERS).map((row) => row.messageId)).toEqual(['2', '3', '1'])
    expect(sortRows(rows, { key: 'unavailable', direction: 'asc' }, ATTENDANCE_GETTERS).map((row) => row.messageId)).toEqual(['2', '3', '1'])
  })

  it('the filter splits posts with answers from posts nobody answered yet', () => {
    const empty = post({}, { available: 0, unavailable: 0 })
    const answered = post({}, { available: 0, unavailable: 2 })
    expect(ATTENDANCE_FILTER_OPTIONS.map((option) => option.value)).toEqual(['all', 'answered', 'nobody'])
    expect([empty, answered].filter((item) => matchesAttendanceFilter(item, 'all'))).toHaveLength(2)
    expect([empty, answered].filter((item) => matchesAttendanceFilter(item, 'answered'))).toEqual([answered])
    expect([empty, answered].filter((item) => matchesAttendanceFilter(item, 'nobody'))).toEqual([empty])
  })

  it('says that drivers toggle their own status and what the app cannot do', () => {
    expect(ATTENDANCE_DRIVERS_TOGGLE_TEXT).toMatch(/Available and Not Available buttons/)
    expect(ATTENDANCE_DRIVERS_TOGGLE_TEXT).toMatch(/cannot set or remove anyone/)
    expect(ATTENDANCE_DRIVERS_TOGGLE_TEXT).toMatch(/edit or delete a post/)
    expect(ATTENDANCE_DRIVERS_TOGGLE_TEXT).toMatch(/channel later/)
  })

  it('builds the Discord link only from the ids it is given', () => {
    expect(discordMessageLink('555000000000000001', '777000000000000001', '700000000000000001')).toBe('https://discord.com/channels/555000000000000001/777000000000000001/700000000000000001')
  })
})

describe('announcements', () => {
  it('the footer names the person who posts', () => {
    expect(announcementFooter('Fake Staff')).toBe('Posted via Nexus App by Fake Staff')
  })

  it('the helper text covers formatting, emoji and the https-only image', () => {
    expect(ANNOUNCEMENT_AS_TYPED_TEXT).toMatch(/exactly as you type/)
    expect(ANNOUNCEMENT_AS_TYPED_TEXT).toMatch(/:name:/)
    expect(ANNOUNCEMENT_AS_TYPED_TEXT).toMatch(/https/)
  })
})
