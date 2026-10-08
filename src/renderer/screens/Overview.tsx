import { Megaphone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar, Badge, Card, PageHeader } from '../components'
import { routes } from '../lib/routes'
import { useLeague } from './LeagueRoute'

export function Overview() {
  const { guild, game } = useLeague()

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        description={`${guild.name} - ${game.label}`}
        leading={<Avatar src={guild.icon} name={guild.name} size={56} shape="rounded" />}
      />

      <div className="grid">
        <Card>
          <dl className="facts">
            <dt>Server</dt>
            <dd>{guild.name}</dd>
          </dl>
        </Card>
        <Card>
          <dl className="facts">
            <dt>Game</dt>
            <dd>{game.label}</dd>
          </dl>
        </Card>
        <Card>
          <dl className="facts">
            <dt>Status</dt>
            <dd>
              <Badge tone={game.enabled ? 'success' : 'neutral'}>{game.enabled ? 'Enabled' : 'Not set up'}</Badge>
            </dd>
          </dl>
        </Card>
      </div>

      <Card elevated className="quick-action">
        <Megaphone size={22} aria-hidden="true" className="quick-action__icon" />
        <div className="quick-action__text">
          <h2>Post an announcement</h2>
          <p>Send an announcement to a Discord channel in {guild.name} straight from Nexus.</p>
        </div>
        <Link className="btn btn--primary" to={routes.league(guild.id, game.key, 'announcement')}>
          Write announcement
        </Link>
      </Card>
    </div>
  )
}
