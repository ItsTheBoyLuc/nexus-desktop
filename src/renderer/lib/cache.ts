/**
 * Tiny TTL cache for read-only API data, so the sidebar, the page and the breadcrumb can
 * ask for the same guild list or game list without three identical requests. In-flight
 * requests are shared; failures are never cached.
 */
interface Entry {
  at: number
  promise: Promise<unknown>
}

const store = new Map<string, Entry>()
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

/** Forget everything (refresh button, sign-out, switching accounts). */
export function clearCache(): void {
  store.clear()
}
