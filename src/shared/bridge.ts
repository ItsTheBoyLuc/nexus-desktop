import type {
  AddDriverInput,
  AddDriverResult,
  AnnouncementInput,
  AnnouncementResult,
  ApiStatus,
  AuthState,
  Calendar,
  CalendarPostInput,
  CalendarPostResult,
  Channel,
  DriverStats,
  Game,
  GameCreateInput,
  Guild,
  IpcResult,
  LeagueGame,
  LeagueGames,
  MemberSearch,
  NextRace,
  Overview,
  PanelInput,
  PanelResult,
  PointsSystem,
  PointsSystemInput,
  RaceOutcome,
  RemoveDriverResult,
  ResultsInput,
  Role,
  RoundInput,
  RoundPatch,
  RoundResult,
  ServerSettings,
  ServerSettingsInput,
  Settings,
  SettingsPatch,
  Standings,
  Team,
  TeamInput,
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

    /** Member search for pickers: 1-32 characters, at most 25 results. Never ask for an ID. */
    members: (guildId: string, query: string) => Promise<IpcResult<MemberSearch>>

    // F1 league (milestone 2). Writes are sent once and never replayed.
    calendar: (guildId: string) => Promise<IpcResult<Calendar>>
    createRound: (guildId: string, input: RoundInput) => Promise<IpcResult<RoundResult>>
    updateRound: (guildId: string, round: number, patch: RoundPatch) => Promise<IpcResult<RoundResult>>
    deleteRound: (guildId: string, round: number) => Promise<IpcResult<Calendar>>
    /**
     * Posts the calendar embed, or edits the earlier post when `messageId` is given. The main process
     * remembers the returned message id per server in the settings file, and forgets it when the API says
     * the message is gone.
     */
    postCalendar: (guildId: string, input: CalendarPostInput) => Promise<IpcResult<CalendarPostResult>>
    /** 404 calendar_not_found when there is no calendar yet. */
    nextRace: (guildId: string) => Promise<IpcResult<NextRace>>

    teams: (guildId: string) => Promise<IpcResult<Team[]>>
    createTeam: (guildId: string, input: TeamInput) => Promise<IpcResult<Team>>
    addDriver: (guildId: string, teamName: string, input: AddDriverInput) => Promise<IpcResult<AddDriverResult>>
    removeDriver: (guildId: string, teamName: string, userId: string) => Promise<IpcResult<RemoveDriverResult>>
    driver: (guildId: string, userId: string) => Promise<IpcResult<DriverStats>>

    standings: (guildId: string) => Promise<IpcResult<Standings>>
    /**
     * Records one race. Recording the same race twice adds its points twice. The main process writes the
     * local ledger only when the API answered success, never after a failure or a lost answer.
     */
    recordResults: (guildId: string, input: ResultsInput) => Promise<IpcResult<RaceOutcome>>
    pointsSystem: (guildId: string) => Promise<IpcResult<PointsSystem>>
    savePointsSystem: (guildId: string, input: PointsSystemInput) => Promise<IpcResult<PointsSystem>>

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
