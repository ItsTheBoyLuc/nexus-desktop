import { useCallback, useState } from 'react'

/**
 * Servers where a write came back 403 for a missing role during this session, per role:
 *  - `fia`:   403 fia_required (recording results, the points system, clearing points, bans, advance race),
 *  - `admin`: 403 admin_required (the penalty settings).
 *
 * The API only says which role is needed when a write is refused, so the first refusal is remembered and the
 * actions stay disabled until the user chooses "Check again" or restarts the app. The data stays readable.
 * (A GET /settings `can_edit` tells about Administrators up front; the FIA role has no such flag.)
 */
export type DeniedRole = 'fia' | 'admin'

const denied: Record<DeniedRole, Set<string>> = { fia: new Set(), admin: new Set() }

export function useRoleDenied(role: DeniedRole, guildId: string): { denied: boolean; markDenied: () => void; reset: () => void } {
  const [isDenied, setIsDenied] = useState(() => denied[role].has(guildId))

  const markDenied = useCallback(() => {
    denied[role].add(guildId)
    setIsDenied(true)
  }, [role, guildId])
  const reset = useCallback(() => {
    denied[role].delete(guildId)
    setIsDenied(false)
  }, [role, guildId])

  return { denied: isDenied, markDenied, reset }
}

/** Recording results, saving the points system, clearing points, bans and advance race: FIA role or Administrator. */
export function useFiaDenied(guildId: string): { denied: boolean; markDenied: () => void; reset: () => void } {
  return useRoleDenied('fia', guildId)
}

/** Saving the penalty settings: Administrator. */
export function useAdminDenied(guildId: string): { denied: boolean; markDenied: () => void; reset: () => void } {
  return useRoleDenied('admin', guildId)
}
