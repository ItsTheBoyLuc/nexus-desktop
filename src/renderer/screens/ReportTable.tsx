import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Report } from '../../shared/types'
import { SortHeader, TextField } from '../components'
import { plural } from '../lib/format'
import { formatDay } from '../lib/format'
import { REPORT_GETTERS, reportSearchFields } from '../lib/reportView'
import type { ReportColumn } from '../lib/reportView'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { StatusBadge } from './ReportDetail'

interface ReportTableProps {
  reports: readonly Report[]
  onOpen: (report: Report) => void
  /** Unique on the page: ties the count line to the table. */
  idPrefix: string
  caption: string
  /** Said under the count when the reports shown are only part of what the server holds. */
  note?: ReactNode
}

/**
 * Search (over the reports that are loaded) and sort, as a keyboard-accessible table: the report number is a real button,
 * every column header is a real button, and the count is announced politely. Every cell is plain text.
 */
export function ReportTable({ reports, onOpen, idPrefix, caption, note }: ReportTableProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<ReportColumn> | null>({ key: 'filed', direction: 'desc' })
  const onSort = (column: ReportColumn): void => setSort((current) => nextSort(current, column))

  const rows = sortRows(
    reports.filter((report) => matchesQuery(reportSearchFields(report), query)),
    sort,
    REPORT_GETTERS
  )
  const searching = query.trim() !== ''

  return (
    <div className="stack stack--tight">
      <TextField label="Search the loaded reports" type="search" value={query} placeholder="Round, circuit, driver, reporter or text" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
      <div className="table-wrap">
        <table className="table table--wide" aria-describedby={`${idPrefix}-count`}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <SortHeader label="Report" column="report" sort={sort} onSort={onSort} />
              <SortHeader label="Circuit" column="circuit" sort={sort} onSort={onSort} />
              <SortHeader label="Drivers involved" column="drivers" sort={sort} onSort={onSort} />
              <SortHeader label="Filed by" column="reporter" sort={sort} onSort={onSort} />
              <SortHeader label="Status" column="status" sort={sort} onSort={onSort} />
              <SortHeader label="Filed" column="filed" sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="table__empty">
                  No loaded report matches your search.
                </td>
              </tr>
            ) : null}
            {rows.map((report) => (
              <tr key={report.id}>
                <th scope="row" className="table__key">
                  <button type="button" className="link-btn" onClick={() => onOpen(report)} aria-label={`Open report ${report.number} of ${report.roundKey}, ${report.circuit}`}>
                    <span>
                      {report.roundKey} #{report.number}
                    </span>
                  </button>
                </th>
                <td>{report.circuit}</td>
                <td className="cell-clamp">{report.driversInvolved}</td>
                <td>{report.reporter}</td>
                <td>
                  <StatusBadge report={report} />
                </td>
                <td>{formatDay(report.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted table-count" id={`${idPrefix}-count`} aria-live="polite">
        {searching ? `Showing ${rows.length} of ${plural(reports.length, 'loaded report')}` : plural(reports.length, 'report')} {note}
      </p>
    </div>
  )
}
