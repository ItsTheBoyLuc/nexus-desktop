import { useState } from 'react'
import type { RacingGame } from '../../shared/types'
import { describeChannelError } from '../lib/errors'
import { resolvePingRoles } from '../lib/pingRoles'
import type { PostFields } from '../lib/postTarget'
import { postFields } from '../lib/postTarget'
import { describeRacingError } from '../lib/racingView'
import type { WriteVerdict } from '../lib/racingWriteFlow'
import { useGuildChannels, usePingRoles, useRacingTeamRoles } from './data'
import { useSettings } from './settings'

export interface PostTargetInitial {
  enabled?: boolean
  channelId?: string
  pingIds?: readonly string[]
}

/**
 * The state of a "Post in a channel" section: on or off, the channel, the roles to ping, and what the server refused about them. Everything
 * lives in memory of the screen that owns it (screens are keyed by server and game, so a switch of either starts from nothing); the only
 * thing ever stored is the channel id, by the main process, as the starting point for next time.
 */
export function usePostTarget(guildId: string, game: RacingGame, initial: PostTargetInitial = {}) {
  const channels = useGuildChannels(guildId)
  const roles = usePingRoles(guildId)
  const teamRoles = useRacingTeamRoles(guildId, game)
  const { postChannelOf, rememberPostChannel } = useSettings()
  const [enabled, setEnabledState] = useState(initial.enabled ?? false)
  const [picked, setPicked] = useState(initial.channelId ?? '')
  const [pingIds, setPingIds] = useState<string[]>([...(initial.pingIds ?? [])])
  const [channelError, setChannelError] = useState<string | null>(null)
  const [pingError, setPingError] = useState<string | null>(null)

  const channelList = channels.status === 'ready' ? channels.data : []
  // The channel last used for this game on this server, when it still exists. It is only a starting point.
  const remembered = postChannelOf(guildId, game)
  const channelId = picked !== '' ? picked : remembered !== null && channelList.some((channel) => channel.id === remembered) ? remembered : ''
  const channelName = (id: string): string => channelList.find((channel) => channel.id === id)?.name ?? ''

  const setEnabled = (value: boolean): void => {
    setEnabledState(value)
    setChannelError(null)
    setPingError(null)
    if (!value) setPingIds([]) // switching it off forgets the roles: nobody can be pinged by a section that is off
  }
  const chooseChannel = (value: string): void => {
    setPicked(value)
    setChannelError(null)
    if (value !== '') rememberPostChannel(guildId, game, value) // the channel id and nothing else
  }
  const changePings = (ids: string[]): void => {
    setPingIds(ids)
    setPingError(null)
  }

  const result = postFields({ enabled, channelId, pingIds })
  const pingViews = resolvePingRoles(pingIds, roles.status === 'ready' ? roles.data : [])

  /** A refusal about the channel or the roles (nothing was posted): shown next to the field. True when it was one. */
  const explainRefusal = (error: unknown, verdict: WriteVerdict, gameLabel: string, effect: string): boolean => {
    if (verdict.type === 'channel') {
      setChannelError(describeChannelError(error, channelName(channelId), effect))
      return true
    }
    if (verdict.type === 'ping') {
      setPingError(describeRacingError(error, gameLabel, effect))
      roles.reload() // a role may have changed in Discord: read the list again
      return true
    }
    return false
  }

  return {
    enabled,
    setEnabled,
    channels,
    roles,
    teamRoles,
    channelId,
    channelName,
    chooseChannel,
    pingIds,
    changePings,
    pingViews,
    channelError,
    pingError,
    /** The fields to add to the request: nothing while the section is off. */
    fields: (result.ok ? result.fields : {}) as PostFields,
    /** Why the section cannot be sent yet (it is on, but no channel is chosen), or null. */
    problem: result.ok ? null : result.message,
    explainRefusal
  }
}

export type PostTarget = ReturnType<typeof usePostTarget>
