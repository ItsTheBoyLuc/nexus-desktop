import type { AnnouncementInput } from './types'

/** Limits mirror the backend (app_backend.py), so errors show up before a request is made. */
export const ANNOUNCEMENT_LIMITS = { titleMax: 150, messageMax: 1500, imageUrlMax: 500 } as const

export interface AnnouncementDraft {
  title: string
  message: string
  channelId: string
  imageUrl: string
}

export type AnnouncementField = 'title' | 'message' | 'channelId' | 'imageUrl'
export type AnnouncementErrors = Partial<Record<AnnouncementField, string>>

export type AnnouncementValidation = { ok: true; value: AnnouncementInput } | { ok: false; errors: AnnouncementErrors }

// Control characters except tab, LF and CR (same set the backend rejects).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const SNOWFLAKE = /^[0-9]{1,20}$/

/** Length in Unicode code points, like Python's len() on the backend (JS .length counts UTF-16 units). */
export function codePointLength(value: string): number {
  let count = 0
  for (const _ of value) count++
  return count
}

export function isValidSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value)
}

/** https URL with a host, no credentials, no whitespace, at most 500 characters. */
export function isValidImageUrl(value: string): boolean {
  if (codePointLength(value) > ANNOUNCEMENT_LIMITS.imageUrlMax || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

export function validateAnnouncement(draft: AnnouncementDraft): AnnouncementValidation {
  const errors: AnnouncementErrors = {}
  const title = draft.title.trim()
  const message = draft.message.trim()
  const imageUrl = draft.imageUrl.trim()

  const titleLength = codePointLength(title)
  if (titleLength === 0) errors.title = 'Enter a title.'
  else if (titleLength > ANNOUNCEMENT_LIMITS.titleMax) errors.title = `The title can be at most ${ANNOUNCEMENT_LIMITS.titleMax} characters.`
  else if (/[\r\n]/.test(title) || CONTROL_CHARS.test(title)) errors.title = 'The title must be a single line without special characters.'

  const messageLength = codePointLength(message)
  if (messageLength === 0) errors.message = 'Enter a message.'
  else if (messageLength > ANNOUNCEMENT_LIMITS.messageMax) errors.message = `The message can be at most ${ANNOUNCEMENT_LIMITS.messageMax} characters.`
  else if (CONTROL_CHARS.test(message)) errors.message = 'The message contains characters that cannot be sent.'

  if (!isValidSnowflake(draft.channelId)) errors.channelId = 'Choose a channel.'

  if (imageUrl !== '' && !isValidImageUrl(imageUrl)) {
    errors.imageUrl = `Use a full https:// link without spaces (at most ${ANNOUNCEMENT_LIMITS.imageUrlMax} characters).`
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: { title, message, channelId: draft.channelId, ...(imageUrl !== '' ? { imageUrl } : {}) }
  }
}
