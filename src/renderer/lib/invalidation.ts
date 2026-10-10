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

/**
 * Reports changed (a decision was made): the list, the report itself, the round overview and the overview counts.
 * Every report key starts with `f1-reports:<guild>`, so one prefix covers all of them.
 */
export function invalidateReports(guildId: string): void {
  invalidate(`f1-reports:${guildId}`)
  invalidate(`overview:${guildId}`)
}

/** Penalty points, bans or the penalty settings changed (also: a decision that awarded points, the overview checklist). */
export function invalidatePenalties(guildId: string): void {
  invalidate(`f1-penalty:${guildId}`)
  invalidate(`overview:${guildId}`)
}

/** Dirty-driver reports changed: the list, the histories and the "Reported (N)" flag of the penalty overview. */
export function invalidateDirty(guildId: string): void {
  invalidate(`f1-dirty:${guildId}`)
  invalidate(`f1-penalty:${guildId}:overview`)
}

/** Attendance divisions or posts changed: every attendance key starts with `f1-attendance:<guild>`. */
export function invalidateAttendance(guildId: string): void {
  invalidate(`f1-attendance:${guildId}`)
}

/** Sign-ups changed (created, closed, a participant removed): the list, the participants and the open sign-ups count of the overview. */
export function invalidateSignups(guildId: string): void {
  invalidate(`league-signups:${guildId}`)
  invalidate(`overview:${guildId}`)
}

/** The sign-up questions changed. */
export function invalidateSignupQuestions(guildId: string): void {
  invalidate(`signup-questions:${guildId}`)
}
