import type { ApiErrorInfo, ApiErrorKind } from '../shared/types'
import { log } from './log'

/** Typed error that the IPC layer turns into a serializable ApiErrorInfo. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly code: string
  readonly status?: number
  readonly retryAfter?: number
  /** True when the request may have reached the server (so a POST must not be replayed). */
  readonly mayHaveBeenSent: boolean

  constructor(init: {
    kind: ApiErrorKind
    code: string
    message: string
    status?: number
    retryAfter?: number
    mayHaveBeenSent?: boolean
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.kind = init.kind
    this.code = init.code
    this.status = init.status
    this.retryAfter = init.retryAfter
    this.mayHaveBeenSent = init.mayHaveBeenSent ?? true
  }

  toInfo(): ApiErrorInfo {
    return {
      kind: this.kind,
      code: this.code,
      message: this.message,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      // Lets the UI tell "the write may have gone through" from "it never left this computer".
      ...(this.kind === 'network' || this.kind === 'timeout' ? { mayHaveBeenSent: this.mayHaveBeenSent } : {})
    }
  }
}

export type SessionEndReason = 'expired' | 'refresh-failed'

export interface ApiClientOptions {
  baseUrl: string
  fetchImpl?: typeof fetch
  /** Hard limit for a single HTTP attempt. */
  timeoutMs?: number
  /** A normal call still unanswered after this long raises the "server waking up" notice. */
  wakeAfterMs?: number
  /** Normal calls: total tries, initial one included. */
  maxTries?: number
  /** Waits before the 2nd, 3rd, ... try. */
  backoffMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
  /** Called with every new refresh token so it can be stored (encrypted). */
  persistRefreshToken?: (token: string) => void
  /** Called when the session is over, to delete the stored refresh token. */
  clearPersistedSession?: () => void
  /** `true` while at least one call has been waiting longer than wakeAfterMs. */
  onWaking?: (active: boolean) => void
  onStatus?: (status: 'online' | 'offline') => void
  onSessionEnded?: (reason: SessionEndReason) => void
  /** Called whenever the number of writes (POST / PUT / PATCH / DELETE) that are on their way changes. The updater waits for it to be 0 before it restarts the app. */
  onWritesChange?: (inFlight: number) => void
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  path: string
  body?: unknown
  /** Send the Bearer token and handle 401 with one refresh. Default true. */
  auth?: boolean
  /** Exactly one attempt: no retries, no waking notice, no refresh. For exchange/logout. */
  once?: boolean
}

interface RawResponse {
  status: number
  json: unknown
  retryAfter?: number
}

const REFRESH_PATH = '/api/app/v1/auth/refresh'
// Failures that happen before a connection exists: the request cannot have been processed.
const PRE_SEND_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'])

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function isBackendError(json: unknown): json is { error: string; message?: unknown } {
  return typeof json === 'object' && json !== null && typeof (json as { error?: unknown }).error === 'string'
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 3600 ? Math.ceil(seconds) : undefined
}

function sessionEndedError(): ApiError {
  return new ApiError({ kind: 'session', code: 'session_ended', message: 'Your session has ended. Please sign in again.', mayHaveBeenSent: false })
}

export function isTokenPair(json: unknown): json is { access_token: string; refresh_token: string } {
  if (typeof json !== 'object' || json === null) return false
  const { access_token: access, refresh_token: refresh } = json as Record<string, unknown>
  return typeof access === 'string' && access.length > 0 && access.length <= 512 && typeof refresh === 'string' && refresh.length > 0 && refresh.length <= 512
}

/**
 * HTTP client for /api/app/v1, living in the main process. It owns the tokens:
 *
 *  - access token: memory only; refresh token: memory + (encrypted) persistence callback.
 *  - 401 -> ONE refresh (single-flight: concurrent calls share it) -> retry the call once.
 *  - The refresh request is sent exactly once. It is NEVER retried, not even after a timeout
 *    or network error: the backend revokes the whole session when an already-used refresh
 *    token is replayed, so a "maybe delivered" refresh must end the session instead.
 *  - Normal calls tolerate a sleeping server (Render free tier): 20 s per attempt, a calm
 *    "waking up" notice after 5 s, up to 3 tries with backoff. Non-idempotent calls (POST)
 *    are only replayed when the request provably did not reach the app. The same holds for
 *    PUT / PATCH / DELETE: no write is ever replayed after a timeout or an ambiguous network error.
 */
export class ApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly wakeAfterMs: number
  private readonly maxTries: number
  private readonly backoffMs: readonly number[]
  private readonly sleep: (ms: number) => Promise<void>

  private accessToken: string | null = null
  private refreshToken: string | null = null
  private refreshInFlight: Promise<boolean> | null = null
  private wakeWatchers = 0
  private writesInFlightCount = 0

  constructor(private readonly options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 20_000
    this.wakeAfterMs = options.wakeAfterMs ?? 5_000
    this.maxTries = options.maxTries ?? 3
    this.backoffMs = options.backoffMs ?? [1_000, 3_000]
    this.sleep = options.sleep ?? defaultSleep
  }

  // ── Session ────────────────────────────────────────────────────────────────

  hasSession(): boolean {
    return this.accessToken !== null
  }

  setSession(tokens: { access_token: string; refresh_token: string }): void {
    this.accessToken = tokens.access_token
    this.refreshToken = tokens.refresh_token
    this.persist(tokens.refresh_token)
  }

  /** Seed with a stored refresh token before calling refreshSession() at startup. */
  setRefreshToken(token: string): void {
    this.refreshToken = token
    this.accessToken = null
  }

  /** Forget the tokens in memory only (keeps the stored refresh token for the next launch). */
  clearMemory(): void {
    this.accessToken = null
    this.refreshToken = null
  }

  /** Sign out: tell the backend (one best-effort attempt), then forget everything. */
  async logout(): Promise<void> {
    const token = this.accessToken
    if (token) {
      try {
        await this.attempt({ method: 'POST', path: '/api/app/v1/auth/logout' }, token)
      } catch {
        // Offline or already expired: the local session is dropped regardless.
      }
    }
    this.clearMemory()
    this.options.clearPersistedSession?.()
  }

  // ── Requests ───────────────────────────────────────────────────────────────

  /**
   * Cheap unauthenticated call that wakes a sleeping server before the (single-shot) refresh
   * is sent. Any JSON answer from the backend, including 401, proves it is awake.
   */
  async warmUp(): Promise<boolean> {
    const stopWatching = this.watchForWakeUp()
    try {
      const res = await this.sendWithRetries({ path: '/api/app/v1/me', auth: false }, null)
      const alive = isBackendError(res.json) || (res.status >= 200 && res.status < 300)
      this.options.onStatus?.(alive ? 'online' : 'offline')
      return alive
    } catch (error) {
      this.options.onStatus?.('offline')
      log.warn('server warm-up failed', error)
      return false
    } finally {
      stopWatching()
    }
  }

  /** How many writes (POST / PUT / PATCH / DELETE) are on their way right now. A restart for an update must wait for 0: a write is never replayed. */
  writesInFlight(): number {
    return this.writesInFlightCount
  }

  async request(options: RequestOptions): Promise<unknown> {
    const isWrite = (options.method ?? 'GET') !== 'GET'
    if (!isWrite) return this.performRequest(options)
    this.writesInFlightCount++
    this.options.onWritesChange?.(this.writesInFlightCount)
    try {
      return await this.performRequest(options)
    } finally {
      this.writesInFlightCount--
      this.options.onWritesChange?.(this.writesInFlightCount)
    }
  }

  private async performRequest(options: RequestOptions): Promise<unknown> {
    const wantsAuth = options.auth !== false
    if (options.once) return this.requestOnce(options)

    const stopWatching = this.watchForWakeUp()
    try {
      let tokenUsed = this.accessToken
      if (wantsAuth && !tokenUsed) throw sessionEndedError()

      let res = await this.sendWithRetries(options, wantsAuth ? tokenUsed : null)
      if (wantsAuth && res.status === 401) {
        if (!(await this.refreshAfterUnauthorized(tokenUsed))) throw sessionEndedError()
        tokenUsed = this.accessToken
        res = await this.sendWithRetries(options, tokenUsed)
        if (res.status === 401) {
          this.endSession('expired')
          throw sessionEndedError()
        }
      }
      this.options.onStatus?.('online')
      return this.interpret(res)
    } catch (error) {
      if (error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout')) this.options.onStatus?.('offline')
      throw error
    } finally {
      stopWatching()
    }
  }

  private async requestOnce(options: RequestOptions): Promise<unknown> {
    const wantsAuth = options.auth !== false
    if (wantsAuth && !this.accessToken) throw sessionEndedError()
    try {
      const res = await this.attempt(options, wantsAuth ? this.accessToken : null)
      this.options.onStatus?.('online')
      return this.interpret(res)
    } catch (error) {
      if (error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout')) this.options.onStatus?.('offline')
      throw error
    }
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  /**
   * Single-flight refresh. Resolves true when new tokens are in place; false when the
   * session ended (listeners were notified and the stored token deleted).
   */
  refreshSession(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.performRefresh().finally(() => {
        this.refreshInFlight = null
      })
    }
    return this.refreshInFlight
  }

  private async refreshAfterUnauthorized(tokenUsed: string | null): Promise<boolean> {
    // Another call already renewed the session while this one was failing: just retry.
    if (this.accessToken !== null && this.accessToken !== tokenUsed) return true
    return this.refreshSession()
  }

  private async performRefresh(): Promise<boolean> {
    const refreshToken = this.refreshToken
    if (!refreshToken) {
      this.endSession('expired')
      return false
    }

    let res: RawResponse
    try {
      // Exactly ONE attempt. No retry, ever (see the class comment).
      res = await this.attempt({ method: 'POST', path: REFRESH_PATH, body: { refresh_token: refreshToken } }, null)
    } catch (error) {
      log.warn('session refresh failed before an answer arrived; ending the session', error)
      this.endSession('refresh-failed')
      return false
    }

    if (res.status === 200 && isTokenPair(res.json)) {
      this.accessToken = res.json.access_token
      this.refreshToken = res.json.refresh_token
      this.persist(res.json.refresh_token)
      this.options.onStatus?.('online')
      return true
    }

    log.warn(`session refresh was refused (HTTP ${res.status}); ending the session`)
    this.endSession(res.status === 400 || res.status === 401 ? 'expired' : 'refresh-failed')
    return false
  }

  private endSession(reason: SessionEndReason): void {
    const hadSession = this.accessToken !== null || this.refreshToken !== null
    this.clearMemory()
    this.options.clearPersistedSession?.()
    if (hadSession) this.options.onSessionEnded?.(reason)
  }

  private persist(refreshToken: string): void {
    try {
      this.options.persistRefreshToken?.(refreshToken)
    } catch (error) {
      log.warn('could not store the refreshed session', error)
    }
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  private watchForWakeUp(): () => void {
    let fired = false
    const timer = setTimeout(() => {
      fired = true
      this.wakeWatchers++
      if (this.wakeWatchers === 1) this.options.onWaking?.(true)
    }, this.wakeAfterMs)
    return () => {
      clearTimeout(timer)
      if (!fired) return
      this.wakeWatchers--
      if (this.wakeWatchers === 0) this.options.onWaking?.(false)
    }
  }

  /** One attempt, retried (for normal calls) while the server looks asleep or unreachable. */
  private async sendWithRetries(options: RequestOptions, token: string | null): Promise<RawResponse> {
    const method = options.method ?? 'GET'
    for (let attemptNumber = 1; ; attemptNumber++) {
      const hasTriesLeft = attemptNumber < this.maxTries
      try {
        const res = await this.attempt(options, token)
        if (hasTriesLeft && this.isRetriableResponse(res, method)) {
          await this.sleep(this.backoffMs[attemptNumber - 1] ?? this.backoffMs[this.backoffMs.length - 1] ?? 1_000)
          continue
        }
        return res
      } catch (error) {
        if (hasTriesLeft && error instanceof ApiError && this.isRetriableError(error, method)) {
          await this.sleep(this.backoffMs[attemptNumber - 1] ?? this.backoffMs[this.backoffMs.length - 1] ?? 1_000)
          continue
        }
        throw error
      }
    }
  }

  /** Render's own 502/503/504 pages (not our JSON errors) mean "the service is not up yet". */
  private isRetriableResponse(res: RawResponse, method: HttpMethod): boolean {
    if (isBackendError(res.json)) return false
    if (res.status === 502 || res.status === 503) return true
    return res.status === 504 && method === 'GET'
  }

  private isRetriableError(error: ApiError, method: HttpMethod): boolean {
    if (error.kind !== 'timeout' && error.kind !== 'network') return false
    // Only reads are replayed after an ambiguous failure: a write (POST, PUT, PATCH, DELETE) may have gone through.
    return method === 'GET' || !error.mayHaveBeenSent
  }

  private async attempt(options: RequestOptions, token: string | null): Promise<RawResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      let body: string | undefined
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(options.body)
      }

      const res = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
        redirect: 'error' // never follow a redirect with an Authorization header attached
      })
      const text = await res.text()
      let json: unknown = null
      if (text) {
        try {
          json = JSON.parse(text)
        } catch {
          json = null
        }
      }
      return { status: res.status, json, retryAfter: parseRetryAfter(res.headers.get('retry-after')) }
    } catch (error) {
      throw this.toTransportError(error, controller.signal.aborted)
    } finally {
      clearTimeout(timer)
    }
  }

  private toTransportError(error: unknown, aborted: boolean): ApiError {
    if (aborted) {
      return new ApiError({ kind: 'timeout', code: 'timeout', message: 'The server took too long to respond.', mayHaveBeenSent: true })
    }
    const cause = (error as { cause?: { code?: unknown } } | null)?.cause
    const code = typeof cause?.code === 'string' ? cause.code : ''
    return new ApiError({
      kind: 'network',
      code: 'network_error',
      message: "Can't reach the Nexus server. Check your internet connection.",
      mayHaveBeenSent: !PRE_SEND_ERROR_CODES.has(code)
    })
  }

  private interpret(res: RawResponse): unknown {
    if (res.status >= 200 && res.status < 300) return res.json

    const backendCode = isBackendError(res.json) ? res.json.error.slice(0, 64) : undefined
    const backendMessage =
      isBackendError(res.json) && typeof res.json.message === 'string' ? res.json.message.slice(0, 300) : undefined

    if (res.status === 429) {
      throw new ApiError({
        kind: 'rate_limited',
        code: backendCode ?? 'rate_limited',
        message: 'Too many requests. Please wait a moment and try again.',
        status: 429,
        retryAfter: res.retryAfter
      })
    }
    if (backendCode) {
      throw new ApiError({ kind: 'http', code: backendCode, message: backendMessage ?? 'The request was not accepted.', status: res.status })
    }
    throw new ApiError({
      kind: 'http',
      code: res.status >= 500 ? 'server_unavailable' : 'unexpected_response',
      message: 'The Nexus server is not responding as expected. Please try again in a moment.',
      status: res.status
    })
  }
}
