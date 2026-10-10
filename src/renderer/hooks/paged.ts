import { useCallback, useRef, useState } from 'react'
import { describeError } from '../lib/errors'
import { useApiData } from './data'
import type { Loaded } from './data'

export interface Page<T> {
  items: T[]
  total: number
}

export interface PagedList<T> {
  first: Loaded<Page<T>>
  /** Everything loaded so far (the first page and the pages added with `loadMore`), no item twice. */
  items: T[]
  /** What the server holds. */
  total: number
  canLoadMore: boolean
  loadingMore: boolean
  /** The message of a failed "load more" (what was loaded stays). */
  moreError: string | null
  loadMore: () => void
}

/**
 * A list the API serves page by page. The first page is read like every screen reads server state (fresh, never
 * faked); "Load more" adds the next page. A re-read (refresh, after a write) starts over from the first page, so the
 * list never mixes old and new answers; offsets can shift when something is added meanwhile, so an item that is
 * already loaded is never listed twice.
 *
 * Nothing here stores anything: the items live in React state and are gone when the screen is left. That matters for the
 * sign-up participants, whose answers are personal data.
 */
export function usePagedList<T>(key: string | null, fetchPage: (offset: number) => Promise<Page<T>>, idOf: (item: T) => string): PagedList<T> {
  const first = useApiData(key, () => fetchPage(0), false)

  // The added pages belong to ONE answer of the first page: a new answer drops them.
  const [extra, setExtra] = useState<{ base: Page<T>; items: T[]; fetched: number } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const busy = useRef(false)

  const base = first.status === 'ready' ? first.data : null
  const added = extra !== null && extra.base === base ? extra : null
  const merge = (loaded: readonly T[], more: readonly T[]): T[] => {
    const seen = new Set(loaded.map(idOf))
    return [...loaded, ...more.filter((item) => !seen.has(idOf(item)))]
  }
  const items = base ? merge(base.items, added?.items ?? []) : []
  const fetched = base ? base.items.length + (added?.fetched ?? 0) : 0
  const total = base?.total ?? 0

  const loadMore = useCallback(() => {
    if (!base || busy.current) return
    busy.current = true
    setLoadingMore(true)
    setMoreError(null)
    fetchPage(fetched)
      .then(
        (page) => {
          setExtra((current) => {
            const same = current !== null && current.base === base ? current : { base, items: [], fetched: 0 }
            const seen = new Set(same.items.map(idOf))
            return { base, items: [...same.items, ...page.items.filter((item) => !seen.has(idOf(item)))], fetched: same.fetched + page.items.length }
          })
        },
        (error: unknown) => setMoreError(describeError(error))
      )
      .finally(() => {
        busy.current = false
        setLoadingMore(false)
      })
  }, [base, fetchPage, fetched, idOf])

  return { first, items, total, canLoadMore: base !== null && fetched < total, loadingMore, moreError, loadMore }
}
