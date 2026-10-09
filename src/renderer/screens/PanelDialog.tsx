import { RotateCw } from 'lucide-react'
import { useId, useState } from 'react'
import { findPanel } from '../../shared/panels'
import type { LeagueGame, Tier } from '../../shared/types'
import { validatePanelInput } from '../../shared/validation'
import { Button, Modal, Notice, SearchSelect, Skeleton, useToast } from '../components'
import { useGuildChannels } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, mayHaveSucceeded, unwrap } from '../lib/errors'
import { invalidateLeagueData } from '../lib/invalidation'

interface PanelDialogProps {
  guildId: string
  game: LeagueGame
  tier: Tier
  onClose: () => void
}

type Mode = 'refresh' | 'new'

/**
 * Post or refresh the sign-up panel of a tier.
 *
 * The API cannot look up an existing panel, so the message id returned when this app posted one is
 * remembered by the main process (settings file). "Refresh panel" exists only when such an id is stored
 * for this server, game and tier, and it sends that id; otherwise the only action is "Post new panel".
 */
export function PanelDialog({ guildId, game, tier, onClose }: PanelDialogProps) {
  const channels = useGuildChannels(guildId)
  const { settings, reload: reloadSettings } = useSettings()
  const toast = useToast()
  const write = useWriteAction()
  const modeName = useId()

  const stored = findPanel(settings.panels, guildId, game.key, tier.key)
  const channelList = channels.status === 'ready' ? channels.data : []
  const nameOf = (id: string | null): string => (id ? (channelList.find((channel) => channel.id === id)?.name ?? 'a channel') : 'a channel')

  const [mode, setMode] = useState<Mode>(stored ? 'refresh' : 'new')
  const [channelId, setChannelId] = useState(tier.signupChannelId ?? '')
  const [submitted, setSubmitted] = useState(false)
  const [problem, setProblem] = useState<{ text: string; uncertain: boolean } | null>(null)

  // The stored panel may disappear while the dialog is open (the main process forgets a gone message).
  const effectiveMode: Mode = stored ? mode : 'new'
  const request = effectiveMode === 'refresh' && stored ? { channelId: stored.channelId, messageId: stored.messageId } : { channelId }
  const checked = validatePanelInput(request)

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!checked.ok) return
    setProblem(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.postPanel(guildId, game.key, tier.key, checked.value)))
    if (!outcome) return
    if (outcome.ok) {
      await reloadSettings() // the main process just remembered (or kept) the message id
      invalidateLeagueData(guildId)
      toast.push({
        tone: 'success',
        title: outcome.value.refreshed ? 'Panel refreshed' : 'Panel posted',
        message: `${tier.key} in ${game.label}, in #${nameOf(outcome.value.channelId)}.`
      })
      onClose()
      return
    }
    const error = outcome.error
    const code = errorCode(error)
    if (code === 'message_not_found' || code === 'not_a_bot_message') {
      await reloadSettings() // the main process has forgotten the panel: only "Post new panel" is left
      setMode('new')
      setProblem({
        text: `${describeError(error)} Nexus no longer remembers it, so post a new panel instead.`,
        uncertain: false
      })
      return
    }
    if (mayHaveSucceeded(error)) {
      setProblem({
        text: `${describeError(error)} The panel may already be in the channel. Check Discord before posting again, so you do not end up with two. Refresh to re-read this tier.`,
        uncertain: true
      })
      return
    }
    setProblem({ text: describeError(error), uncertain: false })
  }

  const channelsReady = channels.status === 'ready'
  const showPicker = effectiveMode === 'new'

  return (
    <Modal open title={`Sign-up panel: ${tier.key}`} dismissible={!write.busy} onClose={onClose}>
      <p>
        The panel for <strong>{tier.key}</strong> in {game.label} has a <strong>Join</strong> button that gives members the role{' '}
        <strong>{tier.roleName ?? 'of this tier'}</strong>.
      </p>

      {stored ? (
        <fieldset className="choice-group" disabled={write.busy}>
          <legend className="sr-only">What to do</legend>
          <div className="choice">
            <input type="radio" id={`${modeName}-refresh`} name={modeName} checked={effectiveMode === 'refresh'} onChange={() => setMode('refresh')} />
            <label htmlFor={`${modeName}-refresh`}>
              <strong>Refresh the panel posted by this app</strong>
              <span className="choice__note">Updates the message in #{nameOf(stored.channelId)} in place: colour, footer, names and the Join button.</span>
            </label>
          </div>
          <div className="choice">
            <input type="radio" id={`${modeName}-new`} name={modeName} checked={effectiveMode === 'new'} onChange={() => setMode('new')} />
            <label htmlFor={`${modeName}-new`}>
              <strong>Post a new panel</strong>
              <span className="choice__note">The old message stays in Discord until someone deletes it.</span>
            </label>
          </div>
        </fieldset>
      ) : (
        <Notice tone="info">
          {tier.signupPanelPosted
            ? 'A panel for this tier was posted before, but not by this app on this computer, so Nexus cannot find it to refresh it. Post a new one; the old message stays in Discord until someone deletes it.'
            : 'No panel has been posted for this tier yet. Posting one lets members join the tier with a button.'}{' '}
          Refreshing is only possible for panels this app posted.
        </Notice>
      )}

      {showPicker ? (
        <>
          {channels.status === 'loading' ? <Skeleton height={64} /> : null}
          {channels.status === 'error' ? (
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
          ) : null}
          {channelsReady && channelList.length === 0 ? (
            <Notice tone="info">Nexus found no channel where it can post and you can see. Check the bot&apos;s permissions in Discord, then try again.</Notice>
          ) : null}
          {channelsReady && channelList.length > 0 ? (
            <SearchSelect
              label="Channel"
              value={channelId}
              options={channelList.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
              placeholder="Search for a channel"
              hint="Only channels where Nexus can post and you can see are listed."
              error={submitted && !checked.ok ? (checked.errors.channelId ?? null) : null}
              onChange={(value) => {
                setChannelId(value)
                setProblem(null)
              }}
            />
          ) : null}
        </>
      ) : null}

      {problem ? (
        <Notice
          tone="danger"
          action={
            problem.uncertain ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<RotateCw size={14} aria-hidden="true" />}
                onClick={() => {
                  setProblem(null)
                  invalidateLeagueData(guildId)
                  void reloadSettings()
                }}
              >
                Refresh
              </Button>
            ) : undefined
          }
        >
          {problem.text}
        </Notice>
      ) : null}

      <div className="dialog-actions">
        <Button variant="secondary" disabled={write.busy} onClick={onClose}>
          Close
        </Button>
        <Button loading={write.busy} disabled={showPicker && (!channelsReady || channelList.length === 0)} onClick={() => void submit()}>
          {effectiveMode === 'refresh' ? 'Refresh panel' : 'Post new panel'}
        </Button>
      </div>
    </Modal>
  )
}
