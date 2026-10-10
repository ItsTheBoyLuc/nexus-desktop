import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { ariaSort } from '../lib/tableView'
import type { SortState } from '../lib/tableView'

interface SortHeaderProps<K extends string> {
  label: string
  column: K
  sort: SortState<K> | null
  onSort: (column: K) => void
  /** Right-align (numeric columns). */
  numeric?: boolean
}

/** A sortable column header: one real button, announced with aria-sort. */
export function SortHeader<K extends string>({ label, column, sort, onSort, numeric = false }: SortHeaderProps<K>) {
  const state = ariaSort(sort, column)
  const Icon = state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown
  return (
    <th scope="col" aria-sort={state} className={numeric ? 'table__num' : undefined}>
      <button type="button" className="sort-btn" onClick={() => onSort(column)}>
        {label}
        <Icon size={14} aria-hidden="true" />
      </button>
    </th>
  )
}
