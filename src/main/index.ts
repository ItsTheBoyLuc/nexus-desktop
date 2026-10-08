import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, session } from 'electron'
import { APP_ID } from './config'
import { log } from './log'
import { hardenSession, hardenWebContents } from './security'

/**
 * Development mode = launched by `electron-vite dev` (it sets ELECTRON_RENDERER_URL) AND
 * not packaged. A packaged app never honours that variable, so nobody can point an
 * installed Nexus (with its preload bridge) at an arbitrary page.
 */
const rendererDevUrl = process.env['ELECTRON_RENDERER_URL']
const isDev = !app.isPackaged && typeof rendererDevUrl === 'string' && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(rendererDevUrl)

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
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
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
    mainWindow = createWindow()
    log.info(`ready (${isDev ? 'development' : 'production'})`)
  })

  app.on('window-all-closed', () => app.quit())
}
