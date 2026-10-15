import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { describeUpdateError } from '../../shared/updates'
import type { UpdateState } from '../../shared/updates'
import type { UpdateAction } from '../lib/updateView'

interface UpdatesContextValue {
  /** Null until the main process has answered. */
  state: UpdateState | null
  run: (action: UpdateAction) => Promise<void>
}

const UpdatesContext = createContext<UpdatesContextValue | null>(null)

/**
 * The app update state, as the main process reports it. The renderer never decides anything: it shows the state, and asks for `check`,
 * `download` or `install` without any argument. If a call cannot be made at all, the screen shows a plain error and the app goes on.
 */
export function UpdatesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    let active = true
    window.nexus.updates.getState().then(
      (current) => {
        if (active) setState((now) => now ?? current)
      },
      () => undefined // no state: the screens show "reading the update status" and nothing else breaks
    )
    const stop = window.nexus.updates.onStateChange((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
      stop()
    }
  }, [])

  const run = useCallback(async (action: UpdateAction): Promise<void> => {
    try {
      const next = await window.nexus.updates[action]()
      setState(next)
    } catch {
      setState((now) => (now === null ? null : { status: 'error', currentVersion: now.currentVersion, during: action === 'check' ? 'check' : 'download', message: describeUpdateError(action === 'check' ? 'check' : 'download') }))
    }
  }, [])

  const value = useMemo(() => ({ state, run }), [state, run])
  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>
}

export function useUpdates(): UpdatesContextValue {
  const context = useContext(UpdatesContext)
  if (!context) throw new Error('useUpdates must be used inside <UpdatesProvider>')
  return context
}
