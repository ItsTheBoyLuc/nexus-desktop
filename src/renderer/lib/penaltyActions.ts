import type { AdvanceRaceResult, BanResult, ClearPointsResult, IpcResult, PenaltyRow } from '../../shared/types'
import type { AdvanceValue, BanValue, ClearValue } from '../../shared/penaltyValidation'
import { describeError, errorCode, outcomeUnknown, unwrap } from './errors'

/**
 * The rules of the penalty actions (clear points, bans, advance race, and the settings), free of React so they can be
 * tested. Every one of them is a write that is sent ONCE:
 *
 *  - a lost answer or a 5xx means "this may already have happened": no second send, the only way forward is to read the
 *    penalty overview again;
 *  - 403 fia_required / admin_required mean the role is missing: the action is switched off, the data stays readable;
 *  - 409 penalty_not_configured and 404 driver_not_found prove nothing was changed;
 *  - the destructive three go out with `confirm: true`, added by `confirmed()` only after the confirm dialog.
 */

/** The request of a destructive action: the validated form values plus the literal confirm the server requires. */
export function confirmed<T extends ClearValue | BanValue | AdvanceValue>(value: T): T & { confirm: true } {
  return { ...value, confirm: true }
}

export type ActionRun<T> =
  | { kind: 'done'; value: T }
  /** 403 fia_required (`fia`) or admin_required (`admin`): the role is missing. */
  | { kind: 'denied'; role: 'fia' | 'admin' }
  /** 409 / 404 penalty_not_configured: nothing was changed; the penalty rules have to be saved first. */
  | { kind: 'not_configured' }
  /** 404 driver_not_found: the driver has no penalty record in that season. Nothing was changed. */
  | { kind: 'not_found'; message: string }
  /** The outcome is unknown: it may have happened. */
  | { kind: 'lost' }
  | { kind: 'field'; field: string; message: string }
  /** Anything else that proves nothing changed. */
  | { kind: 'refused'; message: string }

export const ACTION_FIELD_CODES: Readonly<Record<string, string>> = {
  invalid_driver: 'driver',
  invalid_reason: 'reason',
  invalid_points: 'points',
  invalid_season: 'season',
  invalid_action: 'action',
  invalid_ban_type: 'banType',
  invalid_race_number: 'raceNumber',
  invalid_current_season: 'currentSeason',
  invalid_expiry_races: 'expiryRaces',
  invalid_quali_ban_threshold: 'qualiBanThreshold',
  invalid_race_ban_threshold: 'raceBanThreshold'
}

/** Sends one write and sorts the answer. Never throws, never sends twice. */
export async function runAction<T>(call: () => Promise<IpcResult<T>>): Promise<ActionRun<T>> {
  try {
    return { kind: 'done', value: await unwrap(call()) }
  } catch (error) {
    const code = errorCode(error)
    if (code === 'fia_required') return { kind: 'denied', role: 'fia' }
    if (code === 'admin_required') return { kind: 'denied', role: 'admin' }
    if (code === 'penalty_not_configured') return { kind: 'not_configured' }
    if (code === 'driver_not_found') return { kind: 'not_found', message: describeError(error) }
    if (outcomeUnknown(error)) return { kind: 'lost' }
    const field = code === null ? undefined : ACTION_FIELD_CODES[code]
    if (field) return { kind: 'field', field, message: describeError(error) }
    if (code === 'confirm_required') return { kind: 'refused', message: 'The server wanted a confirmation that the app did not send. Nothing was changed; please report this.' }
    return { kind: 'refused', message: describeError(error) }
  }
}

// ── What the confirm dialogs say ────────────────────────────────────────────

const pointsWord = (count: number): string => `${count} ${count === 1 ? 'point' : 'points'}`

export function seasonText(season: number | undefined, current: number): string {
  return season === undefined ? `season ${current} (the current season)` : `season ${season}`
}

export function describeClearEffect(input: ClearValue, driverName: string, currentSeason: number, currentTotal: number | null): string[] {
  const where = seasonText(input.season, currentSeason)
  const lines =
    input.points === undefined
      ? [
          `All of ${driverName}'s penalty points${currentTotal !== null ? ` (${pointsWord(currentTotal)})` : ''} and their whole penalty history in ${where} are removed, and both bans are lifted.`,
          'Other seasons are not touched.'
        ]
      : [
          `${pointsWord(input.points)} are taken off ${driverName}'s total in ${where} (it never goes below 0).`,
          `Their history is kept, with an "Admin removed ${input.points} pts" entry, and the bans are recalculated against the penalty settings: a ban may be lifted, none is given.`
        ]
  lines.push('Nothing is posted in Discord.')
  return lines
}

export function describeBanEffect(input: BanValue, driverName: string, currentSeason: number): string[] {
  const where = seasonText(input.season, currentSeason)
  const type = input.banType === 'quali' ? 'qualifying ban' : 'race ban'
  const lines =
    input.action === 'give'
      ? [`${driverName} gets a ${type} in ${where}. If they have no penalty record in that season, an empty one is created.`]
      : [`The ${type} of ${driverName} in ${where} is lifted.`]
  lines.push('Their penalty points are not changed.')
  lines.push('Nothing is posted in Discord. The reason is only kept in the activity log, not with the driver.')
  return lines
}

export function describeAdvanceEffect(raceNumber: number, currentSeason: number): string[] {
  return [
    `Every penalty point whose expiry is at or before race ${raceNumber} is removed PERMANENTLY, for every driver of the current season (season ${currentSeason}).`,
    'The totals go down and the ban flags are recalculated. Points an admin removed never expire.',
    'The expired points cannot be brought back from the app. Nothing is posted in Discord.'
  ]
}

export function describeClearResult(result: ClearPointsResult): string {
  return result.mode === 'all'
    ? `All points of ${result.driver} in season ${result.season} were cleared (${pointsWord(result.pointsRemoved)} removed).`
    : `${pointsWord(result.pointsRemoved)} removed from ${result.driver} in season ${result.season}; ${pointsWord(result.remaining)} remain.`
}

export function describeBanResult(result: BanResult): string {
  const type = result.banType === 'quali' ? 'qualifying ban' : 'race ban'
  const now = result.banType === 'quali' ? result.qualiBanned : result.raceBanned
  return `${result.driver} ${now ? 'now has' : 'no longer has'} a ${type} in season ${result.season} (${pointsWord(result.totalPoints)}).`
}

export function describeAdvanceResult(result: AdvanceRaceResult): string {
  const removed = result.expired.reduce((sum, item) => sum + item.points, 0)
  return `Race ${result.raceNumber}, season ${result.season}: ${result.expired.length} expired ${result.expired.length === 1 ? 'entry' : 'entries'} removed (${pointsWord(removed)}), ${result.updated.length} ${result.updated.length === 1 ? 'driver' : 'drivers'} changed.`
}

// ── Overview table ──────────────────────────────────────────────────────────

export type PenaltyColumn = 'position' | 'driver' | 'points' | 'incidents' | 'ban' | 'reported'

const BAN_ORDER: Record<PenaltyRow['ban'], number> = { race: 2, quali: 1, none: 0 }

export const PENALTY_GETTERS: Record<PenaltyColumn, (row: PenaltyRow) => string | number | null> = {
  position: (row) => row.position,
  driver: (row) => row.displayName,
  points: (row) => row.totalPoints,
  incidents: (row) => row.incidents,
  ban: (row) => BAN_ORDER[row.ban],
  reported: (row) => row.reportedCount
}

export type PenaltyFilter = 'all' | 'banned' | 'race' | 'quali' | 'none' | 'reported'

export const PENALTY_FILTER_OPTIONS: ReadonlyArray<{ value: PenaltyFilter; label: string }> = [
  { value: 'all', label: 'Everyone' },
  { value: 'banned', label: 'With any ban' },
  { value: 'race', label: 'Race ban' },
  { value: 'quali', label: 'Qualifying ban' },
  { value: 'none', label: 'No ban' },
  { value: 'reported', label: 'Reported (dirty drivers)' }
]

export function matchesPenaltyFilter(row: PenaltyRow, filter: PenaltyFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'banned':
      return row.ban !== 'none'
    case 'reported':
      return row.reportedCount > 0
    default:
      return row.ban === filter
  }
}

export function banLabel(row: Pick<PenaltyRow, 'ban' | 'qualiBanned' | 'raceBanned'>): string {
  if (row.raceBanned && row.qualiBanned) return 'Race and qualifying ban'
  if (row.raceBanned) return 'Race ban'
  if (row.qualiBanned) return 'Qualifying ban'
  return 'No ban'
}
