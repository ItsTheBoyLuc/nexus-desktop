import { ArrowLeft, BarChart3, Plus, RotateCw, UserMinus, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import type { Team, TeamDriver } from '../../shared/types'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingRegion, Notice, PageHeader, Select, Skeleton, SortHeader, Stagger, TextField, useToast, WriteProblemNotice } from '../components'
import { useTeams } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { plural } from '../lib/format'
import { invalidateTeams } from '../lib/invalidation'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { canManageTeam, describeRemoval, DRIVER_GETTERS, findTeam, TEAM_GETTERS } from '../lib/teamView'
import type { DriverColumn, TeamColumn } from '../lib/teamView'
import { AddDriverDialog } from './AddDriverDialog'
import { DriverStatsDialog } from './DriverStatsDialog'
import { F1Only } from './F1Only'
import { useLeague } from './LeagueRoute'
import { TeamDialog } from './TeamDialog'

function Swatch({ color, small = false }: { color: string | null; small?: boolean }) {
  return <span className={`swatch${small ? ' swatch--sm' : ''}`} style={{ background: color ?? 'transparent' }} role="img" aria-label={color ? `Team colour ${color}` : 'No team colour'} />
}

type DriversFilter = 'all' | 'with' | 'without'

function TeamList({ teams, onOpen }: { teams: Team[]; onOpen: (team: Team) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DriversFilter>('all')
  const [sort, setSort] = useState<SortState<TeamColumn> | null>({ key: 'name', direction: 'asc' })
  const onSort = (column: TeamColumn): void => setSort((current) => nextSort(current, column))

  const filtered = teams.filter((team) => matchesQuery([team.name, team.abbreviation], query) && (filter === 'all' || (filter === 'with') === team.drivers.length > 0))
  const rows = sortRows(filtered, sort, TEAM_GETTERS)
  const filtering = query.trim() !== '' || filter !== 'all'

  return (
    <div className="stack stack--tight">
      <div className="table-tools table-tools--two">
        <div className="table-tools__search">
          <TextField label="Search teams" type="search" value={query} placeholder="Team name or abbreviation" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Select
          label="Drivers"
          value={filter}
          options={[
            { value: 'all', label: 'All teams' },
            { value: 'with', label: 'With drivers' },
            { value: 'without', label: 'Without drivers' }
          ]}
          onChange={(value) => setFilter(value as DriversFilter)}
        />
      </div>
      <div className="table-wrap">
        <table className="table" aria-describedby="teams-count">
          <caption className="sr-only">Teams</caption>
          <thead>
            <tr>
              <SortHeader label="Team" column="name" sort={sort} onSort={onSort} />
              <SortHeader label="Abbreviation" column="abbreviation" sort={sort} onSort={onSort} />
              <SortHeader label="Drivers" column="drivers" sort={sort} onSort={onSort} numeric />
              <SortHeader label="Points" column="points" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <Stagger as="tbody">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="table__empty">
                  No team matches your search or filter.
                </td>
              </tr>
            ) : null}
            {rows.map((team) => (
              <tr key={team.name}>
                <th scope="row" className="table__key">
                  <button type="button" className="link-btn" onClick={() => onOpen(team)}>
                    <Swatch color={team.color} small />
                    <span>{team.name}</span>
                  </button>
                </th>
                <td>{team.abbreviation}</td>
                <td className="table__num">
                  {team.drivers.length === 0 ? <Badge>No drivers</Badge> : team.drivers.length}
                </td>
                <td className="table__num">{team.points}</td>
              </tr>
            ))}
          </Stagger>
        </table>
      </div>
      <p className="muted table-count" id="teams-count" aria-live="polite">
        {filtering ? `Showing ${rows.length} of ${plural(teams.length, 'team')}` : plural(teams.length, 'team')}
      </p>
    </div>
  )
}

function TeamDetail({ guildId, team, onBack }: { guildId: string; team: Team; onBack: () => void }) {
  const toast = useToast()
  const write = useWriteAction()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<DriverColumn> | null>({ key: 'number', direction: 'asc' })
  const [adding, setAdding] = useState(false)
  const [statsOf, setStatsOf] = useState<TeamDriver | null>(null)
  const [pending, setPending] = useState<TeamDriver | null>(null)
  const [problem, setProblem] = useState<WriteProblem | null>(null)

  const manageable = canManageTeam(team)
  const onSort = (column: DriverColumn): void => setSort((current) => nextSort(current, column))
  const rows = sortRows(
    team.drivers.filter((driver) => matchesQuery([driver.displayName, driver.username, driver.number === null ? '' : String(driver.number)], query)),
    sort,
    DRIVER_GETTERS
  )

  const remove = async (): Promise<void> => {
    if (!pending) return
    const target = pending
    setProblem(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.removeDriver(guildId, team.name, target.userId)))
    if (!outcome) return
    setPending(null)
    if (outcome.ok) {
      invalidateTeams(guildId)
      toast.push({ tone: 'success', title: 'Driver removed', message: describeRemoval(target.displayName, team.name, outcome.value) })
      return
    }
    if (errorCode(outcome.error) === 'driver_not_found' || errorCode(outcome.error) === 'team_not_found') invalidateTeams(guildId)
    setProblem(writeProblem(outcome.error, 'The removal'))
  }

  return (
    <div className="stack">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={onBack}>
          All teams
        </Button>
      </div>
      <Card className="team-head">
        <Swatch color={team.color} />
        <div className="team-head__text">
          <h2>{team.name}</h2>
          <p className="muted">
            {team.abbreviation} - {team.color ?? 'no colour'} - {plural(team.drivers.length, 'driver')} - {team.points} points
          </p>
          <p className="muted">
            Discord role: {team.roleName ? <strong>{team.roleName}</strong> : 'deleted or not found'} - Private channel: {team.channelName ? <strong># {team.channelName}</strong> : 'deleted or not found'}
          </p>
        </div>
        <Button icon={<UserPlus size={16} aria-hidden="true" />} disabled={!manageable || write.busy} onClick={() => setAdding(true)}>
          Add driver
        </Button>
      </Card>

      {!manageable ? (
        <Notice tone="warning">This team name contains a slash, so the API cannot address it. Its roster can be read here, but drivers can only be added or removed in Discord.</Notice>
      ) : null}
      <WriteProblemNotice problem={problem} onRefresh={() => { setProblem(null); invalidateTeams(guildId) }} refreshLabel="Refresh the teams" />

      {team.drivers.length === 0 ? (
        <EmptyState
          icon={<Users size={24} aria-hidden="true" />}
          title="This team has no drivers yet"
          description="Add a driver to give a member the team role and put them on the roster."
          action={
            <Button icon={<UserPlus size={16} aria-hidden="true" />} disabled={!manageable} onClick={() => setAdding(true)}>
              Add the first driver
            </Button>
          }
        />
      ) : (
        <div className="stack stack--tight">
          <TextField label="Search the roster" type="search" value={query} placeholder="Name or driver number" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
          <div className="table-wrap">
            <table className="table" aria-describedby="roster-count">
              <caption className="sr-only">Roster of {team.name}</caption>
              <thead>
                <tr>
                  <SortHeader label="No." column="number" sort={sort} onSort={onSort} numeric />
                  <SortHeader label="Driver" column="driver" sort={sort} onSort={onSort} />
                  <SortHeader label="Points" column="points" sort={sort} onSort={onSort} numeric />
                  <SortHeader label="Wins" column="wins" sort={sort} onSort={onSort} numeric />
                  <SortHeader label="Podiums" column="podiums" sort={sort} onSort={onSort} numeric />
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <Stagger as="tbody">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table__empty">
                      No driver matches your search.
                    </td>
                  </tr>
                ) : null}
                {rows.map((driver) => (
                  <tr key={driver.userId}>
                    <td className="table__num">{driver.number !== null ? driver.number : <span className="muted">-</span>}</td>
                    <th scope="row" className="table__key">
                      {driver.displayName}
                      <span className="table__note">@{driver.username}</span>
                    </th>
                    <td className="table__num">{driver.points}</td>
                    <td className="table__num">{driver.wins}</td>
                    <td className="table__num">{driver.podiums}</td>
                    <td>
                      <div className="row-actions">
                        <Button variant="ghost" size="sm" iconOnly icon={<BarChart3 size={16} aria-hidden="true" />} onClick={() => setStatsOf(driver)} aria-label={`Stats of ${driver.displayName}`} title="Driver stats" />
                        <Button variant="ghost" size="sm" iconOnly disabled={!manageable || write.busy} icon={<UserMinus size={16} aria-hidden="true" />} onClick={() => setPending(driver)} aria-label={`Remove ${driver.displayName} from ${team.name}`} title="Remove from team" />
                      </div>
                    </td>
                  </tr>
                ))}
              </Stagger>
            </table>
          </div>
          <p className="muted table-count" id="roster-count" aria-live="polite">
            {plural(team.drivers.length, 'driver')}. Points are the drivers&apos; points added up.
          </p>
        </div>
      )}

      {adding ? <AddDriverDialog guildId={guildId} team={team} onClose={() => setAdding(false)} /> : null}
      {statsOf ? <DriverStatsDialog guildId={guildId} userId={statsOf.userId} name={statsOf.displayName} onClose={() => setStatsOf(null)} /> : null}

      <ConfirmDialog open={pending !== null} title={pending ? `Remove ${pending.displayName} from ${team.name}?` : 'Remove driver?'} confirmLabel="Remove driver" busy={write.busy} onConfirm={() => void remove()} onCancel={() => setPending(null)}>
        {pending ? (
          <>
            <p>
              This removes <strong>{pending.displayName}</strong> (@{pending.username}) from the roster of <strong>{team.name}</strong>.
            </p>
            <ul className="plain-list">
              <li>
                The team role {team.roleName ? <strong>{team.roleName}</strong> : 'of this team'} is taken away from them in Discord. If they have left the server, only the roster entry is removed.
              </li>
              <li>
                Their <strong>points remain</strong> ({pending.points} points, {plural(pending.wins, 'win')}, {plural(pending.podiums, 'podium')}): they stay in the driver standings with no team, and the team&apos;s points go down by that amount.
              </li>
              <li>The team and its private channel are not deleted. You can add the driver again later.</li>
            </ul>
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}

function TeamsScreen() {
  const { guild } = useLeague()
  const teams = useTeams(guild.id)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const list = teams.status === 'ready' ? teams.data : []
  const current = findTeam(list, selected)

  return (
    <div className="page">
      <PageHeader
        title="Teams"
        description={`${guild.name} - teams, rosters and driver numbers`}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={teams.status === 'ready' && teams.refreshing === true} onClick={teams.reload}>
              Refresh
            </Button>
            <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>
              Create team
            </Button>
          </div>
        }
      />

      {teams.status === 'loading' ? (
        <LoadingRegion label="Loading the teams" className="stack">
          <Skeleton height={40} />
          <Skeleton height={220} radius={12} />
        </LoadingRegion>
      ) : null}

      {teams.status === 'error' ? <ErrorState title="Could not load the teams" message={describeError(teams.error)} onRetry={teams.reload} /> : null}

      {teams.status === 'ready' && current ? <TeamDetail key={current.name} guildId={guild.id} team={current} onBack={() => setSelected(null)} /> : null}

      {teams.status === 'ready' && !current ? (
        <>
          {selected !== null ? <Notice tone="info">The team {selected} no longer exists. It may have been removed in Discord.</Notice> : null}
          {teams.data.length === 0 ? (
            <EmptyState
              icon={<Users size={24} aria-hidden="true" />}
              title="No teams yet"
              description="Create the first team: Nexus makes a Discord role and a private team channel for it."
              action={
                <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>
                  Create the first team
                </Button>
              }
            />
          ) : (
            <TeamList teams={teams.data} onOpen={(team) => setSelected(team.name)} />
          )}
          <p className="muted">Teams cannot be edited or deleted here: the league has no command for it, so the API has no endpoint. To change or remove a team, do it in Discord.</p>
        </>
      ) : null}

      {creating ? <TeamDialog guildId={guild.id} onClose={() => setCreating(false)} onCreated={() => setSelected(null)} /> : null}
    </div>
  )
}

export function Teams() {
  return (
    <F1Only page="teams">
      <TeamsScreen />
    </F1Only>
  )
}
