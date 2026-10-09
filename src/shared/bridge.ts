import type {
  AnnouncementInput,
  AnnouncementResult,
  ApiStatus,
  AuthState,
  Channel,
  Game,
  GameCreateInput,
  Guild,
  IpcResult,
  LeagueGame,
  LeagueGames,
  Overview,
  PanelInput,
  PanelResult,
  Role,
  ServerSettings,
  ServerSettingsInput,
  Settings,
  SettingsPatch,
  Tier,
  TierCreateInput,
  TierUpdateInput,
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
    roles: (guildId: string) => Promise<IpcResult<Role[]>>
    postAnnouncement: (guildId: string, input: AnnouncementInput) => Promise<IpcResult<AnnouncementResult>>

    overview: (guildId: string) => Promise<IpcResult<Overview>>

    /** GET /settings. Saving needs the Administrator permission (403 admin_required otherwise). */
    serverSettings: (guildId: string) => Promise<IpcResult<ServerSettings>>
    saveServerSettings: (guildId: string, input: ServerSettingsInput) => Promise<IpcResult<ServerSettings>>

    leagueGames: (guildId: string) => Promise<IpcResult<LeagueGames>>
    createGame: (guildId: string, input: GameCreateInput) => Promise<IpcResult<LeagueGame>>
    setGameActive: (guildId: string, gameKey: string, active: boolean) => Promise<IpcResult<LeagueGame>>
    /** Also forgets the sign-up panels this app remembered for the game's tiers. */
    deleteGame: (guildId: string, gameKey: string) => Promise<IpcResult<null>>
    createTier: (guildId: string, gameKey: string, input: TierCreateInput) => Promise<IpcResult<Tier>>
    updateTier: (guildId: string, gameKey: string, tierKey: string, input: TierUpdateInput) => Promise<IpcResult<Tier>>
    /** Also forgets the sign-up panel this app remembered for the tier. */
    deleteTier: (guildId: string, gameKey: string, tierKey: string) => Promise<IpcResult<null>>
    /**
     * Posts a new panel, or refreshes one in place when `messageId` is given. The main process
     * remembers the posted panel (message id) in the settings file; nothing else may write it.
     */
    postPanel: (guildId: string, gameKey: string, tierKey: string, input: PanelInput) => Promise<IpcResult<PanelResult>>

    /** Current connection status (components that mount late would otherwise miss earlier events). */
    getStatus: () => Promise<ApiStatus>
    /** online / waking (server asleep, retrying) / offline. */
    onStatusChange: (callback: (status: ApiStatus) => void) => Unsubscribe
  }

  settings: {
    get: () => Promise<Settings>
    set: (patch: SettingsPatch) => Promise<Settings>
  }

  system: {
    /** Resolves false when the URL is not on the https allowlist. */
    openExternal: (url: string) => Promise<boolean>
  }
}
