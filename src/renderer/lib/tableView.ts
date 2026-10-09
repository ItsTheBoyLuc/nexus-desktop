/** Search, sort and filter for tables and pickers. Pure functions, so the rules can be tested. */

export type SortDirection = 'asc' | 'desc'

export interface SortState<K extends string> {
  key: K
  direction: SortDirection
}

/** Case-insensitive; every word of the query must appear in at least one of the fields. An empty query matches everything. */
export function matchesQuery(fields: ReadonlyArray<string | null | undefined>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fields
    .filter((field): field is string => typeof field === 'string')
    .join('\n')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * Sort a copy of `rows`. Numbers sort numerically, text naturally ("T2" before "T10"), and rows
 * without a value (null) always go last, whichever direction is chosen. Ties keep their original order.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K> | null,
  getters: Record<K, (row: T) => string | number | null>
): T[] {
  if (!sort) return [...rows]
  const get = getters[sort.key]
  const sign = sort.direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index
      if (a.value === null) return 1
      if (b.value === null) return -1
      const order =
        typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : collator.compare(String(a.value), String(b.value))
      return order !== 0 ? sign * order : a.index - b.index
    })
    .map((entry) => entry.row)
}

/** Clicking a column: a new column starts ascending, the same column flips the direction. */
export function nextSort<K extends string>(current: SortState<K> | null, key: K): SortState<K> {
  if (current && current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  return { key, direction: 'asc' }
}

export function ariaSort<K extends string>(sort: SortState<K> | null, key: K): 'ascending' | 'descending' | 'none' {
  if (!sort || sort.key !== key) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}
