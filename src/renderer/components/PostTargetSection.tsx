import { useId } from 'react'
import type { PostTarget } from '../hooks/postTarget'
import { Button } from './Button'
import { Notice } from './Notice'
import { PingRolesField } from './PingRolesField'
import { SearchSelect } from './SearchSelect'
import { Skeleton } from './Skeleton'

interface PostTargetSectionProps {
  target: PostTarget
  guildId: string
  gameLabel: string
  /** What is posted, in two or three words ("the team card"). */
  what: string
  /** True for "Post to Discord" on an existing item: the section is the whole point, so there is no switch. */
  required?: boolean
  /** Shown under the channel when the form was submitted without one. */
  showProblem?: boolean
  disabled?: boolean
}

/**
 * "Post in a channel": an optional part of the create forms (off by default) and the body of the "Post to Discord" dialogs. Choosing a
 * channel and, if wanted, up to 3 roles to ping. Nothing is posted while the switch is off.
 */
export function PostTargetSection({ target, guildId, gameLabel, what, required = false, showProblem = false, disabled = false }: PostTargetSectionProps) {
  const id = useId()
  const channels = target.channels
  const channelList = channels.status === 'ready' ? channels.data : []

  return (
    <section className="post-target" aria-label="Post in a channel">
      {required ? (
        <h3 className="post-target__title">Where to post</h3>
      ) : (
        <div className="switch">
          <label className="switch__control">
            <input type="checkbox" role="switch" className="switch__input" checked={target.enabled} disabled={disabled} aria-describedby={`${id}-hint`} onChange={(event) => target.setEnabled(event.target.checked)} />
            <span className="switch__track" aria-hidden="true">
              <span className="switch__thumb" />
            </span>
            <span className="switch__label">Post in a channel</span>
          </label>
          <span id={`${id}-hint`} className="switch__hint">
            Off: nothing is posted. On: {what} is also posted in Discord, optionally pinging roles.
          </span>
        </div>
      )}

      {target.enabled || required ? (
        <div className="stack">
          {channels.status === 'loading' ? <Skeleton height={40} /> : null}
          {channels.status === 'error' ? (
            <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={channels.reload}>Try again</Button>}>
              The channels could not be loaded, so nothing can be posted right now.
            </Notice>
          ) : null}
          {channels.status === 'ready' ? (
            <SearchSelect
              label="Channel"
              value={target.channelId}
              options={channelList.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
              placeholder="Search channels"
              disabled={disabled}
              hint="Only channels where Nexus can post and you can see are listed."
              error={target.channelError ?? (showProblem ? target.problem : null)}
              emptyText="No channel found. Nexus can only post where it has permission."
              onChange={target.chooseChannel}
            />
          ) : null}
          <PingRolesField guildId={guildId} gameLabel={gameLabel} roles={target.roles} teamRoles={target.teamRoles} ids={target.pingIds} onChange={target.changePings} disabled={disabled} error={target.pingError} />
        </div>
      ) : null}
    </section>
  )
}
