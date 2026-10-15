import { classifyUpdateError, describeUpdateError, INSTALL_BLOCKED_BY_WRITE, isPlainVersion, releaseNotesToText, SILENT_CHECK_FIRST_DELAY_MS, SILENT_CHECK_INTERVAL_MS } from '../shared/updates'
import type { UpdateCommand, UpdateState } from '../shared/updates'
import { log } from './log'

/**
 * The part of electron-updater's `AppUpdater` this app uses. The real one is created in `electronUpdater.ts` and only when the updater is
 * enabled; the tests use a fake one. Everything the updater reports is treated as untrusted: versions are checked, notes become plain text, and
 * error details are never shown or logged (they can contain URLs or response bodies).
 */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  on: (event: UpdaterEvent, listener: (...args: unknown[]) => void) => unknown
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
}

export type UpdaterEvent = 'checking-for-update' | 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error'

export interface UpdateServiceOptions {
  currentVersion: string
  /** Null: the updater is on. Text: why it is off. When it is off `loadUpdater` is never called: nothing of electron-updater is even loaded. */
  disabledReason: string | null
  loadUpdater: () => Promise<UpdaterLike>
  /** How many writes (a save, a post, a delete) are on their way. Restarting while it is above 0 could cut one off; the app never replays a write. */
  writesInFlight: () => number
  onState: (state: UpdateState) => void
  /** Injected so the tests can run the schedule without waiting. */
  timers?: {
    setTimeout: (callback: () => void, ms: number) => unknown
    setInterval: (callback: () => void, ms: number) => unknown
    clear: (handle: unknown) => void
  }
  now?: () => Date
}

const realTimers = {
  setTimeout: (callback: () => void, ms: number): unknown => {
    const handle = setTimeout(callback, ms)
    handle.unref()
    return handle
  },
  setInterval: (callback: () => void, ms: number): unknown => {
    const handle = setInterval(callback, ms)
    handle.unref()
    return handle
  },
  clear: (handle: unknown): void => clearTimeout(handle as NodeJS.Timeout)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The state machine of the app updates, in the main process only.
 *
 *   idle -> checking -> up-to-date | available | error
 *   available -> downloading -> ready | error          (only after the user asked for it: nothing is ever downloaded by itself)
 *   ready -> (restart and install)                      (refused while a write is in progress)
 *
 * The renderer can only ask for `check`, `download` and `install`, with no argument: it can never supply a URL, a feed or a version. The silent
 * check (a little after start and every 6 hours) only checks. A failed check or download is a state, never an exception: the app keeps working.
 * The integrity of the download is electron-updater's own sha512 check against the release's `latest.yml`; nothing here weakens it.
 */
export class UpdateService {
  private state: UpdateState
  private updater: UpdaterLike | null = null
  private loading: Promise<UpdaterLike | null> | null = null
  private checking: Promise<void> | null = null
  private silentCheck = false
  private downloading: Promise<void> | null = null
  private installing = false
  private timers: { first: unknown; every: unknown } | null = null
  private lastPercent = -1

  constructor(private readonly options: UpdateServiceOptions) {
    this.state = options.disabledReason === null ? { status: 'idle', currentVersion: options.currentVersion } : { status: 'disabled', currentVersion: options.currentVersion, reason: options.disabledReason }
  }

  getState(): UpdateState {
    return this.state
  }

  /** Runs one of the three commands the renderer may ask for and answers with the state afterwards. Never throws. */
  async run(command: UpdateCommand): Promise<UpdateState> {
    try {
      if (command === 'check') await this.check(false)
      else if (command === 'download') await this.download()
      else this.install()
    } catch (error) {
      // Every path below catches its own errors; this is only a net so an updater problem can never reach the app.
      log.warn('update command failed', error)
    }
    return this.state
  }

  /** The silent checks: one a little after start and one every 6 hours. They only check. A disabled updater schedules nothing. */
  start(): void {
    if (this.options.disabledReason !== null || this.timers !== null) return
    const timers = this.options.timers ?? realTimers
    this.timers = {
      first: timers.setTimeout(() => void this.check(true), SILENT_CHECK_FIRST_DELAY_MS),
      every: timers.setInterval(() => void this.check(true), SILENT_CHECK_INTERVAL_MS)
    }
  }

  stop(): void {
    if (!this.timers) return
    const timers = this.options.timers ?? realTimers
    timers.clear(this.timers.first)
    timers.clear(this.timers.every)
    this.timers = null
  }

  /** Call when the number of writes in flight changed: a ready update shows (or loses) the reason why the restart is off. */
  notifyWritesChanged(): void {
    if (this.state.status !== 'ready') return
    const reason = this.blockedReason()
    if (reason !== this.state.installBlockedReason) this.set({ ...this.state, installBlockedReason: reason })
  }

  // ── Check ─────────────────────────────────────────────────────────────────

  private async check(silent: boolean): Promise<void> {
    if (this.options.disabledReason !== null) return
    const status = this.state.status
    if (status === 'downloading' || status === 'ready' || this.installing) return
    if (this.checking) {
      // A manual check that arrives during a silent one shows the progress from now on.
      if (!silent && this.silentCheck) {
        this.silentCheck = false
        this.set({ status: 'checking', currentVersion: this.options.currentVersion })
      }
      return this.checking
    }
    this.silentCheck = silent
    const before = this.state
    if (!silent) this.set({ status: 'checking', currentVersion: this.options.currentVersion })
    this.checking = this.doCheck(before).finally(() => {
      this.checking = null
      this.silentCheck = false
    })
    return this.checking
  }

  private async doCheck(before: UpdateState): Promise<void> {
    const updater = await this.load()
    if (!updater) return this.failCheck(before)
    try {
      const result: unknown = await updater.checkForUpdates()
      // The events usually have answered already. If not, the result of the call decides, and an unreadable one is an error, never "up to date".
      if (this.isChecking(before)) {
        if (isRecord(result) && result['isUpdateAvailable'] === true && isRecord(result['updateInfo'])) this.onAvailable(result['updateInfo'])
        else if (isRecord(result) && result['isUpdateAvailable'] === false) this.onNotAvailable()
        else this.failCheck(before)
      }
    } catch (error) {
      log.warn(`update check failed (${classifyUpdateError(error)})`, error)
      this.failCheck(before, error)
    }
  }

  /** Still waiting for an answer: a manual check shows `checking`; a silent one has not changed the state at all. */
  private isChecking(before: UpdateState): boolean {
    return this.state.status === 'checking' || (this.silentCheck && this.state === before)
  }

  private failCheck(before: UpdateState, error?: unknown): void {
    if (this.silentCheck) {
      // Nobody asked: a failed silent check changes nothing on screen.
      if (this.state.status === 'checking') this.set(before)
      return
    }
    if (this.state.status !== 'checking') return
    this.set({ status: 'error', currentVersion: this.options.currentVersion, during: 'check', message: describeUpdateError('check'), reason: classifyUpdateError(error) })
  }

  private onAvailable(info: unknown): void {
    // Only an answer to a check that is running counts; an unsolicited event changes nothing.
    if (!this.checking) return
    if (this.state.status === 'downloading' || this.state.status === 'ready') return
    const version = isRecord(info) ? info['version'] : undefined
    if (!isPlainVersion(version)) {
      log.warn('the update information had no usable version')
      this.failCheck(this.state)
      return
    }
    if (version === this.options.currentVersion) return this.onNotAvailable()
    this.set({ status: 'available', currentVersion: this.options.currentVersion, version, notes: releaseNotesToText(isRecord(info) ? info['releaseNotes'] : undefined) })
  }

  private onNotAvailable(): void {
    if (!this.checking) return
    if (this.state.status === 'downloading' || this.state.status === 'ready') return
    this.set({ status: 'up-to-date', currentVersion: this.options.currentVersion, checkedAt: (this.options.now?.() ?? new Date()).toISOString() })
  }

  // ── Download ──────────────────────────────────────────────────────────────

  private async download(): Promise<void> {
    if (this.options.disabledReason !== null) return
    if (this.downloading) return this.downloading
    // Only an update that a check announced, and only because the user asked: nothing is ever downloaded by itself.
    if (this.state.status !== 'available') return
    const version = this.state.version
    this.lastPercent = -1
    this.set({ status: 'downloading', currentVersion: this.options.currentVersion, version, percent: 0 })
    this.downloading = this.doDownload().finally(() => {
      this.downloading = null
    })
    return this.downloading
  }

  private async doDownload(): Promise<void> {
    const updater = await this.load()
    const fail = (error?: unknown): void => {
      if (this.state.status === 'downloading') this.set({ status: 'error', currentVersion: this.options.currentVersion, during: 'download', message: describeUpdateError('download'), reason: classifyUpdateError(error) })
    }
    if (!updater) return fail()
    try {
      await updater.downloadUpdate()
      // 'update-downloaded' normally answered already; if the call returned without it, the update is not ready: it is an error, never a guess.
      if (this.state.status === 'downloading') {
        log.warn('the download ended without a ready update')
        fail()
      }
    } catch (error) {
      log.warn(`update download failed (${classifyUpdateError(error)})`, error)
      fail(error)
    }
  }

  private onProgress(progress: unknown): void {
    if (this.state.status !== 'downloading') return
    const raw = isRecord(progress) ? progress['percent'] : undefined
    const percent = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.floor(raw))) : 0
    if (percent === this.lastPercent) return
    this.lastPercent = percent
    this.set({ ...this.state, percent })
  }

  private onDownloaded(info: unknown): void {
    if (this.state.status !== 'downloading') return
    const reported = isRecord(info) ? info['version'] : undefined
    const version = isPlainVersion(reported) ? reported : this.state.version
    this.set({ status: 'ready', currentVersion: this.options.currentVersion, version, installBlockedReason: this.blockedReason() })
  }

  // ── Install ───────────────────────────────────────────────────────────────

  private blockedReason(): string | null {
    return this.options.writesInFlight() > 0 ? INSTALL_BLOCKED_BY_WRITE : null
  }

  private install(): void {
    if (this.options.disabledReason !== null || this.state.status !== 'ready' || this.installing || !this.updater) return
    // A restart would cut off a write that is on its way, and the app never replays a write: not now.
    const reason = this.blockedReason()
    if (reason !== null) {
      this.notifyWritesChanged()
      return
    }
    this.installing = true
    try {
      this.updater.quitAndInstall(true, true)
    } catch (error) {
      log.warn('could not start the installer', error)
      this.installing = false
      this.set({ status: 'error', currentVersion: this.options.currentVersion, during: 'download', message: describeUpdateError('download'), reason: classifyUpdateError(error) })
    }
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  /** Loads the updater once (only when it is enabled) and fixes its settings: nothing downloads or installs by itself, nothing older or unstable is taken. */
  private load(): Promise<UpdaterLike | null> {
    if (this.options.disabledReason !== null) return Promise.resolve(null)
    this.loading ??= this.options
      .loadUpdater()
      .then((updater) => {
        updater.autoDownload = false
        updater.autoInstallOnAppQuit = false
        updater.allowPrerelease = false
        updater.allowDowngrade = false
        updater.on('update-available', (info) => this.onAvailable(info))
        updater.on('update-not-available', () => this.onNotAvailable())
        updater.on('download-progress', (progress) => this.onProgress(progress))
        updater.on('update-downloaded', (info) => this.onDownloaded(info))
        // The promise of the call carries the failure too; the event only keeps the updater from reporting it as unhandled.
        updater.on('error', () => undefined)
        this.updater = updater
        return updater
      })
      .catch((error: unknown) => {
        log.warn('the updater could not be loaded', error)
        this.loading = null
        return null
      })
    return this.loading
  }

  private set(next: UpdateState): void {
    this.state = next
    try {
      this.options.onState(next)
    } catch (error) {
      log.warn('could not report the update state', error)
    }
  }
}
