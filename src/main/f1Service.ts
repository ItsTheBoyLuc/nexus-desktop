import type { CalendarPostInput, CalendarPostResult, RaceOutcome, ResultsInput } from '../shared/types'
import { ApiError } from './apiClient'
import type { NexusApi } from './nexusApi'
import type { SettingsStore } from './settings'

/**
 * The glue between the F1 API and what the app remembers in the settings file. Like the panel service, it
 * only ever changes that file after the API has confirmed the outcome:
 *
 *  - a successful calendar post / edit remembers the message id of the server,
 *  - a calendar message that is gone (deleted, not ours) is forgotten, so "Update posted calendar" is no
 *    longer offered and the UI falls back to "Post new",
 *  - a recorded race is added to the ledger only when the API answered success,
 *  - a timeout, a lost answer or any refusal writes nothing.
 *
 * Nothing here retries: every call goes out exactly once (the API client does not replay a write after an
 * ambiguous failure either), so a lost answer can never record a race twice by itself.
 */
type CalendarStore = Pick<SettingsStore, 'rememberCalendarPost' | 'forgetCalendarPost'>
type LedgerStore = Pick<SettingsStore, 'recordRace'>
type CalendarApi = Pick<NexusApi, 'postCalendar'>
type ResultsApi = Pick<NexusApi, 'recordResults'>

/** Backend codes that prove a remembered calendar message can no longer be edited. */
const CALENDAR_MESSAGE_GONE_CODES = new Set(['message_not_found', 'not_a_bot_message', 'channel_not_found'])

export async function postCalendarAndRemember(api: CalendarApi, store: CalendarStore, guildId: string, input: CalendarPostInput): Promise<CalendarPostResult> {
  try {
    const result = await api.postCalendar(guildId, input)
    store.rememberCalendarPost(guildId, { messageId: result.messageId, channelId: result.channelId })
    return result
  } catch (error) {
    if (input.messageId !== undefined && error instanceof ApiError && error.kind === 'http' && CALENDAR_MESSAGE_GONE_CODES.has(error.code)) {
      store.forgetCalendarPost(guildId)
    }
    throw error
  }
}

export async function recordResultsAndLog(api: ResultsApi, store: LedgerStore, guildId: string, input: ResultsInput, now: () => Date = () => new Date()): Promise<RaceOutcome> {
  const outcome = await api.recordResults(guildId, input) // throws on every failure: the ledger stays untouched
  store.recordRace({ guildId, season: input.season, round: input.round, circuit: input.circuit, recordedAt: now().toISOString() })
  return outcome
}
