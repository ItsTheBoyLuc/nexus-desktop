import type { DirtyDriver, DirtyHistory, DirtyRemoveResult, DirtyReport, IpcResult } from '../../shared/types'
import { describeError, errorCode, outcomeUnknown, unwrap } from './errors'

/**
 * The dirty-driver rules that need care, free of React so they can be tested.
 *
 * A report is removed by its NUMBER, and the numbers move up when an earlier report is removed (in the app, in Discord,
 * from a second app window). A second send after a lost answer, or a stale list, could therefore remove the WRONG report.
 * So a removal first reads the driver's history again and only goes ahead when the report at that number is still the one
 * the user confirmed; and a removal is sent once and never repeated.
 */

export type DirtyColumn = 'driver' | 'reports' | 'latest' | 'by' | 'when'

export const DIRTY_GETTERS: Record<DirtyColumn, (driver: DirtyDriver) => string | number | null> = {
  driver: (driver) => driver.displayName,
  reports: (driver) => driver.reportCount,
  latest: (driver) => driver.latest.reason,
  by: (driver) => driver.latest.reportedBy,
  when: (driver) => {
    const time = Date.parse(driver.latest.timestamp)
    return Number.isNaN(time) ? null : time
  }
}

/** Two reports are the same one when everything the user saw matches (the number alone is not enough). */
export function sameDirtyReport(a: DirtyReport, b: DirtyReport): boolean {
  return a.index === b.index && a.reason === b.reason && a.evidence === b.evidence && a.reportedBy === b.reportedBy && a.timestamp === b.timestamp && a.relatedIncident === b.relatedIncident
}

interface RemovalApi {
  dirtyHistory: (guildId: string, driver: string) => Promise<IpcResult<DirtyHistory>>
  removeDirtyReport: (guildId: string, driver: string, index: number) => Promise<IpcResult<DirtyRemoveResult>>
}

export type RemovalRun =
  | { kind: 'removed'; result: DirtyRemoveResult }
  /** The list changed since the user looked (or the report is gone): nothing was removed. */
  | { kind: 'changed' }
  /** The history could not be read to double-check: nothing was removed. */
  | { kind: 'unverified'; message: string }
  /** The answer was lost: the report may be removed. Never sent again. */
  | { kind: 'lost' }
  | { kind: 'refused'; message: string }

export async function runRemoval(api: RemovalApi, guildId: string, driver: string, shown: DirtyReport): Promise<RemovalRun> {
  let fresh: DirtyHistory
  try {
    fresh = await unwrap(api.dirtyHistory(guildId, driver))
  } catch (error) {
    if (errorCode(error) === 'driver_not_found') return { kind: 'changed' }
    return { kind: 'unverified', message: describeError(error) }
  }
  const current = fresh.reports.find((report) => report.index === shown.index)
  if (!current || !sameDirtyReport(current, shown)) return { kind: 'changed' }

  try {
    return { kind: 'removed', result: await unwrap(api.removeDirtyReport(guildId, driver, shown.index)) }
  } catch (error) {
    const code = errorCode(error)
    if (code === 'report_not_found' || code === 'driver_not_found') return { kind: 'changed' }
    if (outcomeUnknown(error)) return { kind: 'lost' }
    return { kind: 'refused', message: describeError(error) }
  }
}

export function describeRemoval(result: DirtyRemoveResult): string {
  return result.driverRemoved
    ? `Report ${result.removedIndex} of ${result.displayName} was removed. It was their last one, so they are no longer on the list.`
    : `Report ${result.removedIndex} of ${result.displayName} was removed. Their later reports moved up by one number.`
}
