import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Channel, Game, Guild, LeagueGames, Overview, Role, ServerSettings } from '../../shared/types'
import { cached, clearCache, dropCached, onInvalidate } from '../lib/cache'
import { unwrap } from '../lib/errors'
import { useAsync } from './useAsync'
import type { AsyncState } from './useAsync'

interface RefreshContextValue {
  /** Changes on every manual refresh; part of every data hook's request key. */
  tick: number
  refresh: () => void
}

const RefreshContext = createContext<RefreshContextValue | null>(null)

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => {
    clearCache()
    setTick((value) => value + 1)
  }, [])
  const value = useMemo(() => ({ tick, refresh }), [tick, refresh])
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
}

export function useRefresh(): RefreshContextValue {
  const context = useContext(RefreshContext)
  if (!context) throw new Error('useRefresh must be used inside <RefreshProvider>')
  return context
}

export type Loaded<T> = AsyncState<T> & { reload: () => void }

/**
 * Shared plumbing of every data hook: global refresh tick, stale-while-revalidate, and
 * invalidate(prefix) from the screens that just wrote something.
 *
 *  - `share` true: the answer goes through the short TTL cache (several components read it);
 *    false: every mount asks the server (screens that must show the real, current state).
 *  - `key` null: nothing to load yet.
 */
function useApiData<T>(key: string | null, load: () => Promise<T>, share: boolean): Loaded<T> {
  const { tick } = useRefresh()
  const [invalidations, setInvalidations] = useState(0)

  useEffect(
    () =>
      onInvalidate((prefix) => {
        if (key !== null && key.startsWith(prefix)) setInvalidations((count) => count + 1)
      }),
    [key]
  )

  const result = useAsync(
    () => {
      if (key === null) return new Promise<T>(() => undefined) // nothing to load: stay in "loading", never fake an answer
      return share ? cached(key, load) : load()
    },
    key ?? 'none',
    `${tick}.${invalidations}`
  )
  const reload = useCallback(() => {
    if (key !== null) dropCached(key)
    result.reload()
  }, [key, result])
  return { ...result, reload }
}

export function useGuilds(): Loaded<Guild[]> {
  return useApiData('guilds', () => unwrap(window.nexus.api.guilds()), true)
}

export function useGuildGames(guildId: string | undefined): Loaded<Game[]> {
  return useApiData(guildId ? `games:${guildId}` : null, () => unwrap(window.nexus.api.games(guildId ?? '')), true)
}

export function useGuildChannels(guildId: string | undefined): Loaded<Channel[]> {
  return useApiData(guildId ? `channels:${guildId}` : null, () => unwrap(window.nexus.api.channels(guildId ?? '')), true)
}

export function useGuildRoles(guildId: string | undefined): Loaded<Role[]> {
  return useApiData(guildId ? `roles:${guildId}` : null, () => unwrap(window.nexus.api.roles(guildId ?? '')), true)
}

/** Screens that show server state read it fresh every time they open (no TTL cache). */
export function useOverview(guildId: string | undefined): Loaded<Overview> {
  return useApiData(guildId ? `overview:${guildId}` : null, () => unwrap(window.nexus.api.overview(guildId ?? '')), false)
}

export function useServerSettings(guildId: string | undefined): Loaded<ServerSettings> {
  return useApiData(guildId ? `server-settings:${guildId}` : null, () => unwrap(window.nexus.api.serverSettings(guildId ?? '')), false)
}

export function useLeagueGames(guildId: string | undefined): Loaded<LeagueGames> {
  return useApiData(guildId ? `league-games:${guildId}` : null, () => unwrap(window.nexus.api.leagueGames(guildId ?? '')), false)
}
