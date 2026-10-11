import { ArrowLeft, Plus, RotateCw, Trash2, User, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import type { RacingTeam, RacingTeamDetail, RosterEntry } from '../../shared/types'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingRegion, Notice, PageHeader, Select, Skeleton, SortHeader, Stagger, TextField } from '../components'
import { useRacingTeam, useRacingTeams } from '../hooks/data'
import { useManageDenied } from '../hooks/useFiaDenied'
import { describeError, errorCode } from '../lib/errors'
import { formatDay, plural } from '../lib/format'
import { invalidateRacing } from '../lib/racingScope'
import {
  describeRacingError,
  matchesRosterFilter,
  matchesTeamFilter,
  MANAGE_SERVER_RULE,
  roleSummary,
  ROSTER_FILTER_OPTIONS,
  ROSTER_GETTERS,
  rosterName,
  rosterSearchFields,
  TEAM_FILTER_OPTIONS,
  TEAM_GETTERS
} from '../lib/racingView'
import type { RosterColumn, RosterFilter, TeamColumn, TeamFilter } from '../lib/racingView'
import { matchesQuery, nextSort, sortRows } from '../lib/tableView'
import type { SortState } from '../lib/tableView'
import { EsportsNote, useEsports } from './EsportsRoute'
import type { EsportsContext } from './EsportsRoute'
import { RacingTeamDialog } from './RacingTeamDialog'
import { AddMemberDialog, DriverProfileDialog, RemoveMemberDialog } from './RosterDialogs'

export const NO_EDIT_TEXT = 'Teams cannot be edited or deleted: no command does it (and a team\'s Discord role is created once and never renamed), so the API has no endpoint for it. To change or remove a team, do it in Discord.'

function Swatch({ color, small = false }: { color: string | null; small?: boolean }) {
  return <span className={`swatch${small ? ' swatch--sm' : ''}`} style={{ background: color ?? 'transparent' }} role="img" aria-label={color ? `Team colour ${color}` : 'No team colour'} />
}

// ── The list ────────────────────────────────────────────────────────────────

function TeamList({ teams, onOpen }: { teams: RacingTeam[]; onOpen: (team: RacingTeam) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<TeamFilter>('all')
  const [sort, setSort] = useState<SortState<TeamColumn> | null>({ key: 'name', direction: 'asc' })
  const onSort = (column: TeamColumn): void => setSort((current) => nextSort(current, column))

  const rows = sortRows(
    teams.filter((team) => matchesQuery([team.name, team.focus], query) && matchesTeamFilter(team, filter)),
    sort,
    TEAM_GETTERS
  )
  const filtering = query.trim() !== '' || filter !== 'all'

  return (
    <div className="stack stack--tight">
      <div className="table-tools table-tools--two">
        <div className="table-tools__search">
          <TextField label="Search teams" type="search" value={query} placeholder="Team name or class" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Select label="Show" value={filter} options={TEAM_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={(value) => setFilter(value as TeamFilter)} />
      </div>
      <div className="table-wrap">
        <table className="table" aria-describedby="racing-teams-count">
          <caption className="sr-only">Esports teams</caption>
          <thead>
            <tr>
              <SortHeader label="Team" column="name" sort={sort} onSort={onSort} />
              <SortHeader label="Class or category" column="focus" sort={sort} onSort={onSort} />
              <SortHeader label="Members" column="members" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <Stagger as="tbody">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="table__empty">
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
                  {!team.roleExists ? <Badge tone="danger">Discord role deleted</Badge> : null}
                </th>
                <td>{team.focus === '' ? <span className="muted">Not set</span> : team.focus}</td>
                <td className="table__num">{team.memberCount === 0 ? <Badge>No members</Badge> : team.memberCount}</td>
              </tr>
            ))}
          </Stagger>
        </table>
      </div>
      <p className="muted table-count" id="racing-teams-count" aria-live="polite">
        {filtering ? `Showing ${rows.length} of ${plural(teams.length, 'team')}` : plural(teams.length, 'team')}
      </p>
    </div>
  )
}

// ── One team ────────────────────────────────────────────────────────────────

function TeamDetail({ ctx, name, onBack }: { ctx: EsportsContext; name: string; onBack: () => void }) {
  const team = useRacingTeam(ctx.guild.id, ctx.game, name)
  const manage = useManageDenied(ctx.guild.id)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<RosterEntry | null>(null)
  const [profileOf, setProfileOf] = useState<RosterEntry | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RosterFilter>('all')
  const [sort, setSort] = useState<SortState<RosterColumn> | null>({ key: 'role', direction: 'asc' })
  const onSort = (column: RosterColumn): void => setSort((current) => nextSort(current, column))

  const data: RacingTeamDetail | null = team.status === 'ready' ? team.data : null
  const rows = data
    ? sortRows(
        data.roster.filter((entry) => matchesQuery(rosterSearchFields(entry), query) && matchesRosterFilter(entry, filter)),
        sort,
        ROSTER_GETTERS
      )
    : []
  const filtering = query.trim() !== '' || filter !== 'all'
  const gone = team.status === 'error' && errorCode(team.error) === 'team_not_found'

  return (
    <div className="stack">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={onBack}>
          All teams
        </Button>
      </div>

      {team.status === 'loading' ? (
        <LoadingRegion label="Loading the team" className="stack">
          <Skeleton height={90} radius={12} />
          <Skeleton height={220} radius={12} />
        </LoadingRegion>
      ) : null}
      {gone ? (
        <EmptyState title="This team no longer exists" description="It may have been removed in Discord. Go back to the list." action={<Button onClick={onBack}>Back to the teams</Button>} />
      ) : null}
      {team.status === 'error' && !gone ? <ErrorState title="Could not load the team" message={describeRacingError(team.error, ctx.gameLabel)} onRetry={team.reload} /> : null}

      {data ? (
        <>
          <Card className="team-head">
            <Swatch color={data.color} />
            <div className="team-head__text">
              <h2>{data.name}</h2>
              <p className="muted">
                {data.focus === '' ? 'No class or category' : data.focus} - {data.color ?? 'no colour'} - {plural(data.memberCount, 'member')} ({roleSummary(data.roster)})
              </p>
              <p className="muted">
                Discord role: {data.roleName ? <strong>{data.roleName}</strong> : 'deleted or not found'}
                {!data.roleExists ? ' (members cannot be added while it is gone)' : ''}
              </p>
            </div>
            <Button icon={<UserPlus size={16} aria-hidden="true" />} disabled={manage.denied} title={manage.denied ? 'Needs the Manage Server permission' : undefined} onClick={() => setAdding(true)}>
              Add a member
            </Button>
          </Card>

          {manage.denied ? (
            <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
              {MANAGE_SERVER_RULE} The roster stays readable. If your permissions changed, choose Check again.
            </Notice>
          ) : null}

          {data.roster.length === 0 ? (
            <EmptyState
              icon={<Users size={24} aria-hidden="true" />}
              title="This team has no members yet"
              description="Add a member: they get the team's Discord role and a place on the roster."
              action={
                <Button icon={<UserPlus size={16} aria-hidden="true" />} disabled={manage.denied} onClick={() => setAdding(true)}>
                  Add the first member
                </Button>
              }
            />
          ) : (
            <div className="stack stack--tight">
              <div className="table-tools table-tools--two">
                <div className="table-tools__search">
                  <TextField label="Search the roster" type="search" value={query} placeholder="Name or role" autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
                </div>
                <Select label="Show" value={filter} options={ROSTER_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={(value) => setFilter(value as RosterFilter)} />
              </div>
              <div className="table-wrap">
                <table className="table" aria-describedby="racing-roster-count">
                  <caption className="sr-only">Roster of {data.name}</caption>
                  <thead>
                    <tr>
                      <SortHeader label="Member" column="member" sort={sort} onSort={onSort} />
                      <SortHeader label="Role" column="role" sort={sort} onSort={onSort} />
                      <SortHeader label="Joined" column="joined" sort={sort} onSort={onSort} />
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <Stagger as="tbody">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="table__empty">
                          No member matches your search or filter.
                        </td>
                      </tr>
                    ) : null}
                    {rows.map((entry) => (
                      <tr key={entry.userId}>
                        <th scope="row" className="table__key">
                          {rosterName(entry)}
                          <span className="table__note">@{entry.username}</span>
                          {!entry.inServer ? <Badge>Left the server</Badge> : null}
                        </th>
                        <td>{entry.role === '' ? <span className="muted">None</span> : <Badge tone="primary">{entry.role}</Badge>}</td>
                        <td>{formatDay(entry.joinedAt)}</td>
                        <td>
                          <div className="row-actions">
                            <Button variant="ghost" size="sm" iconOnly icon={<User size={16} aria-hidden="true" />} aria-label={`${ctx.gameLabel} profile of ${rosterName(entry)}`} title="All teams and roles in this game" onClick={() => setProfileOf(entry)} />
                            <Button variant="ghost" size="sm" iconOnly disabled={manage.denied} icon={<Trash2 size={16} aria-hidden="true" />} aria-label={`Remove ${rosterName(entry)} from ${data.name}`} title="Remove from the roster" onClick={() => setRemoving(entry)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Stagger>
                </table>
              </div>
              <p className="muted table-count" id="racing-roster-count" aria-live="polite">
                {filtering ? `Showing ${rows.length} of ${plural(data.roster.length, 'member')}` : plural(data.roster.length, 'member')}. A member who left the server can still be removed.
              </p>
            </div>
          )}
        </>
      ) : null}

      {adding && data ? <AddMemberDialog guildId={ctx.guild.id} game={ctx.game} gameLabel={ctx.gameLabel} team={data} onClose={() => setAdding(false)} onAdded={() => setAdding(false)} /> : null}
      {removing && data ? <RemoveMemberDialog guildId={ctx.guild.id} game={ctx.game} gameLabel={ctx.gameLabel} team={data} entry={removing} onClose={() => setRemoving(null)} onRemoved={() => setRemoving(null)} /> : null}
      {profileOf ? <DriverProfileDialog guildId={ctx.guild.id} game={ctx.game} gameLabel={ctx.gameLabel} userId={profileOf.userId} fallbackName={rosterName(profileOf)} onClose={() => setProfileOf(null)} /> : null}
    </div>
  )
}

// ── The screen ──────────────────────────────────────────────────────────────

function TeamsScreen({ ctx }: { ctx: EsportsContext }) {
  const teams = useRacingTeams(ctx.guild.id, ctx.game)
  const manage = useManageDenied(ctx.guild.id)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const list = teams.status === 'ready' ? teams.data : []
  const current = selected === null ? null : (list.find((team) => team.name.toLowerCase() === selected.toLowerCase()) ?? null)

  return (
    <div className="page">
      <PageHeader
        title="Teams"
        description={`${ctx.guild.name} - ${ctx.gameLabel} esports teams, rosters and roles`}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={teams.status === 'ready' && teams.refreshing === true} onClick={() => invalidateRacing(ctx.guild.id, ctx.game)}>
              Refresh
            </Button>
            <Button icon={<Plus size={16} aria-hidden="true" />} disabled={manage.denied} title={manage.denied ? 'Needs the Manage Server permission' : undefined} onClick={() => setCreating(true)}>
              Create a team
            </Button>
          </div>
        }
      />
      <EsportsNote game={ctx.game} gameLabel={ctx.gameLabel} />
      {manage.denied && selected === null ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
          {MANAGE_SERVER_RULE} The teams stay readable. If your permissions changed, choose Check again.
        </Notice>
      ) : null}

      {teams.status === 'loading' ? (
        <LoadingRegion label="Loading the teams" className="stack">
          <Skeleton height={40} />
          <Skeleton height={220} radius={12} />
        </LoadingRegion>
      ) : null}
      {teams.status === 'error' ? <ErrorState title="Could not load the teams" message={errorCode(teams.error) === 'forbidden' ? 'You no longer have the FIA, STAFF or Administrator role in this server, so the teams cannot be read.' : describeError(teams.error)} onRetry={teams.reload} /> : null}

      {selected !== null && teams.status === 'ready' && current === null ? (
        <>
          <Notice tone="info">The team {selected} no longer exists. It may have been removed in Discord.</Notice>
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Back to the teams
          </Button>
        </>
      ) : null}

      {current ? <TeamDetail key={current.name} ctx={ctx} name={current.name} onBack={() => setSelected(null)} /> : null}

      {teams.status === 'ready' && selected === null ? (
        <>
          {list.length === 0 ? (
            <EmptyState
              icon={<Users size={24} aria-hidden="true" />}
              title={`No ${ctx.gameLabel} teams yet`}
              description="Create the first team: Nexus makes a Discord role in the team colour, and the members you add get it."
              action={
                <Button icon={<Plus size={16} aria-hidden="true" />} disabled={manage.denied} onClick={() => setCreating(true)}>
                  Create the first team
                </Button>
              }
            />
          ) : (
            <TeamList teams={list} onOpen={(team) => setSelected(team.name)} />
          )}
          <p className="muted">{NO_EDIT_TEXT}</p>
        </>
      ) : null}

      {creating ? (
        <RacingTeamDialog
          guildId={ctx.guild.id}
          game={ctx.game}
          gameLabel={ctx.gameLabel}
          onClose={() => setCreating(false)}
          onCreated={(team) => {
            setCreating(false)
            setSelected(team.name)
          }}
        />
      ) : null}
    </div>
  )
}

/** Keyed by server AND game: switching either rebuilds the screen, so nothing of the old game's lists, forms or dialogs is left. */
export function EsportsTeams() {
  const ctx = useEsports()
  return <TeamsScreen key={ctx.scope} ctx={ctx} />
}
