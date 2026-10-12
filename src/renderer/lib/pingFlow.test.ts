import { describe, expect, it } from 'vitest'
import type { ApiErrorInfo } from '../../shared/types'
import { UiError } from './errors'
import { ANNOUNCEMENT_LOST_TEXT, announcementLostText, ATTENDANCE_LOST_TEXT, attendanceLostText, describeRacingError } from './racingView'
import { isPingError, judgeWrite, PING_ERROR_CODES } from './racingWriteFlow'

const http = (code: string, status: number, extra: Partial<ApiErrorInfo> = {}): UiError => new UiError({ kind: 'http', code, message: code, status, ...extra })
const lostAnswers: UiError[] = [
  new UiError({ kind: 'timeout', code: 'timeout', message: 'timeout', mayHaveBeenSent: true }),
  new UiError({ kind: 'network', code: 'network', message: 'network', mayHaveBeenSent: true }),
  http('bot_timeout', 504),
  http('discord_error', 502),
  http('internal_error', 500)
]

describe.each(['attendance', 'announcement'] as const)('the verdict after a failed %s post', (write) => {
  it.each(PING_ERROR_CODES)('%s: nothing was posted, the roles stay and can be fixed', (code) => {
    const status = code === 'role_not_found' ? 404 : code.startsWith('bot_') || code === 'role_not_pingable' ? 403 : 400
    expect(judgeWrite(http(code, status), write)).toEqual({ type: 'ping' })
    expect(isPingError(http(code, status))).toBe(true)
  })

  it.each(lostAnswers)('a lost answer ($info.kind $info.code) locks the form: the outcome is unknown and nothing offers to send it again', (error) => {
    expect(judgeWrite(error, write)).toEqual({ type: 'lost' })
  })

  it('manager_required disables posting for the game', () => {
    expect(judgeWrite(http('manager_required', 403), write)).toMatchObject({ type: 'denied', rule: 'manager' })
  })

  it.each(['invalid_channel', 'channel_not_found', 'bot_cannot_send', 'forbidden'])('%s is a channel problem, not a role problem', (code) => {
    expect(judgeWrite(http(code, code === 'channel_not_found' ? 404 : 403), write)).toEqual({ type: 'channel' })
    expect(isPingError(http(code, 403))).toBe(false)
  })

  it('429 (the ping limit) proves nothing was posted: a refusal the user may try again later, never a lost answer', () => {
    const error = new UiError({ kind: 'rate_limited', code: 'rate_limited', message: 'slow', status: 429, retryAfter: 60 })
    expect(judgeWrite(error, write)).toEqual({ type: 'rejected' })
  })

  it('a refusal that proves nothing was done is never treated as lost', () => {
    for (const code of PING_ERROR_CODES) expect(judgeWrite(http(code, 403), write).type).not.toBe('lost')
  })
})

describe('the words for the refusals (plain, and they say nothing was posted)', () => {
  const words = (code: string, status = 400, extra: Partial<ApiErrorInfo> = {}): string => describeRacingError(http(code, status, extra), 'iRacing')

  it.each(['invalid_ping_roles', 'too_many_ping_roles', 'role_not_found', 'role_not_pingable', 'bot_cannot_mention_role'])('%s ends with "Nothing was posted."', (code) => {
    expect(words(code)).toMatch(/Nothing was posted\.$/)
  })

  it('bot_cannot_mention_role explains both ways out: make the role mentionable, or give the bot Mention Everyone', () => {
    const text = words('bot_cannot_mention_role', 403)
    expect(text).toContain('mentionable')
    expect(text).toContain('Mention Everyone')
  })

  it('too_many_ping_roles names the limit of 3', () => expect(words('too_many_ping_roles')).toContain('3'))
  it('role_not_pingable names @everyone and bot roles', () => expect(words('role_not_pingable', 403)).toMatch(/@everyone.*bot/))

  it('429 says to wait a minute and names the limit of 5 pinging posts a minute', () => {
    const text = describeRacingError(new UiError({ kind: 'rate_limited', code: 'rate_limited', message: 'slow', status: 429, retryAfter: 60 }), 'iRacing')
    expect(text).toContain('Wait a minute')
    expect(text).toContain('5 per minute')
    expect(text).toMatch(/Nothing was posted\.$/)
  })

  it('manager_required explains which permission is needed', () => {
    const text = words('manager_required', 403)
    expect(text).toContain('Manage Server')
    expect(text).toContain('Manager or Coach')
  })

  it('never offers a retry', () => {
    for (const code of [...PING_ERROR_CODES, 'manager_required']) expect(words(code, 403).toLowerCase()).not.toMatch(/try again with the same|send it again now|retry/)
  })
})

describe('what a lost answer says', () => {
  it('without roles it is the text of before', () => {
    expect(attendanceLostText(false)).toBe(ATTENDANCE_LOST_TEXT)
    expect(announcementLostText(false)).toBe(ANNOUNCEMENT_LOST_TEXT)
  })

  it('with roles it says the message may already have pinged people and to check the channel first', () => {
    for (const text of [attendanceLostText(true), announcementLostText(true)]) {
      expect(text).toContain('already have pinged people')
      expect(text).toContain('Check the channel first')
      expect(text).toContain('not sent again')
    }
  })

  it('for an attendance post it adds the caveat: a saved-after-sent failure deletes the message but pinged members keep the notification', () => {
    const text = attendanceLostText(true)
    expect(text).toContain('deleted the message again')
    expect(text).toContain('keep the notification')
  })

  it('the announcement does not claim a deletion (it stores nothing)', () => {
    expect(announcementLostText(true)).not.toContain('deleted')
  })

  it('neither text offers to send the same data again', () => {
    for (const text of [attendanceLostText(true), announcementLostText(true)]) expect(text).not.toMatch(/post again|send again|retry/i)
  })
})
