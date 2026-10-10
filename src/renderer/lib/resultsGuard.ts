import { findLedgerEntries } from '../../shared/f1Store'
import type { IpcResult, LedgerEntry, RaceOutcome, ResultsInput, ServerLedgerEntry } from '../../shared/types'
import { errorCode, outcomeUnknown, unwrap } from './errors'

/**
 * The duplicate guard of "Enter race results", now kept by the SERVER (docs/APP_API.md, results ledger):
 *
 *  1. Before saving, the form reads GET standings/results-ledger. If the same season and round is on it, the
 *     warning dialog opens first ("recording again adds the points a second time", Cancel is the default focus).
 *  2. The POST goes out WITHOUT `confirm_duplicate`. If the server answers 409 results_already_recorded (somebody
 *     recorded the race between the read and the write, or the read said nothing), the same warning opens.
 *  3. Only after the user confirmed the warning is the request sent again, with `confirm_duplicate: true`.
 *  4. The app's own local ledger is a FALLBACK for when the ledger endpoint cannot be read.
 *  5. A lost answer or a 5xx is never retried: the race may be recorded already, so the only way forward is to
 *     refresh the standings.
 *
 * Races recorded through Discord commands are in neither ledger; the screen says so permanently.
 */

/** What the dialog shows about an earlier recording, whichever ledger it came from. */
export interface EarlierRace {
  season: string
  round: string
  circuit: string
  /** Who recorded it: known for the server's ledger only. */
  recordedBy: string | null
  at: string
}

export type LedgerRead = { ok: true; entries: readonly ServerLedgerEntry[] } | { ok: false }

export interface DuplicatePlan {
  /** The same season and round was recorded before: the warning dialog is shown. */
  repeat: boolean
  /** Which record the answer is based on. `local` means the server's ledger could not be read. */
  source: 'server' | 'local'
  earlier: EarlierRace[]
}

/** The server compares season and round as trimmed, case-insensitive text. */
export function sameRaceText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function planDuplicate(read: LedgerRead, local: readonly LedgerEntry[], guildId: string, season: string, round: string): DuplicatePlan {
  if (read.ok) {
    const earlier = read.entries
      .filter((entry) => sameRaceText(entry.season, season) && sameRaceText(entry.round, round))
      .map((entry): EarlierRace => ({ season: entry.season, round: entry.round, circuit: entry.circuit, recordedBy: entry.recordedBy || null, at: entry.timestamp }))
    return { repeat: earlier.length > 0, source: 'server', earlier }
  }
  const earlier = findLedgerEntries(local, guildId, season, round).map((entry): EarlierRace => ({ season: entry.season, round: entry.round, circuit: entry.circuit, recordedBy: null, at: entry.recordedAt }))
  return { repeat: earlier.length > 0, source: 'local', earlier }
}

/** After a 409: the server says it is a repeat even if the earlier entry cannot be listed (yet). */
export function planAfterConflict(read: LedgerRead, local: readonly LedgerEntry[], guildId: string, season: string, round: string): DuplicatePlan {
  return { ...planDuplicate(read, local, guildId, season, round), repeat: true }
}

/** The request body for the next send: `confirmDuplicate` is present only once the user confirmed the warning. */
export function buildResultsRequest(input: ResultsInput, confirmedDuplicate: boolean): ResultsInput {
  const request: ResultsInput = { ...input }
  delete request.confirmDuplicate // whatever the caller had: only the user's confirmation may set it
  if (confirmedDuplicate) request.confirmDuplicate = true
  return request
}

interface GuardApi {
  resultsLedger: (guildId: string, query?: { season?: string; round?: string }) => Promise<IpcResult<ServerLedgerEntry[]>>
  recordResults: (guildId: string, input: ResultsInput) => Promise<IpcResult<RaceOutcome>>
}

/** Reads the server's ledger for this season and round. Never throws: a failed read just means "use the local fallback". */
export async function readLedger(api: Pick<GuardApi, 'resultsLedger'>, guildId: string, season: string, round: string): Promise<LedgerRead> {
  try {
    return { ok: true, entries: await unwrap(api.resultsLedger(guildId, { season: season.trim(), round: round.trim() })) }
  } catch {
    return { ok: false }
  }
}

export type SendOutcome =
  | { kind: 'recorded'; outcome: RaceOutcome }
  /** 409 results_already_recorded: nothing was recorded; ask the user. */
  | { kind: 'duplicate' }
  /** The answer was lost, or the server failed (5xx): the race MAY be recorded. Never sent again. */
  | { kind: 'lost'; error: unknown }
  /** A refusal that proves nothing was recorded (validation, fia_required, channel problems ...). */
  | { kind: 'refused'; error: unknown }

/**
 * Sends the race exactly once. There is no retry loop anywhere: not after a timeout, not after a 5xx, not after
 * a network error. `confirmedDuplicate` must only be true after the user pressed the warning dialog's confirm button.
 */
export async function sendResults(api: Pick<GuardApi, 'recordResults'>, guildId: string, input: ResultsInput, confirmedDuplicate: boolean): Promise<SendOutcome> {
  try {
    return { kind: 'recorded', outcome: await unwrap(api.recordResults(guildId, buildResultsRequest(input, confirmedDuplicate))) }
  } catch (error) {
    if (errorCode(error) === 'results_already_recorded') return { kind: 'duplicate' }
    if (outcomeUnknown(error)) return { kind: 'lost', error }
    return { kind: 'refused', error }
  }
}

/** What the saved-results screen says about the outcome beyond the table: the channel post and the server ledger. */
export interface OutcomeNotes {
  posted: boolean
  /** The points are recorded, but the channel post failed (code). */
  announceError: string | null
  /** The points were applied but the server's ledger could not be written: the duplicate guard will not know this race. */
  ledgerMissing: boolean
}

export function outcomeNotes(outcome: RaceOutcome): OutcomeNotes {
  return { posted: outcome.posted !== null, announceError: outcome.announceError, ledgerMissing: outcome.ledger !== null && !outcome.ledger.recorded }
}
