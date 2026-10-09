import { describe, expect, it } from 'vitest'
import { ariaSort, matchesQuery, nextSort, sortRows } from './tableView'
import type { SortState } from './tableView'

describe('matchesQuery', () => {
  it('is case-insensitive and needs every word', () => {
    expect(matchesQuery(['Tier 1 Drivers', 'F1 2025'], 'tier 1')).toBe(true)
    expect(matchesQuery(['Tier 1 Drivers', 'F1 2025'], 'DRIVERS 2025')).toBe(true) // words may sit in different fields
    expect(matchesQuery(['Tier 1 Drivers'], 'tier 2')).toBe(false)
  })
  it('an empty query matches everything, null fields are ignored', () => {
    expect(matchesQuery(['x'], '')).toBe(true)
    expect(matchesQuery([], '   ')).toBe(true)
    expect(matchesQuery([null, undefined, 'abc'], 'abc')).toBe(true)
    expect(matchesQuery([null], 'abc')).toBe(false)
  })
})

interface Row {
  name: string
  drivers: number | null
}
const getters = { name: (r: Row) => r.name, drivers: (r: Row) => r.drivers }
const rows: Row[] = [
  { name: 'T10', drivers: 5 },
  { name: 'T2', drivers: null },
  { name: 'T1', drivers: 30 },
  { name: 't3', drivers: 5 }
]

describe('sortRows', () => {
  it('sorts text naturally and case-insensitively', () => {
    expect(sortRows(rows, { key: 'name', direction: 'asc' }, getters).map((r) => r.name)).toEqual(['T1', 'T2', 't3', 'T10'])
    expect(sortRows(rows, { key: 'name', direction: 'desc' }, getters).map((r) => r.name)).toEqual(['T10', 't3', 'T2', 'T1'])
  })
  it('sorts numbers numerically, keeps rows without a value last in both directions, and is stable', () => {
    expect(sortRows(rows, { key: 'drivers', direction: 'asc' }, getters).map((r) => r.name)).toEqual(['T10', 't3', 'T1', 'T2'])
    expect(sortRows(rows, { key: 'drivers', direction: 'desc' }, getters).map((r) => r.name)).toEqual(['T1', 'T10', 't3', 'T2'])
  })
  it('returns a copy and leaves the input alone', () => {
    const before = rows.map((r) => r.name)
    const sorted = sortRows(rows, null, getters)
    expect(sorted).not.toBe(rows)
    expect(sorted.map((r) => r.name)).toEqual(before)
    sortRows(rows, { key: 'name', direction: 'asc' }, getters)
    expect(rows.map((r) => r.name)).toEqual(before)
  })
})

describe('column header behaviour', () => {
  it('a new column starts ascending, the same column toggles', () => {
    let sort: SortState<'name' | 'drivers'> | null = null
    sort = nextSort(sort, 'name')
    expect(sort).toEqual({ key: 'name', direction: 'asc' })
    sort = nextSort(sort, 'name')
    expect(sort).toEqual({ key: 'name', direction: 'desc' })
    sort = nextSort(sort, 'drivers')
    expect(sort).toEqual({ key: 'drivers', direction: 'asc' })
  })
  it('reports aria-sort for assistive technology', () => {
    const sort: SortState<'name' | 'drivers'> = { key: 'name', direction: 'desc' }
    expect(ariaSort(sort, 'name')).toBe('descending')
    expect(ariaSort(sort, 'drivers')).toBe('none')
    expect(ariaSort(null, 'name')).toBe('none')
  })
})
