/**
 * App updates (auto-update): the states the main process reports to the renderer, and the pure rules around them. Nothing here comes from
 * the renderer: it can only ask for "check", "download" and "install", it can never supply a URL, a feed or a version. Every text that comes
 * from the release (version, notes) is untrusted plain text.
 */

/** How often the silent check runs (it only checks and shows the badge; it never downloads). */
export const SILENT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** The first silent check waits a little after start, so it never competes with the sign-in and the first screens. */
export const SILENT_CHECK_FIRST_DELAY_MS = 20_000

/** Why an install is refused for now: a write (a save, a post, a delete) is on its way and the app never replays a write. */
export const INSTALL_BLOCKED_BY_WRITE = 'A save, post or delete is still in progress. Restarting now could cut it off. Wait a moment, then try again.'

export type UpdateState =
  /** The updater is off: not a packaged installed build (development, dev:mock, the portable build). Nothing is ever checked. */
  | { status: 'disabled'; currentVersion: string; reason: string }
  | { status: 'idle'; currentVersion: string }
  | { status: 'checking'; currentVersion: string }
  | { status: 'up-to-date'; currentVersion: string; checkedAt: string }
  | { status: 'available'; currentVersion: string; version: string; notes: string }
  | { status: 'downloading'; currentVersion: string; version: string; percent: number }
  /** Downloaded and verified. `installBlockedReason` is set while a write is in progress: the restart button is disabled with that reason. */
  | { status: 'ready'; currentVersion: string; version: string; installBlockedReason: string | null }
  /** `reason` is one of the fixed short labels of `classifyUpdateError` (never text from the failure itself). */
  | { status: 'error'; currentVersion: string; during: 'check' | 'download'; message: string; reason?: UpdateErrorReason }

export type UpdateStatus = UpdateState['status']

/** What the renderer may ask for. There is no argument: nothing it sends can change what is checked, downloaded or installed. */
export type UpdateCommand = 'check' | 'download' | 'install'

export const MAX_NOTES_LENGTH = 4000
const MAX_VERSION_LENGTH = 40

/** A plain release version (1.2.3, optionally with a pre-release suffix): anything else from a feed is not shown as a version. */
export function isPlainVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_VERSION_LENGTH && /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[0-9A-Za-z.-]{1,20})?$/.test(value)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/**
 * Release notes as PLAIN TEXT. GitHub gives them as HTML (or as a list of per-version notes): tags are removed, a few entities decoded,
 * list items become lines with a dash and the result is cut. The text is shown as text only, so nothing in it is ever interpreted.
 */
export function releaseNotesToText(notes: unknown): string {
  let raw = ''
  if (typeof notes === 'string') {
    raw = notes
  } else if (Array.isArray(notes)) {
    raw = notes
      .map((item) => (typeof item === 'object' && item !== null && typeof (item as { note?: unknown }).note === 'string' ? (item as { note: string }).note : ''))
      .filter((note) => note !== '')
      .join('\n\n')
  }
  const text = raw
    .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/ul|\/ol)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > MAX_NOTES_LENGTH ? `${text.slice(0, MAX_NOTES_LENGTH - 1)}…` : text
}

/** What decides whether the updater exists at all. Everything but a packaged, installed Windows build turns it off. */
export interface UpdaterEnvironment {
  isPackaged: boolean
  /** Launched by `electron-vite dev`. */
  isDev: boolean
  platform: string
  /** The portable build (it has no installer to replace itself with). */
  isPortable: boolean
}

export function updaterDisabledReason(env: UpdaterEnvironment): string | null {
  if (env.isDev || !env.isPackaged) return 'Updates are only checked in the installed app, not while the app is run from source.'
  if (env.platform !== 'win32') return 'Updates are only available for the Windows installer.'
  if (env.isPortable) return 'The portable build cannot update itself. Install the Windows installer to get updates.'
  return null
}

/** The phrase for the install button when it is off. */
export function describeUpdateError(during: 'check' | 'download'): string {
  return during === 'check'
    ? 'Could not check for updates. Check your internet connection and try again later. The app keeps working as it is.'
    : 'Could not download the update. Check your internet connection and try again. The app keeps working as it is.'
}

/**
 * Why an update failed, as a short fixed label. The labels are the only thing that reaches the screen: nothing of the failure itself (its
 * message, a URL, a response body) is ever shown, so a reason can never leak a secret or a URL with credentials.
 */
export type UpdateErrorReason =
  | 'No published release'
  | 'HTTP 404'
  | `HTTP ${number}`
  | 'No network'
  | 'Certificate error'
  | 'Bad update file'
  | 'Unknown error'

const NETWORK_CODES = /^(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EPIPE|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_NETWORK_ACCESS_DENIED|ERR_CONNECTION_\w+|ERR_TIMED_OUT|ERR_PROXY_\w+|ERR_TUNNEL_\w+)$/
const CERTIFICATE_CODES = /^(?:ERR_CERT_\w+|ERR_SSL_\w+|CERT_\w+|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT\w*|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_TLS_\w+)$/
const BAD_FILE_CODES = /^(?:ERR_CHECKSUM_MISMATCH|ERR_UPDATER_(?:INVALID_RELEASE_FEED|INVALID_UPDATE_INFO|INVALID_VERSION|NO_CHECKSUM|NO_FILES_PROVIDED|INVALID_SIGNATURE|ASSET_NOT_FOUND)|ERR_XML_\w+)$/
const NOT_FOUND_CODES = /^ERR_UPDATER_(?:CHANNEL_FILE_NOT_FOUND|LATEST_VERSION_NOT_FOUND|RELEASE_NOT_FOUND)$/

/**
 * Maps whatever the updater threw to a short label. Only the error's `code`, `name`, `statusCode` and (for Chromium's `net::ERR_...`) the
 * error token inside its message are looked at, and only to pick one of the fixed labels; the text itself is never copied anywhere.
 */
export function classifyUpdateError(error: unknown): UpdateErrorReason {
  if (typeof error !== 'object' || error === null) return 'Unknown error'
  const { code, name, statusCode, message } = error as { code?: unknown; name?: unknown; statusCode?: unknown; message?: unknown }
  if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) return statusCode === 404 ? 'HTTP 404' : `HTTP ${statusCode}`
  const codeText = typeof code === 'string' ? code : ''
  if (codeText === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS') return 'No published release'
  if (NOT_FOUND_CODES.test(codeText)) return 'HTTP 404'
  if (BAD_FILE_CODES.test(codeText) || name === 'YAMLException') return 'Bad update file'
  if (CERTIFICATE_CODES.test(codeText)) return 'Certificate error'
  if (NETWORK_CODES.test(codeText)) return 'No network'
  // Chromium's net stack (electron's `net`) puts its error in the message: "net::ERR_NAME_NOT_RESOLVED". Only the token is read.
  const net = typeof message === 'string' ? /net::(ERR_[A-Z_]{3,40})/.exec(message)?.[1] : undefined
  if (net !== undefined) {
    if (CERTIFICATE_CODES.test(net)) return 'Certificate error'
    if (NETWORK_CODES.test(net)) return 'No network'
  }
  return 'Unknown error'
}

/** The generic text plus the reason next to it, e.g. "Could not check for updates. ... (Reason: HTTP 404)". */
export function describeUpdateErrorWithReason(during: 'check' | 'download', reason: UpdateErrorReason | undefined): string {
  const text = describeUpdateError(during)
  return reason === undefined ? text : `${text} (Reason: ${reason})`
}
