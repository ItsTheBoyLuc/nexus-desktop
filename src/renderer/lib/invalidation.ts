import { invalidate } from './cache'

/**
 * After a successful write, forget what we knew and let every mounted screen read the truth from
 * the server again. Nothing is patched locally: what the screens show is always what the API says.
 */

/** Games, tiers and panels changed: the game list, the league games and the overview counts. */
export function invalidateLeagueData(guildId: string): void {
  invalidate(`games:${guildId}`)
  invalidate(`league-games:${guildId}`)
  invalidate(`overview:${guildId}`)
}

/** Server settings changed (colour, footer, season). */
export function invalidateServerSettings(guildId: string): void {
  invalidate(`server-settings:${guildId}`)
  invalidate(`overview:${guildId}`)
}

/** Calendar rounds changed (or the calendar was posted): the calendar, the next race and the overview counts. */
export function invalidateCalendar(guildId: string): void {
  invalidate(`f1-calendar:${guildId}`)
  invalidate(`f1-next-race:${guildId}`)
  invalidate(`overview:${guildId}`)
}

/** Teams or drivers changed: the teams, the standings (driver and team rows) and the overview counts. */
export function invalidateTeams(guildId: string): void {
  invalidate(`f1-teams:${guildId}`)
  invalidate(`f1-standings:${guildId}`)
  invalidate(`overview:${guildId}`)
}

/** Results were recorded: the standings and the teams (their points are the sum of their drivers'). */
export function invalidateStandings(guildId: string): void {
  invalidate(`f1-standings:${guildId}`)
  invalidate(`f1-teams:${guildId}`)
}

/** The points system changed. */
export function invalidatePointsSystem(guildId: string): void {
  invalidate(`f1-points:${guildId}`)
  invalidate(`overview:${guildId}`)
}
