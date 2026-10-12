import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { NexusBridge, Unsubscribe } from '../shared/bridge'
import { IPC } from '../shared/ipc'
import type { ApiStatus, AuthState } from '../shared/types'

/**
 * The renderer's entire view of the main process. Only these typed functions are exposed:
 * no ipcRenderer, no generic invoke/send, and no tokens (they never leave the main process).
 */
function subscribe<T>(channel: string, callback: (value: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const bridge: NexusBridge = {
  auth: {
    getState: () => ipcRenderer.invoke(IPC.authGetState),
    login: () => ipcRenderer.invoke(IPC.authLogin),
    cancelLogin: () => ipcRenderer.invoke(IPC.authCancel),
    retrySession: () => ipcRenderer.invoke(IPC.authRetry),
    logout: () => ipcRenderer.invoke(IPC.authLogout),
    onStateChange: (callback) => subscribe<AuthState>(IPC.authStateChanged, callback)
  },
  api: {
    me: () => ipcRenderer.invoke(IPC.apiMe),
    guilds: () => ipcRenderer.invoke(IPC.apiGuilds),
    games: (guildId) => ipcRenderer.invoke(IPC.apiGames, guildId),
    channels: (guildId) => ipcRenderer.invoke(IPC.apiChannels, guildId),
    roles: (guildId) => ipcRenderer.invoke(IPC.apiRoles, guildId),
    overview: (guildId) => ipcRenderer.invoke(IPC.apiOverview, guildId),
    serverSettings: (guildId) => ipcRenderer.invoke(IPC.apiServerSettingsGet, guildId),
    saveServerSettings: (guildId, input) => ipcRenderer.invoke(IPC.apiServerSettingsPut, guildId, input),
    leagueGames: (guildId) => ipcRenderer.invoke(IPC.apiLeagueGames, guildId),
    createGame: (guildId, input) => ipcRenderer.invoke(IPC.apiGameCreate, guildId, input),
    setGameActive: (guildId, gameKey, active) => ipcRenderer.invoke(IPC.apiGameSetActive, guildId, gameKey, active),
    deleteGame: (guildId, gameKey) => ipcRenderer.invoke(IPC.apiGameDelete, guildId, gameKey),
    createTier: (guildId, gameKey, input) => ipcRenderer.invoke(IPC.apiTierCreate, guildId, gameKey, input),
    updateTier: (guildId, gameKey, tierKey, input) => ipcRenderer.invoke(IPC.apiTierUpdate, guildId, gameKey, tierKey, input),
    deleteTier: (guildId, gameKey, tierKey) => ipcRenderer.invoke(IPC.apiTierDelete, guildId, gameKey, tierKey),
    postPanel: (guildId, gameKey, tierKey, input) => ipcRenderer.invoke(IPC.apiPostPanel, guildId, gameKey, tierKey, input),
    postAnnouncement: (guildId, input) => ipcRenderer.invoke(IPC.apiAnnouncement, guildId, input),
    members: (guildId, query) => ipcRenderer.invoke(IPC.apiMembers, guildId, query),
    calendar: (guildId) => ipcRenderer.invoke(IPC.apiCalendar, guildId),
    createRound: (guildId, input) => ipcRenderer.invoke(IPC.apiRoundCreate, guildId, input),
    updateRound: (guildId, round, patch) => ipcRenderer.invoke(IPC.apiRoundUpdate, guildId, round, patch),
    deleteRound: (guildId, round) => ipcRenderer.invoke(IPC.apiRoundDelete, guildId, round),
    postCalendar: (guildId, input) => ipcRenderer.invoke(IPC.apiCalendarPost, guildId, input),
    nextRace: (guildId) => ipcRenderer.invoke(IPC.apiNextRace, guildId),
    teams: (guildId) => ipcRenderer.invoke(IPC.apiTeams, guildId),
    createTeam: (guildId, input) => ipcRenderer.invoke(IPC.apiTeamCreate, guildId, input),
    addDriver: (guildId, teamName, input) => ipcRenderer.invoke(IPC.apiDriverAdd, guildId, teamName, input),
    removeDriver: (guildId, teamName, userId) => ipcRenderer.invoke(IPC.apiDriverRemove, guildId, teamName, userId),
    driver: (guildId, userId) => ipcRenderer.invoke(IPC.apiDriver, guildId, userId),
    standings: (guildId) => ipcRenderer.invoke(IPC.apiStandings, guildId),
    recordResults: (guildId, input) => ipcRenderer.invoke(IPC.apiResultsRecord, guildId, input),
    pointsSystem: (guildId) => ipcRenderer.invoke(IPC.apiPointsSystemGet, guildId),
    savePointsSystem: (guildId, input) => ipcRenderer.invoke(IPC.apiPointsSystemPut, guildId, input),
    resultsLedger: (guildId, query) => ipcRenderer.invoke(IPC.apiResultsLedger, guildId, query),
    reports: (guildId, filters) => ipcRenderer.invoke(IPC.apiReports, guildId, filters),
    reportRounds: (guildId) => ipcRenderer.invoke(IPC.apiReportRounds, guildId),
    reportRound: (guildId, season, round) => ipcRenderer.invoke(IPC.apiReportRound, guildId, season, round),
    report: (guildId, reportId) => ipcRenderer.invoke(IPC.apiReport, guildId, reportId),
    decideReport: (guildId, reportId, input) => ipcRenderer.invoke(IPC.apiReportDecide, guildId, reportId, input),
    penaltySettings: (guildId) => ipcRenderer.invoke(IPC.apiPenaltySettingsGet, guildId),
    savePenaltySettings: (guildId, input) => ipcRenderer.invoke(IPC.apiPenaltySettingsPut, guildId, input),
    penaltyOverview: (guildId, season) => ipcRenderer.invoke(IPC.apiPenaltyOverview, guildId, season),
    penaltyHistory: (guildId, driver, season) => ipcRenderer.invoke(IPC.apiPenaltyHistory, guildId, driver, season),
    addPenaltyPoints: (guildId, input) => ipcRenderer.invoke(IPC.apiPenaltyPoints, guildId, input),
    clearPenaltyPoints: (guildId, input) => ipcRenderer.invoke(IPC.apiPenaltyClear, guildId, input),
    setBan: (guildId, input) => ipcRenderer.invoke(IPC.apiPenaltyBan, guildId, input),
    advanceRace: (guildId, input) => ipcRenderer.invoke(IPC.apiPenaltyAdvance, guildId, input),
    dirtyDrivers: (guildId) => ipcRenderer.invoke(IPC.apiDirtyList, guildId),
    dirtyHistory: (guildId, driver) => ipcRenderer.invoke(IPC.apiDirtyHistory, guildId, driver),
    addDirtyReport: (guildId, input) => ipcRenderer.invoke(IPC.apiDirtyAdd, guildId, input),
    removeDirtyReport: (guildId, driver, index) => ipcRenderer.invoke(IPC.apiDirtyRemove, guildId, driver, index),
    attendanceDivisions: (guildId) => ipcRenderer.invoke(IPC.apiAttendanceDivisions, guildId),
    saveAttendanceDivision: (guildId, input) => ipcRenderer.invoke(IPC.apiAttendanceDivisionSave, guildId, input),
    attendancePosts: (guildId, filters) => ipcRenderer.invoke(IPC.apiAttendancePosts, guildId, filters),
    attendancePost: (guildId, messageId) => ipcRenderer.invoke(IPC.apiAttendancePost, guildId, messageId),
    createAttendancePost: (guildId, input) => ipcRenderer.invoke(IPC.apiAttendancePostCreate, guildId, input),
    signupQuestions: (guildId) => ipcRenderer.invoke(IPC.apiSignupQuestionsGet, guildId),
    saveSignupQuestions: (guildId, questions) => ipcRenderer.invoke(IPC.apiSignupQuestionsPut, guildId, questions),
    signups: (guildId, status) => ipcRenderer.invoke(IPC.apiSignups, guildId, status),
    signup: (guildId, signupId) => ipcRenderer.invoke(IPC.apiSignup, guildId, signupId),
    signupParticipants: (guildId, signupId, page) => ipcRenderer.invoke(IPC.apiSignupParticipants, guildId, signupId, page),
    createSignup: (guildId, input) => ipcRenderer.invoke(IPC.apiSignupCreate, guildId, input),
    closeSignup: (guildId, signupId) => ipcRenderer.invoke(IPC.apiSignupClose, guildId, signupId),
    removeParticipant: (guildId, signupId, userId) => ipcRenderer.invoke(IPC.apiSignupParticipantRemove, guildId, signupId, userId),
    racingTeams: (guildId, game) => ipcRenderer.invoke(IPC.apiRacingTeams, guildId, game),
    racingTeam: (guildId, game, name) => ipcRenderer.invoke(IPC.apiRacingTeam, guildId, game, name),
    createRacingTeam: (guildId, game, input) => ipcRenderer.invoke(IPC.apiRacingTeamCreate, guildId, game, input),
    addRosterMember: (guildId, game, input) => ipcRenderer.invoke(IPC.apiRacingRosterAdd, guildId, game, input),
    removeRosterMember: (guildId, game, team, userId) => ipcRenderer.invoke(IPC.apiRacingRosterRemove, guildId, game, team, userId),
    racingDriver: (guildId, game, userId) => ipcRenderer.invoke(IPC.apiRacingDriver, guildId, game, userId),
    racingEvents: (guildId, game, page) => ipcRenderer.invoke(IPC.apiRacingEvents, guildId, game, page),
    addRacingEvent: (guildId, game, input) => ipcRenderer.invoke(IPC.apiRacingEventAdd, guildId, game, input),
    racingResults: (guildId, game, query) => ipcRenderer.invoke(IPC.apiRacingResults, guildId, game, query),
    racingAttendance: (guildId, game, page) => ipcRenderer.invoke(IPC.apiRacingAttendance, guildId, game, page),
    racingAttendancePost: (guildId, game, messageId) => ipcRenderer.invoke(IPC.apiRacingAttendancePost, guildId, game, messageId),
    racingTeamRoles: (guildId, game) => ipcRenderer.invoke(IPC.apiRacingTeamRoles, guildId, game),
    postRacingTeam: (guildId, game, input) => ipcRenderer.invoke(IPC.apiRacingTeamPost, guildId, game, input),
    postRacingEvent: (guildId, game, input) => ipcRenderer.invoke(IPC.apiRacingEventPost, guildId, game, input),
    postRacingResult: (guildId, game, input) => ipcRenderer.invoke(IPC.apiRacingResultPost, guildId, game, input),
    createRacingAttendance: (guildId, game, input) => ipcRenderer.invoke(IPC.apiRacingAttendanceCreate, guildId, game, input),
    postRacingAnnouncement: (guildId, game, input) => ipcRenderer.invoke(IPC.apiRacingAnnouncement, guildId, game, input),
    logRacingResult: (guildId, game, input) => ipcRenderer.invoke(IPC.apiRacingResultLog, guildId, game, input),
    getStatus: () => ipcRenderer.invoke(IPC.apiGetStatus),
    onStatusChange: (callback) => subscribe<ApiStatus>(IPC.apiStatusChanged, callback)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
    rememberPostChannel: (guildId, game, channelId) => ipcRenderer.invoke(IPC.settingsRememberPostChannel, guildId, game, channelId)
  },
  system: {
    openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
    copyText: (text) => ipcRenderer.invoke(IPC.copyText, text)
  }
}

contextBridge.exposeInMainWorld('nexus', bridge)
