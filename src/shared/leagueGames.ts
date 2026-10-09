import type { LeagueGame } from './types'

/**
 * Which league games belong to a catalog game ("f1", "lmu", ...)? Same rule the backend uses for
 * GET /games (docs/APP_API.md): the key equals the slug or starts with `slug_` / `slug-`, case-insensitive.
 */
export function matchesCatalogGame(slug: string, leagueKey: string): boolean {
  const key = leagueKey.toLowerCase()
  const s = slug.toLowerCase()
  return key === s || key.startsWith(`${s}_`) || key.startsWith(`${s}-`)
}

export function leagueGamesFor(slug: string, games: readonly LeagueGame[]): LeagueGame[] {
  return games.filter((game) => matchesCatalogGame(slug, game.key))
}

/** A catalog game counts as enabled when at least one of its league games is active. */
export function isCatalogGameEnabled(slug: string, games: readonly LeagueGame[]): boolean {
  return leagueGamesFor(slug, games).some((game) => game.active)
}

export type EnablePlan =
  /** Already enabled: nothing to do. */
  | { kind: 'already' }
  /** League games exist but are all disabled: enable one of them (PATCH active). */
  | { kind: 'enable-existing'; candidates: LeagueGame[] }
  /** No league game yet: create one whose key is the slug (POST). */
  | { kind: 'create'; gameKey: string }

export function planEnable(slug: string, games: readonly LeagueGame[]): EnablePlan {
  const matching = leagueGamesFor(slug, games)
  if (matching.some((game) => game.active)) return { kind: 'already' }
  if (matching.length > 0) return { kind: 'enable-existing', candidates: matching }
  return { kind: 'create', gameKey: slug }
}
