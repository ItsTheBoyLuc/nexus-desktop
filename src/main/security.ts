import type { Session, WebContents } from 'electron'
import { buildDevCsp } from '../shared/csp'
import { openExternalChecked } from './external'
import { log } from './log'

/**
 * Session-wide hardening: no web permission is ever granted (camera, mic, geolocation,
 * notifications, ...), and in development the relaxed dev CSP is attached to the Vite
 * dev server's responses. Production gets its strict CSP from the <meta> tag that
 * electron.vite.config.ts injects into index.html.
 */
export function hardenSession(session: Session, isDev: boolean): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)

  if (isDev) {
    const csp = buildDevCsp()
    session.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
    })
  }
}

/** Applied to every WebContents (window, devtools, anything that appears later). */
export function hardenWebContents(contents: WebContents, isDev: boolean): void {
  // window.open / target=_blank: never open an in-app window. Allowlisted https links
  // go to the system browser instead; anything else is dropped.
  contents.setWindowOpenHandler(({ url }) => {
    openExternalChecked(url)
    return { action: 'deny' }
  })

  // The app is a single page (hash routing): any real navigation is an attack or a bug.
  const blockNavigation = (event: { preventDefault: () => void }): void => {
    event.preventDefault()
    log.warn('blocked an in-app navigation')
  }
  contents.on('will-navigate', blockNavigation)
  contents.on('will-redirect', blockNavigation)
  contents.on('will-attach-webview', blockNavigation)

  if (!isDev) {
    contents.on('devtools-opened', () => contents.closeDevTools())
  }
}
