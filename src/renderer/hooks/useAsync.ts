import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: unknown }

interface Stored<T> {
  key: string
  outcome: AsyncState<T>
}

/**
 * Runs `loader` whenever `key` changes (or reload() is called). `key` must identify the
 * request (e.g. `games:${guildId}:${refreshTick}`); the loader itself may change freely.
 * Late answers for an outdated key are ignored.
 */
export function useAsync<T>(loader: () => Promise<T>, key: string): AsyncState<T> & { reload: () => void } {
  const [reloads, setReloads] = useState(0)
  const [stored, setStored] = useState<Stored<T> | null>(null)
  const loaderRef = useRef(loader)
  const fullKey = `${key}#${reloads}`

  useEffect(() => {
    loaderRef.current = loader
  })

  useEffect(() => {
    let active = true
    loaderRef.current().then(
      (data) => {
        if (active) setStored({ key: fullKey, outcome: { status: 'ready', data } })
      },
      (error: unknown) => {
        if (active) setStored({ key: fullKey, outcome: { status: 'error', error } })
      }
    )
    return () => {
      active = false
    }
  }, [fullKey])

  const reload = useCallback(() => setReloads((count) => count + 1), [])
  const state: AsyncState<T> = stored && stored.key === fullKey ? stored.outcome : { status: 'loading' }
  return { ...state, reload }
}
