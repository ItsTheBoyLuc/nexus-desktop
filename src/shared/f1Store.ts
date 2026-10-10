import { isStoredPanel } from './panels'
import type { LedgerEntry, StoredPanel } from './types'
import { codePointLength, isValidSnowflake } from './validation'

/**
 * What the app remembers locally about the F1 league, in userData/settings.json:
 *
 *  - the calendar message it posted, per server (the API does not store message ids),
 *  - a ledger of races it recorded successfully. Since milestone 3 the SERVER keeps the duplicate guard
 *    (its results ledger and confirm_duplicate); this local ledger is only the FALLBACK used when the
 *    server's ledger cannot be read. Neither ledger knows about races recorded through Discord commands,
 *    and this one also does not know about races recorded on another device.
 *
 * Only the main process writes either of them, and only after the API confirmed the outcome.
 */

export const MAX_CALENDAR_POSTS = 200
export const MAX_LEDGER_ENTRIES = 1000
export const LEDGER_LIMITS = { seasonMax: 20, roundMax: 10, circuitMax: 60 } as const

/** The file is user-editable, so only well-formed entries (one per server) are kept. */
export function sanitizeCalendarPosts(input: unknown): Record<string, StoredPanel> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
  const clean: Record<string, StoredPanel> = {}
  for (const [guildId, value] of Object.entries(input)) {
    if (Object.keys(clean).length >= MAX_CALENDAR_POSTS) break
    if (isValidSnowflake(guildId) && isStoredPanel(value)) clean[guildId] = { messageId: value.messageId, channelId: value.channelId }
  }
  return clean
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

function isShortText(value: unknown, max: number): value is string {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' && value.trim() !== '' && codePointLength(value) <= max && !/[\u0000-\u001f\u007f]/.test(value)
}

export function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    isValidSnowflake(entry['guildId']) &&
    isShortText(entry['season'], LEDGER_LIMITS.seasonMax) &&
    isShortText(entry['round'], LEDGER_LIMITS.roundMax) &&
    isShortText(entry['circuit'], LEDGER_LIMITS.circuitMax) &&
    isIsoTime(entry['recordedAt'])
  )
}

/** Keep only well-formed entries, oldest first, at most MAX_LEDGER_ENTRIES (the newest survive). */
export function sanitizeLedger(input: unknown): LedgerEntry[] {
  if (!Array.isArray(input)) return []
  const clean = input.filter(isLedgerEntry).map((entry) => ({ guildId: entry.guildId, season: entry.season, round: entry.round, circuit: entry.circuit, recordedAt: entry.recordedAt }))
  return clean.slice(-MAX_LEDGER_ENTRIES)
}

/**
 * "Season 5" and " season  5 " are the same text; "03" and "3" are the same number. Season and round
 * are free text in the API, so this is the only comparison that can tell a repeat from a new race.
 */
export function normaliseRaceText(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ').toLowerCase()
  return /^\d+$/.test(text) ? String(Number(text)) : text
}

/** Every earlier recording of the same server + season + round, oldest first. */
export function findLedgerEntries(ledger: readonly LedgerEntry[], guildId: string, season: string, round: string): LedgerEntry[] {
  const wantedSeason = normaliseRaceText(season)
  const wantedRound = normaliseRaceText(round)
  return ledger.filter((entry) => entry.guildId === guildId && normaliseRaceText(entry.season) === wantedSeason && normaliseRaceText(entry.round) === wantedRound)
}

/** The ledger with one more entry at the end, capped at MAX_LEDGER_ENTRIES. Returns the input untouched when the entry is invalid. */
export function appendLedgerEntry(ledger: readonly LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
  if (!isLedgerEntry(entry)) return [...ledger]
  return [...ledger, { guildId: entry.guildId, season: entry.season.trim(), round: entry.round.trim(), circuit: entry.circuit.trim(), recordedAt: entry.recordedAt }].slice(-MAX_LEDGER_ENTRIES)
}
