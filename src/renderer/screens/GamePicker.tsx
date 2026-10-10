import { Car, Flag, Gauge, Layers, Megaphone, Power, Route, Timer, Users } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { GAME_KEYS, isGameKey } from '../../shared/types'
import type { Game } from '../../shared/types'
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, LoadingRegion, PageHeader, Skeleton } from '../components'
import { useGuildGames, useGuilds } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { mergeGames } from '../lib/catalog'
import { describeError } from '../lib/errors'
import { routes } from '../lib/routes'
import { EnableGameDialog } from './EnableGameDialog'

const GAME_ICONS: Record<(typeof GAME_KEYS)[number], ReactNode> = {
  f1: <Flag size={28} aria-hidden="true" />,
  lmu: <Timer size={28} aria-hidden="true" />,
  iracing: <Gauge size={28} aria-hidden="true" />,
  gt7: <Car size={28} aria-hidden="true" />,
  acc: <Route size={28} aria-hidden="true" />
}

export function GamePicker() {
  const { guildId } = useParams()
  const navigate = useNavigate()
  const guilds = useGuilds()
  const games = useGuildGames(guildId)
  const { remember } = useSettings()
  const [enabling, setEnabling] = useState<Game | null>(null)

  const guild = guilds.status === 'ready' ? guilds.data.find((item) => item.id === guildId) : undefined

  if (guilds.status === 'ready' && !guild) {
    return (
      <div className="page">
        <EmptyState
          title="Server not available"
          description="This server is not in your list. Nexus may have been removed from it, or you no longer have the FIA, STAFF or Administrator role."
          action={<Button onClick={() => navigate(routes.servers)}>Back to servers</Button>}
        />
      </div>
    )
  }

  const gameList = games.status === 'ready' ? mergeGames(games.data) : []
  const noneEnabled = games.status === 'ready' && gameList.every((game) => !game.enabled)

  const open = (game: Game): void => {
    if (!guildId) return
    remember(guildId, isGameKey(game.key) ? game.key : null)
    navigate(routes.game(guildId, game.key))
  }

  return (
    <div className="page">
      <PageHeader
        title={guild?.name ?? 'Choose a game'}
        description="Choose a game to manage, or enable one for this server."
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

      {noneEnabled && guildId ? (
        <EmptyState
          icon={<Power size={24} aria-hidden="true" />}
          title="No game is enabled yet"
          description="Enable a game below to unlock its tiers and sign-up panels and the League modules (Formula 1). The Esports team of every game, Announcement, Settings and Overview already work without one."
          action={
            <Link className="btn btn--secondary" to={routes.server(guildId, 'announcement')}>
              <Megaphone size={16} aria-hidden="true" />
              Write an announcement
            </Link>
          }
        />
      ) : null}

      {games.status === 'ready' ? (
        <ul className="grid" aria-label="Games">
          {gameList.map((game) => {
            const descriptionId = `game-${game.key}-description`
            return (
              <li key={game.key}>
                <Card className="game-card" aria-describedby={descriptionId}>
                  <span className="game-card__icon">{isGameKey(game.key) ? GAME_ICONS[game.key] : <Flag size={28} aria-hidden="true" />}</span>
                  <span className="game-card__title">
                    <span className="game-card__name">{game.label}</span>
                    <Badge tone={game.enabled ? 'success' : 'neutral'}>{game.enabled ? 'Enabled' : 'Not enabled'}</Badge>
                  </span>
                  <span id={descriptionId} className="game-card__text">
                    {game.enabled
                      ? 'Open its modules, or manage its tiers and sign-up panels.'
                      : 'Not enabled for this server. Enabling it unlocks its tiers, sign-up panels and league modules. Its Esports team works without it.'}
                  </span>
                  <span className="game-card__actions">
                    {game.enabled ? (
                      <>
                        <Button size="sm" onClick={() => open(game)}>
                          Open
                        </Button>
                        {guildId ? (
                          <Link className="btn btn--secondary btn--sm" to={routes.server(guildId, 'tiers')}>
                            <Layers size={14} aria-hidden="true" />
                            Games &amp; Tiers
                          </Link>
                        ) : null}
                      </>
                    ) : (
                      <Button size="sm" icon={<Power size={14} aria-hidden="true" />} onClick={() => setEnabling(game)}>
                        Enable game
                      </Button>
                    )}
                    {guildId && isGameKey(game.key) ? (
                      <Link className="btn btn--secondary btn--sm" to={routes.esports(guildId, game.key)}>
                        <Users size={14} aria-hidden="true" />
                        Esports team
                      </Link>
                    ) : null}
                  </span>
                </Card>
              </li>
            )
          })}
        </ul>
      ) : null}

      {enabling && guildId ? <EnableGameDialog guildId={guildId} slug={enabling.key} label={enabling.label} onClose={() => setEnabling(null)} /> : null}
    </div>
  )
}
