import { isRacingGame } from './racingValidation'
import { isValidSnowflake } from './validation'

/**
 * Role pings and the remembered post channel (docs/APP_API.md, milestone 6).
 *
 * The main process parses every request again with these rules, so nothing the renderer sends can add a mention the user did not pick:
 * only numeric role ids are accepted (so "@everyone", "@here" and mention text never get through), at most 3 distinct roles, and the
 * server's own id (the @everyone role) is refused.
 */

/** The most roles one post may ping. */
export const MAX_PING_ROLES = 3

/** A role with more members than this needs an extra confirmation before it is pinged. */
export const BIG_PING_MEMBERS = 50

export type PingRoleProblem = { code: 'invalid_ping_roles' | 'too_many_ping_roles' | 'role_not_pingable'; message: string }

/**
 * Checks `ping_role_ids` before a request is made. Absent, null or an empty list means "nobody is pinged". Duplicates count once.
 * `guildId` is the server: a role with that id IS @everyone and is never pingable.
 */
export function parsePingRoleIds(value: unknown, guildId?: string): { ok: true; value: string[] } | { ok: false; problem: PingRoleProblem } {
  if (value === undefined || value === null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, problem: { code: 'invalid_ping_roles', message: 'The roles to ping are not valid. Pick them from the list.' } }
  const ids: string[] = []
  for (const item of value) {
    if (!isValidSnowflake(item)) return { ok: false, problem: { code: 'invalid_ping_roles', message: 'The roles to ping are not valid. Pick them from the list.' } }
    if (guildId !== undefined && item === guildId) return { ok: false, problem: { code: 'role_not_pingable', message: '@everyone cannot be pinged from the app.' } }
    if (!ids.includes(item)) ids.push(item)
  }
  if (ids.length > MAX_PING_ROLES) return { ok: false, problem: { code: 'too_many_ping_roles', message: `A post can ping at most ${MAX_PING_ROLES} roles.` } }
  return { ok: true, value: ids }
}

/** A role the picker may offer. @everyone has the server's id and is not in the list at all; bot or integration roles are never offered. */
export function isPingable(role: { id: string; name: string; managed: boolean }, guildId: string): boolean {
  if (role.managed || role.id === guildId) return false
  return role.name !== '@everyone' && role.name !== '@here'
}

/** True when pinging this role needs the extra confirmation: more than 50 members, or a count that may be that high or is unknown. */
export function isBigPing(role: { memberCount: number | null; memberCountApproximate: boolean }): boolean {
  if (role.memberCount === null) return true
  return role.memberCountApproximate ? role.memberCount >= BIG_PING_MEMBERS : role.memberCount > BIG_PING_MEMBERS
}

// ── The remembered channel ──────────────────────────────────────────────────

/** At most this many servers x games are remembered; the file is user-editable, so it is bounded. */
export const MAX_POST_CHANNELS = 200

const KEY_PATTERN = /^([0-9]{1,20}):([a-z0-9]{1,20})$/

/** The key of the last channel chosen for the posts of one game on one server. */
export function postChannelKey(guildId: string, game: string): string {
  return `${guildId}:${game}`
}

export function isPostChannelKey(key: unknown): key is string {
  if (typeof key !== 'string') return false
  const match = KEY_PATTERN.exec(key)
  return match !== null && isRacingGame(match[2])
}

/** Keeps only well-formed `guildId:game` -> channel id entries. Nothing else is ever kept (no role ids, names or text). */
export function sanitizePostChannels(input: unknown): Record<string, string> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(clean).length >= MAX_POST_CHANNELS) break
    if (isPostChannelKey(key) && isValidSnowflake(value)) clean[key] = value
  }
  return clean
}
