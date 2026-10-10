import { describe, expect, it } from 'vitest'
import type { ApiErrorInfo } from '../../shared/types'
import { describeError, describeWriteError, errorCode, fieldErrorFor, mayHaveSucceeded, outcomeUnknown, UiError } from './errors'

const err = (info: Partial<ApiErrorInfo> & Pick<ApiErrorInfo, 'kind' | 'code'>): UiError => new UiError({ message: 'backend text', ...info })

describe('error messages for the milestone-1 backend codes', () => {
  it('admin_required says only administrators can change it', () => {
    expect(describeError(err({ kind: 'http', code: 'admin_required', status: 403 }))).toMatch(/administrator/i)
  })

  it('role_too_privileged lists what a linkable role must be', () => {
    const text = describeError(err({ kind: 'http', code: 'role_too_privileged', status: 403 }))
    for (const part of ['admin-level', 'below the bot', '@everyone', 'managed by a bot']) expect(text).toContain(part)
  })

  it('other role and tier errors are explained in plain words', () => {
    for (const code of ['role_not_assignable', 'invalid_role', 'role_not_found', 'tier_exists', 'game_exists', 'game_not_found', 'tier_not_found', 'message_not_found', 'not_a_bot_message', 'too_many_tiers', 'too_many_games']) {
      const text = describeError(err({ kind: 'http', code }))
      expect(text, code).not.toBe('backend text')
      expect(text.length, code).toBeGreaterThan(20)
    }
  })

  it('unknown codes fall back to the backend message, non-UI errors to a generic one', () => {
    expect(describeError(err({ kind: 'http', code: 'something_new', message: 'Custom backend text.' }))).toBe('Custom backend text.')
    expect(describeError(new Error('boom'))).toBe('Something went wrong. Please try again.')
  })

  it('exposes the code', () => {
    expect(errorCode(err({ kind: 'http', code: 'forbidden' }))).toBe('forbidden')
    expect(errorCode(new Error('x'))).toBeNull()
  })
})

describe('"the write may already have happened"', () => {
  it('is true for a timeout and for a network failure after the request may have left', () => {
    expect(mayHaveSucceeded(err({ kind: 'timeout', code: 'timeout', mayHaveBeenSent: true }))).toBe(true)
    expect(mayHaveSucceeded(err({ kind: 'timeout', code: 'timeout' }))).toBe(true)
    expect(mayHaveSucceeded(err({ kind: 'network', code: 'network_error', mayHaveBeenSent: true }))).toBe(true)
    expect(mayHaveSucceeded(err({ kind: 'network', code: 'network_error' }))).toBe(true)
  })

  it('is false when the request provably never left, or the backend explained a refusal', () => {
    expect(mayHaveSucceeded(err({ kind: 'network', code: 'network_error', mayHaveBeenSent: false }))).toBe(false)
    expect(mayHaveSucceeded(err({ kind: 'http', code: 'admin_required', status: 403 }))).toBe(false)
    expect(mayHaveSucceeded(err({ kind: 'validation', code: 'invalid_input' }))).toBe(false)
    expect(mayHaveSucceeded(new Error('x'))).toBe(false)
  })

  it('adds the warning to the message only when it applies', () => {
    const lost = describeWriteError(err({ kind: 'timeout', code: 'timeout' }), 'The change')
    expect(lost).toContain('The change may already have happened')
    expect(lost).toMatch(/refresh/i)
    expect(describeWriteError(err({ kind: 'http', code: 'tier_exists' }), 'The change')).not.toContain('may already have happened')
  })
})

describe('error messages for the milestone-2 backend codes', () => {
  it('bot permission errors name the missing permission and say nothing was created', () => {
    expect(describeError(err({ kind: 'http', code: 'bot_missing_manage_roles', status: 403 }))).toMatch(/Manage Roles.*nothing was created/i)
    expect(describeError(err({ kind: 'http', code: 'bot_missing_manage_channels', status: 403 }))).toMatch(/Manage Channels.*nothing was created/i)
  })

  it('fia_required says who may do it; ambiguous_name and team_exists are explained', () => {
    expect(describeError(err({ kind: 'http', code: 'fia_required', status: 403 }))).toMatch(/FIA role/)
    expect(describeError(err({ kind: 'http', code: 'ambiguous_name', status: 400 }))).toMatch(/more than one driver/)
    expect(describeError(err({ kind: 'http', code: 'team_exists', status: 409 }))).toMatch(/already exists/)
  })

  it('every other calendar, team and driver code is plain language, not the raw backend text', () => {
    for (const code of ['calendar_not_found', 'round_not_found', 'round_exists', 'too_many_rounds', 'team_not_found', 'driver_not_found', 'member_not_found', 'bot_cannot_assign_role']) {
      const text = describeError(err({ kind: 'http', code }))
      expect(text, code).not.toBe('backend text')
      expect(text.length, code).toBeGreaterThan(20)
    }
  })

  it('maps a backend code to its form field (e.g. a duplicate team name under the name field)', () => {
    const map = { team_exists: 'name', invalid_color: 'color' } as const
    expect(fieldErrorFor(err({ kind: 'http', code: 'team_exists', status: 409 }), map)).toMatchObject({ field: 'name' })
    expect(fieldErrorFor(err({ kind: 'http', code: 'invalid_color', status: 400 }), map)?.field).toBe('color')
    expect(fieldErrorFor(err({ kind: 'http', code: 'bot_missing_manage_roles', status: 403 }), map)).toBeNull()
    expect(fieldErrorFor(new Error('x'), map)).toBeNull()
  })
})

describe('"the outcome is unknown" for writes that must never be repeated', () => {
  it('a bot timeout and a garbled success answer may have been applied', () => {
    expect(mayHaveSucceeded(err({ kind: 'http', code: 'bot_timeout', status: 504 }))).toBe(true)
    expect(mayHaveSucceeded(err({ kind: 'invalid_response', code: 'invalid_response' }))).toBe(true)
    expect(describeWriteError(err({ kind: 'http', code: 'bot_timeout', status: 504 }), 'The change')).toContain('may already have happened')
  })

  it('race results: any lost answer or server-side failure counts as unknown', () => {
    for (const error of [
      err({ kind: 'timeout', code: 'timeout' }),
      err({ kind: 'network', code: 'network_error', mayHaveBeenSent: true }),
      err({ kind: 'invalid_response', code: 'invalid_response' }),
      err({ kind: 'http', code: 'bot_timeout', status: 504 }),
      err({ kind: 'http', code: 'internal_error', status: 500 }),
      err({ kind: 'http', code: 'discord_error', status: 502 }),
      err({ kind: 'http', code: 'server_unavailable', status: 503 })
    ]) {
      expect(outcomeUnknown(error), error.info.code).toBe(true)
    }
  })

  it('race results: refusals that prove nothing happened are definite, so the form stays usable', () => {
    for (const error of [
      err({ kind: 'http', code: 'fia_required', status: 403 }),
      err({ kind: 'http', code: 'ambiguous_name', status: 400 }),
      err({ kind: 'http', code: 'invalid_results', status: 400 }),
      err({ kind: 'http', code: 'bot_unavailable', status: 503 }),
      err({ kind: 'rate_limited', code: 'rate_limited', status: 429 }),
      err({ kind: 'network', code: 'network_error', mayHaveBeenSent: false }),
      err({ kind: 'validation', code: 'invalid_input' }),
      err({ kind: 'session', code: 'session_ended' })
    ]) {
      expect(outcomeUnknown(error), error.info.code).toBe(false)
    }
    expect(outcomeUnknown(new Error('x'))).toBe(false)
  })
})
