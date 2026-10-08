import type {
  AnnouncementInput,
  AnnouncementResult,
  ApiStatus,
  AuthState,
  Channel,
  Game,
  Guild,
  IpcResult,
  Settings,
  UserInfo
} from './types'

export type Unsubscribe = () => void

/**
 * The only thing the preload exposes to the renderer (`window.nexus`). It carries no
 * tokens: sessions live in the main process, the renderer only learns "signed in as X".
 */
export interface NexusBridge {
  auth: {
    getState: () => Promise<AuthState>
    /** Opens the system browser for the Discord login. Progress arrives through onStateChange. */
    login: () => Promise<void>
    cancelLogin: () => Promise<void>
    /** Re-attempts restoring the saved session (shown after "no connection"). */
    retrySession: () => Promise<void>
    logout: () => Promise<void>
    onStateChange: (callback: (state: AuthState) => void) => Unsubscribe
  }

  api: {
    me: () => Promise<IpcResult<UserInfo>>
    guilds: () => Promise<IpcResult<Guild[]>>
    games: (guildId: string) => Promise<IpcResult<Game[]>>
    channels: (guildId: string) => Promise<IpcResult<Channel[]>>
    postAnnouncement: (guildId: string, input: AnnouncementInput) => Promise<IpcResult<AnnouncementResult>>
    /** online / waking (server asleep, retrying) / offline. */
    onStatusChange: (callback: (status: ApiStatus) => void) => Unsubscribe
  }

  settings: {
    get: () => Promise<Settings>
    set: (patch: Partial<Settings>) => Promise<Settings>
  }

  system: {
    /** Resolves false when the URL is not on the https allowlist. */
    openExternal: (url: string) => Promise<boolean>
  }
}
