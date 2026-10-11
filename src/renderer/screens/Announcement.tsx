import { RotateCw, Send } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { ANNOUNCEMENT_LIMITS, validateAnnouncement } from '../../shared/validation'
import type { AnnouncementDraft, AnnouncementField } from '../../shared/validation'
import { Button, Card, EmptyState, LoadingRegion, Modal, Notice, PageHeader, Select, Skeleton, SuccessMark, TextField, useToast } from '../components'
import { useGuildChannels } from '../hooks/data'
import { describeError, mayHaveSucceeded, unwrap } from '../lib/errors'
import { useServer } from './ServerRoute'

const EMPTY_DRAFT: AnnouncementDraft = { title: '', message: '', channelId: '', imageUrl: '' }
type Phase = 'editing' | 'confirming' | 'posting' | 'done'

export function Announcement() {
  const { guild } = useServer()
  const channels = useGuildChannels(guild.id)
  const toast = useToast()

  const [draft, setDraft] = useState<AnnouncementDraft>(EMPTY_DRAFT)
  const [touched, setTouched] = useState<ReadonlySet<AnnouncementField>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [phase, setPhase] = useState<Phase>('editing')
  const [postError, setPostError] = useState<string | null>(null)
  const [postedTo, setPostedTo] = useState<string>('')

  const validation = validateAnnouncement(draft)
  const errors = validation.ok ? {} : validation.errors
  const visibleError = (field: AnnouncementField): string | null => (submitted || touched.has(field) ? (errors[field] ?? null) : null)

  const channelList = channels.status === 'ready' ? channels.data : []
  const channelName = (id: string): string => channelList.find((channel) => channel.id === id)?.name ?? 'channel'

  const update = (field: keyof AnnouncementDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setPostError(null)
  }
  const touch = (field: AnnouncementField): void => setTouched((current) => new Set(current).add(field))

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    setSubmitted(true)
    if (validation.ok) setPhase('confirming')
  }

  const post = async (): Promise<void> => {
    if (!validation.ok) return
    setPhase('posting')
    setPostError(null)
    try {
      const result = await unwrap(window.nexus.api.postAnnouncement(guild.id, validation.value))
      setPostedTo(channelName(result.channelId))
      setPhase('done')
      toast.push({ tone: 'success', title: 'Announcement posted', message: `Sent to #${channelName(result.channelId)}.` })
    } catch (error) {
      const message = mayHaveSucceeded(error)
        ? `${describeError(error)} The announcement may already have been posted, so check the channel in Discord before trying again.`
        : describeError(error)
      setPhase('editing')
      setPostError(message)
      toast.push({ tone: 'danger', title: 'Announcement not posted', message })
    }
  }

  const startAnother = (): void => {
    setDraft((current) => ({ ...EMPTY_DRAFT, channelId: current.channelId }))
    setTouched(new Set())
    setSubmitted(false)
    setPostError(null)
    setPhase('editing')
  }

  return (
    <div className="page page--narrow">
      <PageHeader title="Announcement" description={`Post an announcement to a Discord channel in ${guild.name}.`} />

      {phase === 'done' ? (
        <Card className="success-panel">
          <SuccessMark size={40} className="success-panel__icon" />
          <h2>Announcement posted</h2>
          <p>It was sent to #{postedTo} in {guild.name}.</p>
          <Button onClick={startAnother}>Post another</Button>
        </Card>
      ) : channels.status === 'loading' ? (
        <LoadingRegion label="Loading channels">
          <Card>
            <div className="stack">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={120} />
            </div>
          </Card>
        </LoadingRegion>
      ) : channels.status === 'error' ? (
        <Notice
          tone="danger"
          action={
            <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={channels.reload}>
              Try again
            </Button>
          }
        >
          Could not load the channels. {describeError(channels.error)}
        </Notice>
      ) : channelList.length === 0 ? (
        <EmptyState
          title="No channels available"
          description="Nexus can only list channels where it is allowed to post embeds and where you can see the channel. Check the bot's permissions in Discord, then refresh."
          action={
            <Button variant="secondary" icon={<RotateCw size={16} aria-hidden="true" />} onClick={channels.reload}>
              Check again
            </Button>
          }
        />
      ) : (
        <Card>
          <form className="stack" onSubmit={onSubmit} noValidate aria-label="New announcement">
            <Select
              label="Channel"
              value={draft.channelId}
              placeholder="Choose a channel"
              hint="Only channels where Nexus can post and you can see are listed."
              error={visibleError('channelId')}
              options={channelList.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
              onChange={(value) => {
                update('channelId', value)
                touch('channelId')
              }}
            />

            <TextField
              label="Title"
              value={draft.title}
              maxLength={ANNOUNCEMENT_LIMITS.titleMax}
              error={visibleError('title')}
              autoComplete="off"
              onChange={(event) => update('title', event.target.value)}
              onBlur={() => touch('title')}
            />

            <TextField
              multiline
              label="Message"
              value={draft.message}
              maxLength={ANNOUNCEMENT_LIMITS.messageMax}
              rows={7}
              hint="Tip: :emoji_name: turns into the server's custom emoji."
              error={visibleError('message')}
              onChange={(event) => update('message', event.target.value)}
              onBlur={() => touch('message')}
            />

            <TextField
              label="Image URL"
              optional
              type="url"
              inputMode="url"
              value={draft.imageUrl}
              maxLength={ANNOUNCEMENT_LIMITS.imageUrlMax}
              placeholder="https://"
              error={visibleError('imageUrl')}
              autoComplete="off"
              onChange={(event) => update('imageUrl', event.target.value)}
              onBlur={() => touch('imageUrl')}
            />

            {postError ? <Notice tone="danger">{postError}</Notice> : null}

            <div className="form-actions">
              <Button type="submit" icon={<Send size={16} aria-hidden="true" />}>
                Review and post
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Modal
        open={phase === 'confirming' || phase === 'posting'}
        title="Post this announcement?"
        dismissible={phase !== 'posting'}
        onClose={() => setPhase('editing')}
        footer={
          <>
            <Button variant="secondary" disabled={phase === 'posting'} onClick={() => setPhase('editing')}>
              Back to editing
            </Button>
            <Button loading={phase === 'posting'} icon={<Send size={16} aria-hidden="true" />} onClick={() => void post()}>
              Post announcement
            </Button>
          </>
        }
      >
        <p>
          This will be posted in <strong>#{channelName(draft.channelId)}</strong> in {guild.name} straight away.
        </p>
        <div className="preview">
          <div className="preview__title">{draft.title.trim()}</div>
          <div className="preview__message">{draft.message.trim()}</div>
          {draft.imageUrl.trim() ? <div className="preview__image">Image: {draft.imageUrl.trim()}</div> : null}
        </div>
      </Modal>
    </div>
  )
}
