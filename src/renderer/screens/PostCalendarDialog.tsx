import { useState } from 'react'
import { isValidSnowflake } from '../../shared/validation'
import { Button, ErrorState, LoadingRegion, Modal, Notice, SearchSelect, Skeleton, useToast, WriteProblemNotice } from '../components'
import { useGuildChannels } from '../hooks/data'
import { useSettings } from '../hooks/settings'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { plural } from '../lib/format'

interface PostCalendarDialogProps {
  guildId: string
  roundCount: number
  onClose: () => void
}

/** Backend codes that prove the remembered calendar message cannot be edited any more (the main process then forgets it). */
const MESSAGE_GONE = new Set(['message_not_found', 'not_a_bot_message', 'channel_not_found'])

/**
 * "Post to Discord". The API cannot find a calendar message that was posted earlier, so this app remembers the
 * message id it got back (main process, settings file). While one is remembered the dialog offers "Update posted
 * calendar", which edits that message in place; when Discord says the message no longer exists, the dialog says so
 * and falls back to "Post new". Nothing is remembered until the API confirmed the post.
 */
export function PostCalendarDialog({ guildId, roundCount, onClose }: PostCalendarDialogProps) {
  const channels = useGuildChannels(guildId)
  const { settings, reload: reloadSettings } = useSettings()
  const toast = useToast()
  const write = useWriteAction()

  const stored = settings.calendarPosts[guildId] ?? null
  const [wantsNew, setWantsNew] = useState(false)
  const [goneNote, setGoneNote] = useState<string | null>(null)
  const [channelId, setChannelId] = useState('')
  const [channelError, setChannelError] = useState<string | null>(null)
  const [problem, setProblem] = useState<WriteProblem | null>(null)

  const channelName = (id: string): string => (channels.status === 'ready' ? (channels.data.find((channel) => channel.id === id)?.name ?? 'a deleted or hidden channel') : 'a channel')
  const updating = stored !== null && !wantsNew

  const finish = async (title: string, message: string): Promise<void> => {
    await reloadSettings() // the main process just remembered (or forgot) the message id
    toast.push({ tone: 'success', title, message })
    onClose()
  }

  const update = async (): Promise<void> => {
    if (!stored) return
    setProblem(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.postCalendar(guildId, { channelId: stored.channelId, messageId: stored.messageId })))
    if (!outcome) return
    if (outcome.ok) {
      await finish('Calendar updated', `The posted calendar in #${channelName(outcome.value.channelId)} now shows ${plural(roundCount, 'round')}.`)
      return
    }
    const code = errorCode(outcome.error)
    if (code !== null && MESSAGE_GONE.has(code)) {
      await reloadSettings() // the main process forgot the id: "Update posted calendar" is no longer offered
      setGoneNote(
        code === 'not_a_bot_message'
          ? 'The remembered message was not posted by Nexus, so it cannot be updated. Nothing was changed.'
          : 'The posted calendar no longer exists in Discord (the message or its channel was deleted). Nothing was changed.'
      )
      setWantsNew(true)
      setChannelId(code === 'channel_not_found' ? '' : stored.channelId)
      return
    }
    setProblem(writeProblem(outcome.error, 'The update'))
  }

  const postNew = async (): Promise<void> => {
    if (!isValidSnowflake(channelId)) {
      setChannelError('Choose a channel.')
      return
    }
    setProblem(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.postCalendar(guildId, { channelId })))
    if (!outcome) return
    if (outcome.ok) {
      await finish('Calendar posted', `Posted in #${channelName(outcome.value.channelId)}. Use "Update posted calendar" next time to edit the same message.`)
      return
    }
    const code = errorCode(outcome.error)
    if (code === 'channel_not_found' || code === 'bot_cannot_send' || code === 'forbidden' || code === 'invalid_channel') {
      setChannelError(describeError(outcome.error))
      return
    }
    setProblem(writeProblem(outcome.error, 'The post'))
  }

  const closeAndCheck = (): void => {
    void reloadSettings()
    onClose()
  }

  return (
    <Modal open title="Post the calendar to Discord" dismissible={!write.busy} onClose={onClose}>
      <p>
        Posts the calendar as an embed ({plural(roundCount, 'round')}, ten per field) in a channel. A message posted earlier by this app can be updated in place.
      </p>

      {channels.status === 'loading' ? (
        <LoadingRegion label="Loading channels">
          <Skeleton height={40} />
        </LoadingRegion>
      ) : null}
      {channels.status === 'error' ? <ErrorState title="Could not load the channels" message={describeError(channels.error)} onRetry={channels.reload} /> : null}

      {goneNote ? <Notice tone="warning">{goneNote} Pick a channel below to post the calendar again.</Notice> : null}

      {channels.status === 'ready' && updating && stored ? (
        <>
          <Notice tone="info">
            This app posted the calendar in <strong>#{channelName(stored.channelId)}</strong>. Updating edits that message, so nothing new appears in the channel.
          </Notice>
          <WriteProblemNotice problem={problem} onRefresh={closeAndCheck} refreshLabel="Close and check Discord" />
          <div className="dialog-actions">
            <Button variant="secondary" disabled={write.busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              disabled={write.busy}
              onClick={() => {
                setWantsNew(true)
                setChannelId(stored.channelId)
                setProblem(null)
              }}
            >
              Post new instead
            </Button>
            <Button loading={write.busy} onClick={() => void update()}>
              Update posted calendar
            </Button>
          </div>
        </>
      ) : null}

      {channels.status === 'ready' && !updating ? (
        <>
          <SearchSelect
            label="Channel"
            value={channelId}
            options={channels.data.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
            placeholder="Search channels"
            emptyText="No channel found. Nexus can only post where it has permission."
            hint="Only channels Nexus can post in and you can see are listed."
            error={channelError}
            onChange={(value) => {
              setChannelId(value)
              setChannelError(null)
              setProblem(null)
            }}
          />
          {stored ? <Notice tone="info">Posting a new message does not remove the one in #{channelName(stored.channelId)}. From now on this app updates the new one.</Notice> : null}
          <WriteProblemNotice problem={problem} onRefresh={closeAndCheck} refreshLabel="Close and check Discord" />
          <div className="dialog-actions">
            <Button variant="secondary" disabled={write.busy} onClick={onClose}>
              Cancel
            </Button>
            <Button loading={write.busy} onClick={() => void postNew()}>
              {stored || goneNote ? 'Post new calendar' : 'Post calendar'}
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  )
}
