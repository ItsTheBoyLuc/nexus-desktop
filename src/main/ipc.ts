import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { parseGameInput, parsePanelRequest, parseSettingsInput, parseTierCreateInput, parseTierUpdateInput } from '../shared/inputs'
import type { Parsed } from '../shared/inputs'
import { IPC } from '../shared/ipc'
import type { ApiErrorInfo, ApiStatus, IpcResult } from '../shared/types'
import { isValidKey, isValidSnowflake, validateAnnouncement } from '../shared/validation'
import { ApiError } from './apiClient'
import type { AuthService } from './auth'
import { openExternalChecked } from './external'
import { log } from './log'
import type { NexusApi } from './nexusApi'
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

  handle(IPC.apiGetStatus, () => deps.getApiStatus())

  handle(IPC.settingsGet, () => deps.settings.get())
  handle(IPC.settingsSet, (patch) => deps.settings.set(patch))

  handle(IPC.openExternal, (url) => openExternalChecked(url))
}
