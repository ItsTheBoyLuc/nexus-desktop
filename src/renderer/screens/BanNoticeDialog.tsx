import { Megaphone, Send } from 'lucide-react'
import { useState } from 'react'
import { ANNOUNCEMENT_LIMITS, validateAnnouncement } from '../../shared/validation'
import type { AnnouncementDraft, AnnouncementField } from '../../shared/validation'
import { Button, CopyButton, ErrorState, LoadingRegion, Modal, Notice, SearchSelect, Skeleton, TextField, useToast } from '../components'
import { useGuildChannels } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import { banAnnouncementDraft } from '../lib/banNotice'
import { describeChannelError, describeError, isChannelError, mayHaveSucceeded, unwrap } from '../lib/errors'

interface BanNoticeDialogProps {
  guildId: string
  /** The ban text exactly as the server returned it. */
  notice: string
  driverName: string
  season: number | null
  /** Where the ban text came from, for the first line. */
  source: 'manual-points' | 'decision'
  onClose: () => void
}

type Step = 'notice' | 'compose' | 'confirm'

/**
 * A ban threshold was reached. Manual points (like /f1 penalty) do NOT announce anything in Discord: the server only
 * returns the ban text. This dialog shows it with a Copy button, and offers to post it as an announcement through the
 * server-level announcement endpoint (channel picker and the usual confirm step first).
 */
export function BanNoticeDialog({ guildId, notice, driverName, season, source, onClose }: BanNoticeDialogProps) {
  const channels = useGuildChannels(guildId)
  const toast = useToast()
  const write = useWriteAction()

  const initial = banAnnouncementDraft(notice)
  const [step, setStep] = useState<Step>('notice')
  const [draft, setDraft] = useState<AnnouncementDraft>({ title: initial.title, message: initial.message, channelId: '', imageUrl: '' })
  const [submitted, setSubmitted] = useState(false)
  const [channelError, setChannelError] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const validation = validateAnnouncement(draft)
  const errors: Partial<Record<AnnouncementField, string>> = validation.ok ? {} : validation.errors
  const shown = (field: AnnouncementField): string | null => (field === 'channelId' && channelError ? channelError : submitted ? (errors[field] ?? null) : null)
  const channelName = (id: string): string => (channels.status === 'ready' ? (channels.data.find((channel) => channel.id === id)?.name ?? '') : '')

  const update = (field: keyof AnnouncementDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setChannelError(null)
    setProblem(null)
  }

  const review = (): void => {
    setSubmitted(true)
    if (validation.ok) setStep('confirm')
  }

  const post = async (): Promise<void> => {
    if (!validation.ok) return
    const outcome = await write.run(() => unwrap(window.nexus.api.postAnnouncement(guildId, validation.value)))
    if (!outcome) return
    if (outcome.ok) {
      toast.push({ tone: 'success', title: 'Ban notice posted', message: `Sent to #${channelName(outcome.value.channelId) || 'the channel'} as an announcement.` })
      onClose()
      return
    }
    setStep('compose')
    if (isChannelError(outcome.error)) setChannelError(describeChannelError(outcome.error, channelName(draft.channelId), 'The announcement was not posted.'))
    else setProblem(mayHaveSucceeded(outcome.error) ? `${describeError(outcome.error)} The announcement may already have been posted, so check the channel in Discord before you try again.` : describeError(outcome.error))
  }

  const closeButton = (
    <Button data-autofocus onClick={onClose}>
      Close
    </Button>
  )

  if (step === 'confirm') {
    return (
      <Modal
        key="confirm"
        open
        title="Post this announcement?"
        dismissible={!write.busy}
        onClose={() => setStep('compose')}
        footer={
          <>
            <Button variant="secondary" data-autofocus disabled={write.busy} onClick={() => setStep('compose')}>
              Back to editing
            </Button>
            <Button loading={write.busy} icon={<Send size={16} aria-hidden="true" />} onClick={() => void post()}>
              Post announcement
            </Button>
          </>
        }
      >
        <p>
          This is posted in <strong>#{channelName(draft.channelId) || 'the chosen channel'}</strong> straight away, as a normal announcement from Nexus. It is not a Stewards Decision and it is not posted in the report thread.
        </p>
        <div className="preview">
          <div className="preview__title">{draft.title.trim()}</div>
          <div className="preview__message">{draft.message.trim()}</div>
        </div>
      </Modal>
    )
  }

  if (step === 'compose') {
    return (
      <Modal
        key="compose"
        open
        title="Post the ban notice as an announcement"
        size="lg"
        onClose={() => setStep('notice')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setStep('notice')}>
              Back
            </Button>
            <Button icon={<Send size={16} aria-hidden="true" />} disabled={channels.status !== 'ready'} onClick={review}>
              Review and post
            </Button>
          </>
        }
      >
        <p>The announcement endpoint posts a plain embed in the channel you choose. Change the title or text if you like; nothing is posted before the next step.</p>
        {channels.status === 'loading' ? (
          <LoadingRegion label="Loading channels">
            <Skeleton height={40} />
          </LoadingRegion>
        ) : null}
        {channels.status === 'error' ? <ErrorState title="Could not load the channels" message={describeError(channels.error)} onRetry={channels.reload} /> : null}
        {channels.status === 'ready' ? (
          <SearchSelect
            label="Channel"
            value={draft.channelId}
            options={channels.data.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
            placeholder="Search channels"
            emptyText="No channel found. Nexus can only post where it has permission."
            hint="Only channels where Nexus can post and you can see are listed."
            error={shown('channelId')}
            onChange={(value) => update('channelId', value)}
          />
        ) : null}
        <TextField label="Title" value={draft.title} maxLength={ANNOUNCEMENT_LIMITS.titleMax} error={shown('title')} autoComplete="off" onChange={(event) => update('title', event.target.value)} />
        <TextField multiline label="Message" rows={6} value={draft.message} maxLength={ANNOUNCEMENT_LIMITS.messageMax} error={shown('message')} onChange={(event) => update('message', event.target.value)} />
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
      </Modal>
    )
  }

  return (
    <Modal key="notice" open title="A ban threshold was reached" onClose={onClose} footer={closeButton}>
      <Notice tone="warning">
        <strong>A ban threshold was reached. Nothing has been announced in Discord.</strong>{' '}
        {source === 'manual-points'
          ? 'Manual penalty points never post a ban announcement (like /f1 penalty): the server only hands you the text.'
          : 'The server could not post the ban notice in the report thread, so here is the text.'}
      </Notice>
      <p>
        {driverName}
        {season !== null ? `, season ${season}` : ''}. The text of the notice:
      </p>
      <blockquote className="ban-notice">{notice}</blockquote>
      <div className="dialog-actions dialog-actions--start">
        <CopyButton text={notice} label="Copy the text" what="The ban notice" />
        <Button variant="secondary" size="sm" icon={<Megaphone size={14} aria-hidden="true" />} onClick={() => setStep('compose')}>
          Post as announcement
        </Button>
      </div>
      <p className="muted">The ban itself is saved either way: the driver&apos;s ban flag is already set in the penalty overview.</p>
    </Modal>
  )
}
