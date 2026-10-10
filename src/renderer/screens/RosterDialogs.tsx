import { useState } from 'react'
import { validateRosterAddDraft } from '../../shared/racingValidation'
import type { RosterAddField } from '../../shared/racingValidation'
import type { RacingGame, RacingTeamDetail, RosterEntry } from '../../shared/types'
import { RACING_ROLES } from '../../shared/types'
import { Badge, Button, ErrorState, LoadingRegion, MemberPicker, Modal, Notice, Select, Skeleton, useToast } from '../components'
import type { Person } from '../components'
import { useRacingDriver } from '../hooks/data'
import { useManageDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { errorCode, outcomeUnknown, unwrap } from '../lib/errors'
import { formatDay } from '../lib/format'
import { invalidateRacing } from '../lib/racingScope'
import { describeRacingError, describeRoleError, MANAGE_SERVER_RULE, rosterName } from '../lib/racingView'
import { describeError } from '../lib/errors'

interface BaseProps {
  guildId: string
  game: RacingGame
  gameLabel: string
}

/** Where a roster write that was refused for the Manage Server rule is explained. */
function DeniedNotice({ onCheckAgain }: { onCheckAgain: () => void }) {
  return (
    <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={onCheckAgain}>Check again</Button>}>
      {MANAGE_SERVER_RULE} The server refused your account, so this action is off. If your permissions changed, choose Check again.
    </Notice>
  )
}

// ── Add a member ────────────────────────────────────────────────────────────

/**
 * Add a member to a team's roster (/racing {game} roster-add). The member is chosen by name with the member search (never by ID),
 * the role from a dropdown of exactly four roles. The member also gets the team's Discord role. Sent once: after a lost answer the
 * form locks (the member and the role may already be set).
 */
export function AddMemberDialog({ guildId, game, gameLabel, team, onClose, onAdded }: BaseProps & { team: RacingTeamDetail; onClose: () => void; onAdded: () => void }) {
  const toast = useToast()
  const write = useWriteAction()
  const manage = useManageDenied(guildId)
  const [person, setPerson] = useState<Person | null>(null)
  const [role, setRole] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<RosterAddField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  const result = validateRosterAddDraft({ team: team.name, userId: person?.id ?? '', role })
  const errors: Partial<Record<RosterAddField, string>> = result.ok ? {} : result.errors
  const show = (field: RosterAddField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const onRoster = new Map(team.roster.map((entry) => [entry.userId, 'Already on this roster'] as [string, string]))
  const known: Person[] = team.roster.flatMap((entry): Person[] => (entry.inServer ? [{ id: entry.userId, displayName: rosterName(entry), username: entry.username }] : []))

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!result.ok || lost || manage.denied) return
    const outcome = await write.run(() => unwrap(window.nexus.api.addRosterMember(guildId, game, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateRacing(guildId, game)
      toast.push({ tone: 'success', title: 'Member added', message: `${person?.displayName ?? 'The member'} is now ${result.value.role} of ${team.name}${outcome.value.roleAssigned ? ' and has the team role.' : '.'}` })
      onAdded()
      return
    }
    const error = outcome.error
    if (outcomeUnknown(error)) {
      invalidateRacing(guildId, game)
      setLost(true)
      return
    }
    const code = errorCode(error)
    if (code === 'manage_server_required') manage.markDenied()
    else if (code === 'member_not_found' || code === 'already_on_roster') setServerErrors({ userId: describeRacingError(error, gameLabel) })
    else if (code === 'invalid_role') setServerErrors({ role: describeRacingError(error, gameLabel) })
    else setProblem(describeRacingError(error, gameLabel))
    if (code === 'already_on_roster' || code === 'team_not_found' || code === 'team_role_not_found') invalidateRacing(guildId, game)
  }

  return (
    <Modal
      open
      title={`Add a member to ${team.name}`}
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={write.busy} disabled={lost || manage.denied} onClick={() => void submit()}>
            Add to the roster
          </Button>
        </>
      }
    >
      <p className="muted">
        Like <code>/racing {game} roster-add</code>. The member also gets the team&apos;s Discord role{team.roleName ? <> <strong>{team.roleName}</strong></> : null}.
      </p>
      {!team.roleExists ? <Notice tone="warning">The Discord role of this team was deleted. Adding a member will be refused, and a team cannot be repaired from the app.</Notice> : null}
      {manage.denied ? <DeniedNotice onCheckAgain={manage.reset} /> : null}
      {lost ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={onClose}>Close and refresh the roster</Button>}>
          Nexus did not get a clear answer, so <strong>the member may already be on the roster</strong> (and have the role). It is not sent again from here. The roster was just read again: look at it first.
        </Notice>
      ) : null}
      <MemberPicker label="Member" guildId={guildId} value={person?.id ?? ''} known={known} taken={onRoster} placeholder="Search by name" hint="Search the server's members by name. You never need an ID." error={show('userId')} onChange={(next) => { setPerson(next); setServerErrors({}); setProblem(null) }} />
      <Select
        label="Role in the team"
        value={role}
        placeholder="Choose a role"
        options={RACING_ROLES.map((item) => ({ value: item, label: item }))}
        hint="A Manager or Coach may also create attendance posts and announcements for this game."
        error={show('role')}
        onChange={(value) => { setRole(value); setServerErrors({}); setProblem(null) }}
      />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </Modal>
  )
}

// ── Remove a member ─────────────────────────────────────────────────────────

/**
 * Remove a member (/racing {game} roster-remove): a confirm dialog that names the member and the team role that is taken away.
 * It works for someone who has left the server too (the entry is found by ID; there is no role to take away then).
 */
export function RemoveMemberDialog({ guildId, game, gameLabel, team, entry, onClose, onRemoved }: BaseProps & { team: RacingTeamDetail; entry: RosterEntry; onClose: () => void; onRemoved: () => void }) {
  const toast = useToast()
  const write = useWriteAction()
  const manage = useManageDenied(guildId)
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)
  const name = rosterName(entry)
  const roleName = team.roleName ?? 'the team role'

  const remove = async (): Promise<void> => {
    if (lost || manage.denied) return
    setProblem(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.removeRosterMember(guildId, game, team.name, entry.userId)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateRacing(guildId, game)
      toast.push({
        tone: 'success',
        title: 'Member removed',
        message: outcome.value.roleRemoved ? `${name} left ${team.name} and lost the role ${roleName}.` : `${name} was removed from the roster of ${team.name}.`
      })
      if (outcome.value.roleError) toast.push({ tone: 'danger', title: 'The role stays', message: `The roster entry is gone, but the Discord role could not be taken away: ${describeRoleError(outcome.value.roleError)}.` })
      onRemoved()
      return
    }
    const error = outcome.error
    if (outcomeUnknown(error)) {
      invalidateRacing(guildId, game)
      setLost(true)
      return
    }
    const code = errorCode(error)
    if (code === 'manage_server_required') manage.markDenied()
    else setProblem(describeRacingError(error, gameLabel))
    if (code === 'not_on_roster' || code === 'team_not_found') invalidateRacing(guildId, game)
  }

  return (
    <Modal
      open
      title={`Remove ${name} from ${team.name}?`}
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        <>
          {/* Cancel is the default focus: Enter never removes a member by accident. */}
          <Button variant="secondary" data-autofocus disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={write.busy} disabled={lost || manage.denied} onClick={() => void remove()}>
            Remove from the roster
          </Button>
        </>
      }
    >
      <p>
        This removes <strong>{name}</strong> (@{entry.username}, {entry.role || 'no role'}) from the roster of <strong>{team.name}</strong>.
      </p>
      <ul className="plain-list">
        {entry.inServer ? (
          <li>
            The team role <strong>{roleName}</strong> is taken away from them in Discord.
          </li>
        ) : (
          <li>They have left the server, so there is no Discord role to take away. Only the roster entry is removed.</li>
        )}
        <li>They can be added again later.</li>
        <li>Nothing is posted in Discord, and the person is not told.</li>
      </ul>
      {manage.denied ? <DeniedNotice onCheckAgain={manage.reset} /> : null}
      {lost ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={onClose}>Close and refresh the roster</Button>}>
          Nexus did not get a clear answer, so <strong>the member may already be removed</strong>. It is not sent again from here. The roster was just read again: look at it first.
        </Notice>
      ) : null}
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </Modal>
  )
}

// ── Driver profile ──────────────────────────────────────────────────────────

/** Every team and role of one member in THIS game (/racing {game} driver-profile). Read fresh, kept in memory only. */
export function DriverProfileDialog({ guildId, game, gameLabel, userId, fallbackName, onClose }: BaseProps & { userId: string; fallbackName: string; onClose: () => void }) {
  const profile = useRacingDriver(guildId, game, userId)
  return (
    <Modal open title={`${gameLabel} profile: ${profile.status === 'ready' ? (profile.data.displayName ?? fallbackName) : fallbackName}`} onClose={onClose} footer={<Button data-autofocus onClick={onClose}>Close</Button>}>
      {profile.status === 'loading' ? (
        <LoadingRegion label="Loading the profile">
          <Skeleton height={20} />
          <Skeleton height={20} width="60%" />
        </LoadingRegion>
      ) : null}
      {profile.status === 'error' ? (
        <ErrorState title="Could not load the profile" message={errorCode(profile.error) === 'driver_not_found' ? describeRacingError(profile.error, gameLabel) : describeError(profile.error)} onRetry={profile.reload} />
      ) : null}
      {profile.status === 'ready' ? (
        <>
          <p className="muted">
            {profile.data.inServer ? 'In the server.' : 'Has left the server.'} Only the teams of {gameLabel} are listed: other games have their own teams.
          </p>
          {profile.data.memberships.length === 0 ? (
            <p>This member is on no {gameLabel} team.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Teams of this member in {gameLabel}</caption>
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col">Role</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.data.memberships.map((membership) => (
                    <tr key={membership.team}>
                      <th scope="row" className="table__key">{membership.team}</th>
                      <td>
                        <Badge tone="primary">{membership.role}</Badge>
                      </td>
                      <td>{membership.joined || formatDay(membership.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Modal>
  )
}
