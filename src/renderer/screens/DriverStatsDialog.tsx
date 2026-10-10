import { Badge, Button, ErrorState, LoadingRegion, Modal, Skeleton } from '../components'
import { useAsync } from '../hooks/useAsync'
import { describeError, unwrap } from '../lib/errors'

/** The stats of one driver, read fresh from GET /f1/drivers/{id} (what /league driver-stats shows). */
export function DriverStatsDialog({ guildId, userId, name, onClose }: { guildId: string; userId: string; name: string; onClose: () => void }) {
  const stats = useAsync(() => unwrap(window.nexus.api.driver(guildId, userId)), `f1-driver:${guildId}:${userId}`)
  return (
    <Modal
      open
      title={`Driver stats: ${name}`}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {stats.status === 'loading' ? (
        <LoadingRegion label="Loading driver stats">
          <Skeleton height={20} />
          <Skeleton height={20} width="60%" />
          <Skeleton height={20} width="40%" />
        </LoadingRegion>
      ) : null}
      {stats.status === 'error' ? <ErrorState title="Could not load the driver" message={describeError(stats.error)} onRetry={stats.reload} /> : null}
      {stats.status === 'ready' ? (
        <dl className="facts">
          <div>
            <dt>Driver</dt>
            <dd>
              {stats.data.displayName} <span className="muted">@{stats.data.username}</span>
            </dd>
          </div>
          <div>
            <dt>Team</dt>
            <dd>{stats.data.team === '—' ? <span className="muted">No team</span> : stats.data.team}</dd>
          </div>
          <div>
            <dt>Number</dt>
            <dd>{stats.data.number !== null ? stats.data.number : <Badge>None</Badge>}</dd>
          </div>
          <div>
            <dt>Points</dt>
            <dd>{stats.data.points}</dd>
          </div>
          <div>
            <dt>Wins</dt>
            <dd>{stats.data.wins}</dd>
          </div>
          <div>
            <dt>Podiums</dt>
            <dd>{stats.data.podiums}</dd>
          </div>
        </dl>
      ) : null}
    </Modal>
  )
}
