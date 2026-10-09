import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isStoredPanel, isValidPanelKey, MAX_STORED_PANELS, panelKey, panelKeysFor, sanitizePanels } from '../shared/panels'
import { DEFAULT_SETTINGS, isGameKey } from '../shared/types'
import type { Settings, StoredPanel } from '../shared/types'
import { isValidKey, isValidSnowflake } from '../shared/validation'
import { log } from './log'

/**
 * What the renderer may change: the last chosen server and game. Anything else, including
 * `panels`, is dropped, so the renderer can neither forge nor wipe the panel registry.
 */
export function sanitizeSettings(input: unknown): Partial<Settings> {
  if (typeof input !== 'object' || input === null) return {}
  const record = input as Record<string, unknown>
  const clean: Partial<Settings> = {}
  if ('lastGuildId' in record) clean.lastGuildId = isValidSnowflake(record.lastGuildId) ? record.lastGuildId : null
  if ('lastGame' in record) clean.lastGame = isGameKey(record.lastGame) ? record.lastGame : null
  return clean
}

/** The settings file is user-editable, so it is validated field by field when it is read. */
function sanitizeStoredSettings(input: unknown): Partial<Settings> {
  const clean = sanitizeSettings(input)
  if (typeof input === 'object' && input !== null && 'panels' in input) clean.panels = sanitizePanels((input as { panels: unknown }).panels)
  return clean
}

/**
 * The last chosen server and game, plus the sign-up panels this app posted (the API cannot
 * look panels up, so the message id from POST post-panel is the only way to refresh one later).
 * A small JSON file in userData. Not sensitive; tokens are never stored here.
 */
export class SettingsStore {
  private current: Settings

  constructor(private readonly filePath: string) {
    this.current = this.read()
  }

  get(): Settings {
    return { ...this.current, panels: { ...this.current.panels } }
  }

  set(patch: unknown): Settings {
    this.current = { ...this.current, ...sanitizeSettings(patch) }
    this.write()
    return this.get()
  }

  /** Remember a panel after the API confirmed it was posted. Invalid input is ignored. */
  rememberPanel(guildId: string, gameKey: string, tierKey: string, panel: StoredPanel): void {
    if (!isValidSnowflake(guildId) || !isValidKey(gameKey) || !isValidKey(tierKey) || !isStoredPanel(panel)) return
    const key = panelKey(guildId, gameKey, tierKey)
    if (!isValidPanelKey(key)) return
    const panels = { ...this.current.panels }
    delete panels[key] // re-insert so the newest entries survive when the cap is reached
    panels[key] = { messageId: panel.messageId, channelId: panel.channelId }
    const keys = Object.keys(panels)
    for (const oldest of keys.slice(0, Math.max(0, keys.length - MAX_STORED_PANELS))) delete panels[oldest]
    this.current = { ...this.current, panels }
    this.write()
  }

  /** Forget the panel of one tier, or of every tier of a game when `tierKey` is omitted. */
  forgetPanels(guildId: string, gameKey: string, tierKey?: string): void {
    const doomed = panelKeysFor(this.current.panels, guildId, gameKey, tierKey)
    if (doomed.length === 0) return
    const panels = { ...this.current.panels }
    for (const key of doomed) delete panels[key]
    this.current = { ...this.current, panels }
    this.write()
  }

  private read(): Settings {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      return { ...DEFAULT_SETTINGS, panels: {}, ...sanitizeStoredSettings(raw) }
    } catch {
      return { ...DEFAULT_SETTINGS, panels: {} }
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const temp = `${this.filePath}.tmp`
      writeFileSync(temp, JSON.stringify(this.current, null, 2), 'utf8')
      renameSync(temp, this.filePath)
    } catch (error) {
      log.warn('could not save settings', error)
    }
  }
}
