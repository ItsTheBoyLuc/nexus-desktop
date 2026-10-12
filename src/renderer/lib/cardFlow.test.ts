import { describe, expect, it } from 'vitest'
import type { ApiErrorInfo } from '../../shared/types'
import { UiError } from './errors'
import { postFields } from './postTarget'
import { CARD_LOST_TEXT, CARD_POST_LOST_TEXT, cardMayBeThere, createLostText, describeCardError, describeRacingError, RESULT_LOST_TEXT } from './racingView'
import { judgeWrite } from './racingWriteFlow'

const CH = '777000000000000001'
const R = '820000000000000001'
const http = (code: string, status: number, extra: Partial<ApiErrorInfo> = {}): UiError => new UiError({ kind: 'http', code, message: code, status, ...extra })

describe('the Post in a channel section is off by default and sends nothing while off', () => {
  it('off: no fields at all, whatever was chosen before it was switched off', () => {
    expect(postFields({ enabled: false, channelId: CH, pingIds: [R] })).toEqual({ ok: true, fields: {} })
    expect(postFields({ enabled: false, channelId: '', pingIds: [] })).toEqual({ ok: true, fields: {} })
  })
  it('on: the channel is required', () => {
    expect(postFields({ enabled: true, channelId: '', pingIds: [] })).toMatchObject({ ok: false })
    expect(postFields({ enabled: true, channelId: 'general', pingIds: [] })).toMatchObject({ ok: false })
  })
  it('on: the channel, and the roles only when there are some', () => {
    expect(postFields({ enabled: true, channelId: CH, pingIds: [] })).toEqual({ ok: true, fields: { channelId: CH } })
    expect(postFields({ enabled: true, channelId: CH, pingIds: [R] })).toEqual({ ok: true, fields: { channelId: CH, pingRoleIds: [R] } })
  })
})

describe.each(['team', 'event', 'result', 'card'] as const)('the verdict after a failed %s write', (write) => {
  it('manage_server_required disables the action', () => {
    expect(judgeWrite(http('manage_server_required', 403), write)).toMatchObject({ type: 'denied', rule: 'manage' })
  })
  it('a lost answer locks everything', () => {
    for (const error of [new UiError({ kind: 'timeout', code: 'timeout', message: 't', mayHaveBeenSent: true }), http('bot_timeout', 504), http('internal_error', 500), http('discord_error', 502)]) {
      expect(judgeWrite(error, write, true)).toEqual({ type: 'lost' })
    }
  })
  it('with a card, channel and role refusals are explained next to their fields', () => {
    for (const code of ['invalid_channel', 'channel_not_found', 'bot_cannot_send', 'forbidden']) expect(judgeWrite(http(code, 403), write, true)).toEqual({ type: 'channel' })
    for (const code of ['invalid_ping_roles', 'too_many_ping_roles', 'role_not_found', 'role_not_pingable', 'bot_cannot_mention_role']) expect(judgeWrite(http(code, 403), write, true)).toEqual({ type: 'ping' })
  })
  it('429 is a refusal that proves nothing was done', () => {
    expect(judgeWrite(new UiError({ kind: 'rate_limited', code: 'rate_limited', message: 's', status: 429, retryAfter: 60 }), write, true)).toEqual({ type: 'rejected' })
  })
})

describe('without a card a create still treats forbidden as "no longer staff"', () => {
  it.each(['team', 'event', 'result'] as const)('%s', (write) => {
    expect(judgeWrite(http('forbidden', 403), write)).toEqual({ type: 'rejected' })
    expect(judgeWrite(http('forbidden', 403), write, false)).toEqual({ type: 'rejected' })
  })
  it('the dedicated post always has a channel to refuse', () => {
    expect(judgeWrite(http('forbidden', 403), 'card')).toEqual({ type: 'channel' })
  })
})

describe('words', () => {
  it('a create that asked for a card says the card may already be in the channel and may have pinged people', () => {
    expect(createLostText(RESULT_LOST_TEXT, false)).toBe(RESULT_LOST_TEXT)
    const text = createLostText(RESULT_LOST_TEXT, true)
    expect(text).toContain(RESULT_LOST_TEXT)
    expect(text).toContain('already have pinged people')
    expect(text).toContain('Check the channel first')
    expect(CARD_LOST_TEXT).toContain('do not post it again')
  })

  it('a lost dedicated post says to look at the channel and never offers to send again', () => {
    expect(CARD_POST_LOST_TEXT).toContain('already be in the channel')
    expect(CARD_POST_LOST_TEXT).toContain('not sent again')
    expect(CARD_POST_LOST_TEXT).not.toMatch(/retry|post again\b(?! because)/i)
  })

  it('a refusal about the card of a create says nothing was created or posted, in the words given', () => {
    for (const code of ['invalid_ping_roles', 'too_many_ping_roles', 'role_not_found', 'role_not_pingable', 'bot_cannot_mention_role']) {
      expect(describeRacingError(http(code, 403), 'iRacing', 'Nothing was created or posted.')).toMatch(/Nothing was created or posted\.$/)
      expect(describeRacingError(http(code, 403), 'iRacing')).toMatch(/Nothing was posted\.$/)
    }
    expect(describeRacingError(new UiError({ kind: 'rate_limited', code: 'rate_limited', message: 's', status: 429, retryAfter: 60 }), 'iRacing', 'Nothing was added or posted.')).toMatch(/Wait a minute.*Nothing was added or posted\.$/)
  })

  it('bot_cannot_mention_role explains both ways out', () => {
    const text = describeRacingError(http('bot_cannot_mention_role', 403), 'iRacing', 'Nothing was created or posted.')
    expect(text).toContain('mentionable')
    expect(text).toContain('Mention Everyone')
  })

  it('the not-found answers of the dedicated posts are explained', () => {
    expect(describeRacingError(http('event_not_found', 404), 'iRacing')).toContain('no longer exists')
    expect(describeRacingError(http('result_not_found', 404), 'iRacing')).toContain('no longer')
    expect(describeRacingError(http('team_not_found', 404), 'iRacing')).toContain('no longer exists')
  })

  it('post_error codes are told in plain words', () => {
    expect(describeCardError('discord_error')).toBe('Discord rejected the message.')
    expect(describeCardError('bot_cannot_send')).toContain('View Channel')
    expect(describeCardError('bot_cannot_mention_role')).toContain('Mention Everyone')
    expect(describeCardError('something_odd')).toContain('something_odd')
  })

  it('only a bot_timeout post_error may have left a card in the channel', () => {
    expect(cardMayBeThere('bot_timeout')).toBe(true)
    expect(describeCardError('bot_timeout')).toContain('may already be in the channel')
    for (const code of ['discord_error', 'bot_cannot_send', 'channel_not_found', 'forbidden']) expect(cardMayBeThere(code)).toBe(false)
  })
})
