import type { RacingGame } from '../../shared/types'
import { invalidate } from './cache'

/**
 * Data isolation of the esports teams (milestone 5). Every key of the esports data carries the server AND the game, so
 * a request for one game never shares a cache entry, a loading state or an invalidation with another game:
 *
 *   racing:<guild>:<game>:teams | team:<name> | driver:<id> | events | results...
 *
 * And every esports screen is rendered under `racingScope(guild, game)` as its React key: when the selected game or the
 * server changes, the screen is rebuilt from scratch, so lists, forms, search boxes and pending dialogs of the old game
 * cannot leak into the new one.
 */
export function racingScope(guildId: string, game: RacingGame): string {
  return `${guildId}:${game}`
}

export function racingPrefix(guildId: string, game: RacingGame): string {
  return `racing:${guildId}:${game}:`
}

export function racingKey(guildId: string, game: RacingGame, ...parts: string[]): string {
  return `${racingPrefix(guildId, game)}${parts.join(':')}`
}

/** After a write: forget what we knew about THIS game on THIS server and read it again. Other games are untouched. */
export function invalidateRacing(guildId: string, game: RacingGame): void {
  invalidate(racingPrefix(guildId, game))
}
