import { longDate, parseEventDate } from '../../shared/racingValidation'
import type { RacingEvent, RacingTeam, RosterEntry } from '../../shared/types'
import { RACING_ROLES } from '../../shared/types'
import { describeError, errorCode } from './errors'

/**
 * How esports teams and rosters are listed, and what the screens say about the answers of the API. Free of React so the rules can
 * be tested. Every text of a team or member (names, classes, notes) is untrusted: nothing here builds HTML.
 */

// ── Words for the answers ───────────────────────────────────────────────────

export const MANAGE_SERVER_RULE =
  'Creating teams, changing rosters, adding events and logging results need the Manage Server permission, or Administrator, in Discord. Your account is staff of this server, so you can read everything here, but not do this.'

export const MANAGER_RULE = 'Creating an attendance post or an announcement needs Manage Server, Administrator, or being a Manager or Coach of one of THIS game\'s teams.'

/** The wording for every refusal of the esports endpoints; anything else falls back to the generic texts. */
export function describeRacingError(error: unknown, gameLabel: string): string {
  switch (errorCode(error)) {
    case 'manage_server_required':
      return MANAGE_SERVER_RULE
    case 'manager_required':
      return MANAGER_RULE
    case 'bot_missing_manage_roles':
      return 'Nexus is missing the Manage Roles permission in this server, so nothing was created or changed. Give the Nexus role the Manage Roles permission in Discord and try again.'
    case 'role_not_assignable':
      return "The team's Discord role is above Nexus's highest role, so Nexus cannot hand it out. Move the Nexus role above the team role in Discord. Nothing was changed."
    case 'bot_cannot_assign_role':
      return "Discord would not let Nexus change that member's roles. The Nexus role has to be above both the team role and the member's highest role. Nothing was changed."
    case 'team_exists':
      return `A ${gameLabel} team with that name already exists. Team names are compared ignoring capitals, so choose another name. Nothing was created.`
    case 'team_not_found':
      return 'That team no longer exists. Refresh the list to see the current teams.'
    case 'team_role_not_found':
      return "The team's Discord role no longer exists, and a team cannot be repaired from the app (it has no edit). Nothing was changed."
    case 'member_not_found':
      return 'Discord could not find that member in the server. Search again and pick them from the list. Nothing was changed.'
    case 'already_on_roster':
      return 'That member is already on this roster. Refresh to see it. Nothing was changed.'
    case 'not_on_roster':
      return 'That member is not on this roster (any more). It may have been removed in Discord. Refresh to see the current roster.'
    case 'driver_not_found':
      return `That member is not in the server and is on no ${gameLabel} team.`
    case 'unknown_game':
      return 'That game has no esports team module.'
    default:
      return describeError(error)
  }
}

/** Why the team role could not be taken away although the roster entry was removed (`role_error` of the DELETE answer). */
export function describeRoleError(code: string): string {
  switch (code) {
    case 'bot_cannot_remove_role':
      return 'Nexus is not allowed to remove that role from the member (the Nexus role must be above it).'
    case 'bot_unavailable':
      return 'the bot was offline at that moment'
    case 'bot_timeout':
      return 'Discord did not answer in time'
    case 'discord_error':
      return 'Discord rejected the change'
    default:
      return `the role could not be removed (${code.slice(0, 40)})`
  }
}

// ── Teams table ─────────────────────────────────────────────────────────────

export type TeamColumn = 'name' | 'focus' | 'members'

export const TEAM_GETTERS: Record<TeamColumn, (team: RacingTeam) => string | number | null> = {
  name: (team) => team.name,
  focus: (team) => (team.focus === '' ? null : team.focus), // teams without a class sort last
  members: (team) => team.memberCount
}

export type TeamFilter = 'all' | 'with' | 'without' | 'role-missing'

export const TEAM_FILTER_OPTIONS: ReadonlyArray<{ value: TeamFilter; label: string }> = [
  { value: 'all', label: 'All teams' },
  { value: 'with', label: 'With members' },
  { value: 'without', label: 'Without members' },
  { value: 'role-missing', label: 'Discord role deleted' }
]

export function matchesTeamFilter(team: RacingTeam, filter: TeamFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'with':
      return team.memberCount > 0
    case 'without':
      return team.memberCount === 0
    case 'role-missing':
      return !team.roleExists
  }
}

// ── Roster table ────────────────────────────────────────────────────────────

export type RosterColumn = 'member' | 'role' | 'joined'

/** The name to show for a member: their name now, else the name stored when they joined. */
export function rosterName(entry: Pick<RosterEntry, 'currentName' | 'displayName' | 'username'>): string {
  return entry.currentName ?? (entry.displayName || entry.username)
}

export const ROSTER_GETTERS: Record<RosterColumn, (entry: RosterEntry) => string | number | null> = {
  member: rosterName,
  role: (entry) => {
    const index = (RACING_ROLES as readonly string[]).indexOf(entry.role)
    return index === -1 ? RACING_ROLES.length : index // the four roles in dropdown order, anything else the commands stored last
  },
  joined: (entry) => {
    const time = Date.parse(entry.joinedAt)
    return Number.isNaN(time) ? null : time
  }
}

export type RosterFilter = 'all' | 'left' | (typeof RACING_ROLES)[number]

export const ROSTER_FILTER_OPTIONS: ReadonlyArray<{ value: RosterFilter; label: string }> = [
  { value: 'all', label: 'All members' },
  ...RACING_ROLES.map((role) => ({ value: role, label: role })),
  { value: 'left', label: 'Left the server' }
]

export function matchesRosterFilter(entry: RosterEntry, filter: RosterFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'left') return !entry.inServer
  return entry.role.trim().toLowerCase() === filter.toLowerCase()
}

export function rosterSearchFields(entry: RosterEntry): string[] {
  return [entry.currentName, entry.displayName, entry.username, entry.role].filter((field): field is string => field !== null)
}

/** Counts per role for the header of a team ("2 Race Drivers, 1 Manager"); roles the commands stored as other text are counted as Other. */
export function roleSummary(roster: readonly RosterEntry[]): string {
  if (roster.length === 0) return 'No members'
  const counts = new Map<string, number>()
  for (const entry of roster) {
    const known = (RACING_ROLES as readonly string[]).find((role) => role.toLowerCase() === entry.role.trim().toLowerCase())
    const key = known ?? 'Other'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...RACING_ROLES, 'Other'].filter((role) => counts.has(role)).map((role) => `${counts.get(role)} ${role}`).join(', ')
}

// ── Events ──────────────────────────────────────────────────────────────────

export interface EventDateView {
  /** The date as stored: free text. */
  text: string
  /** The full date the bot understood, shown when the stored text is not already that date written as YYYY-MM-DD. */
  readAs: string | null
  /** The text is a real date in two readings (03/04/2026): the bot took the first one. */
  ambiguous: boolean
  /** The bot cannot read it: it is kept forever and listed last. */
  unreadable: boolean
}

export function describeEventDate(event: Pick<RacingEvent, 'date' | 'dateIso'>): EventDateView {
  const parsed = parseEventDate(event.date)
  if (event.dateIso === null) return { text: event.date, readAs: null, ambiguous: false, unreadable: true }
  return {
    text: event.date,
    readAs: event.date.trim() === event.dateIso ? null : longDate(event.dateIso),
    ambiguous: parsed?.ambiguous === true,
    unreadable: false
  }
}

export type EventColumn = 'date' | 'time' | 'name' | 'class'

/** Sorting is optional: with no column chosen the events stay in the order the API returns them (soonest first, unreadable dates last). */
export const EVENT_GETTERS: Record<EventColumn, (event: RacingEvent) => string | number | null> = {
  date: (event) => event.dateIso, // unreadable dates always last
  time: (event) => event.time,
  name: (event) => event.name,
  class: (event) => (event.class === '' ? null : event.class)
}
