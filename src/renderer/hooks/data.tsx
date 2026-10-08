import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Channel, Game, Guild } from '../../shared/types'
import { cached, clearCache } from '../lib/cache'
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

type Loaded<T> = AsyncState<T> & { reload: () => void }

export function useGuilds(): Loaded<Guild[]> {
  const { tick } = useRefresh()
  return useAsync(() => cached('guilds', () => unwrap(window.nexus.api.guilds())), `guilds:${tick}`)
}

export function useGuildGames(guildId: string | undefined): Loaded<Game[]> {
  const { tick } = useRefresh()
  return useAsync(
    () => (guildId ? cached(`games:${guildId}`, () => unwrap(window.nexus.api.games(guildId))) : Promise.resolve([])),
    `games:${guildId ?? ''}:${tick}`
  )
}

export function useGuildChannels(guildId: string | undefined): Loaded<Channel[]> {
  const { tick } = useRefresh()
  return useAsync(
    () => (guildId ? cached(`channels:${guildId}`, () => unwrap(window.nexus.api.channels(guildId))) : Promise.resolve([])),
    `channels:${guildId ?? ''}:${tick}`
  )
}
