import { GAME_KEYS, GAME_LABELS, isGameKey } from '../../shared/types'
import type { Game } from '../../shared/types'

/** The five supported games in a fixed order; a game the API did not list counts as not enabled. */
export function mergeGames(fromApi: readonly Game[]): Game[] {
  const known: Game[] = GAME_KEYS.map((key) => fromApi.find((game) => game.key === key) ?? { key, label: GAME_LABELS[key], enabled: false })
  return [...known, ...fromApi.filter((game) => !isGameKey(game.key))]
}
