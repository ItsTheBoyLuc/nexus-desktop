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
