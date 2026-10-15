import type { Parsed } from './inputs'
import { isValidSnowflake } from './validation'

/**
 * The main process never trusts what the renderer sends over IPC (milestone 7, app posts): the ids are parsed again here before they can
 * reach the API. A channel and a message are Discord ids, nothing else: no name, no link and no title can be passed in their place.
 */

/** A Discord id: digits only and not zero (the server refuses `0` with 400, so the app does not even ask). */
export function isAppPostId(value: unknown): value is string {
  return isValidSnowflake(value) && BigInt(value) > 0n
}

export function parseAppPostChannel(value: unknown): Parsed<string> {
  return isAppPostId(value) ? { ok: true, value } : { ok: false, message: 'That channel is not valid.' }
}

/** The post to delete: the channel and the message, both Discord ids. */
export function parseAppPostRef(channelId: unknown, messageId: unknown): Parsed<{ channelId: string; messageId: string }> {
  if (!isAppPostId(channelId)) return { ok: false, message: 'That channel is not valid.' }
  if (!isAppPostId(messageId)) return { ok: false, message: 'That message ID is not valid.' }
  return { ok: true, value: { channelId, messageId } }
}
