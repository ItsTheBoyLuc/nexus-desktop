import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Calendar, Channel, Game, Guild, LeagueGames, NextRace, Overview, PointsSystem, Role, ServerSettings, Standings, Team } from '../../shared/types'
import { cached, clearCache, dropCached, onInvalidate } from '../lib/cache'
import { errorCode, unwrap } from '../lib/errors'
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

// ── F1 league (milestone 2): always read fresh, like every screen that shows server state ──

export function useCalendar(guildId: string | undefined): Loaded<Calendar> {
  return useApiData(guildId ? `f1-calendar:${guildId}` : null, () => unwrap(window.nexus.api.calendar(guildId ?? '')), false)
}

/** `null` data = there is no calendar (404 calendar_not_found), which is a normal state, not an error. */
export function useNextRace(guildId: string | undefined): Loaded<NextRace | null> {
  return useApiData(
    guildId ? `f1-next-race:${guildId}` : null,
    async () => {
      try {
        return await unwrap(window.nexus.api.nextRace(guildId ?? ''))
      } catch (error) {
        if (errorCode(error) === 'calendar_not_found') return null
        throw error
      }
    },
    false
  )
}

export function useTeams(guildId: string | undefined): Loaded<Team[]> {
  return useApiData(guildId ? `f1-teams:${guildId}` : null, () => unwrap(window.nexus.api.teams(guildId ?? '')), false)
}

export function useStandings(guildId: string | undefined): Loaded<Standings> {
  return useApiData(guildId ? `f1-standings:${guildId}` : null, () => unwrap(window.nexus.api.standings(guildId ?? '')), false)
}

export function usePointsSystem(guildId: string | undefined): Loaded<PointsSystem> {
  return useApiData(guildId ? `f1-points:${guildId}` : null, () => unwrap(window.nexus.api.pointsSystem(guildId ?? '')), false)
}
