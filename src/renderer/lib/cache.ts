/**
 * Tiny TTL cache for read-only API data, so the sidebar, the page and the breadcrumb can
 * ask for the same guild list or game list without three identical requests. In-flight
 * requests are shared; failures are never cached.
 *
 * Writes never touch cached data themselves: after a successful write the screen calls
 * `invalidate(prefix)`, which forgets the matching entries and tells every mounted data hook
 * with a matching key to fetch again from the server.
 */
interface Entry {
  at: number
  promise: Promise<unknown>
}

const store = new Map<string, Entry>()
const listeners = new Set<(prefix: string) => void>()
const DEFAULT_TTL_MS = 30_000

export function cached<T>(key: string, loader: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise as Promise<T>

  const promise = loader().catch((error: unknown) => {
    if (store.get(key)?.promise === promise) store.delete(key)
    throw error
  })
  store.set(key, { at: Date.now(), promise })
  return promise
}

/** Forget one entry without notifying anyone (a hook that reloads itself uses this). */
export function dropCached(key: string): void {
  store.delete(key)
}

/** Forget everything (refresh button, sign-out, switching accounts). */
export function clearCache(): void {
  store.clear()
}

/** Forget every entry whose key starts with `prefix` and make matching mounted hooks refetch. */
export function invalidate(prefix: string): void {
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key)
  for (const listener of [...listeners]) listener(prefix)
}

export function onInvalidate(listener: (prefix: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
