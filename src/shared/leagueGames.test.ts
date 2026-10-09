import { describe, expect, it } from 'vitest'
import { isCatalogGameEnabled, leagueGamesFor, matchesCatalogGame, planEnable } from './leagueGames'
import type { LeagueGame } from './types'

const game = (key: string, active: boolean): LeagueGame => ({ key, label: key, category: 'c', active, tiers: [] })

describe('which league games belong to a catalog game', () => {
  it('equals the slug, or starts with slug_ / slug-, case-insensitively (same rule as GET /games)', () => {
    for (const key of ['f1', 'F1', 'f1_2025', 'F1_Pro', 'f1-2025']) expect(matchesCatalogGame('f1', key), key).toBe(true)
    for (const key of ['f12', 'f1x', 'xf1', 'f', 'acc_f1', '']) expect(matchesCatalogGame('f1', key), key).toBe(false)
    expect(matchesCatalogGame('acc', 'ACC')).toBe(true)
  })

  it('filters a list', () => {
    const games = [game('f1_2025', true), game('f1_2024', false), game('acc', true)]
    expect(leagueGamesFor('f1', games).map((g) => g.key)).toEqual(['f1_2025', 'f1_2024'])
    expect(isCatalogGameEnabled('f1', games)).toBe(true)
    expect(isCatalogGameEnabled('lmu', games)).toBe(false)
    expect(isCatalogGameEnabled('f1', [game('f1_2024', false)])).toBe(false) // only inactive league games
  })
})

describe('planning "Enable game"', () => {
  it('creates a league game keyed by the slug when none exists', () => {
    expect(planEnable('lmu', [game('f1', true)])).toEqual({ kind: 'create', gameKey: 'lmu' })
    expect(planEnable('lmu', [])).toEqual({ kind: 'create', gameKey: 'lmu' })
  })

  it('offers the existing disabled league games instead of creating a duplicate', () => {
    const plan = planEnable('f1', [game('f1_2024', false), game('F1', false), game('acc', true)])
    expect(plan.kind).toBe('enable-existing')
    if (plan.kind === 'enable-existing') expect(plan.candidates.map((g) => g.key)).toEqual(['f1_2024', 'F1'])
  })

  it('does nothing when the game is already enabled', () => {
    expect(planEnable('f1', [game('f1_2024', false), game('f1_2025', true)])).toEqual({ kind: 'already' })
  })
})
