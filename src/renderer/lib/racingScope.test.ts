import { describe, expect, it, vi } from 'vitest'
import { GAME_KEYS } from '../../shared/types'
import { cached, onInvalidate } from './cache'
import { invalidateRacing, racingKey, racingScope } from './racingScope'

/**
 * Game and server state reset (milestone 5). Every esports screen is rendered under `racingScope(guild, game)` as its React key, so
 * a change of server or game rebuilds it from scratch: lists, forms, search boxes and pending dialogs of the old game cannot leak
 * into the new one. The keys of every read carry the server and the game too, so one game never shares data with another.
 */
const G1 = '555000000000000001'
const G2 = '555000000000000002'

describe('the scope and the keys', () => {
  it('differ for every server and every game', () => {
    const scopes = GAME_KEYS.flatMap((game) => [racingScope(G1, game), racingScope(G2, game)])
    expect(new Set(scopes).size).toBe(GAME_KEYS.length * 2)
  })

  it('every key of the results, attendance and announcement data names the server and the game', () => {
    for (const game of GAME_KEYS) {
      for (const part of ['results', 'attendance', 'attendance-post']) {
        const key = racingKey(G1, game, part, 'x')
        expect(key.startsWith(`racing:${G1}:${game}:`)).toBe(true)
      }
    }
    expect(racingKey(G1, 'lmu', 'results')).not.toBe(racingKey(G1, 'iracing', 'results'))
    expect(racingKey(G1, 'lmu', 'results')).not.toBe(racingKey(G2, 'lmu', 'results'))
  })

  it('invalidating one game forgets that game on that server only', async () => {
    const loaders = new Map<string, ReturnType<typeof vi.fn>>()
    const load = (key: string) => {
      const fn = vi.fn(async () => key)
      loaders.set(key, fn)
      return fn
    }
    const keys = GAME_KEYS.flatMap((game) => [racingKey(G1, game, 'results'), racingKey(G2, game, 'results')])
    for (const key of keys) await cached(key, load(key), 60_000)
    const heard: string[] = []
    const stop = onInvalidate((prefix) => heard.push(prefix))
    invalidateRacing(G1, 'gt7')
    stop()
    expect(heard).toEqual([`racing:${G1}:gt7:`])
    // gt7 on G1 is loaded again, everything else is still cached
    for (const key of keys) {
      const again = vi.fn(async () => key)
      await cached(key, again, 60_000)
      expect(again.mock.calls.length, key).toBe(key === racingKey(G1, 'gt7', 'results') ? 1 : 0)
    }
  })
})
