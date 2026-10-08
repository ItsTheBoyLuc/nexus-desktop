import type { AuthState, SignedOutReason } from '../shared/types'
import { ApiError, isTokenPair } from './apiClient'
import type { ApiClient, SessionEndReason } from './apiClient'
import type { startLoopbackServer } from './loopback'
import type { NexusApi } from './nexusApi'
import { log } from './log'
import { challengeFor, generateState, generateVerifier } from './pkce'
import type { RefreshTokenStore } from './tokenStore'

export interface AuthServiceDeps {
  client: ApiClient
  api: NexusApi
  store: RefreshTokenStore
  apiBaseUrl: string
  loginTimeoutMs: number
  /** Must enforce the https allowlist (see external.ts). Returns false when refused. */
  openExternal: (url: string) => boolean
  startLoopback: typeof startLoopbackServer
  onState: (state: AuthState) => void
}

/**
 * Owns the login lifecycle in the main process. The renderer only ever sees AuthState
 * (never a token): loading -> signed-out | signing-in -> signed-in.
 */
export class AuthService {
  private state: AuthState = { status: 'loading' }
  private pendingLogin: { close: () => void } | null = null

  constructor(private readonly deps: AuthServiceDeps) {}

  getState(): AuthState {
    return this.state
  }

  /** Called when the API client gives up on the session (refresh failed / revoked). */
  handleSessionEnded(reason: SessionEndReason): void {
    this.setState({ status: 'signed-out', reason: reason === 'expired' ? 'expired' : 'session-ended' })
  }

  /** Startup: resume the session from the stored refresh token, if there is one. */
  async restore(): Promise<void> {
    this.setState({ status: 'loading' })
    const stored = this.deps.store.load()
    if (!stored) {
      this.setState({ status: 'signed-out' })
      return
    }

    // The refresh request may be sent only once, so first make sure the (possibly sleeping)
    // server answers at all. If it does not, the stored token stays untouched for next time.
    if (!(await this.deps.client.warmUp())) {
      this.setState({ status: 'signed-out', reason: 'offline' })
      return
    }

    this.deps.client.setRefreshToken(stored)
    if (!(await this.deps.client.refreshSession())) return // handleSessionEnded() already set the state

    try {
      this.setState({ status: 'signed-in', user: await this.deps.api.me() })
    } catch (error) {
      log.warn('could not load the profile after restoring the session', error)
      this.deps.client.clearMemory() // the rotated refresh token is already stored: next launch resumes
      this.setState({ status: 'signed-out', reason: 'offline' })
    }
  }

  async login(): Promise<void> {
    if (this.pendingLogin || this.state.status === 'signing-in') return
    this.setState({ status: 'signing-in' })

    const verifier = generateVerifier()
    const challenge = challengeFor(verifier)
    const state = generateState()

    let loopback: Awaited<ReturnType<typeof startLoopbackServer>>
    try {
      loopback = await this.deps.startLoopback({ expectedState: state, timeoutMs: this.deps.loginTimeoutMs })
    } catch (error) {
      log.error('could not start the loopback login server', error)
      this.setSignedOut('error')
      return
    }
    this.pendingLogin = loopback

    const loginUrl = `${this.deps.apiBaseUrl}/app/auth/login?${new URLSearchParams({
      state,
      code_challenge: challenge,
      redirect: loopback.redirectUri
    }).toString()}`

    if (!this.deps.openExternal(loginUrl)) {
      loopback.close()
      this.pendingLogin = null
      this.setSignedOut('error')
      return
    }

    const outcome = await loopback.result
    this.pendingLogin = null

    switch (outcome.kind) {
      case 'code':
        await this.completeLogin(outcome.code, verifier)
        return
      case 'denied':
        this.setSignedOut('denied')
        return
      case 'timeout':
        this.setSignedOut('timeout')
        return
      case 'cancelled':
        this.setSignedOut('cancelled')
        return
    }
  }

  cancelLogin(): void {
    this.pendingLogin?.close()
  }

  async logout(): Promise<void> {
    this.pendingLogin?.close()
    await this.deps.client.logout()
    this.deps.store.clear()
    this.setSignedOut('logged-out')
  }

  private async completeLogin(code: string, verifier: string): Promise<void> {
    try {
      // Single attempt: the code is single-use, so a replay could only fail.
      const json = await this.deps.client.request({
        method: 'POST',
        path: '/api/app/v1/auth/exchange',
        body: { code, code_verifier: verifier },
        auth: false,
        once: true
      })
      if (!isTokenPair(json)) throw new ApiError({ kind: 'invalid_response', code: 'invalid_response', message: 'Unexpected login response.' })
      this.deps.client.setSession(json) // keeps the access token in memory, persists the refresh token
      const user = await this.deps.api.me()
      this.setState({ status: 'signed-in', user })
    } catch (error) {
      log.warn('login could not be completed', error)
      this.deps.client.clearMemory()
      this.deps.store.clear()
      const offline = error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout')
      this.setSignedOut(offline ? 'offline' : 'error')
    }
  }

  private setSignedOut(reason: SignedOutReason): void {
    this.setState({ status: 'signed-out', reason })
  }

  private setState(state: AuthState): void {
    this.state = state
    this.deps.onState(state)
  }
}
