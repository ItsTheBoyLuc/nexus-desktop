import type {
  AddDriverInput,
  AddDriverResult,
  AdvanceRaceInput,
  AdvanceRaceResult,
  RacingDriverProfile,
  RacingEvent,
  RacingEventInput,
  RacingEventPage,
  RacingGame,
  RacingTeam,
  RacingTeamDetail,
  RacingTeamInput,
  RosterAddInput,
  RosterAddResult,
  RosterRemoveResult,
  AttendanceDivisions,
  AttendancePost,
  AttendancePostFilters,
  AttendancePostInput,
  AttendancePostPage,
  AttendancePostResult,
  DivisionInput,
  DivisionResult,
  ParticipantRemoveResult,
  Signup,
  SignupCloseResult,
  SignupCreateResult,
  SignupInput,
  SignupParticipantPage,
  SignupQuestions,
  SignupStatus,
  BanInput,
  BanResult,
  ClearPointsInput,
  ClearPointsResult,
  DecisionInput,
  DecisionResult,
  DirtyDriver,
  DirtyHistory,
  DirtyRemoveResult,
  DirtyReportInput,
  DirtyReportResult,
  ManualPointsInput,
  ManualPointsResult,
  PenaltyHistory,
  PenaltyOverview,
  PenaltySettings,
  PenaltySettingsInput,
  Report,
  ReportFilters,
  ReportPage,
  ReportRoundDetail,
  ReportRoundRow,
  ServerLedgerEntry,
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
    /** The races recorded through the app (newest first): the server's duplicate guard. Races recorded with Discord commands are not in it. */
    resultsLedger: (guildId: string, query?: { season?: string; round?: string }) => Promise<IpcResult<ServerLedgerEntry[]>>

    // Reports, penalties and dirty drivers (milestone 3). Writes are sent once and never replayed.
    reports: (guildId: string, filters?: ReportFilters) => Promise<IpcResult<ReportPage>>
    reportRounds: (guildId: string) => Promise<IpcResult<ReportRoundRow[]>>
    reportRound: (guildId: string, season: string, round: string) => Promise<IpcResult<ReportRoundDetail>>
    report: (guildId: string, reportId: string) => Promise<IpcResult<Report>>
    /** 409 already_decided / penalty_not_configured, 404 or 409 report_message_not_found, 500 penalty_points_failed: see docs/APP_API.md. */
    decideReport: (guildId: string, reportId: string, input: DecisionInput) => Promise<IpcResult<DecisionResult>>

    penaltySettings: (guildId: string) => Promise<IpcResult<PenaltySettings>>
    savePenaltySettings: (guildId: string, input: PenaltySettingsInput) => Promise<IpcResult<PenaltySettings>>
    penaltyOverview: (guildId: string, season?: number) => Promise<IpcResult<PenaltyOverview>>
    penaltyHistory: (guildId: string, driver: string, season?: number) => Promise<IpcResult<PenaltyHistory>>
    addPenaltyPoints: (guildId: string, input: ManualPointsInput) => Promise<IpcResult<ManualPointsResult>>
    /** The destructive three need `confirm: true`, which the screens set only after their confirm dialog. */
    clearPenaltyPoints: (guildId: string, input: ClearPointsInput) => Promise<IpcResult<ClearPointsResult>>
    setBan: (guildId: string, input: BanInput) => Promise<IpcResult<BanResult>>
    advanceRace: (guildId: string, input: AdvanceRaceInput) => Promise<IpcResult<AdvanceRaceResult>>

    dirtyDrivers: (guildId: string) => Promise<IpcResult<DirtyDriver[]>>
    dirtyHistory: (guildId: string, driver: string) => Promise<IpcResult<DirtyHistory>>
    addDirtyReport: (guildId: string, input: DirtyReportInput) => Promise<IpcResult<DirtyReportResult>>
    removeDirtyReport: (guildId: string, driver: string, index: number) => Promise<IpcResult<DirtyRemoveResult>>

    // Attendance and sign-ups (milestone 4). Writes are sent once and never replayed.
    attendanceDivisions: (guildId: string) => Promise<IpcResult<AttendanceDivisions>>
    /** A list that is not in the input keeps its value on the server: pass only the lists the user edited. */
    saveAttendanceDivision: (guildId: string, input: DivisionInput) => Promise<IpcResult<DivisionResult>>
    attendancePosts: (guildId: string, filters?: AttendancePostFilters) => Promise<IpcResult<AttendancePostPage>>
    attendancePost: (guildId: string, messageId: string) => Promise<IpcResult<AttendancePost>>
    /** A lost answer may have posted the message in Discord: never repeat the call with the same data. */
    createAttendancePost: (guildId: string, input: AttendancePostInput) => Promise<IpcResult<AttendancePostResult>>
    signupQuestions: (guildId: string) => Promise<IpcResult<SignupQuestions>>
    /** Administrator only (403 admin_required). */
    saveSignupQuestions: (guildId: string, questions: string[]) => Promise<IpcResult<SignupQuestions>>
    signups: (guildId: string, status?: SignupStatus) => Promise<IpcResult<Signup[]>>
    signup: (guildId: string, signupId: string) => Promise<IpcResult<Signup>>
    /** Personal data: keep it in memory only. Never write it anywhere. */
    signupParticipants: (guildId: string, signupId: string, page?: { limit?: number; offset?: number }) => Promise<IpcResult<SignupParticipantPage>>
    /** A lost answer may have posted the panel in Discord: never repeat the call with the same data. */
    createSignup: (guildId: string, input: SignupInput) => Promise<IpcResult<SignupCreateResult>>
    closeSignup: (guildId: string, signupId: string) => Promise<IpcResult<SignupCloseResult>>
    removeParticipant: (guildId: string, signupId: string, userId: string) => Promise<IpcResult<ParticipantRemoveResult>>

    // Esports teams (milestone 5): every call carries the game, which is the {game} of the endpoint. Writes are sent once and never replayed.
    racingTeams: (guildId: string, game: RacingGame) => Promise<IpcResult<RacingTeam[]>>
    /** The roster is personal data of members: keep it in memory only, never write it anywhere. */
    racingTeam: (guildId: string, game: RacingGame, name: string) => Promise<IpcResult<RacingTeamDetail>>
    /** Needs Manage Server or Administrator (403 manage_server_required). A lost answer may already have created the Discord role: never repeat it with the same data. */
    createRacingTeam: (guildId: string, game: RacingGame, input: RacingTeamInput) => Promise<IpcResult<RacingTeamDetail>>
    addRosterMember: (guildId: string, game: RacingGame, input: RosterAddInput) => Promise<IpcResult<RosterAddResult>>
    removeRosterMember: (guildId: string, game: RacingGame, team: string, userId: string) => Promise<IpcResult<RosterRemoveResult>>
    racingDriver: (guildId: string, game: RacingGame, userId: string) => Promise<IpcResult<RacingDriverProfile>>
    racingEvents: (guildId: string, game: RacingGame, page?: { limit?: number; offset?: number }) => Promise<IpcResult<RacingEventPage>>
    addRacingEvent: (guildId: string, game: RacingGame, input: RacingEventInput) => Promise<IpcResult<RacingEvent>>

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
    /** Copies plain text to the clipboard (at most 4000 characters). Resolves false when it was refused. */
    copyText: (text: string) => Promise<boolean>
  }
}
