/**
 * Which sidebar modules are available, and the short reason shown (tooltip and hint) when one is not.
 * Kept free of React so the rules can be tested.
 */
export interface ModuleState {
  enabled: boolean
  /** Why it is greyed out; null when enabled. */
  reason: string | null
}

export interface ModuleContext {
  /** A server is chosen. */
  hasServer: boolean
  /** Game key from the URL, if any. */
  game: string | null
  /** The chosen game is enabled for this server. */
  gameEnabled: boolean
}

const available: ModuleState = { enabled: true, reason: null }
const off = (reason: string): ModuleState => ({ enabled: false, reason })

/** Server-level pages (Overview, Games & Tiers, Settings, Announcement) only need a server. */
export function serverModuleState(context: Pick<ModuleContext, 'hasServer'>): ModuleState {
  return context.hasServer ? available : off('Choose a server first.')
}

function gameState(context: ModuleContext): ModuleState | null {
  if (!context.hasServer) return off('Choose a server first.')
  if (!context.game) return off('Choose a game first.')
  if (!context.gameEnabled) return off('Enable this game first.')
  return null
}

/** League: only Formula 1 has one. */
export function leagueModuleState(context: ModuleContext): ModuleState {
  return gameState(context) ?? (context.game === 'f1' ? available : off('Only Formula 1 has a league module.'))
}

/** Esports team: every game has one. */
export function esportsModuleState(context: ModuleContext): ModuleState {
  return gameState(context) ?? available
}
