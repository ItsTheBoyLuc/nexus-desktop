import { Car, Flag, Gauge, Route, Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { GAME_KEYS, GAME_LABELS, isGameKey } from '../../shared/types'
import type { Game } from '../../shared/types'
import { Avatar, Badge, Button, CardButton, EmptyState, ErrorState, LoadingRegion, PageHeader, Skeleton } from '../components'
import { useGuildGames, useGuilds } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { describeError } from '../lib/errors'
import { routes } from '../lib/routes'

const GAME_ICONS: Record<(typeof GAME_KEYS)[number], ReactNode> = {
  f1: <Flag size={28} aria-hidden="true" />,
  lmu: <Timer size={28} aria-hidden="true" />,
  iracing: <Gauge size={28} aria-hidden="true" />,
  gt7: <Car size={28} aria-hidden="true" />,
  acc: <Route size={28} aria-hidden="true" />
}

/** The five supported games in a fixed order; anything the API did not list counts as not set up. */
function mergeGames(fromApi: Game[]): Game[] {
  const known: Game[] = GAME_KEYS.map((key) => fromApi.find((game) => game.key === key) ?? { key, label: GAME_LABELS[key], enabled: false })
  return [...known, ...fromApi.filter((game) => !isGameKey(game.key))]
}

export function GamePicker() {
  const { guildId } = useParams()
  const navigate = useNavigate()
  const guilds = useGuilds()
  const games = useGuildGames(guildId)
  const { remember } = useSettings()

  const guild = guilds.status === 'ready' ? guilds.data.find((item) => item.id === guildId) : undefined

  if (guilds.status === 'ready' && !guild) {
    return (
      <div className="page">
        <EmptyState
          title="Server not available"
          description="This server is not in your list. Nexus may have been removed from it, or you no longer have the FIA, STAFF or Administrator role."
          action={
            <Button onClick={() => navigate(routes.servers)}>Back to servers</Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title={guild?.name ?? 'Choose a game'}
        description="Choose a game to manage its league."
        leading={guild ? <Avatar src={guild.icon} name={guild.name} size={56} shape="rounded" /> : <Skeleton width={56} height={56} radius={12} />}
        actions={<Link to={routes.servers}>All servers</Link>}
      />

      {games.status === 'loading' ? (
        <LoadingRegion label="Loading games" className="grid">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="card game-card">
              <Skeleton width={28} height={28} radius={8} />
              <Skeleton width="55%" height={18} />
              <Skeleton width="80%" height={12} />
            </div>
          ))}
        </LoadingRegion>
      ) : null}

      {games.status === 'error' ? <ErrorState title="Could not load the games" message={describeError(games.error)} onRetry={games.reload} /> : null}

      {games.status === 'ready' ? (
        <ul className="grid" aria-label="Games">
          {mergeGames(games.data).map((game) => {
            const descriptionId = `game-${game.key}-description`
            return (
              <li key={game.key}>
                <CardButton
                  className="game-card"
                  aria-disabled={!game.enabled}
                  aria-describedby={descriptionId}
                  onClick={() => {
                    if (!guildId) return
                    remember(guildId, isGameKey(game.key) ? game.key : null)
                    navigate(routes.league(guildId, game.key))
                  }}
                >
                  <span className="game-card__icon">{isGameKey(game.key) ? GAME_ICONS[game.key] : <Flag size={28} aria-hidden="true" />}</span>
                  <span className="game-card__title">
                    <span className="game-card__name">{game.label}</span>
                    <Badge tone={game.enabled ? 'success' : 'neutral'}>{game.enabled ? 'Ready' : 'Not set up'}</Badge>
                  </span>
                  <span id={descriptionId} className="game-card__text">
                    {game.enabled ? 'Open the league for this game.' : 'This game is not set up for this server yet. Set it up with the Nexus bot in Discord, then refresh.'}
                  </span>
                </CardButton>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
