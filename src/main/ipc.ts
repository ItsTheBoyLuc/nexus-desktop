import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import {
  parseAddDriverInput,
  parseCalendarPostRequest,
  parseGameInput,
  parseMemberSearchQuery,
  parsePanelRequest,
  parsePointsSystemInput,
  parseResultsInput,
  parseRoundCreateInput,
  parseRoundNumber,
  parseRoundPatch,
  parseSettingsInput,
  parseTeamInput,
  parseTeamPathName,
  parseTierCreateInput,
  parseTierUpdateInput
} from '../shared/inputs'
import type { Parsed } from '../shared/inputs'
import { IPC } from '../shared/ipc'
import {
  parseAdvanceInput,
  parseBanInput,
  parseClearInput,
  parseDecisionInput,
  parseDirtyReportInput,
  parseDriverName,
  parseLedgerQuery,
  parseManualPointsInput,
  parseOptionalSeason,
  parsePenaltySettingsInput,
  parseReportFiltersInput,
  parseReportId,
  parseReportIndex,
  parseReportOverviewQuery
} from '../shared/penaltyInputs'
import type { ApiErrorInfo, ApiStatus, IpcResult } from '../shared/types'
import { isValidKey, isValidSnowflake, validateAnnouncement } from '../shared/validation'
import { ApiError } from './apiClient'
import type { AuthService } from './auth'
import { copyTextChecked } from './clipboard'
import { openExternalChecked } from './external'
import { log } from './log'
import type { NexusApi } from './nexusApi'
import { postCalendarAndRemember, recordResultsAndLog } from './f1Service'
import { deleteGameAndForget, deleteTierAndForget, postPanelAndRemember } from './panelService'
import type { SettingsStore } from './settings'

export interface IpcDeps {
  auth: AuthService
  api: NexusApi
  settings: SettingsStore
  getApiStatus: () => ApiStatus
  /** True only for frames of our own renderer (dev server URL or the packaged index.html). */
  isTrustedUrl: (url: string) => boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function validationError(message: string, code = 'invalid_input'): ApiErrorInfo {
  return { kind: 'validation', code, message }
}

async function toResult<T>(run: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.toInfo() }
    log.error('unexpected error while handling an API request', error)
    return { ok: false, error: { kind: 'unexpected', code: 'unexpected', message: 'Something went wrong. Please try again.' } }
  }
}

/** Send an event to every renderer window. */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export function registerIpc(deps: IpcDeps): void {
  const handle = <R>(channel: string, fn: (...args: unknown[]) => Promise<R> | R): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      // Defence in depth: only our own page may call into the main process.
      if (!deps.isTrustedUrl(event.senderFrame?.url ?? '')) {
        log.warn('rejected an IPC call from an untrusted frame')
        throw new Error('Untrusted sender')
      }
      return fn(...args)
    })
  }

  // The renderer is not trusted to have validated anything: every argument is re-checked here.
  const withGuild = <T>(guildId: unknown, run: (id: string) => Promise<T>): Promise<IpcResult<T>> =>
    isValidSnowflake(guildId)
      ? toResult(() => run(guildId))
      : Promise.resolve({ ok: false, error: validationError('That server ID is not valid.', 'invalid_guild_id') })

  handle(IPC.authGetState, () => deps.auth.getState())
  handle(IPC.authLogin, () => deps.auth.login())
  handle(IPC.authCancel, () => deps.auth.cancelLogin())
  handle(IPC.authRetry, () => deps.auth.restore())
  handle(IPC.authLogout, () => deps.auth.logout())

  handle(IPC.apiMe, () => toResult(() => deps.api.me()))
  handle(IPC.apiGuilds, () => toResult(() => deps.api.guilds()))
  handle(IPC.apiGames, (guildId) => withGuild(guildId, (id) => deps.api.games(id)))
  handle(IPC.apiChannels, (guildId) => withGuild(guildId, (id) => deps.api.channels(id)))
  handle(IPC.apiAnnouncement, (guildId, input) =>
    withGuild(guildId, async (id) => {
      const record = isRecord(input) ? input : {}
      const checked = validateAnnouncement({
        title: typeof record['title'] === 'string' ? record['title'] : '',
        message: typeof record['message'] === 'string' ? record['message'] : '',
        channelId: typeof record['channelId'] === 'string' ? record['channelId'] : '',
        imageUrl: typeof record['imageUrl'] === 'string' ? record['imageUrl'] : ''
      })
      if (!checked.ok) {
        throw new ApiError({
          kind: 'validation',
          code: 'invalid_input',
          message: Object.values(checked.errors)[0] ?? 'Check the announcement and try again.',
          mayHaveBeenSent: false
        })
      }
      return deps.api.postAnnouncement(id, checked.value)
    })
  )

  // The renderer is not trusted to have validated keys or form input either: re-check, then call the API.
  const rejectInput = (message: string): never => {
    throw new ApiError({ kind: 'validation', code: 'invalid_input', message, mayHaveBeenSent: false })
  }
  const valid = <T>(parsed: Parsed<T>): T => (parsed.ok ? parsed.value : rejectInput(parsed.message))
  const gameKeyOf = (value: unknown): string => (isValidKey(value) ? value : rejectInput('That game key is not valid.'))
  const tierKeyOf = (value: unknown): string => (isValidKey(value) ? value : rejectInput('That tier key is not valid.'))

  handle(IPC.apiRoles, (guildId) => withGuild(guildId, (id) => deps.api.roles(id)))
  handle(IPC.apiOverview, (guildId) => withGuild(guildId, (id) => deps.api.overview(id)))
  handle(IPC.apiServerSettingsGet, (guildId) => withGuild(guildId, (id) => deps.api.serverSettings(id)))
  handle(IPC.apiServerSettingsPut, (guildId, input) =>
    withGuild(guildId, (id) => deps.api.saveServerSettings(id, valid(parseSettingsInput(input))))
  )

  handle(IPC.apiLeagueGames, (guildId) => withGuild(guildId, (id) => deps.api.leagueGames(id)))
  handle(IPC.apiGameCreate, (guildId, input) => withGuild(guildId, (id) => deps.api.createGame(id, valid(parseGameInput(input)))))
  handle(IPC.apiGameSetActive, (guildId, gameKey, active) =>
    withGuild(guildId, (id) =>
      typeof active === 'boolean' ? deps.api.setGameActive(id, gameKeyOf(gameKey), active) : rejectInput('Choose whether the game is on or off.')
    )
  )
  handle(IPC.apiGameDelete, (guildId, gameKey) =>
    withGuild(guildId, async (id) => {
      await deleteGameAndForget(deps.api, deps.settings, id, gameKeyOf(gameKey))
      return null
    })
  )
  handle(IPC.apiTierCreate, (guildId, gameKey, input) =>
    withGuild(guildId, (id) => deps.api.createTier(id, gameKeyOf(gameKey), valid(parseTierCreateInput(input))))
  )
  handle(IPC.apiTierUpdate, (guildId, gameKey, tierKey, input) =>
    withGuild(guildId, (id) => deps.api.updateTier(id, gameKeyOf(gameKey), tierKeyOf(tierKey), valid(parseTierUpdateInput(input))))
  )
  handle(IPC.apiTierDelete, (guildId, gameKey, tierKey) =>
    withGuild(guildId, async (id) => {
      await deleteTierAndForget(deps.api, deps.settings, id, gameKeyOf(gameKey), tierKeyOf(tierKey))
      return null
    })
  )
  handle(IPC.apiPostPanel, (guildId, gameKey, tierKey, input) =>
    withGuild(guildId, (id) =>
      postPanelAndRemember(deps.api, deps.settings, id, gameKeyOf(gameKey), tierKeyOf(tierKey), valid(parsePanelRequest(input)))
    )
  )

  // F1 league (milestone 2). Same rule: every argument is re-checked here before it can reach the API.
  const userIdOf = (value: unknown): string => (isValidSnowflake(value) ? value : rejectInput('That member ID is not valid.'))

  handle(IPC.apiMembers, (guildId, query) => withGuild(guildId, (id) => deps.api.members(id, valid(parseMemberSearchQuery(query)))))
  handle(IPC.apiCalendar, (guildId) => withGuild(guildId, (id) => deps.api.calendar(id)))
  handle(IPC.apiRoundCreate, (guildId, input) => withGuild(guildId, (id) => deps.api.createRound(id, valid(parseRoundCreateInput(input)))))
  handle(IPC.apiRoundUpdate, (guildId, round, patch) =>
    withGuild(guildId, (id) => deps.api.updateRound(id, valid(parseRoundNumber(round)), valid(parseRoundPatch(patch))))
  )
  handle(IPC.apiRoundDelete, (guildId, round) => withGuild(guildId, (id) => deps.api.deleteRound(id, valid(parseRoundNumber(round)))))
  handle(IPC.apiCalendarPost, (guildId, input) =>
    withGuild(guildId, (id) => postCalendarAndRemember(deps.api, deps.settings, id, valid(parseCalendarPostRequest(input))))
  )
  handle(IPC.apiNextRace, (guildId) => withGuild(guildId, (id) => deps.api.nextRace(id)))

  handle(IPC.apiTeams, (guildId) => withGuild(guildId, (id) => deps.api.teams(id)))
  handle(IPC.apiTeamCreate, (guildId, input) => withGuild(guildId, (id) => deps.api.createTeam(id, valid(parseTeamInput(input)))))
  handle(IPC.apiDriverAdd, (guildId, teamName, input) =>
    withGuild(guildId, (id) => deps.api.addDriver(id, valid(parseTeamPathName(teamName)), valid(parseAddDriverInput(input))))
  )
  handle(IPC.apiDriverRemove, (guildId, teamName, userId) =>
    withGuild(guildId, (id) => deps.api.removeDriver(id, valid(parseTeamPathName(teamName)), userIdOf(userId)))
  )
  handle(IPC.apiDriver, (guildId, userId) => withGuild(guildId, (id) => deps.api.driver(id, userIdOf(userId))))

  handle(IPC.apiStandings, (guildId) => withGuild(guildId, (id) => deps.api.standings(id)))
  handle(IPC.apiResultsRecord, (guildId, input) =>
    withGuild(guildId, (id) => recordResultsAndLog(deps.api, deps.settings, id, valid(parseResultsInput(input))))
  )
  handle(IPC.apiPointsSystemGet, (guildId) => withGuild(guildId, (id) => deps.api.pointsSystem(id)))
  handle(IPC.apiPointsSystemPut, (guildId, input) =>
    withGuild(guildId, (id) => deps.api.savePointsSystem(id, valid(parsePointsSystemInput(input))))
  )

  handle(IPC.apiResultsLedger, (guildId, query) => withGuild(guildId, (id) => deps.api.resultsLedger(id, valid(parseLedgerQuery(query)))))

  // Reports, penalties and dirty drivers (milestone 3). Same rule: re-checked here, and every write goes out once.
  handle(IPC.apiReports, (guildId, filters) => withGuild(guildId, (id) => deps.api.reports(id, valid(parseReportFiltersInput(filters)))))
  handle(IPC.apiReportRounds, (guildId) => withGuild(guildId, (id) => deps.api.reportRounds(id)))
  handle(IPC.apiReportRound, (guildId, season, round) =>
    withGuild(guildId, (id) => {
      const query = valid(parseReportOverviewQuery({ season, round }))
      return query ? deps.api.reportRound(id, query.season, query.round) : rejectInput('Give both the season and the round.')
    })
  )
  handle(IPC.apiReport, (guildId, reportId) => withGuild(guildId, (id) => deps.api.report(id, valid(parseReportId(reportId)))))
  handle(IPC.apiReportDecide, (guildId, reportId, input) =>
    withGuild(guildId, (id) => deps.api.decideReport(id, valid(parseReportId(reportId)), valid(parseDecisionInput(input))))
  )

  handle(IPC.apiPenaltySettingsGet, (guildId) => withGuild(guildId, (id) => deps.api.penaltySettings(id)))
  handle(IPC.apiPenaltySettingsPut, (guildId, input) => withGuild(guildId, (id) => deps.api.savePenaltySettings(id, valid(parsePenaltySettingsInput(input)))))
  handle(IPC.apiPenaltyOverview, (guildId, season) => withGuild(guildId, (id) => deps.api.penaltyOverview(id, valid(parseOptionalSeason(season)))))
  handle(IPC.apiPenaltyHistory, (guildId, driver, season) =>
    withGuild(guildId, (id) => deps.api.penaltyHistory(id, valid(parseDriverName(driver)), valid(parseOptionalSeason(season))))
  )
  handle(IPC.apiPenaltyPoints, (guildId, input) => withGuild(guildId, (id) => deps.api.addPenaltyPoints(id, valid(parseManualPointsInput(input)))))
  handle(IPC.apiPenaltyClear, (guildId, input) => withGuild(guildId, (id) => deps.api.clearPenaltyPoints(id, valid(parseClearInput(input)))))
  handle(IPC.apiPenaltyBan, (guildId, input) => withGuild(guildId, (id) => deps.api.setBan(id, valid(parseBanInput(input)))))
  handle(IPC.apiPenaltyAdvance, (guildId, input) => withGuild(guildId, (id) => deps.api.advanceRace(id, valid(parseAdvanceInput(input)))))

  handle(IPC.apiDirtyList, (guildId) => withGuild(guildId, (id) => deps.api.dirtyDrivers(id)))
  handle(IPC.apiDirtyHistory, (guildId, driver) => withGuild(guildId, (id) => deps.api.dirtyHistory(id, valid(parseDriverName(driver)))))
  handle(IPC.apiDirtyAdd, (guildId, input) => withGuild(guildId, (id) => deps.api.addDirtyReport(id, valid(parseDirtyReportInput(input)))))
  handle(IPC.apiDirtyRemove, (guildId, driver, index) =>
    withGuild(guildId, (id) => deps.api.removeDirtyReport(id, valid(parseDriverName(driver)), valid(parseReportIndex(index))))
  )

  handle(IPC.apiGetStatus, () => deps.getApiStatus())

  handle(IPC.settingsGet, () => deps.settings.get())
  handle(IPC.settingsSet, (patch) => deps.settings.set(patch))

  handle(IPC.openExternal, (url) => openExternalChecked(url))
  handle(IPC.copyText, (text) => copyTextChecked(text))
}
