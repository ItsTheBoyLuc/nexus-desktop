import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { GameKey, Settings } from '../../shared/types'

interface SettingsContextValue {
  settings: Settings
  /** False until the saved settings file has been read. */
  loaded: boolean
  remember: (guildId: string | null, game: GameKey | null) => void
  /** Re-read the file (after a panel was posted or forgotten: only the main process writes panels). */
  reload: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

/** Last chosen server and game, and the sign-up panels this app posted (persisted by the main process in userData). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    window.nexus.settings.get().then(
      (saved) => {
        if (!active) return
        setSettings(saved)
        setLoaded(true)
      },
      () => {
        if (active) setLoaded(true)
      }
    )
    return () => {
      active = false
    }
  }, [])

  const remember = useCallback((guildId: string | null, game: GameKey | null) => {
    setSettings((current) => {
      if (current.lastGuildId === guildId && current.lastGame === game) return current
      return { ...current, lastGuildId: guildId, lastGame: game }
    })
    void window.nexus.settings.set({ lastGuildId: guildId, lastGame: game })
  }, [])

  const reload = useCallback(async () => {
    try {
      setSettings(await window.nexus.settings.get())
    } catch {
      // Keep what we have; the file is only a convenience.
    }
  }, [])

  const value = useMemo(() => ({ settings, loaded, remember, reload }), [settings, loaded, remember, reload])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used inside <SettingsProvider>')
  return context
}
