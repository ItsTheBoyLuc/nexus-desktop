import { Users, X } from 'lucide-react'
import { useId } from 'react'
import { MAX_PING_ROLES } from '../../shared/pingRoles'
import type { RacingTeamRole, Role } from '../../shared/types'
import type { Loaded } from '../hooks/data'
import { memberCountText, NOT_MENTIONABLE_WARNING, pingOptions, resolvePingRoles, teamRoleSelection } from '../lib/pingRoles'
import { Badge } from './Badge'
import { Button } from './Button'
import { Notice } from './Notice'
import { SearchSelect } from './SearchSelect'
import { Skeleton } from './Skeleton'

interface PingRolesFieldProps {
  guildId: string
  gameLabel: string
  /** GET /roles with the member counts (read fresh by the screen). */
  roles: Loaded<Role[]>
  /** GET /racing/{game}/team-roles: the data behind "All {game} team roles". */
  teamRoles: Loaded<RacingTeamRole[]>
  /** The chosen role ids, in the order they were chosen (at most 3). */
  ids: readonly string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  /** A refusal of the server about the roles (nothing was posted). */
  error?: string | null
}

/**
 * "Ping roles": the optional part of a post that notifies up to 3 roles. The roles are chosen by name from a searchable list that shows how
 * many members each has ("about N members" while the bot's member cache is incomplete). @everyone and @here are never offered and
 * bot-managed roles are not selectable; a role that is not mentionable is offered with a warning. The quick action "All {game} team
 * roles" fills in the roles of the teams of this game (only when there are at most 3). Nothing here is stored.
 */
export function PingRolesField({ guildId, gameLabel, roles, teamRoles, ids, onChange, disabled = false, error = null }: PingRolesFieldProps) {
  const id = useId()
  const list = roles.status === 'ready' ? roles.data : []
  const chosen = resolvePingRoles(ids, list)
  const full = ids.length >= MAX_PING_ROLES
  const quick = roles.status === 'ready' && teamRoles.status === 'ready' ? teamRoleSelection(teamRoles.data, list, guildId) : null
  const notMentionable = chosen.filter((role) => !role.mentionable)

  const add = (roleId: string): void => {
    if (roleId !== '' && !ids.includes(roleId) && !full) onChange([...ids, roleId])
  }
  const quickHint =
    teamRoles.status === 'error'
      ? `The ${gameLabel} team roles could not be loaded.`
      : quick?.problem === 'none'
        ? `No ${gameLabel} team has a Discord role you can ping yet.`
        : quick?.problem === 'too-many'
          ? `${gameLabel} has more than ${MAX_PING_ROLES} team roles and a post pings at most ${MAX_PING_ROLES}. Pick the roles one by one.`
          : null

  return (
    <fieldset className="ping-roles" disabled={disabled} aria-describedby={`${id}-hint`}>
      <legend className="field__label">
        Ping roles <span className="muted">(optional)</span>
      </legend>
      <p className="muted" id={`${id}-hint`}>
        Notify up to {MAX_PING_ROLES} roles with this post. People are notified the moment it is posted. @everyone and @here cannot be pinged, and roles managed by a bot are not listed.
      </p>

      {roles.status === 'loading' ? <Skeleton height={40} /> : null}
      {roles.status === 'error' ? (
        <Notice tone="warning" action={<Button variant="secondary" size="sm" onClick={roles.reload}>Try again</Button>}>
          The roles could not be loaded, so roles cannot be pinged right now. You can still post without pinging anyone.
        </Notice>
      ) : null}

      {roles.status === 'ready' ? (
        <>
          <div className="section-head">
            <span className="muted" aria-live="polite">
              {ids.length} of {MAX_PING_ROLES} chosen
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={<Users size={14} aria-hidden="true" />}
              disabled={disabled || quick === null || quick.problem !== null}
              onClick={() => quick && onChange(quick.ids)}
            >
              All {gameLabel} team roles
            </Button>
          </div>
          {quickHint ? <p className="muted">{quickHint}</p> : null}

          {chosen.length === 0 ? (
            <p className="muted">Nobody will be pinged.</p>
          ) : (
            <ul className="member-chips" aria-label="Roles that will be pinged">
              {chosen.map((role) => (
                <li key={role.id} className="member-chip">
                  <span className="member-chip__name">
                    <span className="plain-text">{role.name}</span> <span className="muted">{role.missing ? '' : memberCountText(role)}</span>
                  </span>
                  {role.missing ? <Badge tone="danger">Gone</Badge> : !role.mentionable ? <Badge tone="danger">Not mentionable</Badge> : null}
                  <button type="button" className="member-chip__remove" disabled={disabled} aria-label={`Do not ping ${role.name}`} onClick={() => onChange(ids.filter((value) => value !== role.id))}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Keyed by how many are chosen, so the search box is empty again after every pick. */}
          <SearchSelect
            key={ids.length}
            label="Add a role to ping"
            value=""
            options={pingOptions(list, guildId, ids)}
            placeholder={full ? `The list is full (${MAX_PING_ROLES})` : 'Search roles by name'}
            disabled={disabled || full}
            emptyText="No role found. Roles managed by a bot and @everyone are not listed."
            onChange={add}
          />
        </>
      ) : null}

      {notMentionable.length > 0 ? <Notice tone="warning">{NOT_MENTIONABLE_WARNING}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </fieldset>
  )
}
