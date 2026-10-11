import { CircleCheck, ExternalLink as ExternalIcon, Send } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { ANNOUNCEMENT_LIMITS, validateAnnouncement } from '../../shared/validation'
import type { AnnouncementDraft, AnnouncementField } from '../../shared/validation'
import type { AnnouncementResult } from '../../shared/types'
import { Button, Card, CopyButton, EmptyState, LoadingRegion, Modal, Notice, PageHeader, SearchSelect, Skeleton, TextField, useToast } from '../components'
import { useAuth } from '../hooks/auth'
import { useGuildChannels, useServerSettings } from '../hooks/data'
import { useManagerDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeChannelError, describeError, unwrap } from '../lib/errors'
import { ANNOUNCEMENT_AS_TYPED_TEXT, ANNOUNCEMENT_LOST_TEXT, announcementFooter, describeRacingError, discordMessageLink, MANAGER_RULE } from '../lib/racingView'
import { judgeWrite } from '../lib/racingWriteFlow'
import { EsportsNote, useEsports } from './EsportsRoute'
import type { EsportsContext } from './EsportsRoute'

const EMPTY_DRAFT: AnnouncementDraft = { title: '', message: '', channelId: '', imageUrl: '' }
type Phase = 'editing' | 'confirming' | 'lost' | 'done'

/** An http:// image link is refused with its own words: the API only takes https (the command lets http through, the API does not). */
function imageProblem(value: string, fallback: string | null): string | null {
  return /^http:\/\//i.test(value.trim()) ? 'Only https links are accepted: this one starts with http://. Use an https:// image link.' : fallback
}

function AnnouncementScreen({ ctx }: { ctx: EsportsContext }) {
  const channels = useGuildChannels(ctx.guild.id)
  const settings = useServerSettings(ctx.guild.id)
  const auth = useAuth()
  const toast = useToast()
  const write = useWriteAction()
  const manager = useManagerDenied(ctx.guild.id, ctx.game)

  const [draft, setDraft] = useState<AnnouncementDraft>(EMPTY_DRAFT)
  const [touched, setTouched] = useState<ReadonlySet<AnnouncementField>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [phase, setPhase] = useState<Phase>('editing')
  const [serverErrors, setServerErrors] = useState<Partial<Record<AnnouncementField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [posted, setPosted] = useState<AnnouncementResult | null>(null)

  const validation = validateAnnouncement(draft)
  const errors = validation.ok ? {} : validation.errors
  const visibleError = (field: AnnouncementField): string | null => {
    const shown = serverErrors[field] ?? (submitted || touched.has(field) ? (errors[field] ?? null) : null)
    return field === 'imageUrl' ? imageProblem(draft.imageUrl, shown) : shown
  }

  const channelList = channels.status === 'ready' ? channels.data : []
  const channelName = (id: string): string => channelList.find((channel) => channel.id === id)?.name ?? ''
  const userName = auth.state.status === 'signed-in' ? auth.state.user.username : 'you'
  const serverFooter = settings.status === 'ready' ? settings.data.footerName : null
  const footer = `${announcementFooter(userName)}${serverFooter ? ` · ${serverFooter}` : ''}`

  const update = (field: keyof AnnouncementDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
  }
  const touch = (field: AnnouncementField): void => setTouched((current) => new Set(current).add(field))

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    setSubmitted(true)
    if (validation.ok && !manager.denied) setPhase('confirming')
  }

  const post = async (): Promise<void> => {
    if (!validation.ok || manager.denied) return
    const outcome = await write.run(() => unwrap(window.nexus.api.postRacingAnnouncement(ctx.guild.id, ctx.game, validation.value)))
    if (!outcome) return
    if (outcome.ok) {
      setPosted(outcome.value)
      setPhase('done')
      toast.push({ tone: 'success', title: 'Announcement posted', message: `Sent to #${channelName(outcome.value.channelId) || 'the channel'}.` })
      return
    }
    const error = outcome.error
    const verdict = judgeWrite(error, 'announcement')
    if (verdict.type === 'lost') {
      // The message may be in the channel already: lock the form and never offer the same data for sending.
      setPhase('lost')
      return
    }
    setPhase('editing')
    if (verdict.type === 'denied') {
      manager.markDenied()
      return
    }
    if (verdict.type === 'channel') {
      setServerErrors({ channelId: describeChannelError(error, channelName(draft.channelId), 'Nothing was posted.') })
      return
    }
    setProblem(describeRacingError(error, ctx.gameLabel))
  }

  const startAnother = (): void => {
    setDraft((current) => ({ ...EMPTY_DRAFT, channelId: phase === 'done' ? current.channelId : '' }))
    setTouched(new Set())
    setSubmitted(false)
    setServerErrors({})
    setProblem(null)
    setPosted(null)
    setPhase('editing')
  }

  const open = async (link: string): Promise<void> => {
    const opened = await window.nexus.system.openExternal(link).catch(() => false)
    if (!opened) toast.push({ tone: 'danger', title: 'Link not opened', message: 'The link could not be opened. Copy it and open it in your browser.' })
  }

  return (
    <div className="page">
      <PageHeader title="Announcement" description={`${ctx.guild.name} - post a ${ctx.gameLabel} announcement to a Discord channel`} />
      <EsportsNote game={ctx.game} gameLabel={ctx.gameLabel} />
      <Notice tone="info">
        This is the announcement of the <strong>{ctx.gameLabel} esports team</strong>. The announcement for the whole server is a separate screen in the Server section. {ANNOUNCEMENT_AS_TYPED_TEXT} The message footer reads <strong>&ldquo;{announcementFooter('your name')}&rdquo;</strong>, followed by the footer text of this server.
      </Notice>
      {manager.denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manager.reset}>Check again</Button>}>
          {MANAGER_RULE} The server refused your account for {ctx.gameLabel}, so posting is off here. If your role changed, choose Check again.
        </Notice>
      ) : null}

      {phase === 'done' && posted ? (
        <Card className="success-panel">
          <CircleCheck size={40} aria-hidden="true" className="success-panel__icon" />
          <h2>Announcement posted</h2>
          <p>
            It was sent to {channelName(posted.channelId) ? <strong>#{channelName(posted.channelId)}</strong> : 'the channel you chose'} in {ctx.guild.name}.
          </p>
          <dl className="facts facts--grid">
            <div>
              <dt>Message ID</dt>
              <dd className="plain-text">{posted.messageId}</dd>
            </div>
            <div>
              <dt>Channel ID</dt>
              <dd className="plain-text">{posted.channelId}</dd>
            </div>
          </dl>
          <div className="dialog-actions">
            <Button variant="secondary" size="sm" icon={<ExternalIcon size={14} aria-hidden="true" />} onClick={() => void open(discordMessageLink(ctx.guild.id, posted.channelId, posted.messageId))}>
              Open in Discord
            </Button>
            <CopyButton text={posted.messageId} label="Copy the message ID" what="The message ID" />
            <Button onClick={startAnother}>Post another</Button>
          </div>
          <p className="muted">The link is built from the channel and message the server just returned. The app does not keep it: announcements cannot be read back.</p>
        </Card>
      ) : phase === 'lost' ? (
        <Card className="stack">
          <Notice tone="danger">
            <strong>The announcement may already be in the channel.</strong> {ANNOUNCEMENT_LOST_TEXT}
          </Notice>
          <div className="dialog-actions dialog-actions--start">
            <Button variant="secondary" onClick={startAnother}>
              Discard this draft
            </Button>
          </div>
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
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={channels.reload}>Try again</Button>}>
          Could not load the channels. {describeError(channels.error)}
        </Notice>
      ) : channelList.length === 0 ? (
        <EmptyState
          title="No channels available"
          description="Nexus can only list channels where it is allowed to post embeds and where you can see the channel. Check the bot's permissions in Discord, then refresh."
          action={
            <Button variant="secondary" onClick={channels.reload}>
              Check again
            </Button>
          }
        />
      ) : (
        <Card>
          <form className="stack" onSubmit={onSubmit} noValidate aria-label={`New ${ctx.gameLabel} announcement`}>
            <SearchSelect
              label="Channel"
              value={draft.channelId}
              options={channelList.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
              placeholder="Search channels"
              hint="Only channels where Nexus can post and you can see are listed."
              error={visibleError('channelId')}
              emptyText="No channel found. Nexus can only post where it has permission."
              onChange={(value) => {
                update('channelId', value)
                touch('channelId')
              }}
            />
            <TextField label="Title" value={draft.title} maxLength={ANNOUNCEMENT_LIMITS.titleMax} hint="One line, up to 150 characters." error={visibleError('title')} autoComplete="off" onChange={(event) => update('title', event.target.value)} onBlur={() => touch('title')} />
            <TextField
              multiline
              label="Message"
              value={draft.message}
              maxLength={ANNOUNCEMENT_LIMITS.messageMax}
              rows={7}
              hint="Up to 1500 characters. :emoji_name: turns into the server's custom emoji."
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
              hint="An https link only. http is refused."
              error={visibleError('imageUrl')}
              autoComplete="off"
              onChange={(event) => update('imageUrl', event.target.value)}
              onBlur={() => touch('imageUrl')}
            />
            {problem ? <Notice tone="danger">{problem}</Notice> : null}
            <div className="form-actions">
              <Button type="submit" icon={<Send size={16} aria-hidden="true" />} disabled={manager.denied}>
                Review and post
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Modal
        open={phase === 'confirming'}
        title={`Post this ${ctx.gameLabel} announcement?`}
        dismissible={!write.busy}
        onClose={() => setPhase('editing')}
        footer={
          <>
            <Button variant="secondary" disabled={write.busy} onClick={() => setPhase('editing')}>
              Back to editing
            </Button>
            <Button loading={write.busy} icon={<Send size={16} aria-hidden="true" />} onClick={() => void post()}>
              Post announcement
            </Button>
          </>
        }
      >
        <p>
          This will be posted in <strong>#{channelName(draft.channelId) || 'the channel you chose'}</strong> in {ctx.guild.name} straight away. It cannot be edited or deleted from this app.
        </p>
        <div className="preview">
          <div className="preview__title plain-text">{draft.title.trim()}</div>
          <div className="preview__message plain-text">{draft.message.trim()}</div>
          {draft.imageUrl.trim() ? <div className="preview__image plain-text">Image: {draft.imageUrl.trim()}</div> : null}
          <div className="preview__image plain-text">{footer}</div>
        </div>
        <p className="muted">The text goes to Discord exactly as typed, so formatting characters render there and :name: emoji of this server are converted.</p>
      </Modal>
    </div>
  )
}

/** Keyed by server AND game: switching either rebuilds the screen, so no draft, channel or pending dialog of the old game is left. */
export function EsportsAnnouncement() {
  const ctx = useEsports()
  return <AnnouncementScreen key={ctx.scope} ctx={ctx} />
}
