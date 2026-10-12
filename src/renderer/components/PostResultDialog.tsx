import { ExternalLink as ExternalIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PingedRole } from '../../shared/types'
import { pingedMismatchNote } from '../lib/pingRoles'
import { discordMessageLink } from '../lib/racingView'
import { Button } from './Button'
import { CopyButton } from './Evidence'
import { Modal } from './Modal'
import { Notice } from './Notice'
import { SuccessMark } from './SuccessMark'
import { useToast } from './Toast'

interface PostResultDialogProps {
  title: string
  /** One sentence about what was posted. */
  intro: ReactNode
  guildId: string
  /** Straight from the server's answer: the link is built from these ids and nothing else. */
  channelId: string
  messageId: string
  /** The name of the channel when the app knows it. */
  channelName?: string | undefined
  /** `pinged_roles` of the answer. */
  pingedRoles: readonly PingedRole[]
  /** The role ids that were asked for, to notice when the answer does not agree. */
  requestedRoleIds: readonly string[]
  /** More facts of the item (a name, a date ...), as `<div><dt/><dd/></div>` rows. */
  facts?: ReactNode
  /** More buttons before Close. */
  actions?: ReactNode
  onClose: () => void
}

/**
 * What the server said after a post: the channel, the message id and the roles that were pinged, and an "Open in Discord" link built only
 * from ids the answer returned. Nothing is kept: the dialog is the only place the ids live.
 */
export function PostResultDialog({ title, intro, guildId, channelId, messageId, channelName, pingedRoles, requestedRoleIds, facts, actions, onClose }: PostResultDialogProps) {
  const toast = useToast()
  const link = discordMessageLink(guildId, channelId, messageId)
  const mismatch = pingedMismatchNote(requestedRoleIds, pingedRoles)
  const open = async (): Promise<void> => {
    const opened = await window.nexus.system.openExternal(link).catch(() => false)
    if (!opened) toast.push({ tone: 'danger', title: 'Link not opened', message: 'The link could not be opened. Copy the message ID and find the message in Discord.' })
  }

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          {actions}
          <Button data-autofocus onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="result-head">
        <SuccessMark size={28} />
        <p>{intro}</p>
      </div>
      <dl className="facts facts--grid">
        {facts}
        <div>
          <dt>Channel</dt>
          <dd className="plain-text">{channelName ? `# ${channelName}` : 'The channel you chose'}</dd>
        </div>
        <div>
          <dt>Message ID</dt>
          <dd className="plain-text">{messageId}</dd>
        </div>
        <div className="facts__wide">
          <dt>Roles pinged</dt>
          <dd className="plain-text">{pingedRoles.length === 0 ? 'Nobody' : pingedRoles.map((role) => role.name || role.id).join(', ')}</dd>
        </div>
      </dl>
      {mismatch ? <Notice tone="warning">{mismatch}</Notice> : null}
      <div className="dialog-actions dialog-actions--start">
        <Button variant="secondary" size="sm" icon={<ExternalIcon size={14} aria-hidden="true" />} onClick={() => void open()}>
          Open in Discord
        </Button>
        <CopyButton text={messageId} label="Copy the message ID" what="The message ID" />
      </div>
      <p className="muted">The link is built from the channel and message the server just returned. The app does not keep it.</p>
    </Modal>
  )
}
