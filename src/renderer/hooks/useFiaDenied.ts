import { useCallback, useState } from 'react'

/**
 * Servers where recording results or saving the points system came back 403 fia_required during this session.
 * The API only says "FIA role or Administrator" when a write is refused (GET /settings `can_edit` is about
 * Administrators only), so the first refusal is remembered and both actions stay disabled until the user
 * chooses "Check again" or restarts the app. The tables stay readable.
 */
const denied = new Set<string>()

export function useFiaDenied(guildId: string): { denied: boolean; markDenied: () => void; reset: () => void } {
  const [isDenied, setIsDenied] = useState(() => denied.has(guildId))

  const markDenied = useCallback(() => {
    denied.add(guildId)
    setIsDenied(true)
  }, [guildId])
  const reset = useCallback(() => {
    denied.delete(guildId)
    setIsDenied(false)
  }, [guildId])

  return { denied: isDenied, markDenied, reset }
}
