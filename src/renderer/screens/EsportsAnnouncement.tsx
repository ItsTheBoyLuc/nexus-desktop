import { Send } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { ANNOUNCEMENT_LIMITS, validateAnnouncement } from '../../shared/validation'
import type { AnnouncementDraft, AnnouncementField } from '../../shared/validation'
import type { RacingAnnouncementInput, RacingAnnouncementResult } from '../../shared/types'
import { Button, Card, EmptyState, LoadingRegion, Notice, PageHeader, PingRolesField, PostConfirmDialog, PostResultDialog, SearchSelect, Skeleton, TextField, useToast } from '../components'
import { useAuth } from '../hooks/auth'
import { useGuildChannels, usePingRoles, useRacingTeamRoles, useServerSettings } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { useManagerDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeChannelError, describeError, unwrap } from '../lib/errors'
import { resolvePingRoles } from '../lib/pingRoles'
import { ANNOUNCEMENT_AS_TYPED_TEXT, announcementFooter, announcementLostText, describeRacingError, MANAGER_RULE } from '../lib/racingView'
import { judgeWrite } from '../lib/racingWriteFlow'
import { EsportsNote, useEsports } from './EsportsRoute'
import type { EsportsContext } from './EsportsRoute'

const EMPTY_DRAFT: AnnouncementDraft = { title: '', message: '', channelId: '', imageUrl: '' }
type Phase = 'editing' | 'confirming' | 'lost'

/** An http:// image link is refused with its own words: the API only takes https (the command lets http through, the API does not). */
function imageProblem(value: string, fallback: string | null): string | null {
  return /^http:\/\//i.test(value.trim()) ? 'Only https links are accepted: this one starts with http://. Use an https:// image link.' : fallback
}

function AnnouncementScreen({ ctx }: { ctx: EsportsContext }) {
  const channels = useGuildChannels(ctx.guild.id)
  const settings = useServerSettings(ctx.guild.id)
  const roles = usePingRoles(ctx.guild.id)
  const teamRoles = useRacingTeamRoles(ctx.guild.id, ctx.game)
  const { postChannelOf, rememberPostChannel } = useSettings()
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
  // The roles to ping (ids only, in memory only) and what was just posted, for the result dialog.
  const [pingIds, setPingIds] = useState<string[]>([])
  const [pingError, setPingError] = useState<string | null>(null)
  const [posted, setPosted] = useState<{ result: RacingAnnouncementResult; requested: string[] } | null>(null)

  const channelList = channels.status === 'ready' ? channels.data : []
  // The channel last used for this game on this server, when it still exists. It is only a starting point: the user can pick another.
  const remembered = postChannelOf(ctx.guild.id, ctx.game)
  const channelId = draft.channelId !== '' ? draft.channelId : remembered !== null && channelList.some((channel) => channel.id === remembered) ? remembered : ''

  const validation = validateAnnouncement({ ...draft, channelId })
  const errors = validation.ok ? {} : validation.errors
  const visibleError = (field: AnnouncementField): string | null => {
    const shown = serverErrors[field] ?? (submitted || touched.has(field) ? (errors[field] ?? null) : null)
    return field === 'imageUrl' ? imageProblem(draft.imageUrl, shown) : shown
  }

  const channelName = (id: string): string => channelList.find((channel) => channel.id === id)?.name ?? ''
  const userName = auth.state.status === 'signed-in' ? auth.state.user.username : 'you'
  const serverFooter = settings.status === 'ready' ? settings.data.footerName : null
  const footer = `${announcementFooter(userName)}${serverFooter ? ` · ${serverFooter}` : ''}`

  const update = (field: keyof AnnouncementDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
  }
  const chooseChannel = (value: string): void => {
    update('channelId', value)
    setTouched((current) => new Set(current).add('channelId'))
    if (value !== '') rememberPostChannel(ctx.guild.id, ctx.game, value) // the channel id and nothing else
  }
  const changePings = (ids: string[]): void => {
    setPingIds(ids)
    setPingError(null)
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
    const input: RacingAnnouncementInput = { ...validation.value, ...(pingIds.length > 0 ? { pingRoleIds: pingIds } : {}) }
    const outcome = await write.run(() => unwrap(window.nexus.api.postRacingAnnouncement(ctx.guild.id, ctx.game, input)))
    if (!outcome) return
    if (outcome.ok) {
      setPosted({ result: outcome.value, requested: pingIds })
      toast.push({ tone: 'success', title: 'Announcement posted', message: `Sent to #${channelName(outcome.value.channelId) || 'the channel'}.` })
      // Ready for the next one: the text and the roles are cleared (so nobody is pinged twice by accident), the channel stays.
      setDraft({ ...EMPTY_DRAFT, channelId })
      setPingIds([])
      setTouched(new Set())
      setSubmitted(false)
      setPhase('editing')
      return
    }
    const error = outcome.error
    const verdict = judgeWrite(error, 'announcement')
    if (verdict.type === 'lost') {
      // The message may be in the channel already (and may already have pinged people): lock the form and never offer the same data for sending.
      setPhase('lost')
      return
    }
    setPhase('editing')
    if (verdict.type === 'denied') {
      manager.markDenied()
      return
    }
    if (verdict.type === 'channel') {
      setServerErrors({ channelId: describeChannelError(error, channelName(channelId), 'Nothing was posted.') })
      return
    }
    if (verdict.type === 'ping') {
      // Nothing was posted. The roles stay so they can be fixed, and the list is read again: a role may have changed in Discord.
      setPingError(describeRacingError(error, ctx.gameLabel))
      roles.reload()
      return
    }
    setProblem(describeRacingError(error, ctx.gameLabel))
  }

  /** Throws the draft away after a lost answer. Nothing is sent. */
  const discard = (): void => {
    setDraft(EMPTY_DRAFT)
    setPingIds([])
    setPingError(null)
    setTouched(new Set())
    setSubmitted(false)
    setServerErrors({})
    setProblem(null)
    setPhase('editing')
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

      {phase === 'lost' ? (
        <Card className="stack">
          <Notice tone="danger">
            <strong>The announcement may already be in the channel.</strong> {announcementLostText(pingIds.length > 0)}
          </Notice>
          <div className="dialog-actions dialog-actions--start">
            <Button variant="secondary" onClick={discard}>
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
              value={channelId}
              options={channelList.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
              placeholder="Search channels"
              hint="Only channels where Nexus can post and you can see are listed."
              error={visibleError('channelId')}
              emptyText="No channel found. Nexus can only post where it has permission."
              onChange={chooseChannel}
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
            <PingRolesField guildId={ctx.guild.id} gameLabel={ctx.gameLabel} roles={roles} teamRoles={teamRoles} ids={pingIds} onChange={changePings} error={pingError} />
            {problem ? <Notice tone="danger">{problem}</Notice> : null}
            <div className="form-actions">
              <Button type="submit" icon={<Send size={16} aria-hidden="true" />} disabled={manager.denied}>
                Review and post
              </Button>
            </div>
          </form>
        </Card>
      )}

      <PostConfirmDialog
        open={phase === 'confirming'}
        title={`Post this ${ctx.gameLabel} announcement?`}
        channelLabel={`#${channelName(channelId) || 'the channel you chose'}`}
        guildName={ctx.guild.name}
        roles={resolvePingRoles(pingIds, roles.status === 'ready' ? roles.data : [])}
        confirmLabel="Post announcement"
        busy={write.busy}
        onConfirm={() => void post()}
        onCancel={() => setPhase('editing')}
      >
        <div className="preview">
          <div className="preview__title plain-text">{draft.title.trim()}</div>
          <div className="preview__message plain-text">{draft.message.trim()}</div>
          {draft.imageUrl.trim() ? <div className="preview__image plain-text">Image: {draft.imageUrl.trim()}</div> : null}
          <div className="preview__image plain-text">{footer}</div>
        </div>
        <p className="muted">The text goes to Discord exactly as typed, so formatting characters render there and :name: emoji of this server are converted.</p>
      </PostConfirmDialog>

      {posted ? (
        <PostResultDialog
          title="Announcement posted"
          intro={
            <>
              It was sent to {channelName(posted.result.channelId) ? <strong>#{channelName(posted.result.channelId)}</strong> : 'the channel you chose'} in {ctx.guild.name}. The app cannot read announcements back.
            </>
          }
          guildId={ctx.guild.id}
          channelId={posted.result.channelId}
          channelName={channelName(posted.result.channelId) || undefined}
          messageId={posted.result.messageId}
          pingedRoles={posted.result.pingedRoles}
          requestedRoleIds={posted.requested}
          onClose={() => setPosted(null)}
        />
      ) : null}
    </div>
  )
}

/** Keyed by server AND game: switching either rebuilds the screen, so no draft, channel, chosen role or pending dialog of the old game is left. */
export function EsportsAnnouncement() {
  const ctx = useEsports()
  return <AnnouncementScreen key={ctx.scope} ctx={ctx} />
}
