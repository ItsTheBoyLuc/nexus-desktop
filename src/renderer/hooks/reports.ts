import { useCallback, useRef, useState } from 'react'
import type { Report, ReportFilters, ReportPage } from '../../shared/types'
import { describeError, unwrap } from '../lib/errors'
import { mergeReports } from '../lib/reportView'
import { useApiData } from './data'
import type { Loaded } from './data'

/** The API serves 1-100 reports per request. */
export const REPORT_PAGE_SIZE = 100

const filterKey = (filters: ReportFilters): string => JSON.stringify([filters.season ?? '', filters.round ?? '', filters.status ?? '', filters.driver ?? ''])

export interface ReportList {
  first: Loaded<ReportPage>
  /** Everything loaded so far (the first page and the pages added with `loadMore`), newest first, no report twice. */
  reports: Report[]
  /** What the server holds for these filters. */
  total: number
  canLoadMore: boolean
  loadingMore: boolean
  /** The message of a failed "load more" (the reports already loaded stay). */
  moreError: string | null
  loadMore: () => void
}

/**
 * The reports of one filter set: the first page is read like every screen reads server state (fresh, never faked), and
 * "Load more" adds the next page. A re-read (refresh, after a decision) starts over from the first page, so the list
 * never mixes old and new answers. Filters (season, round, status, driver) are sent to the server; search and sorting
 * happen on the reports that are loaded.
 */
export function useReportList(guildId: string, filters: ReportFilters): ReportList {
  const key = `f1-reports:${guildId}:list:${filterKey(filters)}`
  const first = useApiData(key, () => unwrap(window.nexus.api.reports(guildId, { ...filters, limit: REPORT_PAGE_SIZE, offset: 0 })), false)

  // The added pages belong to ONE answer of the first page: a new answer (a re-read) drops them.
  const [extra, setExtra] = useState<{ base: ReportPage; reports: Report[]; fetched: number } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const busy = useRef(false)

  const base = first.status === 'ready' ? first.data : null
  const added = extra !== null && extra.base === base ? extra : null
  const reports = base ? mergeReports(base.reports, added?.reports ?? []) : []
  const fetched = base ? base.reports.length + (added?.fetched ?? 0) : 0
  const total = base?.total ?? 0

  const loadMore = useCallback(() => {
    if (!base || busy.current) return
    busy.current = true
    setLoadingMore(true)
    setMoreError(null)
    unwrap(window.nexus.api.reports(guildId, { ...filters, limit: REPORT_PAGE_SIZE, offset: fetched })).then(
      (page) => {
        setExtra((current) => {
          const same = current !== null && current.base === base ? current : { base, reports: [], fetched: 0 }
          return { base, reports: mergeReports(same.reports, page.reports), fetched: same.fetched + page.reports.length }
        })
      },
      (error: unknown) => setMoreError(describeError(error))
    ).finally(() => {
      busy.current = false
      setLoadingMore(false)
    })
  }, [base, guildId, filters, fetched])

  return { first, reports, total, canLoadMore: base !== null && fetched < total, loadingMore, moreError, loadMore }
}
