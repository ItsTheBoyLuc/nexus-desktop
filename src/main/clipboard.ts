import { clipboard } from 'electron'
import { log } from './log'

/** Longest text the renderer may put on the clipboard (a ban notice or a link, never a document). */
export const MAX_COPY_LENGTH = 4000

/**
 * The only way the renderer writes to the clipboard: plain text, written by the main process, so the window
 * needs no clipboard permission of its own (the session denies every web permission). Reading is not offered.
 */
export function copyTextChecked(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_COPY_LENGTH) return false
  try {
    clipboard.writeText(raw)
    return true
  } catch (error) {
    log.warn('could not write to the clipboard', error)
    return false
  }
}
