import type { Signup, SignupParticipant, SignupQuestions } from '../../shared/types'
import { describeChannelError, describeError, errorCode, isChannelError } from './errors'

/**
 * How sign-ups and their participants are listed, and what the screens say about the answers of the API. Free of React
 * so the rules can be tested. A participant's answers are personal data: nothing here stores or logs them, and every
 * text is returned as it is (the screens render it as plain text).
 */

// ── Sign-up table ───────────────────────────────────────────────────────────

export type SignupColumn = 'title' | 'status' | 'participants' | 'closes' | 'created'

export const SIGNUP_GETTERS: Record<SignupColumn, (signup: Signup) => string | number | null> = {
  title: (signup) => signup.title,
  status: (signup) => (signup.status === 'open' ? 0 : 1),
  participants: (signup) => signup.participantCount,
  closes: (signup) => signup.closeDate, // the close date is free text; a sign-up without one sorts last
  created: (signup) => {
    const time = Date.parse(signup.createdAt)
    return Number.isNaN(time) ? null : time
  }
}

export type SignupFilter = 'all' | 'open' | 'closed'
export const SIGNUP_FILTER_OPTIONS: ReadonlyArray<{ value: SignupFilter; label: string }> = [
  { value: 'all', label: 'Open and closed' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' }
]

export function matchesSignupFilter(signup: Pick<Signup, 'status'>, filter: SignupFilter): boolean {
  return filter === 'all' || signup.status === filter
}

// ── Participant table ───────────────────────────────────────────────────────

export type ParticipantColumn = 'name' | 'platform' | 'platformUsername' | 'signedUp'

/** The name to show: the member's current display name, else their username. */
export function participantName(participant: Pick<SignupParticipant, 'displayName' | 'username'>): string {
  return participant.displayName ?? participant.username
}

export const PARTICIPANT_GETTERS: Record<ParticipantColumn, (participant: SignupParticipant) => string | number | null> = {
  name: participantName,
  platform: (participant) => participant.platformName,
  platformUsername: (participant) => participant.platformUsername,
  signedUp: (participant) => {
    const time = Date.parse(participant.timestamp)
    return Number.isNaN(time) ? null : time
  }
}

/** Everything the search box looks at, answers included: plain text only. */
export function participantSearchFields(participant: SignupParticipant): string[] {
  return [participant.displayName, participant.username, participant.platformName, participant.platform, participant.platformUsername, ...participant.answers.flatMap((item) => [item.question, item.answer])].filter((field): field is string => field !== null)
}

// ── What the API answers ────────────────────────────────────────────────────

/** Why the panel in Discord could not be greyed out although the sign-up is closed (`panel_error` of the close answer). */
export function describePanelError(code: string): string {
  switch (code) {
    case 'panel_channel_unknown':
      return 'the app does not know which channel the panel is in'
    case 'panel_channel_not_found':
      return 'the channel of the panel no longer exists'
    case 'panel_message_not_found':
      return 'the panel message was deleted in Discord'
    case 'bot_cannot_edit_panel':
      return 'Nexus is not allowed to edit the panel message'
    case 'bot_unavailable':
      return 'the bot was offline at that moment'
    case 'bot_timeout':
      return 'Discord did not answer in time'
    case 'discord_error':
      return 'Discord rejected the edit'
    default:
      return `the panel could not be edited (${code.slice(0, 40)})`
  }
}

export interface CreateProblem {
  /** The field the problem belongs to, when it belongs to one. */
  field: 'channelId' | 'confirmationChannelId' | null
  text: string
}

/**
 * The refusals of "create a sign-up". All of them are answered BEFORE anything is posted, and each one names what has to be
 * fixed. (A lost answer is not one of them: see `outcomeUnknown` in lib/errors.ts.)
 */
export function describeSignupCreateError(error: unknown, names: { channel: string; confirmation: string }): CreateProblem | null {
  const code = errorCode(error)
  const confirmation = names.confirmation === '' ? 'the default confirmation channel (signup-confirmations)' : `#${names.confirmation}`
  switch (code) {
    case 'bot_cannot_post_confirmations':
      return {
        field: 'confirmationChannelId',
        text: `Nexus cannot post in ${confirmation}: it needs View Channel, Send Messages and Embed Links there. Fix the bot's permissions in Discord or pick another confirmation channel. Nothing was posted.`
      }
    case 'bot_missing_manage_channels':
      return {
        field: 'confirmationChannelId',
        text: 'There is no signup-confirmations channel yet, and Nexus needs the Manage Channels permission to create it when the first driver signs up. Give the Nexus role Manage Channels in Discord, or create a channel yourself and pick it as the confirmation channel. Nothing was posted.'
      }
    case 'confirmation_channel_ambiguous':
      return {
        field: 'confirmationChannelId',
        text: `Sign-ups find their confirmation channel by name (ignoring emoji and capitals), and ${confirmation} also matches another channel, so confirmations could end up in the wrong one. Rename one of the channels so the names differ, or pick another channel. Nothing was posted.`
      }
    case 'confirmation_channel_not_found':
      return { field: 'confirmationChannelId', text: 'The confirmation channel no longer exists in Discord. Pick another one, or leave it on the default. Nothing was posted.' }
    case 'invalid_confirmation_channel':
      return { field: 'confirmationChannelId', text: 'That confirmation channel is not valid. Pick one from the list, or leave it on the default. Nothing was posted.' }
    default:
      return isChannelError(error) ? { field: 'channelId', text: describeChannelError(error, names.channel, 'Nothing was posted.') } : null
  }
}

/** Errors of closing a sign-up or removing a participant that need their own words. */
export function describeSignupWriteError(error: unknown): string {
  switch (errorCode(error)) {
    case 'already_closed':
      return 'This sign-up was already closed, possibly in Discord. Nothing was changed.'
    case 'signup_not_found':
      return 'This sign-up no longer exists. It may have been removed in Discord. Go back to the list.'
    case 'participant_not_found':
      return 'That person is not signed up any more (maybe removed in Discord a moment ago). Nothing was changed.'
    default:
      return describeError(error)
  }
}

// ── The questions editor ────────────────────────────────────────────────────

/** Move a row one place up or down; moves outside the list leave it as it is. */
export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) return [...rows]
  const next = [...rows]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}

/** True when the editor's rows differ from the questions the server holds (compared as trimmed text, in order). */
export function questionsChanged(rows: readonly string[], saved: readonly string[]): boolean {
  const current = rows.map((row) => row.trim())
  return current.length !== saved.length || current.some((row, index) => row !== saved[index])
}

/** What "reset to defaults" puts in the form: no custom questions, because an empty list is how the server restores its defaults. */
export function resetRows(): string[] {
  return []
}

/** The limits the form applies: the server's own, from GET. */
export function questionLimits(questions: Pick<SignupQuestions, 'maxQuestions' | 'maxQuestionLength'>): { max: number; length: number } {
  return { max: questions.maxQuestions, length: questions.maxQuestionLength }
}
