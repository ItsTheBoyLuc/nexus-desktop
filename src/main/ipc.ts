import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { ApiErrorInfo, IpcResult } from '../shared/types'
import { isValidSnowflake, validateAnnouncement } from '../shared/validation'
import { ApiError } from './apiClient'
import type { AuthService } from './auth'
import { openExternalChecked } from './external'
import { log } from './log'
import type { NexusApi } from './nexusApi'
import type { SettingsStore } from './settings'

export interface IpcDeps {
  auth: AuthService
  api: NexusApi
  settings: SettingsStore
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

  handle(IPC.settingsGet, () => deps.settings.get())
  handle(IPC.settingsSet, (patch) => deps.settings.set(patch))

  handle(IPC.openExternal, (url) => openExternalChecked(url))
}
