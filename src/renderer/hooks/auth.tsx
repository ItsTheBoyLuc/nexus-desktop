import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ApiStatus, AuthState } from '../../shared/types'
import { clearCache } from '../lib/cache'

interface AuthContextValue {
  state: AuthState
  login: () => void
  cancelLogin: () => void
  retrySession: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Mirrors the main process' AuthState. The renderer never sees a token: it only learns
 * "loading / signed out (and why) / signing in / signed in as X".
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    const apply = (next: AuthState): void => {
      if (next.status !== 'signed-in') clearCache() // never keep one account's data around for the next
      setState(next)
    }
    // Subscribe first, then ask: IPC preserves order, so the latest state always wins.
    const unsubscribe = window.nexus.auth.onStateChange(apply)
    void window.nexus.auth.getState().then(apply)
    return unsubscribe
  }, [])

  const login = useCallback(() => void window.nexus.auth.login(), [])
  const cancelLogin = useCallback(() => void window.nexus.auth.cancelLogin(), [])
  const retrySession = useCallback(() => void window.nexus.auth.retrySession(), [])
  const logout = useCallback(() => void window.nexus.auth.logout(), [])

  const value = useMemo(() => ({ state, login, cancelLogin, retrySession, logout }), [state, login, cancelLogin, retrySession, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}

export function useApiStatus(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>('unknown')
  useEffect(() => {
    // Subscribe first, then ask for the current value (IPC keeps order, so the newest always wins).
    const unsubscribe = window.nexus.api.onStatusChange(setStatus)
    void window.nexus.api.getStatus().then(setStatus)
    return unsubscribe
  }, [])
  return status
}
