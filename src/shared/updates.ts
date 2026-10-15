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
  | { status: 'error'; currentVersion: string; during: 'check' | 'download'; message: string }

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
