import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { appendLedgerEntry, isLedgerEntry, sanitizeCalendarPosts, sanitizeLedger } from '../shared/f1Store'
import { isStoredPanel, isValidPanelKey, MAX_STORED_PANELS, panelKey, panelKeysFor, sanitizePanels } from '../shared/panels'
import { DEFAULT_SETTINGS, isGameKey } from '../shared/types'
import type { LedgerEntry, Settings, StoredPanel } from '../shared/types'
import { isValidKey, isValidSnowflake } from '../shared/validation'
import { log } from './log'

/**
 * What the renderer may change: the last chosen server and game and the Reduce animations switch. Anything else, including
 * `panels`, is dropped, so the renderer can neither forge nor wipe the panel registry.
 */
export function sanitizeSettings(input: unknown): Partial<Settings> {
  if (typeof input !== 'object' || input === null) return {}
  const record = input as Record<string, unknown>
  const clean: Partial<Settings> = {}
  if ('lastGuildId' in record) clean.lastGuildId = isValidSnowflake(record.lastGuildId) ? record.lastGuildId : null
  if ('lastGame' in record) clean.lastGame = isGameKey(record.lastGame) ? record.lastGame : null
  if ('reduceMotion' in record) clean.reduceMotion = record.reduceMotion === true
  return clean
}

/** The settings file is user-editable, so it is validated field by field when it is read. */
function sanitizeStoredSettings(input: unknown): Partial<Settings> {
  const clean = sanitizeSettings(input)
  if (typeof input === 'object' && input !== null) {
    const record = input as Record<string, unknown>
    if ('panels' in record) clean.panels = sanitizePanels(record['panels'])
    if ('calendarPosts' in record) clean.calendarPosts = sanitizeCalendarPosts(record['calendarPosts'])
    if ('ledger' in record) clean.ledger = sanitizeLedger(record['ledger'])
  }
  return clean
}

/**
 * The last chosen server and game, plus what this app remembers because the API cannot tell it:
 * the sign-up panels it posted and the calendar message it posted (the message id from the POST is the
 * only way to refresh them later), and a ledger of the races it recorded.
 * A small JSON file in userData. Not sensitive; tokens are never stored here.
 * Only the main process writes panels, calendar posts and the ledger, and only after the API confirmed it.
 */
export class SettingsStore {
  private current: Settings

  constructor(private readonly filePath: string) {
    this.current = this.read()
  }

  get(): Settings {
    return {
      ...this.current,
      panels: { ...this.current.panels },
      calendarPosts: { ...this.current.calendarPosts },
      ledger: this.current.ledger.map((entry) => ({ ...entry }))
    }
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

  /** Remember the calendar message of a server after the API confirmed it was posted. Invalid input is ignored. */
  rememberCalendarPost(guildId: string, post: StoredPanel): void {
    if (!isValidSnowflake(guildId) || !isStoredPanel(post)) return
    const posts = { ...this.current.calendarPosts }
    delete posts[guildId]
    posts[guildId] = { messageId: post.messageId, channelId: post.channelId }
    this.current = { ...this.current, calendarPosts: sanitizeCalendarPosts(posts) }
    this.write()
  }

  /** Forget the calendar message of a server (it was deleted in Discord, or is not ours). */
  forgetCalendarPost(guildId: string): void {
    if (!(guildId in this.current.calendarPosts)) return
    const posts = { ...this.current.calendarPosts }
    delete posts[guildId]
    this.current = { ...this.current, calendarPosts: posts }
    this.write()
  }

  /** Record that a race was saved, after the API confirmed it. Invalid input is ignored. */
  recordRace(entry: LedgerEntry): void {
    if (!isLedgerEntry(entry)) return
    this.current = { ...this.current, ledger: appendLedgerEntry(this.current.ledger, entry) }
    this.write()
  }

  private read(): Settings {
    const fresh = (): Settings => ({ ...DEFAULT_SETTINGS, panels: {}, calendarPosts: {}, ledger: [] })
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      return { ...fresh(), ...sanitizeStoredSettings(raw) }
    } catch {
      return fresh()
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
