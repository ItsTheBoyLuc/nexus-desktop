import { ArrowLeft, Ban, Eraser, Plus } from 'lucide-react'
import { useState } from 'react'
import type { PenaltyHistoryItem } from '../../shared/types'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingRegion, Notice, Skeleton, SortHeader, TextField } from '../components'
import { usePenaltyHistory } from '../hooks/data'
import { describeError, errorCode } from '../lib/errors'
import { formatWhen, plural } from '../lib/format'
import { banLabel } from '../lib/penaltyActions'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'

type HistoryColumn = 'index' | 'points' | 'reason' | 'race' | 'expires' | 'when'

const GETTERS: Record<HistoryColumn, (item: PenaltyHistoryItem) => string | number | null> = {
  index: (item) => item.index,
  points: (item) => item.points,
  reason: (item) => item.reason,
  race: (item) => item.race,
  expires: (item) => item.expiresAfterRace, // an admin removal never expires: it sorts last
  when: (item) => {
    const time = Date.parse(item.timestamp)
    return Number.isNaN(time) ? null : time
  }
}

interface Props {
  guildId: string
  /** The driver's name as the overview shows it (the server finds drivers by name). */
  driver: string
  season: number
  currentSeason: number
  /** The FIA role was refused earlier: clearing and bans are off. */
  fiaDenied: boolean
  onBack: () => void
  onAddPoints: () => void
  onClear: (total: number) => void
  onBan: () => void
}

/** One driver's whole penalty history in one season (the command shows the last 10; this shows all of it), with the driver's actions. */
export function DriverPenaltyHistory({ guildId, driver, season, currentSeason, fiaDenied, onBack, onAddPoints, onClear, onBan }: Props) {
  const history = usePenaltyHistory(guildId, driver, season)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<HistoryColumn> | null>({ key: 'index', direction: 'asc' })
  const onSort = (column: HistoryColumn): void => setSort((current) => nextSort(current, column))
  const fiaTitle = 'Needs the FIA role or the Administrator permission'

  return (
    <div className="stack">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={onBack}>
          All drivers
        </Button>
      </div>

      {history.status === 'loading' ? (
        <LoadingRegion label="Loading the penalty history" className="stack">
          <Skeleton height={80} radius={12} />
          <Skeleton height={200} radius={12} />
        </LoadingRegion>
      ) : null}

      {history.status === 'error' && errorCode(history.error) === 'driver_not_found' ? (
        <EmptyState
          title={`${driver} has no penalty record in season ${season}`}
          description="Nothing was ever recorded for this driver in that season, or it was cleared. You can still add points or give a ban."
          action={
            <div className="header-actions">
              <Button icon={<Plus size={16} aria-hidden="true" />} onClick={onAddPoints}>
                Add penalty points
              </Button>
              <Button variant="secondary" onClick={onBack}>
                Back to the overview
              </Button>
            </div>
          }
        />
      ) : null}
      {history.status === 'error' && errorCode(history.error) !== 'driver_not_found' ? <ErrorState title="Could not load the history" message={describeError(history.error)} onRetry={history.reload} /> : null}

      {history.status === 'ready' ? (
        <>
          <Card className="stack">
            <div className="section-head">
              <h2>{history.data.displayName}</h2>
              <div className="header-actions">
                <Badge tone={history.data.ban === 'none' ? 'neutral' : 'danger'}>{banLabel(history.data)}</Badge>
                {history.data.totalPoints > 0 ? <Badge tone="primary">{plural(history.data.totalPoints, 'point')}</Badge> : <Badge>0 points</Badge>}
              </div>
            </div>
            <p className="muted">
              Season {history.data.season}
              {history.data.season === currentSeason ? ' (the current season)' : ''} - {plural(history.data.incidents, 'incident')}. The history lists every entry, oldest first.
            </p>
            <div className="header-actions">
              <Button icon={<Plus size={16} aria-hidden="true" />} onClick={onAddPoints}>
                Add penalty points
              </Button>
              <Button variant="secondary" icon={<Eraser size={16} aria-hidden="true" />} disabled={fiaDenied} title={fiaDenied ? fiaTitle : undefined} onClick={() => onClear(history.data.totalPoints)}>
                Clear points
              </Button>
              <Button variant="secondary" icon={<Ban size={16} aria-hidden="true" />} disabled={fiaDenied} title={fiaDenied ? fiaTitle : undefined} onClick={onBan}>
                Give or remove a ban
              </Button>
            </div>
            {fiaDenied ? <Notice tone="danger">Clearing points and bans need the FIA role or the Administrator permission, and the server refused your account. The history stays readable.</Notice> : null}
          </Card>

          {history.data.history.length === 0 ? (
            <EmptyState title="No entries" description="The history of this driver is empty in this season (a ban was given without points, or the history was cleared)." />
          ) : (
            <div className="stack stack--tight">
              <TextField label="Search the history" type="search" value={query} placeholder="Reason or race" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
              <div className="table-wrap">
                <table className="table table--wide" aria-describedby="history-count">
                  <caption className="sr-only">Penalty history of {history.data.displayName} in season {history.data.season}</caption>
                  <thead>
                    <tr>
                      <SortHeader label="#" column="index" sort={sort} onSort={onSort} numeric />
                      <SortHeader label="Points" column="points" sort={sort} onSort={onSort} numeric />
                      <SortHeader label="Reason" column="reason" sort={sort} onSort={onSort} />
                      <SortHeader label="Race" column="race" sort={sort} onSort={onSort} />
                      <SortHeader label="Expires after race" column="expires" sort={sort} onSort={onSort} numeric />
                      <SortHeader label="When" column="when" sort={sort} onSort={onSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(
                      history.data.history.filter((item) => matchesQuery([item.reason, item.race], query)),
                      sort,
                      GETTERS
                    ).map((item) => (
                      <tr key={item.index}>
                        <td className="table__num">{item.index}</td>
                        <td className="table__num">{item.points > 0 ? `+${item.points}` : item.points}</td>
                        <td className="plain-text">{item.reason}</td>
                        <td>{item.race}</td>
                        <td className="table__num">{item.expiresAfterRace === null ? <span className="muted">Never</span> : item.expiresAfterRace}</td>
                        <td>{formatWhen(item.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted table-count" id="history-count" aria-live="polite">
                {plural(history.data.history.length, 'entry', 'entries')}. A negative entry is points an admin removed; it never expires.
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
