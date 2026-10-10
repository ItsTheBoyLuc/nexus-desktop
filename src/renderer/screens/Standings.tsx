import { ClipboardPenLine, RotateCw, Trophy } from 'lucide-react'
import { useState } from 'react'
import type { Standings as StandingsData } from '../../shared/types'
import { Badge, Button, EmptyState, ErrorState, LoadingRegion, Notice, PageHeader, Select, Skeleton, SortHeader, Tabs, tabPanelProps, TextField } from '../components'
import { useServerSettings, useStandings, useTeams } from '../hooks/data'
import { useFiaDenied } from '../hooks/useFiaDenied'
import { describeError } from '../lib/errors'
import { plural } from '../lib/format'
import { invalidateStandings } from '../lib/invalidation'
import { DRIVER_STANDING_GETTERS, knownDrivers, TEAM_STANDING_GETTERS } from '../lib/resultsFlow'
import type { DriverStandingColumn, TeamStandingColumn } from '../lib/resultsFlow'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { F1Only } from './F1Only'
import { useLeague } from './LeagueRoute'
import { PointsSystemEditor } from './PointsSystemEditor'
import { ResultsForm } from './ResultsForm'

type TabId = 'drivers' | 'constructors' | 'points'

function DriverTable({ standings }: { standings: StandingsData }) {
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState('all')
  const [sort, setSort] = useState<SortState<DriverStandingColumn> | null>({ key: 'position', direction: 'asc' })
  const onSort = (column: DriverStandingColumn): void => setSort((current) => nextSort(current, column))

  const teams = [...new Set(standings.drivers.map((row) => row.team))].sort((a, b) => a.localeCompare(b))
  const filtered = standings.drivers.filter((row) => matchesQuery([row.username, row.team], query) && (team === 'all' || row.team === team))
  const rows = sortRows(filtered, sort, DRIVER_STANDING_GETTERS)
  const filtering = query.trim() !== '' || team !== 'all'

  return (
    <div className="stack stack--tight">
      <div className="table-tools table-tools--two">
        <div className="table-tools__search">
          <TextField label="Search drivers" type="search" value={query} placeholder="Driver or team" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Select label="Team" value={team} options={[{ value: 'all', label: 'All teams' }, ...teams.map((name) => ({ value: name, label: name === '—' ? 'No team' : name }))]} onChange={setTeam} />
      </div>
      <div className="table-wrap">
        <table className="table table--wide" aria-describedby="wdc-count">
          <caption className="sr-only">World Drivers&apos; Championship</caption>
          <thead>
            <tr>
              <SortHeader label="Pos" column="position" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Driver" column="driver" sort={sort} onSort={onSort} />
              <SortHeader label="Team" column="team" sort={sort} onSort={onSort} />
              <SortHeader label="Points" column="points" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Wins" column="wins" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Podiums" column="podiums" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Gap" column="gap" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="table__empty">
                  No driver matches your search or filter.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.userId}>
                <td className="table__num">{row.position}</td>
                <th scope="row" className="table__key">
                  {row.username}
                </th>
                <td>{row.team === '—' ? <span className="muted">No team</span> : row.team}</td>
                <td className="table__num">{row.points}</td>
                <td className="table__num">{row.wins}</td>
                <td className="table__num">{row.podiums}</td>
                <td className="table__num">{row.gap === 0 ? <span className="muted">Leader</span> : `-${row.gap}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted table-count" id="wdc-count" aria-live="polite">
        {filtering ? `Showing ${rows.length} of ${plural(standings.drivers.length, 'driver')}` : plural(standings.drivers.length, 'driver')}
      </p>
    </div>
  )
}

function TeamTable({ standings }: { standings: StandingsData }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<TeamStandingColumn> | null>({ key: 'position', direction: 'asc' })
  const onSort = (column: TeamStandingColumn): void => setSort((current) => nextSort(current, column))
  const rows = sortRows(
    standings.constructors.filter((row) => matchesQuery([row.team], query)),
    sort,
    TEAM_STANDING_GETTERS
  )

  return (
    <div className="stack stack--tight">
      <TextField label="Search teams" type="search" value={query} placeholder="Team name" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
      <div className="table-wrap">
        <table className="table table--wide" aria-describedby="wcc-count">
          <caption className="sr-only">World Constructors&apos; Championship</caption>
          <thead>
            <tr>
              <SortHeader label="Pos" column="position" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Team" column="team" sort={sort} onSort={onSort} />
              <SortHeader label="Points" column="points" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Drivers" column="drivers" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Gap" column="gap" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="table__empty">
                  No team matches your search.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.team}>
                <td className="table__num">{row.position}</td>
                <th scope="row" className="table__key">
                  {row.team}
                </th>
                <td className="table__num">{row.points}</td>
                <td className="table__num">{row.drivers}</td>
                <td className="table__num">{row.gap === 0 ? <span className="muted">Leader</span> : `-${row.gap}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted table-count" id="wcc-count" aria-live="polite">
        {plural(standings.constructors.length, 'team')}. A team&apos;s points are its drivers&apos; points added up.
      </p>
    </div>
  )
}

function StandingsScreen() {
  const { guild } = useLeague()
  const standings = useStandings(guild.id)
  const teams = useTeams(guild.id)
  const settings = useServerSettings(guild.id)
  const fia = useFiaDenied(guild.id)

  const [tab, setTab] = useState<TabId>('drivers')
  const [entering, setEntering] = useState(false)
  const [lostNotice, setLostNotice] = useState(false)

  const data = standings.status === 'ready' ? standings.data : null
  const known = knownDrivers(teams.status === 'ready' ? teams.data : [], data)

  return (
    <div className="page">
      <PageHeader
        title="Standings"
        description={`${guild.name} - driver and team championships`}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={standings.status === 'ready' && standings.refreshing === true} onClick={standings.reload}>
              Refresh
            </Button>
            {!entering ? (
              <Button icon={<ClipboardPenLine size={16} aria-hidden="true" />} disabled={fia.denied || standings.status === 'loading'} title={fia.denied ? 'Only the FIA role or Administrators can record results' : undefined} onClick={() => { setEntering(true); setLostNotice(false) }}>
                Enter race results
              </Button>
            ) : null}
          </div>
        }
      />

      {fia.denied && !entering && tab !== 'points' ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={fia.reset}>Check again</Button>}>
          Recording race results and changing the points system need the FIA role or the Administrator permission, and the server refused your account. The tables below stay readable. If your roles changed, choose Check again.
        </Notice>
      ) : null}

      {lostNotice && !entering ? (
        <Notice tone="warning" action={<Button variant="secondary" size="sm" onClick={() => setLostNotice(false)}>Dismiss</Button>}>
          The last attempt to record a race got no clear answer, so it may or may not have been recorded. The tables below were just read again from the server: compare them with what you expected before you enter anything else.
        </Notice>
      ) : null}

      {entering ? (
        <ResultsForm
          guildId={guild.id}
          defaultSeason={settings.status === 'ready' ? String(settings.data.effectiveSeason) : ''}
          known={known}
          denied={fia.denied}
          onDenied={fia.markDenied}
          onCheckAgain={fia.reset}
          onLeave={(reason) => {
            setEntering(false)
            if (reason === 'lost') setLostNotice(true)
            invalidateStandings(guild.id)
          }}
        />
      ) : (
        <>
          <Tabs
            label="Standings"
            idPrefix="standings"
            active={tab}
            onChange={(id) => setTab(id as TabId)}
            tabs={[
              { id: 'drivers', label: 'Drivers (WDC)', badge: data?.drivers.length },
              { id: 'constructors', label: 'Teams (WCC)', badge: data?.constructors.length },
              { id: 'points', label: 'Points system' }
            ]}
          />

          {tab !== 'points' ? (
            <div {...tabPanelProps('standings', tab)} className="stack">
              {standings.status === 'loading' ? (
                <LoadingRegion label="Loading the standings" className="stack">
                  <Skeleton height={40} />
                  <Skeleton height={240} radius={12} />
                </LoadingRegion>
              ) : null}
              {standings.status === 'error' ? <ErrorState title="Could not load the standings" message={describeError(standings.error)} onRetry={standings.reload} /> : null}
              {data && tab === 'drivers' ? (
                data.drivers.length === 0 ? (
                  <EmptyState icon={<Trophy size={24} aria-hidden="true" />} title="No drivers in the standings yet" description="Drivers appear here once they are added to a team or a race is recorded." />
                ) : (
                  <DriverTable standings={data} />
                )
              ) : null}
              {data && tab === 'constructors' ? (
                data.constructors.length === 0 ? (
                  <EmptyState icon={<Trophy size={24} aria-hidden="true" />} title="No teams in the standings yet" description="Create a team on the Teams page first." />
                ) : (
                  <TeamTable standings={data} />
                )
              ) : null}
              <p className="muted">
                The tables show the one running championship of this server, exactly as the server returns it
                <Badge>No season selector</Badge>: the API keeps a single set of totals, so there is no way to look at another season.
              </p>
            </div>
          ) : (
            <div {...tabPanelProps('standings', 'points')}>
              <PointsSystemEditor guildId={guild.id} denied={fia.denied} onDenied={fia.markDenied} onCheckAgain={fia.reset} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function Standings() {
  return (
    <F1Only page="standings">
      <StandingsScreen />
    </F1Only>
  )
}
