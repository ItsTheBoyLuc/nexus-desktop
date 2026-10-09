import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  /** `refreshing`: showing the previous answer while a fresh one is on its way (never faked, just not blanked). */
  | { status: 'ready'; data: T; refreshing?: boolean }
  | { status: 'error'; error: unknown }

interface Stored<T> {
  /** Identity of the data (e.g. `games:<guild>`). */
  key: string
  /** Identity plus version and reload counter: one specific request. */
  requestKey: string
  outcome: AsyncState<T>
}

/**
 * Runs `loader` whenever `key`, `version` or the reload counter change (or reload() is called).
 *
 * - `key` identifies the data (e.g. `games:${guildId}`). A different key starts from "loading".
 * - `version` (e.g. the global refresh tick) and reload() fetch the SAME data again: the previous
 *   answer stays visible with `refreshing: true` until the new one arrives, so a screen never
 *   flashes empty after a write. An error is never kept: a failed refetch shows the error.
 * Late answers for an outdated request are ignored.
 */
export function useAsync<T>(loader: () => Promise<T>, key: string, version = ''): AsyncState<T> & { reload: () => void } {
  const [reloads, setReloads] = useState(0)
  const [stored, setStored] = useState<Stored<T> | null>(null)
  const loaderRef = useRef(loader)
  const requestKey = `${key}|${version}#${reloads}`

  useEffect(() => {
    loaderRef.current = loader
  })

  useEffect(() => {
    let active = true
    loaderRef.current().then(
      (data) => {
        if (active) setStored({ key, requestKey, outcome: { status: 'ready', data } })
      },
      (error: unknown) => {
        if (active) setStored({ key, requestKey, outcome: { status: 'error', error } })
      }
    )
    return () => {
      active = false
    }
  }, [key, requestKey])

  const reload = useCallback(() => setReloads((count) => count + 1), [])

  let state: AsyncState<T> = { status: 'loading' }
  if (stored && stored.requestKey === requestKey) state = stored.outcome
  else if (stored && stored.key === key && stored.outcome.status === 'ready') state = { status: 'ready', data: stored.outcome.data, refreshing: true }
  return { ...state, reload }
}
