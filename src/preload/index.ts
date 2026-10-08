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
    postAnnouncement: (guildId, input) => ipcRenderer.invoke(IPC.apiAnnouncement, guildId, input),
    onStatusChange: (callback) => subscribe<ApiStatus>(IPC.apiStatusChanged, callback)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  system: {
    openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url)
  }
}

contextBridge.exposeInMainWorld('nexus', bridge)
