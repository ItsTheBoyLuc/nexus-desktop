/** Route paths and parsing in one place, so the sidebar, breadcrumb and router agree. */
export const PAGES = ['overview', 'calendar', 'reports', 'standings', 'teams', 'announcement'] as const
export type PageKey = (typeof PAGES)[number]

export const PAGE_LABELS: Record<PageKey, string> = {
  overview: 'Overview',
  calendar: 'Calendar',
  reports: 'Reports',
  standings: 'Standings',
  teams: 'Teams',
  announcement: 'Announcement'
}

export const routes = {
  login: '/login',
  servers: '/servers',
  games: (guildId: string): string => `/g/${guildId}`,
  league: (guildId: string, game: string, page: PageKey = 'overview'): string => `/g/${guildId}/${game}/${page}`
} as const

export interface ParsedLocation {
  guildId: string | null
  game: string | null
  page: PageKey | null
}

const LOCATION = /^\/g\/(\d{1,20})(?:\/([a-z0-9_]{1,32})(?:\/([a-z]+))?)?\/?$/

export function parseLocation(pathname: string): ParsedLocation {
  const match = LOCATION.exec(pathname)
  const page = match?.[3]
  return {
    guildId: match?.[1] ?? null,
    game: match?.[2] ?? null,
    page: (PAGES as readonly string[]).includes(page ?? '') ? (page as PageKey) : null
  }
}
