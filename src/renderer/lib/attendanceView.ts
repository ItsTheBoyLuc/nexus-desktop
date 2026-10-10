import type { AttendanceDriver, DivisionResult } from '../../shared/types'

/** What an overlap means in Discord, said wherever it is shown. */
export const OVERLAP_EXPLANATION =
  'A driver in both lists is marked Present automatically when a post is created, and the Present button in Discord then refuses them, because a reserve driver may only use Reserve. The command has no rule against it and neither does the API, so it is stored as you set it.'

export const LEFT_SERVER_NAME = 'A member who left the server'

/** The name to show for a driver row: the name the server sent, else a plain statement that they left. */
export function driverLabel(driver: Pick<AttendanceDriver, 'name'>): string {
  return driver.name ?? LEFT_SERVER_NAME
}

/**
 * The drivers named in the `overlap` of a division answer, as names: resolved from the two lists the same answer carries,
 * else from names the screen already knows (people picked a moment ago), else as a member who left. Order of the answer.
 */
export function overlapNames(result: Pick<DivisionResult, 'division' | 'overlap'>, known: (userId: string) => string | null = () => null): string[] {
  const names = new Map([...result.division.regularDrivers, ...result.division.reserveDrivers].map((driver) => [driver.userId, driver.name] as [string, string | null]))
  return result.overlap.map((id) => names.get(id) ?? known(id) ?? LEFT_SERVER_NAME)
}

/** The sentence that opens the warning after a save. */
export function describeOverlap(result: Pick<DivisionResult, 'division' | 'overlap'>, known?: (userId: string) => string | null): string {
  const count = result.overlap.length
  const names = overlapNames(result, known).join(', ')
  return `The division ${result.division.name} was saved, but ${count === 1 ? 'one driver is' : `${count} drivers are`} in both the regular and the reserve list: ${names}.`
}
