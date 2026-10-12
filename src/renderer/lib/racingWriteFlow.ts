import { errorCode, isChannelError, outcomeUnknown } from './errors'

/** Backend codes (M6) that mean "the roles to ping cannot be used"; the server checks them before it posts anything. */
export const PING_ERROR_CODES = ['invalid_ping_roles', 'too_many_ping_roles', 'role_not_found', 'role_not_pingable', 'bot_cannot_mention_role'] as const

export function isPingError(error: unknown): boolean {
  const code = errorCode(error)
  return code !== null && (PING_ERROR_CODES as readonly string[]).includes(code)
}

/**
 * What the esports screens do after a write (log a result, create an attendance post, post an announcement), free of React so the
 * rules can be tested. All three writes are append-only in effect: a result can never be deleted, and a message that was posted in
 * Discord cannot be taken back by the app. So the rule is the same for all of them:
 *
 *  - the write is sent once; it is never replayed, not even after a timeout,
 *  - when the answer was lost (a timeout, a dropped connection, a 5xx) the outcome is UNKNOWN: the form is locked and the only way
 *    forward is to look first (refresh the list, or check the channel in Discord), never to send the same data again,
 *  - a refusal that proves nothing was done is explained next to the field or in a notice, and the user may correct and send again.
 */
export type RacingWrite = 'result' | 'attendance' | 'announcement' | 'team' | 'event' | 'card'

export type WriteVerdict =
  /** The server may have carried the write out. Lock the form, refresh, never offer a retry. */
  | { type: 'lost' }
  /** 403 for a missing permission: disable the action, keep the data readable, explain the rule. */
  | { type: 'denied'; rule: 'manage' | 'manager' }
  /** The chosen channel cannot be used; nothing was posted. */
  | { type: 'channel' }
  /** One of the roles to ping cannot be used; nothing was posted. The roles are kept so the user can fix them. */
  | { type: 'ping' }
  /** Any other refusal: the server did nothing, the user may correct the data. */
  | { type: 'rejected' }

/** The permission code each write is refused with. */
const DENIED_CODE: Record<RacingWrite, { code: string; rule: 'manage' | 'manager' }> = {
  result: { code: 'manage_server_required', rule: 'manage' },
  team: { code: 'manage_server_required', rule: 'manage' },
  event: { code: 'manage_server_required', rule: 'manage' },
  card: { code: 'manage_server_required', rule: 'manage' },
  attendance: { code: 'manager_required', rule: 'manager' },
  announcement: { code: 'manager_required', rule: 'manager' }
}

/**
 * Writes that always have a channel to refuse. A create (team, event, result) only has one when a card was asked for with it: then the
 * caller passes `posting = true` and a channel or role refusal is explained as such (nothing was created or posted); without a card
 * `forbidden` still means "no longer staff".
 */
const ALWAYS_POSTS: Record<RacingWrite, boolean> = { attendance: true, announcement: true, card: true, result: false, team: false, event: false }

export function judgeWrite(error: unknown, write: RacingWrite, posting: boolean = ALWAYS_POSTS[write]): WriteVerdict {
  if (outcomeUnknown(error)) return { type: 'lost' }
  const denied = DENIED_CODE[write]
  if (errorCode(error) === denied.code) return { type: 'denied', rule: denied.rule }
  // Only a write that posts to a channel has a channel to refuse; for a create without a card `forbidden` means "no longer staff".
  if (posting && isChannelError(error)) return { type: 'channel' }
  if (posting && isPingError(error)) return { type: 'ping' }
  return { type: 'rejected' }
}

export type WritePhase = 'editing' | 'confirming' | 'saving' | 'lost' | 'done'
export type WriteAction = 'edit' | 'review' | 'send' | 'back' | 'refresh' | 'close' | 'start-over'

/**
 * What the user can do in each phase. The important line: in `lost` there is no `send`, no `edit` and no `review`: only `refresh`
 * (look at what the server holds) and `close`. In `saving` nothing can be done, so a second send is impossible.
 */
export function availableActions(phase: WritePhase): WriteAction[] {
  switch (phase) {
    case 'editing':
      return ['edit', 'review', 'close']
    case 'confirming':
      return ['back', 'send']
    case 'saving':
      return []
    case 'lost':
      return ['refresh', 'close']
    case 'done':
      return ['start-over', 'close']
  }
}

/** The phase after an answer: success finishes, a lost answer locks, a refusal goes back to editing. */
export function phaseAfter(verdict: WriteVerdict | 'ok'): WritePhase {
  if (verdict === 'ok') return 'done'
  return verdict.type === 'lost' ? 'lost' : 'editing'
}
