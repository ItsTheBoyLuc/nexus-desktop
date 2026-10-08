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
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorInfo }

export type ApiStatus = 'unknown' | 'online' | 'waking' | 'offline'

export interface Settings {
  lastGuildId: string | null
  lastGame: GameKey | null
}

export const DEFAULT_SETTINGS: Settings = { lastGuildId: null, lastGame: null }
