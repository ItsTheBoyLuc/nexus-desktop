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
    getStatus: () => ipcRenderer.invoke(IPC.apiGetStatus),
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
