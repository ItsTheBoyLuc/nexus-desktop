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

/** Friendly, actionable text for an error. Never includes raw server details beyond the backend's own message. */
export function describeError(error: unknown): string {
  if (!(error instanceof UiError)) return 'Something went wrong. Please try again.'
  const { code, kind, message, retryAfter } = error.info

  switch (code) {
    case 'forbidden':
      return 'You no longer have the FIA, STAFF or Administrator role in this server.'
    case 'guild_not_found':
      return 'Nexus is no longer in this server.'
    case 'channel_not_found':
      return 'That channel no longer exists. Refresh and pick another one.'
    case 'bot_cannot_send':
      return "Nexus can't post in that channel. Check the bot's permissions there."
    case 'discord_error':
      return 'Discord rejected the message. Check the content and try again.'
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

/** True when a failed request may still have reached the server (a POST might have gone through). */
export function mayHaveSucceeded(error: unknown): boolean {
  return error instanceof UiError && (error.info.kind === 'timeout' || error.info.kind === 'network')
}
