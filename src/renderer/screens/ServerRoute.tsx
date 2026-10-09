import { useEffect } from 'react'
import { Navigate, Outlet, useOutletContext, useParams } from 'react-router-dom'
import type { Guild } from '../../shared/types'
import { ErrorState, LoadingRegion, Skeleton } from '../components'
import { useGuilds } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { describeError } from '../lib/errors'
import { routes } from '../lib/routes'

export interface ServerContext {
  guild: Guild
}

export function useServer(): ServerContext {
  return useOutletContext<ServerContext>()
}

/**
 * Guards /g/:guildId/server/*. Only a server is needed (no game): Overview, Games & Tiers,
 * Settings and Announcement work as soon as a server is chosen. The server must be in the
 * user's list, re-read from the API, so a stale deep link can never open a server the user lost access to.
 */
export function ServerRoute() {
  const { guildId } = useParams()
  const guilds = useGuilds()
  const { settings, remember } = useSettings()

  const guild = guilds.status === 'ready' ? guilds.data.find((item) => item.id === guildId) : undefined

  // Remember the server (and keep the game if it is the same server), but only once it is validated.
  useEffect(() => {
    if (guild) remember(guild.id, settings.lastGuildId === guild.id ? settings.lastGame : null)
  }, [guild, remember, settings.lastGuildId, settings.lastGame])

  if (guilds.status === 'error') return <ErrorState message={describeError(guilds.error)} onRetry={guilds.reload} />
  if (guilds.status === 'loading') {
    return (
      <LoadingRegion label="Loading server" className="page">
        <Skeleton width={280} height={28} />
        <div className="grid grid--spaced">
          <Skeleton height={120} radius={12} />
          <Skeleton height={120} radius={12} />
          <Skeleton height={120} radius={12} />
        </div>
      </LoadingRegion>
    )
  }
  if (!guild) return <Navigate to={routes.servers} replace />
  return <Outlet context={{ guild } satisfies ServerContext} />
}
