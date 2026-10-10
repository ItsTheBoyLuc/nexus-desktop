import type { ApiErrorInfo, IpcResult } from '../../shared/types'

/** Error carrying the structured info that came over IPC. */
export class UiError extends Error {
  readonly info: ApiErrorInfo

  constructor(info: ApiErrorInfo) {
    super(info.message)
    this.name = 'UiError'
    this.info = info
  }
}

/** Turn an IpcResult into a value, or throw a UiError. */
export async function unwrap<T>(pending: Promise<IpcResult<T>>): Promise<T> {
  const result = await pending
  if (result.ok) return result.data
  throw new UiError(result.error)
}

/** The backend error code of an error, if it is one ("admin_required", "role_too_privileged", ...). */
export function errorCode(error: unknown): string | null {
  return error instanceof UiError ? error.info.code : null
}

/** Friendly, actionable text for an error. Never includes raw server details beyond the backend's own message. */
export function describeError(error: unknown): string {
  if (!(error instanceof UiError)) return 'Something went wrong. Please try again.'
  const { code, kind, message, retryAfter } = error.info

  switch (code) {
    case 'forbidden':
      return 'You no longer have the FIA, STAFF or Administrator role in this server.'
    case 'admin_required':
      return 'Only server administrators can change this. Your account has the staff role, but not the Administrator permission.'
    case 'guild_not_found':
      return 'Nexus is no longer in this server.'
    case 'channel_not_found':
      return 'That channel no longer exists. Refresh and pick another one.'
    case 'bot_cannot_send':
      return "Nexus can't post in that channel. Check the bot's permissions there."
    case 'discord_error':
      return 'Discord rejected the message. Check the content and try again.'
    case 'role_too_privileged':
      return 'That role has admin-level permissions (such as Administrator or Manage Roles), so only a server Administrator can link it to a tier. Pick a role that is below the bot, is not @everyone, is not managed by a bot, and has no admin-level permissions.'
    case 'role_not_assignable':
      return "Nexus can't hand out that role because it sits above the bot's highest role. Move the bot's role above it in Discord, or pick another role."
    case 'invalid_role':
      return 'That role cannot be used. @everyone and roles managed by a bot or integration are not allowed.'
    case 'role_not_found':
      return 'That role no longer exists in Discord. Refresh the list and pick another role.'
    case 'game_exists':
      return 'A game with that key already exists. Refresh to see it.'
    case 'tier_exists':
      return 'A tier with that key already exists in this game. Choose another key.'
    case 'too_many_games':
      return 'This server has reached the maximum of 25 games.'
    case 'too_many_tiers':
      return 'This game has reached the maximum of 50 tiers.'
    case 'game_not_found':
      return 'That game no longer exists. It may have been removed in Discord or on the web dashboard. Refresh to see the current list.'
    case 'tier_not_found':
      return 'That tier no longer exists. It may have been removed in Discord or on the web dashboard. Refresh to see the current list.'
    case 'message_not_found':
      return 'The panel message no longer exists in Discord (it was probably deleted).'
    case 'not_a_bot_message':
      return 'That message was not posted by Nexus, so it cannot be refreshed.'
    case 'fia_required':
      return 'Only members with the FIA role, or server administrators, can record race results or change the points system. Your account has the staff role only.'
    case 'ambiguous_name':
      return 'That name matches more than one driver in the results. Choose the driver from the list instead.'
    case 'team_exists':
      return 'A team with that name already exists. Team names must be unique, so choose another name.'
    case 'team_not_found':
      return 'That team no longer exists. It may have been removed in Discord. Refresh to see the current teams.'
    case 'driver_not_found':
      return 'That driver is no longer on this team. Refresh to see the current roster.'
    case 'member_not_found':
      return 'Discord could not find that member in the server. Search again and pick them from the list.'
    case 'bot_missing_manage_roles':
      return 'Nexus is missing the Manage Roles permission in this server, so nothing was created or changed. Give the Nexus role the Manage Roles permission in Discord and try again.'
    case 'bot_missing_manage_channels':
      return 'Nexus is missing the Manage Channels permission in this server, so nothing was created. Give the Nexus role the Manage Channels permission in Discord and try again.'
    case 'bot_cannot_assign_role':
      return "Discord would not let Nexus change that member's roles. Check that the Nexus role is above the team role and above the member's highest role."
    case 'calendar_not_found':
      return 'There is no calendar yet. Add a round to create it.'
    case 'round_not_found':
      return 'That round no longer exists. It may have been removed in Discord. Refresh to see the current calendar.'
    case 'round_exists':
      return 'That round number is already used. Leave the number empty to use the next free one.'
    case 'too_many_rounds':
      return 'The calendar already has the maximum of 25 rounds.'
    case 'bot_unavailable':
    case 'bot_timeout':
      return 'The Nexus bot is not responding right now. Try again in a moment.'
    case 'unauthorized':
    case 'session_ended':
      return 'Your session has ended. Please sign in again.'
    default:
      break
  }

  if (kind === 'rate_limited') {
    return retryAfter ? `Too many requests. Try again in ${retryAfter} seconds.` : 'Too many requests. Please wait a moment and try again.'
  }
  if (kind === 'timeout') return 'The server took too long to respond. Please try again.'
  return message || 'Something went wrong. Please try again.'
}

/**
 * True when a failed request may still have been carried out by the server (the answer was lost):
 * a timeout, or a network failure after the request could have been sent. Never true for a
 * refusal the backend itself explained.
 */
export function mayHaveSucceeded(error: unknown): boolean {
  if (!(error instanceof UiError)) return false
  const { kind, code, mayHaveBeenSent } = error.info
  // bot_timeout: the bot did not answer within 10 s, so the action may still have been carried out.
  // invalid_response: the server answered success-shaped nonsense; the write itself may well have happened.
  return kind === 'timeout' || kind === 'invalid_response' || (kind === 'network' && mayHaveBeenSent !== false) || (kind === 'http' && code === 'bot_timeout')
}

/**
 * Stricter than `mayHaveSucceeded`, for writes where a second attempt does real damage (recording race results
 * adds points every time): besides a lost answer, any server-side failure (5xx) counts as "the outcome is
 * unknown", because the server may have failed after it recorded the race. Only answers that prove nothing
 * was done (4xx refusals, rate limit, bot offline) are definite.
 */
export function outcomeUnknown(error: unknown): boolean {
  if (!(error instanceof UiError)) return false
  if (mayHaveSucceeded(error)) return true
  const { kind, code, status } = error.info
  return kind === 'http' && status !== undefined && status >= 500 && code !== 'bot_unavailable'
}

/** An error that belongs to one form field: the code is looked up in `map` (backend code -> field). */
export function fieldErrorFor<F extends string>(error: unknown, map: Readonly<Record<string, F>>): { field: F; message: string } | null {
  const code = errorCode(error)
  const field = code === null ? undefined : map[code]
  return field === undefined ? null : { field, message: describeError(error) }
}

/** `describeError` plus, for an uncertain write, a plain statement that it may already have happened. */
export function describeWriteError(error: unknown, what: string): string {
  const text = describeError(error)
  return mayHaveSucceeded(error) ? `${text} ${what} may already have happened, so refresh and check before you try again.` : text
}

/** What a screen shows after a failed write: the text, and whether the write may still have happened (then a refresh is offered). */
export interface WriteProblem {
  text: string
  uncertain: boolean
}

export function writeProblem(error: unknown, what: string): WriteProblem {
  return { text: describeWriteError(error, what), uncertain: mayHaveSucceeded(error) }
}
