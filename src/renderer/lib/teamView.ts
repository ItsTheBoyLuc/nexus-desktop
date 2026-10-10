import { isTeamPathName } from '../../shared/f1Validation'
import type { RemoveDriverResult, Team, TeamDriver } from '../../shared/types'

/** Pure helpers of the teams screen, kept free of React so they can be tested. */

export type TeamColumn = 'name' | 'abbreviation' | 'drivers' | 'points'
export type DriverColumn = 'number' | 'driver' | 'points' | 'wins' | 'podiums'

export const TEAM_GETTERS: Record<TeamColumn, (team: Team) => string | number | null> = {
  name: (team) => team.name,
  abbreviation: (team) => team.abbreviation,
  drivers: (team) => team.drivers.length,
  points: (team) => team.points
}

export const DRIVER_GETTERS: Record<DriverColumn, (driver: TeamDriver) => string | number | null> = {
  number: (driver) => driver.number, // a driver without a number always sorts last
  driver: (driver) => driver.displayName,
  points: (driver) => driver.points,
  wins: (driver) => driver.wins,
  podiums: (driver) => driver.podiums
}

/** Team names are matched case-insensitively, like the API does. */
export function findTeam(teams: readonly Team[], name: string | null): Team | undefined {
  if (name === null) return undefined
  const wanted = name.toLowerCase()
  return teams.find((team) => team.name.toLowerCase() === wanted)
}

/**
 * A team created in Discord with `/` or `\` in its name is listed but cannot be addressed by name in the API,
 * so adding or removing its drivers is not possible from the app.
 */
export function canManageTeam(team: Pick<Team, 'name'>): boolean {
  return isTeamPathName(team.name)
}

/** What the API reported about a removal, in plain words (the driver may have left the server). */
export function describeRemoval(driverName: string, teamName: string, result: Pick<RemoveDriverResult, 'roleRemoved' | 'memberInServer'>): string {
  if (!result.memberInServer) return `${driverName} has left the server, so no role could be taken away. They are no longer on the roster of ${teamName}; their points remain.`
  if (!result.roleRemoved) return `${driverName} is no longer on the roster of ${teamName}, but the team role could not be removed. Check their roles in Discord. Their points remain.`
  return `${driverName} was removed from ${teamName} and lost the team role. Their points remain.`
}
