import { describe, expect, it } from 'vitest'
import { parseLocation, routes } from './routes'

describe('route helpers', () => {
  it('builds and parses league paths consistently', () => {
    expect(routes.league('123', 'f1', 'announcement')).toBe('/g/123/f1/announcement')
    expect(parseLocation(routes.league('123', 'f1', 'announcement'))).toEqual({ guildId: '123', game: 'f1', page: 'announcement' })
    expect(parseLocation(routes.league('123', 'iracing'))).toEqual({ guildId: '123', game: 'iracing', page: 'overview' })
  })

  it('parses the game picker and the server list', () => {
    expect(parseLocation(routes.games('123'))).toEqual({ guildId: '123', game: null, page: null })
    expect(parseLocation('/g/123/')).toEqual({ guildId: '123', game: null, page: null })
    expect(parseLocation(routes.servers)).toEqual({ guildId: null, game: null, page: null })
    expect(parseLocation(routes.login)).toEqual({ guildId: null, game: null, page: null })
  })

  it('ignores anything that is not a valid app path', () => {
    for (const path of ['/g/abc/f1/overview', '/g/123/F1/overview', '/g/123/f1/overview/extra', '/x/123/f1', '/g/' + '1'.repeat(30)]) {
      expect(parseLocation(path).guildId, path).toBeNull()
    }
    expect(parseLocation('/g/123/f1/unknown-page').page).toBeNull()
  })
})
