/**
 * FAKE role-ping rules of the esports posts (milestone 6) for `npm run dev:mock`: what the server checks before it posts an attendance post or
 * an announcement that pings roles (docs/APP_API.md, "Posting to a channel, with optional role pings"). Part of the mock bridge: it must never
 * end up in an Electron build (it is only reachable through installMock.ts and racingMock.ts, behind the compile-time `__NEXUS_MOCK__` flag).
 *
 * Scenarios (query string, on top of the ones in racingMock.ts):
 *   manyteamroles   every game has at least 4 teams with a role: "All {game} team roles" cannot fill the 3 places and says so
 *   norolelist      GET /roles fails with a 500: the ping section says the roles could not be loaded
 *   invalidping     every pinging post is refused with 400 invalid_ping_roles
 *   toomanyping     every pinging post is refused with 400 too_many_ping_roles
 *   pingrefused     every pinging post is refused with 403 role_not_pingable
 *   pinglimit       every pinging post is refused with 429 rate_limited (the 5 per minute limit)
 *
 * Hooks (normal scenario), by what is chosen:
 *   the role "Quiet Role (not mentionable)"   403 bot_cannot_mention_role, except in the channel #mention-everyone-ok where the bot may mention it
 *   the role "Role Deleted Meanwhile"         404 role_not_found (it is listed, but gone when the post arrives)
 *   more than 3 distinct roles, a role with the server's own id (@everyone), a role that is bot-managed, or a non-numeric id   400 / 403 as in the docs
 *   a 6th pinging post within a minute        429 rate_limited, like the real limit
 * Everything is obviously fake. Roles with 60 members ("Big Announcements Group") and an approximate count ("Cache Still Filling") exist.
 */
import type { IpcResult, PingedRole, Role } from '../../shared/types'
import { failure, notFound, refused } from './common'

export const ROLE_NOT_MENTIONABLE = '800000000000000020'
export const ROLE_DELETED_MEANWHILE = '800000000000000022'
/** A channel where the bot has Mention Everyone: a role that is not mentionable can be pinged there. */
export const MENTION_ALL_CHANNEL = '777000000000000010'

const RATE_LIMIT = 5
const WINDOW_MS = 60_000

/** The 5-per-minute limit of pinging posts, per user and server (here: one user). */
export function createPingLimiter(now: () => number = Date.now): (guildId: string) => boolean {
  const stamps = new Map<string, number[]>()
  return (guildId) => {
    const recent = (stamps.get(guildId) ?? []).filter((time) => now() - time < WINDOW_MS)
    if (recent.length >= RATE_LIMIT) {
      stamps.set(guildId, recent)
      return false
    }
    stamps.set(guildId, [...recent, now()])
    return true
  }
}

export type PingCheck = { error: IpcResult<never> } | { pinged: PingedRole[] }

/**
 * Everything the server checks for `ping_role_ids`, in the documented order: the shape, the count, each role (in the server, not @everyone, not
 * managed, mentionable or the bot may mention it in the channel), and last the rate limit (a refused request does not use it up).
 */
export function checkPings(options: {
  scenario: string
  guildId: string
  roleIds: readonly unknown[] | undefined
  channelId: string
  roles: readonly Role[]
  allowed: () => boolean
}): PingCheck {
  const { scenario, guildId, roleIds, channelId, roles } = options
  if (roleIds === undefined || roleIds.length === 0) return { pinged: [] }
  if (scenario === 'invalidping') return { error: failure('http', 'invalid_ping_roles', 'ping_role_ids must be a list of role IDs.', 400) }
  if (scenario === 'toomanyping') return { error: failure('http', 'too_many_ping_roles', 'A post can ping at most 3 roles.', 400) }
  if (!roleIds.every((id) => typeof id === 'string' && /^\d{15,25}$/.test(id))) return { error: failure('http', 'invalid_ping_roles', 'ping_role_ids must be a list of role IDs.', 400) }
  const ids = [...new Set(roleIds as string[])]
  if (ids.length > 3) return { error: failure('http', 'too_many_ping_roles', 'A post can ping at most 3 roles.', 400) }
  if (scenario === 'pingrefused') return { error: refused('role_not_pingable', 'That role cannot be pinged.') }

  const pinged: PingedRole[] = []
  for (const id of ids) {
    if (id === guildId) return { error: refused('role_not_pingable', '@everyone cannot be pinged.') }
    const role = roles.find((item) => item.id === id)
    if (!role || id === ROLE_DELETED_MEANWHILE) return { error: notFound('role_not_found', 'That role was not found in this server.') }
    if (role.managed) return { error: refused('role_not_pingable', 'Bot and integration roles cannot be pinged.') }
    if (!role.mentionable && channelId !== MENTION_ALL_CHANNEL) return { error: refused('bot_cannot_mention_role', 'That role is not mentionable and the bot cannot mention it there.') }
    pinged.push({ id: role.id, name: role.name })
  }
  if (scenario === 'pinglimit' || !options.allowed()) return { error: failure('rate_limited', 'rate_limited', 'Too many pinging posts. Try again in a minute.', 429, { retryAfter: 60 }) }
  return { pinged }
}
