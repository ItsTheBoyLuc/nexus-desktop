import { describe, expect, it } from 'vitest'
import { esportsModuleState, leagueModuleState, serverModuleState } from './modules'
import { gameHomePage, isLeaguePage, parseLocation, parseServerPage, routes } from './routes'

describe('route helpers', () => {
  it('builds and parses game paths consistently', () => {
    expect(routes.game('123', 'f1', 'calendar')).toBe('/g/123/f1/calendar')
    expect(parseLocation(routes.game('123', 'f1', 'dirty-drivers'))).toEqual({ guildId: '123', game: 'f1', page: 'dirty-drivers' })
    expect(parseLocation(routes.game('123', 'iracing'))).toEqual({ guildId: '123', game: 'iracing', page: 'esports' })
  })

  it('every game opens somewhere: Formula 1 on its league, the others on their esports team', () => {
    expect(gameHomePage('f1')).toBe('calendar')
    for (const game of ['lmu', 'iracing', 'gt7', 'acc']) expect(gameHomePage(game)).toBe('esports')
  })

  it('builds and parses server-level pages, which have no game', () => {
    expect(routes.server('123', 'tiers')).toBe('/g/123/server/tiers')
    expect(routes.server('123')).toBe('/g/123/server/overview')
    expect(parseServerPage('/g/123/server/settings')).toBe('settings')
    expect(parseLocation('/g/123/server/settings')).toEqual({ guildId: '123', game: null, page: null })
    expect(parseServerPage('/g/123/f1/calendar')).toBeNull()
    expect(parseServerPage('/g/123/server/unknown')).toBeNull()
    expect(parseServerPage('/g/123/server/settings/extra')).toBeNull()
  })

  it('parses the game picker and the server list', () => {
    expect(parseLocation(routes.games('123'))).toEqual({ guildId: '123', game: null, page: null })
    expect(parseLocation('/g/123/')).toEqual({ guildId: '123', game: null, page: null })
    expect(parseLocation(routes.servers)).toEqual({ guildId: null, game: null, page: null })
    expect(parseLocation(routes.login)).toEqual({ guildId: null, game: null, page: null })
  })

  it('ignores anything that is not a valid app path', () => {
    for (const path of ['/g/abc/f1/calendar', '/g/123/F1/calendar', '/g/123/f1/calendar/extra', '/x/123/f1', '/g/' + '1'.repeat(30)]) {
      expect(parseLocation(path).guildId, path).toBeNull()
    }
    expect(parseLocation('/g/123/f1/unknown-page').page).toBeNull()
    // Announcement moved to the server level: it is no longer a game page.
    expect(parseLocation('/g/123/f1/announcement').page).toBeNull()
  })

  it('tells league pages from the esports page', () => {
    expect(isLeaguePage('calendar')).toBe(true)
    expect(isLeaguePage('esports')).toBe(false)
    expect(isLeaguePage(null)).toBe(false)
  })
})

describe('which sidebar modules are available', () => {
  it('server pages need only a server', () => {
    expect(serverModuleState({ hasServer: true })).toEqual({ enabled: true, reason: null })
    expect(serverModuleState({ hasServer: false })).toEqual({ enabled: false, reason: 'Choose a server first.' })
  })

  it('game modules explain what is missing, in order: server, game, enabled', () => {
    const state = { hasServer: true, game: 'f1', gameEnabled: true }
    expect(leagueModuleState({ ...state, hasServer: false }).reason).toBe('Choose a server first.')
    expect(leagueModuleState({ ...state, game: null }).reason).toBe('Choose a game first.')
    expect(leagueModuleState({ ...state, gameEnabled: false }).reason).toBe('Enable this game first.')
    expect(esportsModuleState({ ...state, gameEnabled: false }).reason).toBe('Enable this game first.')
  })

  it('only Formula 1 has a league, but every enabled game has an esports team', () => {
    expect(leagueModuleState({ hasServer: true, game: 'f1', gameEnabled: true }).enabled).toBe(true)
    for (const game of ['lmu', 'iracing', 'gt7', 'acc']) {
      expect(leagueModuleState({ hasServer: true, game, gameEnabled: true })).toEqual({ enabled: false, reason: 'Only Formula 1 has a league module.' })
    }
    for (const game of ['f1', 'lmu', 'iracing', 'gt7', 'acc']) expect(esportsModuleState({ hasServer: true, game, gameEnabled: true }).enabled, game).toBe(true)
  })

  it('a disabled game is reported as "enable it first" before the league rule', () => {
    expect(leagueModuleState({ hasServer: true, game: 'acc', gameEnabled: false }).reason).toBe('Enable this game first.')
  })
})
