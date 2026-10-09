import { describe, expect, it } from 'vitest'
import type { ApiErrorInfo } from '../../shared/types'
import { describeError, describeWriteError, errorCode, mayHaveSucceeded, UiError } from './errors'

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
