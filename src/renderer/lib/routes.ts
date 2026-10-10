/**
 * Route paths and parsing in one place, so the sidebar, breadcrumb and router agree.
 *
 *   /servers                         server list
 *   /g/:guild                        game picker
 *   /g/:guild/server/:page           server-level pages: overview, tiers (Games & Tiers), settings, announcement
 *   /g/:guild/:game/:page            game-level pages: the League modules (Formula 1 only)
 *   /g/:guild/:game/esports/:page    the Esports team of any of the five games (teams, events, results, attendance, announcement)
 */
export const SERVER_PAGES = ['overview', 'tiers', 'settings', 'announcement'] as const
export type ServerPageKey = (typeof SERVER_PAGES)[number]

export const SERVER_PAGE_LABELS: Record<ServerPageKey, string> = {
  overview: 'Overview',
  tiers: 'Games & Tiers',
  settings: 'Settings',
  announcement: 'Announcement'
}

/** The League module: only Formula 1 has one. */
export const LEAGUE_PAGES = ['calendar', 'teams', 'standings', 'reports', 'penalties', 'dirty-drivers', 'attendance', 'signups'] as const
export type LeaguePageKey = (typeof LEAGUE_PAGES)[number]

/**
 * The pages of the Esports team group (milestone 5). Every one of the five games has them, whether the game is enabled in
 * Games & Tiers or not: the esports data is separate from the league's.
 */
export const ESPORTS_PAGES = ['teams', 'events', 'results', 'attendance', 'announcement'] as const
export type EsportsPageKey = (typeof ESPORTS_PAGES)[number]

export const ESPORTS_PAGE_LABELS: Record<EsportsPageKey, string> = {
  teams: 'Teams',
  events: 'Events',
  results: 'Results',
  attendance: 'Attendance',
  announcement: 'Announcement'
}

export function isEsportsPage(value: unknown): value is EsportsPageKey {
  return typeof value === 'string' && (ESPORTS_PAGES as readonly string[]).includes(value)
}

/** Every game has an Esports team module. */
export const PAGES = [...LEAGUE_PAGES, 'esports'] as const
export type PageKey = (typeof PAGES)[number]

export const PAGE_LABELS: Record<PageKey, string> = {
  calendar: 'Calendar',
  teams: 'Teams',
  standings: 'Standings',
  reports: 'Reports',
  penalties: 'Penalties',
  'dirty-drivers': 'Dirty drivers',
  attendance: 'Attendance',
  signups: 'Sign-ups',
  esports: 'Esports team'
}

export function isLeaguePage(page: PageKey | null): page is LeaguePageKey {
  return page !== null && (LEAGUE_PAGES as readonly string[]).includes(page)
}

/** Where a game opens: Formula 1 has a League module, every other game goes straight to its Esports team. */
export function gameHomePage(game: string): PageKey {
  return game === 'f1' ? 'calendar' : 'esports'
}

export const routes = {
  login: '/login',
  servers: '/servers',
  games: (guildId: string): string => `/g/${guildId}`,
  server: (guildId: string, page: ServerPageKey = 'overview'): string => `/g/${guildId}/server/${page}`,
  game: (guildId: string, game: string, page: PageKey = gameHomePage(game)): string => `/g/${guildId}/${game}/${page}`,
  esports: (guildId: string, game: string, page: EsportsPageKey = 'teams'): string => `/g/${guildId}/${game}/esports/${page}`
} as const

export interface ParsedLocation {
  guildId: string | null
  game: string | null
  page: PageKey | null
  /** Set only on /g/:guild/:game/esports/:page, where `page` is 'esports'. */
  esportsPage: EsportsPageKey | null
}

const SERVER_SEGMENT = 'server'
// Groups: 1 guild, 2 game, 3 the page after /esports/, 4 a game-level page. Only the esports path has a fourth segment.
const LOCATION = /^\/g\/(\d{1,20})(?:\/([a-z0-9_]{1,32})(?:\/esports\/([a-z-]+)|\/([a-z-]+))?)?\/?$/

/** Game, game-level page and esports page of a path. Server-level paths have a guild but no game. */
export function parseLocation(pathname: string): ParsedLocation {
  const match = LOCATION.exec(pathname)
  const guildId = match?.[1] ?? null
  if (match?.[2] === SERVER_SEGMENT) return { guildId, game: null, page: null, esportsPage: null }
  const game = match?.[2] ?? null
  const esportsSegment = match?.[3]
  if (esportsSegment !== undefined) return { guildId, game, page: 'esports', esportsPage: isEsportsPage(esportsSegment) ? esportsSegment : null }
  const page = match?.[4]
  return { guildId, game, page: (PAGES as readonly string[]).includes(page ?? '') ? (page as PageKey) : null, esportsPage: null }
}

/** The server-level page of a path (`/g/:guild/server/:page`), or null. */
export function parseServerPage(pathname: string): ServerPageKey | null {
  const page = new RegExp(`^/g/\\d{1,20}/${SERVER_SEGMENT}/([a-z]+)/?$`).exec(pathname)?.[1]
  return (SERVER_PAGES as readonly string[]).includes(page ?? '') ? (page as ServerPageKey) : null
}
