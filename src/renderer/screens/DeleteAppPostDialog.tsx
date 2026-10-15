import { RotateCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Modal, Notice, useToast } from '../components'
import { useManageDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { APP_POST_GONE_TEXT, channelLabel, DELETE_LOST_TEXT, DELETE_NEVER_TEXT, DELETE_PERMISSION_TEXT, deleteActions, describeAppPostError, invalidateAppPosts, judgeDelete, phaseAfterDelete } from '../lib/appPosts'
import type { DeletePhase } from '../lib/appPosts'
import { unwrap } from '../lib/errors'
import { MANAGE_SERVER_RULE } from '../lib/racingView'

/** The post that is about to be deleted: ids from the server's own answer (the list, or the answer of the post that was just made). */
export interface PostToDelete {
  channelId: string
  messageId: string
  /** Shown as plain text. Empty for an embed without a title. */
  title: string
}

interface Props {
  guildId: string
  guildName: string
  post: PostToDelete
  /** The name of the channel when the app knows it. */
  channelName: string
  /** What the post is, in the title of the dialog: "post" or "announcement". */
  noun?: 'post' | 'announcement'
  /** Cancel, or Escape: nothing was deleted and nothing changed. */
  onCancel: () => void
  /** The post was deleted. The list of its channel was invalidated already. */
  onDeleted: () => void
  /** The dialog ends without a delete that is known to have happened (already gone, lost answer, list out of date): the list of the channel has been invalidated, show it. */
  onRefresh: () => void
}

/**
 * Confirmation for deleting one post made with the app. It names the title and the channel, says that it cannot be undone and that the team,
 * event or result behind a card is never deleted, and puts the focus on Cancel. The delete is sent ONCE through the single-flight write helper:
 * after a timeout, a dropped connection or a 5xx the answer is unknown, so the dialog locks and offers only a refresh of the list (a second
 * send could remove a newer post that looks the same, and the list shows what really happened). Needs Manage Server or Administrator.
 * Nothing about the post is stored: it lives in this dialog and in the list's React state.
 */
export function DeleteAppPostDialog({ guildId, guildName, post, channelName, noun = 'post', onCancel, onDeleted, onRefresh }: Props) {
  const toast = useToast()
  const write = useWriteAction()
  const manage = useManageDenied(guildId)
  const [phase, setPhase] = useState<DeletePhase>('confirming')
  const [problem, setProblem] = useState<string | null>(null)
  const actions = deleteActions(write.busy ? 'deleting' : phase)

  const refresh = (): void => {
    invalidateAppPosts(guildId, post.channelId)
    onRefresh()
  }

  const submit = async (): Promise<void> => {
    if (phase !== 'confirming' || manage.denied) return
    const outcome = await write.run(() => unwrap(window.nexus.api.deleteAppPost(guildId, post.channelId, post.messageId)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateAppPosts(guildId, post.channelId)
      toast.push({ tone: 'success', title: noun === 'announcement' ? 'Announcement deleted' : 'Post deleted', message: `Removed from ${channelLabel(channelName)}.` })
      onDeleted()
      return
    }
    const verdict = judgeDelete(outcome.error)
    if (verdict.type === 'denied') manage.markDenied()
    if (verdict.type === 'lost' || verdict.type === 'gone' || verdict.type === 'stale') invalidateAppPosts(guildId, post.channelId)
    setPhase(phaseAfterDelete(verdict))
    setProblem(verdict.type === 'lost' ? DELETE_LOST_TEXT : verdict.type === 'denied' ? null : describeAppPostError(outcome.error, 'delete'))
  }

  const footer = actions.includes('refresh') ? (
    <Button data-autofocus icon={<RotateCw size={14} aria-hidden="true" />} onClick={refresh}>
      Refresh list
    </Button>
  ) : (
    <>
      {/* The safe choice has the focus: Enter or Space does nothing destructive. */}
      <Button data-autofocus variant="secondary" disabled={write.busy} onClick={onCancel}>
        Cancel
      </Button>
      <Button destructive loading={write.busy} icon={<Trash2 size={16} aria-hidden="true" />} disabled={manage.denied} title={manage.denied ? 'Needs the Manage Server permission' : undefined} onClick={() => void submit()}>
        {noun === 'announcement' ? 'Delete announcement' : 'Delete post'}
      </Button>
    </>
  )

  return (
    <Modal open title={noun === 'announcement' ? 'Delete this announcement?' : 'Delete this post?'} dismissible={!write.busy && phase === 'confirming'} onClose={onCancel} footer={footer}>
      <p>
        This deletes the message <strong className="plain-text">{post.title === '' ? '(no title)' : post.title}</strong> from <strong className="plain-text">{channelLabel(channelName)}</strong> in <span className="plain-text">{guildName}</span>. It cannot be undone.
      </p>
      <p>{DELETE_NEVER_TEXT}</p>
      {manage.denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
          {MANAGE_SERVER_RULE} The server refused your account, so deleting is off. If your permissions changed, choose Check again.
        </Notice>
      ) : (
        <p className="muted">{DELETE_PERMISSION_TEXT}</p>
      )}
      {phase === 'gone' ? <Notice tone="info">{APP_POST_GONE_TEXT}</Notice> : null}
      {problem && phase !== 'gone' ? <Notice tone="danger">{phase === 'lost' ? <strong>The post may or may not be deleted. </strong> : null}{problem}</Notice> : null}
    </Modal>
  )
}
