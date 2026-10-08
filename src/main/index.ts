import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, Menu, safeStorage, session } from 'electron'
import { IPC } from '../shared/ipc'
import { ApiClient } from './apiClient'
import { AuthService } from './auth'
import { API_BASE_URL, API_BACKOFF_MS, API_MAX_TRIES, API_TIMEOUT_MS, APP_ID, LOGIN_TIMEOUT_MS, WAKE_NOTICE_AFTER_MS } from './config'
import { openExternalChecked } from './external'
import { broadcast, registerIpc } from './ipc'
import { startLoopbackServer } from './loopback'
import { log } from './log'
import { createNexusApi } from './nexusApi'
import { hardenSession, hardenWebContents } from './security'
import { SettingsStore } from './settings'
import { ApiStatusTracker } from './status'
import { RefreshTokenStore } from './tokenStore'

/**
 * Development mode = launched by `electron-vite dev` (it sets ELECTRON_RENDERER_URL) AND
 * not packaged. A packaged app never honours that variable, so nobody can point an
 * installed Nexus (with its preload bridge) at an arbitrary page.
 */
const rendererDevUrl = process.env['ELECTRON_RENDERER_URL']
const isDev = !app.isPackaged && typeof rendererDevUrl === 'string' && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(rendererDevUrl)

const rendererIndexFile = join(__dirname, '../renderer/index.html')
const trustedUrlPrefix = isDev && rendererDevUrl ? rendererDevUrl : pathToFileURL(rendererIndexFile).href

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const iconPath = join(app.getAppPath(), 'build', 'icon.ico')

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    show: false, // shown on ready-to-show so there is no white flash
    backgroundColor: '#0a0a0a',
    title: 'Nexus',
    autoHideMenuBar: true,
    ...(isDev && existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.on('render-process-gone', (_event, details) => log.error(`renderer process gone (${details.reason})`))
  if (isDev) {
    // Surface renderer warnings/errors (e.g. CSP violations) in the terminal during development.
    window.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') log.warn(`renderer ${event.level}: ${event.message}`)
    })
  }
  window.on('closed', () => {
    mainWindow = null
  })

  if (isDev && rendererDevUrl) {
    void window.loadURL(rendererDevUrl)
  } else {
    void window.loadFile(rendererIndexFile)
  }
  return window
}

/** Builds the main-process services and wires them together. Tokens never leave this scope. */
function startServices(): void {
  const userData = app.getPath('userData')
  const tokenStore = new RefreshTokenStore(join(userData, 'session.bin'), safeStorage)
  const settings = new SettingsStore(join(userData, 'settings.json'))
  if (!tokenStore.canPersist()) log.warn('OS encryption is unavailable: the session will not be remembered after the app closes')

  const status = new ApiStatusTracker((value) => broadcast(IPC.apiStatusChanged, value))

  // auth <-> client reference each other (the client reports a dead session to auth).
  // eslint-disable-next-line prefer-const
  let auth: AuthService
  const client = new ApiClient({
    baseUrl: API_BASE_URL,
    timeoutMs: API_TIMEOUT_MS,
    wakeAfterMs: WAKE_NOTICE_AFTER_MS,
    maxTries: API_MAX_TRIES,
    backoffMs: API_BACKOFF_MS,
    persistRefreshToken: (token) => {
      tokenStore.save(token)
    },
    clearPersistedSession: () => tokenStore.clear(),
    onWaking: (active) => status.setWaking(active),
    onStatus: (value) => status.setBase(value),
    onSessionEnded: (reason) => auth.handleSessionEnded(reason)
  })
  const api = createNexusApi(client)

  auth = new AuthService({
    client,
    api,
    store: tokenStore,
    apiBaseUrl: API_BASE_URL,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    openExternal: openExternalChecked,
    startLoopback: startLoopbackServer,
    onState: (state) => broadcast(IPC.authStateChanged, state)
  })

  registerIpc({ auth, api, settings, isTrustedUrl: (url) => url.startsWith(trustedUrlPrefix) })
  void auth.restore()
}

// Single instance: a second launch just focuses the running window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, isDev))

  void app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID)
    if (!isDev) Menu.setApplicationMenu(null)
    hardenSession(session.defaultSession, isDev)
    startServices()
    mainWindow = createWindow()
    log.info(`ready (${isDev ? 'development' : 'production'})`)
  })

  app.on('window-all-closed', () => app.quit())
}
