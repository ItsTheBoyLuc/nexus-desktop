import { CalendarDays, Circle, CircleCheck, Layers, Megaphone, RotateCw, Settings as SettingsIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Overview as OverviewData } from '../../shared/types'
import { Avatar, Badge, Button, Card, ErrorState, LoadingRegion, Notice, PageHeader, Skeleton, Stagger } from '../components'
import { useOverview } from '../hooks/data'
import { describeError } from '../lib/errors'
import { formatCountdown, plural } from '../lib/format'
import { routes } from '../lib/routes'
import { useServer } from './ServerRoute'

function Stat({ value, label, note }: { value: number; label: string; note?: string }) {
  return (
    <Card className="stat">
      <div className="stat__value">{value.toLocaleString()}</div>
      <div className="stat__label">{label}</div>
      {note ? <div className="stat__note">{note}</div> : null}
    </Card>
  )
}

function Loaded({ data, guildId }: { data: OverviewData; guildId: string }) {
  const { counts, checklist, nextEvent } = data
  const doneCount = checklist.filter((item) => item.done).length

  return (
    <>
      {!data.memberCacheComplete ? (
        <Notice tone="info">Discord did not return the full member list, so the driver counts below may be lower than the real numbers.</Notice>
      ) : null}

      <section aria-labelledby="stats-heading" className="stack stack--tight">
        <h2 id="stats-heading" className="section-title">
          At a glance
        </h2>
        <Stagger className="grid grid--stats">
          <Stat value={counts.activeGames} label="Games enabled" note={counts.games > counts.activeGames ? `${counts.games} set up in total` : undefined} />
          <Stat value={counts.tiers} label="Tiers" note={`${counts.tiersWithPanel} with a sign-up panel`} />
          <Stat value={counts.tierDrivers} label="Drivers in tiers" note="Each member counted once" />
          <Stat value={counts.teams} label="Teams" note={plural(counts.teamDrivers, 'driver')} />
          <Stat value={counts.calendarRounds} label="Calendar rounds" />
          <Stat value={counts.openSignups} label="Open sign-ups" />
          <Stat value={counts.reports} label="Reports" note={`${counts.pendingReports} pending`} />
          <Stat value={data.season} label="Season in effect" />
        </Stagger>
      </section>

      <div className="columns">
        <section aria-labelledby="checklist-heading" className="stack stack--tight">
          <div className="section-head">
            <h2 id="checklist-heading" className="section-title">
              Setup checklist
            </h2>
            <Badge tone={data.setupComplete ? 'success' : 'neutral'}>{data.setupComplete ? 'Complete' : `${doneCount} of ${checklist.length} done`}</Badge>
          </div>
          <Card>
            {checklist.length === 0 ? (
              <p className="muted">The server did not return any checklist items.</p>
            ) : (
              <ul className="checklist" aria-label="Setup checklist">
                {checklist.map((item) => (
                  <li key={item.key} className={`checklist__item${item.done ? ' checklist__item--done' : ''}`}>
                    {item.done ? <CircleCheck size={20} aria-hidden="true" className="checklist__icon" /> : <Circle size={20} aria-hidden="true" className="checklist__icon" />}
                    <div className="checklist__text">
                      <span className="checklist__label">{item.label}</span>
                      {item.detail ? <span className="checklist__detail">{item.detail}</span> : null}
                    </div>
                    <span className="checklist__state">{item.done ? 'Done' : 'To do'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <div className="stack">
          <section aria-labelledby="next-heading" className="stack stack--tight">
            <h2 id="next-heading" className="section-title">
              Next event
            </h2>
            <Card>
              {nextEvent ? (
                <div className="next-event">
                  <CalendarDays size={22} aria-hidden="true" className="quick-action__icon" />
                  <div className="next-event__text">
                    <span className="next-event__name">{nextEvent.name}</span>
                    <span className="muted">
                      {nextEvent.round !== null ? `Round ${nextEvent.round} - ` : ''}
                      {nextEvent.date}
                      {nextEvent.time ? ` at ${nextEvent.time}` : ''}
                    </span>
                    <span className="next-event__meta">
                      <Badge>{nextEvent.eventType}</Badge>
                      <Badge tone="primary">{formatCountdown(nextEvent.countdownHours)}</Badge>
                    </span>
                  </div>
                </div>
              ) : (
                <p className="muted">No upcoming race. Either there is no calendar yet, or every round is in the past.</p>
              )}
            </Card>
          </section>

          <section aria-labelledby="go-heading" className="stack stack--tight">
            <h2 id="go-heading" className="section-title">
              Go to
            </h2>
            <div className="link-list">
              <Link className="btn btn--secondary" to={routes.server(guildId, 'tiers')}>
                <Layers size={16} aria-hidden="true" />
                Games &amp; Tiers
              </Link>
              <Link className="btn btn--secondary" to={routes.server(guildId, 'settings')}>
                <SettingsIcon size={16} aria-hidden="true" />
                Settings
              </Link>
              <Link className="btn btn--secondary" to={routes.server(guildId, 'announcement')}>
                <Megaphone size={16} aria-hidden="true" />
                Announcement
              </Link>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

export function Overview() {
  const { guild } = useServer()
  const overview = useOverview(guild.id)

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        description={
          overview.status === 'ready' && overview.data.memberCount !== null ? `${guild.name} - ${overview.data.memberCount.toLocaleString()} members` : guild.name
        }
        leading={<Avatar src={guild.icon} name={guild.name} size={56} shape="rounded" />}
        actions={
          <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={overview.status === 'ready' && overview.refreshing === true} onClick={overview.reload}>
            Refresh
          </Button>
        }
      />

      {overview.status === 'loading' ? (
        <LoadingRegion label="Loading overview" className="stack">
          <div className="grid grid--stats">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="card">
                <Skeleton width={60} height={32} />
                <Skeleton width="70%" height={12} />
              </div>
            ))}
          </div>
          <Skeleton height={260} radius={12} />
        </LoadingRegion>
      ) : null}

      {overview.status === 'error' ? <ErrorState title="Could not load the overview" message={describeError(overview.error)} onRetry={overview.reload} /> : null}
      {overview.status === 'ready' ? <Loaded data={overview.data} guildId={guild.id} /> : null}
    </div>
  )
}
