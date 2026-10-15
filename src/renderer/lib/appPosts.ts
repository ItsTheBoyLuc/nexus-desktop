import { invalidate } from './cache'
import { describeError, errorCode, outcomeUnknown, UiError } from './errors'
import { MANAGE_SERVER_RULE } from './racingView'

/**
 * The posts made with the app (milestone 7): what the screens say about listing and deleting them, and what happens after each answer.
 * Free of React so the rules can be tested. The title of a post comes from Discord and is untrusted: nothing here builds HTML.
 */

/** Said next to every list. The server looks at the last 100 messages of the channel and returns at most 25 app posts of them. */
export const APP_POSTS_SCOPE_TEXT =
  'Shows posts among the last 100 messages of the channel (at most 25, newest first). A post further back is not found here, but it still exists in Discord.'

/** Also says what else is in the list: the cards posted with the app, and the announcements of every game. */
export const APP_POSTS_KIND_TEXT = 'The list also contains the team, event and result cards and the announcements of every game that were posted with the app.'

/** Part of every delete confirmation. */
export const DELETE_NEVER_TEXT = 'Deleting a post never deletes the team, event or result itself: only the message in Discord is removed.'

export const DELETE_PERMISSION_TEXT = 'Deleting a post needs the Manage Server permission, or Administrator, in Discord.'

/** Said after a lost answer: the delete is not sent again, and the list is the only way to find out. */
export const DELETE_LOST_TEXT =
  'Nexus did not get a clear answer, so the post may or may not be deleted. The delete is not sent again. Refresh the list to see what is in the channel now.'

export const APP_POST_GONE_TEXT = 'That post is already gone: it was deleted a moment earlier, in Discord or by someone else. Nothing more to do. The list is refreshed.'

type Action = 'list' | 'delete'

/** The words for every refusal of the two calls. A refusal always happens before anything is deleted. */
export function describeAppPostError(error: unknown, action: Action): string {
  switch (errorCode(error)) {
    case 'manage_server_required':
      return MANAGE_SERVER_RULE
    case 'bot_cannot_read':
      return 'Nexus cannot read that channel: it needs the View Channel and Read Message History permissions there. Give the Nexus role both in Discord, or pick another channel.'
    case 'bot_cannot_delete':
      return 'Nexus is not allowed to delete that message: it needs the Manage Messages permission in that channel, or the post is too old for Discord to delete. Nothing was deleted.'
    case 'channel_not_found':
      return 'That channel no longer exists in this server (or is not a text channel). Refresh the channel list and pick another one.'
    case 'not_an_app_post':
      return 'That message is not a post made with the app (it may have been edited, or it is not from Nexus). Nexus only deletes posts it can recognise, so nothing was deleted. Refresh the list.'
    case 'message_not_found':
      return action === 'delete' ? APP_POST_GONE_TEXT : 'That message no longer exists.'
    case 'forbidden':
      return action === 'delete'
        ? 'Your account cannot see that channel in Discord (or is no longer staff of this server), so Nexus will not delete there. Nothing was deleted.'
        : 'Your account cannot see that channel in Discord (or is no longer staff of this server), so its posts are not listed.'
    case 'invalid_channel':
    case 'invalid_message_id':
      return 'That channel or message is not valid. Refresh the list and try again. Nothing was deleted.'
    case 'rate_limited':
      return rateLimitText(error, action)
    default:
      return describeError(error)
  }
}

function rateLimitText(error: unknown, action: Action): string {
  const seconds = error instanceof UiError ? error.info.retryAfter : undefined
  const wait = seconds !== undefined && seconds > 0 ? `Try again in ${seconds} seconds.` : 'Wait a minute, then try again.'
  return action === 'delete'
    ? `Too many deletes in a short time: Nexus allows 10 deletes a minute for each person on each server, and a refused attempt counts too. ${wait} Nothing was deleted.`
    : `Too many reads of Discord in a short time. ${wait}`
}

/** What the delete dialog does with an answer. */
export type DeleteVerdict =
  /** The server may have carried it out (timeout, dropped connection, 5xx): lock, never offer a second send, only a refresh of the list. */
  | { type: 'lost' }
  /** 403 manage_server_required: switch the action off for this server and keep the list readable. */
  | { type: 'denied' }
  /** 404 message_not_found: the post is gone already. Say so and refresh. */
  | { type: 'gone' }
  /** The list is out of date or the channel is unusable (not_an_app_post, channel_not_found): nothing was deleted, only a refresh helps. */
  | { type: 'stale' }
  /** Any other refusal that proves nothing was deleted (no permission of the bot, a rate limit, ...): the message is shown, the user may try again later. */
  | { type: 'rejected' }

export function judgeDelete(error: unknown): DeleteVerdict {
  if (outcomeUnknown(error)) return { type: 'lost' }
  switch (errorCode(error)) {
    case 'manage_server_required':
      return { type: 'denied' }
    case 'message_not_found':
      return { type: 'gone' }
    case 'not_an_app_post':
    case 'channel_not_found':
      return { type: 'stale' }
    default:
      return { type: 'rejected' }
  }
}

export type DeletePhase = 'confirming' | 'deleting' | 'lost' | 'gone' | 'stale'
export type DeleteAction = 'cancel' | 'delete' | 'refresh'

/**
 * What the user can do in each phase. The important line: in `lost` there is no `delete` and no `cancel`: only `refresh` (look at what the
 * channel holds). In `deleting` nothing can be done, so a second send is impossible. A post that is gone or not recognised any more is
 * never offered for deletion again.
 */
export function deleteActions(phase: DeletePhase): DeleteAction[] {
  switch (phase) {
    case 'confirming':
      return ['cancel', 'delete']
    case 'deleting':
      return []
    case 'lost':
    case 'gone':
    case 'stale':
      return ['refresh']
  }
}

/** The phase after a refused or lost delete; `confirming` again when the user may try again. */
export function phaseAfterDelete(verdict: DeleteVerdict): DeletePhase {
  switch (verdict.type) {
    case 'lost':
      return 'lost'
    case 'gone':
      return 'gone'
    case 'stale':
      return 'stale'
    case 'denied':
    case 'rejected':
      return 'confirming'
  }
}

/** "Deleting #channel" text for a channel that may not have a known name. */
export function channelLabel(name: string): string {
  return name === '' ? 'the channel' : `#${name}`
}

// ── Keys ────────────────────────────────────────────────────────────────────

/** The key of the list of one channel. Memory only (React state of the hook); nothing about posts is stored anywhere. */
export function appPostsKey(guildId: string, channelId: string): string {
  return `${appPostsPrefix(guildId, channelId)}list`
}

/** Ends with a colon, so the channel `123` never matches the channel `1234`. */
const appPostsPrefix = (guildId: string, channelId: string): string => `app-posts:${guildId}:${channelId}:`

/** After a delete (or a lost answer): forget what we knew about this channel and read it again. */
export function invalidateAppPosts(guildId: string, channelId: string): void {
  invalidate(appPostsPrefix(guildId, channelId))
}
