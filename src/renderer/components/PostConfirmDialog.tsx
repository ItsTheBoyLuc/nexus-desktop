import { Send } from 'lucide-react'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { bigPingText, confirmView, memberCountText, NOT_MENTIONABLE_WARNING } from '../lib/pingRoles'
import type { PingRoleView } from '../lib/pingRoles'
import { Badge } from './Badge'
import { Button } from './Button'
import { Modal } from './Modal'
import { Notice } from './Notice'

interface PostConfirmDialogProps {
  open: boolean
  title: string
  /** The channel the post goes to, as `#name` (or a plain phrase when the name is not known). */
  channelLabel: string
  guildName: string
  /** The roles that will be pinged: empty when nobody is. */
  roles: readonly PingRoleView[]
  confirmLabel: string
  /** The request is running: nothing can be closed or sent twice. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** What else the user should see before posting (a preview of the text). */
  children?: ReactNode
}

/**
 * The question before every post to a channel. It names the channel and the roles that will be pinged (with their member counts) and, when
 * roles are pinged, says "Pings notify members immediately and cannot be undone." A role with more than 50 members (or a count that may be
 * that high or is unknown) makes the confirm button wait for a checkbox. Cancel has the initial focus, so Enter never posts by accident.
 */
export function PostConfirmDialog(props: PostConfirmDialogProps) {
  // The inner dialog only exists while it is open, so the checkbox is always unchecked when it opens again.
  return props.open ? <OpenDialog {...props} /> : null
}

function OpenDialog({ title, channelLabel, guildName, roles, confirmLabel, busy = false, onConfirm, onCancel, children }: PostConfirmDialogProps) {
  const checkId = useId()
  const [understood, setUnderstood] = useState(false)
  const view = confirmView(roles, understood)

  return (
    <Modal
      open
      title={title}
      dismissible={!busy}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" data-autofocus disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!view.canConfirm} icon={<Send size={16} aria-hidden="true" />} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>
        This will be posted in <strong className="plain-text">{channelLabel}</strong> in {guildName} straight away. It cannot be edited or deleted from this app.
      </p>

      {roles.length === 0 ? (
        <p className="muted">Nobody will be pinged.</p>
      ) : (
        <>
          <div>
            <p className="field__label">Roles that will be pinged</p>
            <ul className="ping-summary">
              {roles.map((role) => (
                <li key={role.id}>
                  <span className="plain-text">{role.name}</span>
                  <span className="muted">{role.missing ? 'no longer exists' : memberCountText(role)}</span>
                  {!role.mentionable ? <Badge tone="danger">Not mentionable</Badge> : null}
                </li>
              ))}
            </ul>
          </div>
          {view.sentence ? <Notice tone="warning">{view.sentence}</Notice> : null}
          {view.warnNotMentionable ? <Notice tone="warning">{NOT_MENTIONABLE_WARNING}</Notice> : null}
          {view.needsCheck ? (
            <div className="stack stack--tight">
              <ul className="ping-summary ping-summary--big">
                {roles
                  .filter((role) => role.big)
                  .map((role) => (
                    <li key={role.id} className="plain-text">
                      {bigPingText(role)}
                    </li>
                  ))}
              </ul>
              <label className="check" htmlFor={checkId}>
                <input id={checkId} type="checkbox" checked={understood} disabled={busy} onChange={(event) => setUnderstood(event.target.checked)} />
                <span>I understand that this notifies a large group of people at once.</span>
              </label>
            </div>
          ) : null}
        </>
      )}

      {children}
    </Modal>
  )
}
