import { BIG_PING_MEMBERS, isBigPing, isPingable, MAX_PING_ROLES } from '../../shared/pingRoles'
import type { PingedRole, RacingTeamRole, Role } from '../../shared/types'
import { plural } from './format'

/**
 * Pinging roles with an esports post (milestone 6), free of React so the rules can be tested.
 *
 * What the picker offers: every role of GET /roles EXCEPT bot or integration roles (`managed`), @everyone (it is not in the list, and
 * the server's own id and the names "@everyone" / "@here" are refused here as well) - so @everyone and @here can never be chosen.
 * A role that is not mentionable IS offered, with a warning: the post is only pinged when the bot may mention everyone in the channel,
 * and the server refuses it (`bot_cannot_mention_role`, nothing posted) when it may not.
 */

/** The sentence the confirmation dialog always shows when roles are pinged. */
export const PING_CONFIRM_SENTENCE = 'Pings notify members immediately and cannot be undone.'

export const NOT_MENTIONABLE_WARNING = 'Not mentionable: Discord only pings this role if Nexus has the Mention Everyone permission in the channel. If it does not, the post is refused and nothing is sent.'

/** A role as the screens show it: the picked id resolved against the list of the server. */
export interface PingRoleView {
  id: string
  name: string
  color: string | null
  /** False for a role that is not mentionable. A role that is no longer in the list counts as not known to be mentionable. */
  mentionable: boolean
  memberCount: number | null
  approximate: boolean
  /** More than 50 members, or a count that may be that high or is unknown: needs the extra confirmation. */
  big: boolean
  /** The role is not in the list any more (deleted since the list was read). */
  missing: boolean
}

/** "12 members", "about 12 members" while the bot's member cache is incomplete, "1 member", or "member count unknown". */
export function memberCountText(role: Pick<PingRoleView, 'memberCount' | 'approximate'>): string {
  if (role.memberCount === null) return 'member count unknown'
  const text = plural(role.memberCount, 'member')
  return role.approximate ? `about ${text}` : text
}

export function viewOfRole(role: Role): PingRoleView {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    mentionable: role.mentionable,
    memberCount: role.memberCount,
    approximate: role.memberCountApproximate,
    big: isBigPing(role),
    missing: false
  }
}

/** The chosen ids as views, in the order they were chosen. An id the list does not know stays (so it can be removed) with an unknown count. */
export function resolvePingRoles(ids: readonly string[], roles: readonly Role[]): PingRoleView[] {
  return ids.map((id) => {
    const found = roles.find((role) => role.id === id)
    return found ? viewOfRole(found) : { id, name: 'A role that no longer exists', color: null, mentionable: false, memberCount: null, approximate: true, big: true, missing: true }
  })
}

/** Roles the picker may offer at all: never a managed role and never @everyone / @here. */
export function pingableRoles(roles: readonly Role[], guildId: string): Role[] {
  return roles.filter((role) => isPingable(role, guildId))
}

export interface PingOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
  badge?: string
}

/** The options of the role search: one per pingable role, with its member count; a role already chosen is shown as taken. */
export function pingOptions(roles: readonly Role[], guildId: string, chosen: readonly string[]): PingOption[] {
  return pingableRoles(roles, guildId).map((role) => {
    const taken = chosen.includes(role.id)
    const view = viewOfRole(role)
    const notes = [taken ? 'Already chosen' : '', role.mentionable ? '' : 'Not mentionable'].filter(Boolean)
    return {
      value: role.id,
      label: role.name,
      ...(notes.length > 0 ? { description: notes.join('. ') } : {}),
      ...(taken ? { disabled: true } : {}),
      badge: memberCountText(view)
    }
  })
}

export type TeamRoleProblem = 'none' | 'too-many'

/**
 * What "All {game} team roles" fills in: the team roles that the server also lists and that may be pinged. More than 3 cannot be filled in
 * (a post pings at most 3): the button is then off and says so, instead of silently picking some of them.
 */
export function teamRoleSelection(teamRoles: readonly RacingTeamRole[], roles: readonly Role[], guildId: string): { ids: string[]; problem: TeamRoleProblem | null } {
  const pingable = new Set(pingableRoles(roles, guildId).map((role) => role.id))
  const ids = [...new Set(teamRoles.map((role) => role.roleId))].filter((id) => pingable.has(id))
  if (ids.length === 0) return { ids: [], problem: 'none' }
  if (ids.length > MAX_PING_ROLES) return { ids: [], problem: 'too-many' }
  return { ids, problem: null }
}

/** True when any chosen role needs the extra checkbox in the confirmation. */
export function needsBigPingCheck(roles: readonly PingRoleView[]): boolean {
  return roles.some((role) => role.big)
}

/** Why a big role needs the checkbox, in the dialog. */
export function bigPingText(role: PingRoleView): string {
  return role.memberCount === null ? `${role.name}: the member count could not be read, so it may be a big group.` : `${role.name} has ${memberCountText(role)}, more than ${BIG_PING_MEMBERS}.`
}

/**
 * A note for the result when the server did not confirm what was asked for. `requested` are the ids sent; `pinged` is what the answer lists.
 * Null when they agree (or nothing was asked for).
 */
export function pingedMismatchNote(requested: readonly string[], pinged: readonly PingedRole[]): string | null {
  if (requested.length === 0) return null
  if (pinged.length === 0) return 'The server did not say which roles were pinged. Look at the message in Discord to see who was.'
  const got = new Set(pinged.map((role) => role.id))
  return requested.every((id) => got.has(id)) ? null : 'The server pinged fewer roles than you chose. Look at the message in Discord to see who was pinged.'
}

/** What the confirmation dialog shows and allows, as plain data (the dialog only draws it). */
export interface ConfirmView {
  /** "Pings notify members immediately and cannot be undone.", or null when nobody is pinged. */
  sentence: string | null
  /** At least one chosen role cannot be pinged without the bot's Mention Everyone permission. */
  warnNotMentionable: boolean
  /** A big role is among them: the confirm button waits for the checkbox. */
  needsCheck: boolean
  /** The confirm button works. Cancel always does, and is the default focus. */
  canConfirm: boolean
}

export function confirmView(roles: readonly PingRoleView[], understood: boolean): ConfirmView {
  const needsCheck = needsBigPingCheck(roles)
  return {
    sentence: roles.length > 0 ? PING_CONFIRM_SENTENCE : null,
    warnNotMentionable: roles.some((role) => !role.mentionable),
    needsCheck,
    canConfirm: !needsCheck || understood
  }
}
