import type { StoredPanel } from './types'
import { isValidKey, isValidSnowflake } from './validation'

/** A panel is identified by server, league game key (e.g. "f1_2025") and tier key. */
export function panelKey(guildId: string, gameKey: string, tierKey: string): string {
  return `${guildId}:${gameKey}:${tierKey}`
}

const KEY_PATTERN = /^([0-9]{1,20}):([A-Za-z0-9_]{1,20}):([A-Za-z0-9_]{1,20})$/
export const MAX_STORED_PANELS = 500

export function isValidPanelKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

export function isStoredPanel(value: unknown): value is StoredPanel {
  if (typeof value !== 'object' || value === null) return false
  const { messageId, channelId } = value as Record<string, unknown>
  return isValidSnowflake(messageId) && isValidSnowflake(channelId)
}

/** Keep only well-formed entries (the file is user-editable, so it is never trusted). */
export function sanitizePanels(input: unknown): Record<string, StoredPanel> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
  const clean: Record<string, StoredPanel> = {}
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(clean).length >= MAX_STORED_PANELS) break
    if (isValidPanelKey(key) && isStoredPanel(value)) clean[key] = { messageId: value.messageId, channelId: value.channelId }
  }
  return clean
}

/** The remembered panel for a tier, if there is one. */
export function findPanel(panels: Record<string, StoredPanel>, guildId: string, gameKey: string, tierKey: string): StoredPanel | null {
  if (!isValidKey(gameKey) || !isValidKey(tierKey)) return null
  return panels[panelKey(guildId, gameKey, tierKey)] ?? null
}

/** Keys of every stored panel that belongs to a whole game (tierKey omitted) or to one tier. */
export function panelKeysFor(panels: Record<string, StoredPanel>, guildId: string, gameKey: string, tierKey?: string): string[] {
  if (tierKey !== undefined) {
    const exact = panelKey(guildId, gameKey, tierKey)
    return exact in panels ? [exact] : []
  }
  const prefix = `${guildId}:${gameKey}:`
  return Object.keys(panels).filter((key) => key.startsWith(prefix))
}
