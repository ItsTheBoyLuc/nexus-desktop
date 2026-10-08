import { useEffect } from 'react'
import { Navigate, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { isGameKey } from '../../shared/types'
import type { Game, Guild } from '../../shared/types'
import { ErrorState, LoadingRegion, Skeleton } from '../components'
import { useGuildGames, useGuilds } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { describeError } from '../lib/errors'
import { routes } from '../lib/routes'

export interface LeagueContext {
  guild: Guild
  game: Game
}

export function useLeague(): LeagueContext {
  return useOutletContext<LeagueContext>()
}

/**
 * Guards /g/:guildId/:game/*. The server must be in the user's list and the game must be
 * enabled for it; otherwise the user is sent back to the server or game picker. Everything
 * is re-read from the API, so a stale deep link or saved setting can never open a page the
 * user should not see.
 */
export function LeagueRoute() {
  const { guildId, game: gameKey } = useParams()
  const guilds = useGuilds()
  const games = useGuildGames(guildId)
  const { remember } = useSettings()

  const guild = guilds.status === 'ready' ? guilds.data.find((item) => item.id === guildId) : undefined
  const game = games.status === 'ready' ? games.data.find((item) => item.key === gameKey) : undefined
  const valid = Boolean(guild && game?.enabled)

  // Remember the last place the user worked, but only once it has been validated.
  useEffect(() => {
    if (valid && guildId && isGameKey(gameKey)) remember(guildId, gameKey)
  }, [valid, guildId, gameKey, remember])

  if (guilds.status === 'error') return <ErrorState message={describeError(guilds.error)} onRetry={guilds.reload} />
  if (games.status === 'error') return <ErrorState message={describeError(games.error)} onRetry={games.reload} />

  if (guilds.status === 'loading' || games.status === 'loading') {
    return (
      <LoadingRegion label="Loading league" className="page">
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
  if (!game?.enabled || !guildId) return <Navigate to={routes.games(guild.id)} replace />

  return <Outlet context={{ guild, game } satisfies LeagueContext} />
}
