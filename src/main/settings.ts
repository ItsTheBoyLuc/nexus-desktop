import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, isGameKey } from '../shared/types'
import type { Settings } from '../shared/types'
import { isValidSnowflake } from '../shared/validation'
import { log } from './log'

/** Reduce arbitrary input (file contents or an IPC patch) to valid settings fields only. */
export function sanitizeSettings(input: unknown): Partial<Settings> {
  if (typeof input !== 'object' || input === null) return {}
  const record = input as Record<string, unknown>
  const clean: Partial<Settings> = {}
  if ('lastGuildId' in record) clean.lastGuildId = isValidSnowflake(record.lastGuildId) ? record.lastGuildId : null
  if ('lastGame' in record) clean.lastGame = isGameKey(record.lastGame) ? record.lastGame : null
  return clean
}

/** The last chosen server and game, in a small JSON file in userData. Not sensitive. */
export class SettingsStore {
  private current: Settings

  constructor(private readonly filePath: string) {
    this.current = this.read()
  }

  get(): Settings {
    return { ...this.current }
  }

  set(patch: unknown): Settings {
    this.current = { ...this.current, ...sanitizeSettings(patch) }
    this.write()
    return this.get()
  }

  private read(): Settings {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      return { ...DEFAULT_SETTINGS, ...sanitizeSettings(raw) }
    } catch {
      return { ...DEFAULT_SETTINGS }
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
