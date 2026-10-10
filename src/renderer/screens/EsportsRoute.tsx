import { useEffect } from 'react'
import { Navigate, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { GAME_LABELS } from '../../shared/types'
import type { Guild, RacingGame } from '../../shared/types'
import { isRacingGame } from '../../shared/racingValidation'
import { ErrorState, LoadingRegion, Notice, Skeleton } from '../components'
import { useGuilds } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { describeError } from '../lib/errors'
import { racingScope } from '../lib/racingScope'
import { routes } from '../lib/routes'

export interface EsportsContext {
  guild: Guild
  game: RacingGame
  gameLabel: string
  /** `<guild>:<game>`: every esports screen is keyed by it, so a switch of server or game rebuilds the screen from scratch. */
  scope: string
}

export function useEsports(): EsportsContext {
  return useOutletContext<EsportsContext>()
}

/**
 * Guards /g/:guildId/:game/esports/*. The server must be in the user's list and the game must be one of the five games with an
 * esports team. The game does NOT have to be enabled in Games & Tiers: the esports data is separate from the league's, so this
 * route never sends anyone back to the game picker for that reason (an unknown game is refused, though).
 */
export function EsportsRoute() {
  const { guildId, game: gameKey } = useParams()
  const guilds = useGuilds()
  const { remember } = useSettings()

  const guild = guilds.status === 'ready' ? guilds.data.find((item) => item.id === guildId) : undefined
  const valid = Boolean(guild && isRacingGame(gameKey))
  useEffect(() => {
    if (valid && guildId && isRacingGame(gameKey)) remember(guildId, gameKey)
  }, [valid, guildId, gameKey, remember])

  if (guilds.status === 'error') return <ErrorState message={describeError(guilds.error)} onRetry={guilds.reload} />
  if (guilds.status === 'loading') {
    return (
      <LoadingRegion label="Loading the esports team" className="page">
        <Skeleton width={280} height={28} />
        <Skeleton height={160} radius={12} />
      </LoadingRegion>
    )
  }
  if (!guild || !guildId) return <Navigate to={routes.servers} replace />
  if (!isRacingGame(gameKey)) return <Navigate to={routes.games(guild.id)} replace />

  return <Outlet context={{ guild, game: gameKey, gameLabel: GAME_LABELS[gameKey], scope: racingScope(guild.id, gameKey) } satisfies EsportsContext} />
}

/** The short text at the top of every esports screen: what this module is, and for Formula 1 how it differs from the League. */
export function EsportsNote({ game, gameLabel }: { game: RacingGame; gameLabel: string }) {
  if (game === 'f1') {
    return (
      <Notice tone="info">
        <strong>Formula 1 Esports</strong> is not the League. The League is the championship you organise yourself, with its own calendar, teams and standings. The Esports team is for the teams of this server that race in <strong>external competitions</strong>. They have separate teams, events,
        results and attendance, and the two never share data.
      </Notice>
    )
  }
  return (
    <Notice tone="info">
      The <strong>{gameLabel}</strong> esports team: the teams of this server that race in external competitions. Its teams, events, results and attendance belong to {gameLabel} only. It works whether or not {gameLabel} is enabled in Games &amp; Tiers.
    </Notice>
  )
}
