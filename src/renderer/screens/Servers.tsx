import { Plus, RotateCw, ServerOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { BOT_INVITE_URL } from '../../shared/constants'
import { Avatar, Button, CardButton, EmptyState, ErrorState, LoadingRegion, PageHeader, Skeleton, Stagger } from '../components'
import { useGuilds } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { describeError } from '../lib/errors'
import { routes } from '../lib/routes'

export function Servers() {
  const guilds = useGuilds()
  const navigate = useNavigate()
  const { remember } = useSettings()

  return (
    <div className="page">
      <PageHeader title="Your servers" description="Servers where Nexus is installed and you have the FIA, STAFF or Administrator role." />

      {guilds.status === 'loading' ? (
        <LoadingRegion label="Loading your servers" className="grid">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="card server-card">
              <Skeleton width={48} height={48} radius={12} />
              <Skeleton width="60%" height={16} />
            </div>
          ))}
        </LoadingRegion>
      ) : null}

      {guilds.status === 'error' ? <ErrorState title="Could not load your servers" message={describeError(guilds.error)} onRetry={guilds.reload} /> : null}

      {guilds.status === 'ready' && guilds.data.length === 0 ? (
        <EmptyState
          icon={<ServerOff size={24} aria-hidden="true" />}
          title="No servers found"
          description="Nexus must be added to your Discord server, and you need the FIA, STAFF or Administrator role there to manage it."
          action={
            <>
              <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => void window.nexus.system.openExternal(BOT_INVITE_URL)}>
                Add Nexus to a server
              </Button>
              <Button variant="secondary" icon={<RotateCw size={16} aria-hidden="true" />} onClick={guilds.reload}>
                Check again
              </Button>
            </>
          }
        />
      ) : null}

      {guilds.status === 'ready' && guilds.data.length > 0 ? (
        <Stagger as="ul" className="grid" aria-label="Servers">
          {guilds.data.map((guild) => (
            <li key={guild.id}>
              <CardButton
                className="server-card"
                onClick={() => {
                  remember(guild.id, null)
                  navigate(routes.games(guild.id))
                }}
              >
                <Avatar src={guild.icon} name={guild.name} size={48} shape="rounded" />
                <span className="server-card__name">{guild.name}</span>
              </CardButton>
            </li>
          ))}
        </Stagger>
      ) : null}
    </div>
  )
}
