import { isValidSnowflake } from '../../shared/validation'

/**
 * The "Post in a channel" part of the create forms of teams, events and results (milestone 6, part 2), free of React so the rules can be
 * tested. It is OFF by default. While it is off nothing about a channel or a role is sent, whatever was chosen before it was switched off:
 * the request is exactly the one of before M6.
 */
export interface PostTargetDraft {
  enabled: boolean
  channelId: string
  pingIds: readonly string[]
}

export type PostFields = { channelId?: string; pingRoleIds?: string[] }

export function postFields(draft: PostTargetDraft): { ok: true; fields: PostFields } | { ok: false; message: string } {
  if (!draft.enabled) return { ok: true, fields: {} }
  if (!isValidSnowflake(draft.channelId)) return { ok: false, message: 'Choose a channel to post in, or switch posting off.' }
  return { ok: true, fields: { channelId: draft.channelId, ...(draft.pingIds.length > 0 ? { pingRoleIds: [...draft.pingIds] } : {}) } }
}
