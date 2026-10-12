import { Send } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CardOutcome, CardPostResult } from '../../shared/types'
import { Button, Modal, Notice, PostConfirmDialog, PostResultDialog, PostTargetSection, useToast } from '../components'
import { usePostTarget } from '../hooks/postTarget'
import { useManageDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { CARD_POST_LOST_TEXT, cardMayBeThere, describeCardError, describeRacingError, MANAGE_SERVER_RULE } from '../lib/racingView'
import { judgeWrite } from '../lib/racingWriteFlow'
import type { EsportsContext } from './EsportsRoute'

/** What the channel and roles of a card were, to start a second try from the same choice (the user still has to ask for it). */
export interface CardTarget {
  channelId: string
  pingRoleIds?: string[]
}

type Phase = 'editing' | 'confirming' | 'lost'

interface PostToDiscordDialogProps {
  ctx: EsportsContext
  /** "Post the team card", "Post the event card" ... */
  title: string
  /** What is posted, for the confirmation ("the card of Apex Racing"). */
  subject: string
  /** The item in a few lines (shown in the form and in the confirmation). */
  summary: ReactNode
  /** The facts of the item for the result dialog. */
  resultFacts?: ReactNode
  /** Why the dialog opened, when it is a second try after a failed post (the item is saved). */
  notice?: ReactNode
  /** The choice of the first try. */
  initial?: CardTarget
  /** Label of the button that moves to the confirmation ("Post again" after a failed post). */
  reviewLabel?: string
  /** Sends the card with the chosen channel and roles. Called at most once per dialog. */
  send: (target: CardTarget) => Promise<CardPostResult>
  onClose: () => void
}

/**
 * "Post to Discord" for an item that already exists (team detail, event row, result row), and the second try after a post that failed
 * when the item was created ("Post again"). It changes no stored data. Choosing a channel and roles, then the confirmation that names
 * both, then ONE request: it is never repeated automatically, and after a lost answer the dialog only says to look at the channel first.
 */
export function PostToDiscordDialog({ ctx, title, subject, summary, resultFacts, notice, initial, reviewLabel = 'Review and post', send, onClose }: PostToDiscordDialogProps) {
  const toast = useToast()
  const write = useWriteAction()
  const manage = useManageDenied(ctx.guild.id)
  const target = usePostTarget(ctx.guild.id, ctx.game, { enabled: true, channelId: initial?.channelId ?? '', pingIds: initial?.pingRoleIds ?? [] })
  const [phase, setPhase] = useState<Phase>('editing')
  const [submitted, setSubmitted] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [posted, setPosted] = useState<{ result: CardPostResult; requested: string[] } | null>(null)

  const review = (): void => {
    setSubmitted(true)
    if (target.problem === null && !manage.denied) setPhase('confirming')
  }

  const submit = async (): Promise<void> => {
    if (target.problem !== null || target.fields.channelId === undefined || manage.denied) return
    const request: CardTarget = { channelId: target.fields.channelId, ...(target.fields.pingRoleIds ? { pingRoleIds: target.fields.pingRoleIds } : {}) }
    const outcome = await write.run(() => send(request))
    if (!outcome) return
    if (outcome.ok) {
      setPosted({ result: outcome.value, requested: request.pingRoleIds ?? [] })
      toast.push({ tone: 'success', title: 'Card posted', message: `Sent to #${target.channelName(outcome.value.channelId) || 'the channel'}.` })
      return
    }
    const error = outcome.error
    const verdict = judgeWrite(error, 'card')
    if (verdict.type === 'lost') {
      // The card may be in the channel already (and may already have pinged people): nothing offers to send it again.
      setPhase('lost')
      return
    }
    setPhase('editing')
    if (verdict.type === 'denied') {
      manage.markDenied()
      return
    }
    if (target.explainRefusal(error, verdict, ctx.gameLabel, 'Nothing was posted.')) return
    setProblem(describeRacingError(error, ctx.gameLabel))
  }

  if (posted) {
    return (
      <PostResultDialog
        title="Card posted"
        intro={<>The card of {subject} is in Discord.</>}
        guildId={ctx.guild.id}
        channelId={posted.result.channelId}
        channelName={target.channelName(posted.result.channelId) || undefined}
        messageId={posted.result.messageId}
        pingedRoles={posted.result.pingedRoles}
        requestedRoleIds={posted.requested}
        facts={resultFacts}
        onClose={onClose}
      />
    )
  }

  return (
    <>
      <Modal
        open={phase !== 'confirming'}
        title={title}
        size="lg"
        dismissible={!write.busy}
        onClose={onClose}
        footer={
          phase === 'lost' ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button icon={<Send size={16} aria-hidden="true" />} disabled={manage.denied} onClick={review}>
                {reviewLabel}
              </Button>
            </>
          )
        }
      >
        {phase === 'lost' ? (
          <Notice tone="danger">
            <strong>The card may already be in the channel.</strong> {CARD_POST_LOST_TEXT}
          </Notice>
        ) : (
          <>
            {notice}
            <div className="stack stack--tight">{summary}</div>
            {manage.denied ? (
              <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
                {MANAGE_SERVER_RULE} The server refused your account, so posting is off. If your permissions changed, choose Check again.
              </Notice>
            ) : null}
            <PostTargetSection target={target} guildId={ctx.guild.id} gameLabel={ctx.gameLabel} what={subject} required showProblem={submitted} />
            {problem ? <Notice tone="danger">{problem}</Notice> : null}
          </>
        )}
      </Modal>
      <PostConfirmDialog
        open={phase === 'confirming'}
        title={`Post ${subject}?`}
        channelLabel={`#${target.channelName(target.channelId) || 'the channel you chose'}`}
        guildName={ctx.guild.name}
        roles={target.pingViews}
        confirmLabel="Post to Discord"
        busy={write.busy}
        onConfirm={() => void submit()}
        onCancel={() => setPhase('editing')}
      >
        <div className="stack stack--tight">{summary}</div>
      </PostConfirmDialog>
    </>
  )
}

interface CardOutcomeDialogProps {
  ctx: EsportsContext
  /** "team", "event" or "result". */
  kind: string
  /** The name of the saved item, for the sentences. */
  itemName: string
  card: CardOutcome
  /** What was asked for with the create. */
  requested: CardTarget
  summary: ReactNode
  resultFacts?: ReactNode
  send: (target: CardTarget) => Promise<CardPostResult>
  onClose: () => void
}

/**
 * What to show after a create that asked for a card. Posted: the result dialog. Failed (`post_error`): the item IS saved, only the post
 * failed, so the dialog says so and offers "Post again", which only opens the same form again: the user has to review and confirm it, and
 * it calls the dedicated endpoint (it never creates anything again). Unknown: the server said neither, so only the channel can tell.
 */
export function CardOutcomeDialog({ ctx, kind, itemName, card, requested, summary, resultFacts, send, onClose }: CardOutcomeDialogProps) {
  if (card.status === 'posted') {
    return (
      <PostResultDialog
        title={`The ${kind} was saved and posted`}
        intro={
          <>
            The {kind} <strong className="plain-text">{itemName}</strong> was saved and its card is in Discord.
          </>
        }
        guildId={ctx.guild.id}
        channelId={card.post.channelId}
        messageId={card.post.messageId}
        pingedRoles={card.post.pingedRoles}
        requestedRoleIds={requested.pingRoleIds ?? []}
        facts={resultFacts}
        onClose={onClose}
      />
    )
  }
  if (card.status === 'unknown') {
    return (
      <Modal open title={`The ${kind} was saved`} onClose={onClose} footer={<Button data-autofocus onClick={onClose}>Close</Button>}>
        <Notice tone="warning">
          The {kind} <strong className="plain-text">{itemName}</strong> was saved. The server did not say whether its card was posted, so look at the channel in Discord before you post it again.
        </Notice>
      </Modal>
    )
  }
  const reason = describeCardError(card.error.code)
  return (
    <PostToDiscordDialog
      ctx={ctx}
      title={`The ${kind} was saved, but not posted`}
      subject={`the card of ${itemName}`}
      summary={summary}
      resultFacts={resultFacts}
      initial={requested}
      reviewLabel="Post again"
      notice={
        <Notice tone="danger">
          <strong>The {kind} was saved, but its card could not be posted.</strong> {reason}
          {cardMayBeThere(card.error.code) ? '' : ' Nothing was sent to the channel.'} Nothing is sent again until you choose Post again and confirm it.
        </Notice>
      }
      send={send}
      onClose={onClose}
    />
  )
}

