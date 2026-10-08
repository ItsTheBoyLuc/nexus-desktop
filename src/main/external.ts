import { shell } from 'electron'
import { API_HOST } from './config'
import { parseAllowedExternalUrl } from './links'
import { log } from './log'

/**
 * The only way the app opens the system browser. https + allowlisted host (discord.com,
 * nexus-b67.pages.dev, the API host) or nothing happens.
 */
export function openExternalChecked(raw: unknown): boolean {
  const safe = parseAllowedExternalUrl(raw, [API_HOST])
  if (!safe) {
    log.warn('blocked an external URL that is not on the allowlist')
    return false
  }
  shell.openExternal(safe).catch((error: unknown) => log.warn('could not open the system browser', error))
  return true
}
