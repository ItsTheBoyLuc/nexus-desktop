/** Types shared by the main process, the preload bridge and the renderer. */

export const GAME_KEYS = ['f1', 'lmu', 'iracing', 'gt7', 'acc'] as const
export type GameKey = (typeof GAME_KEYS)[number]

export function isGameKey(value: unknown): value is GameKey {
  return typeof value === 'string' && (GAME_KEYS as readonly string[]).includes(value)
}

/** Short names for navigation and fallbacks; the API's own `label` wins when present. */
export const GAME_LABELS: Record<GameKey, string> = {
  f1: 'Formula 1',
  lmu: 'Le Mans Ultimate',
  iracing: 'iRacing',
  gt7: 'Gran Turismo 7',
  acc: 'Assetto Corsa Competizione'
}

export interface UserInfo {
  id: string
  username: string
  /** Avatar image URL (Discord CDN). */
  avatar: string
}

export interface Guild {
  id: string
  name: string
  icon: string | null
}

export interface Game {
  key: string
  label: string
  enabled: boolean
}

export interface Channel {
  id: string
  name: string
}

/** A Discord role as listed by GET /roles (for pickers). */
export interface Role {
  id: string
  name: string
  /** "#RRGGBB" or null for the default colour. */
  color: string | null
  position: number
  /** Bot / integration role: cannot be linked to a tier. */
  managed: boolean
  /** The bot may hand this role out (below the bot's highest role). */
  assignable: boolean
  /** Carries elevated permissions: only a server Administrator may link it. */
  privileged: boolean
}

export interface AnnouncementInput {
  title: string
  message: string
  channelId: string
  imageUrl?: string
}

export interface AnnouncementResult {
  messageId: string
  channelId: string
}

export type SignedOutReason =
  | 'logged-out'
  | 'denied'
  | 'cancelled'
  | 'timeout'
  | 'expired'
  | 'session-ended'
  | 'offline'
  | 'error'

/** What the login screen / app shell reacts to. Tokens are never part of it. */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; reason?: SignedOutReason }
  | { status: 'signing-in' }
  | { status: 'signed-in'; user: UserInfo }

// ── Server settings (GET/PUT /settings) ─────────────────────────────────────

export type SeasonSource = 'penalty_settings' | 'settings' | 'default'

export interface ServerSettings {
  /** "#RRGGBB", upper-case. */
  embedColor: string
  footerName: string
  /** The value stored in settings; null if never set. */
  seasonNumber: number | null
  /** The season every command actually uses. */
  effectiveSeason: number
  /** Which stored value decides `effectiveSeason`. */
  seasonSource: SeasonSource
}

/** Any subset; only the fields present are changed. */
export interface ServerSettingsInput {
  embedColor?: string
  footerName?: string
  seasonNumber?: number
}

// ── League games and tiers (/league/games...) ───────────────────────────────

export interface Tier {
  key: string
  roleId: string
  signupPanelPosted: boolean
  signupChannelId: string | null
  pointsSystem: string | null
  /** Members holding the role right now; null if the role no longer exists. */
  driverCount: number | null
  roleName: string | null
}

export interface LeagueGame {
  key: string
  label: string
  category: string
  active: boolean
  tiers: Tier[]
}

export interface LeagueGames {
  games: LeagueGame[]
  /** False when Discord would not return the full member list: driver counts may be too low. */
  memberCacheComplete: boolean
}

export interface GameCreateInput {
  gameKey: string
  label: string
  category: string
}

export interface TierCreateInput {
  tierKey: string
  roleId: string
  /** null or absent = none. */
  pointsSystem?: string | null
}

export interface TierUpdateInput {
  roleId?: string
  pointsSystem?: string | null
  signupChannelId?: string | null
}

export interface PanelInput {
  channelId: string
  /** Present = edit that panel in place (refresh); absent = post a new panel. */
  messageId?: string
}

export interface PanelResult {
  messageId: string
  channelId: string
  refreshed: boolean
  tier: Tier
}

/** A sign-up panel this app posted: the API cannot look panels up, so the app remembers them. */
export interface StoredPanel {
  messageId: string
  channelId: string
}

// ── Overview (GET /overview) ────────────────────────────────────────────────

export interface OverviewCounts {
  games: number
  activeGames: number
  tiers: number
  tiersWithPanel: number
  tierDrivers: number
  teams: number
  teamDrivers: number
  calendarRounds: number
  openSignups: number
  reports: number
  pendingReports: number
}

export interface ChecklistItem {
  key: string
  label: string
  done: boolean
  detail: string | null
}

export interface NextEvent {
  round: number | string | null
  name: string
  flag: string | null
  /** As stored by the bot (text). */
  date: string
  time: string | null
  eventType: string
  countdownHours: number
}

export interface Overview {
  memberCount: number | null
  season: number
  counts: OverviewCounts
  nextEvent: NextEvent | null
  checklist: ChecklistItem[]
  setupComplete: boolean
  memberCacheComplete: boolean
}

export type ApiErrorKind =
  | 'http'
  | 'network'
  | 'timeout'
  | 'session'
  | 'rate_limited'
  | 'invalid_response'
  | 'validation'
  | 'unexpected'

/** Serializable error that crosses the IPC boundary. */
export interface ApiErrorInfo {
  kind: ApiErrorKind
  /** Backend error code ("forbidden", "bot_cannot_send", ...) or a client-side code. */
  code: string
  message: string
  status?: number
  /** Seconds, for rate_limited. */
  retryAfter?: number
  /** Only for network / timeout failures: false when the request provably never reached the server. */
  mayHaveBeenSent?: boolean
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorInfo }

export type ApiStatus = 'unknown' | 'online' | 'waking' | 'offline'

/** App settings kept in userData/settings.json. Not sensitive, never contains tokens. */
export interface Settings {
  lastGuildId: string | null
  lastGame: GameKey | null
  /** Sign-up panels posted by this app, by `guildId:gameKey:tierKey` (see shared/panels.ts). */
  panels: Record<string, StoredPanel>
}

export const DEFAULT_SETTINGS: Settings = { lastGuildId: null, lastGame: null, panels: {} }

/** What the renderer may change itself; panels are only ever written by the main process. */
export type SettingsPatch = Partial<Pick<Settings, 'lastGuildId' | 'lastGame'>>
