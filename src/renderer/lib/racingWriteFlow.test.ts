import { describe, expect, it } from 'vitest'
import type { ApiErrorInfo } from '../../shared/types'
import { UiError } from './errors'
import { availableActions, judgeWrite, phaseAfter } from './racingWriteFlow'
import type { RacingWrite, WritePhase } from './racingWriteFlow'

const error = (info: Partial<ApiErrorInfo> & { code: string }): UiError => new UiError({ kind: 'http', message: info.code, ...info })
const WRITES: RacingWrite[] = ['result', 'attendance', 'announcement']

describe.each(WRITES)('after a failed %s write', (write) => {
  it.each([
    ['a timeout', { kind: 'timeout', code: 'timeout', mayHaveBeenSent: true }],
    ['a dropped connection', { kind: 'network', code: 'network', mayHaveBeenSent: true }],
    ['a bot_timeout (504)', { kind: 'http', code: 'bot_timeout', status: 504 }],
    ['a 502 discord_error', { kind: 'http', code: 'discord_error', status: 502 }],
    ['a 500', { kind: 'http', code: 'internal_error', status: 500 }],
    ['an answer that is not what the docs describe', { kind: 'invalid_response', code: 'invalid_response' }]
  ] as const)('%s means the outcome is unknown: the form locks and nothing can be sent again', (_name, info) => {
    const verdict = judgeWrite(error({ ...info }), write)
    expect(verdict).toEqual({ type: 'lost' })
    const phase = phaseAfter(verdict)
    expect(phase).toBe('lost')
    expect(availableActions(phase)).not.toContain('send')
    expect(availableActions(phase)).not.toContain('review')
    expect(availableActions(phase)).not.toContain('edit')
  })

  it('a request that provably never reached the server can be corrected and sent again', () => {
    expect(judgeWrite(error({ kind: 'network', code: 'network', mayHaveBeenSent: false }), write)).toEqual({ type: 'rejected' })
    expect(judgeWrite(error({ kind: 'validation', code: 'unknown_game', mayHaveBeenSent: false }), write)).toEqual({ type: 'rejected' })
    expect(judgeWrite(error({ kind: 'rate_limited', code: 'rate_limited', status: 429 }), write)).toEqual({ type: 'rejected' })
    expect(judgeWrite(error({ code: 'bot_unavailable', status: 503 }), write)).toEqual({ type: 'rejected' })
  })

  it('a field refusal is not an unknown outcome', () => {
    expect(judgeWrite(error({ code: 'invalid_title', status: 400 }), write)).toEqual({ type: 'rejected' })
    expect(phaseAfter({ type: 'rejected' })).toBe('editing')
  })

  it('anything that is not an error from the bridge is not treated as lost', () => {
    expect(judgeWrite(new Error('boom'), write)).toEqual({ type: 'rejected' })
    expect(judgeWrite(undefined, write)).toEqual({ type: 'rejected' })
  })
})

describe('permissions are per write', () => {
  it('logging a result is refused with manage_server_required: the Manage Server rule', () => {
    expect(judgeWrite(error({ code: 'manage_server_required', status: 403 }), 'result')).toEqual({ type: 'denied', rule: 'manage' })
  })

  it.each(['attendance', 'announcement'] as const)('%s is refused with manager_required: the Manager rule, per game', (write) => {
    expect(judgeWrite(error({ code: 'manager_required', status: 403 }), write)).toEqual({ type: 'denied', rule: 'manager' })
    // The other write's code does not disable this one.
    expect(judgeWrite(error({ code: 'manage_server_required', status: 403 }), write)).toEqual({ type: 'rejected' })
  })

  it('manager_required does not disable logging a result', () => {
    expect(judgeWrite(error({ code: 'manager_required', status: 403 }), 'result')).toEqual({ type: 'rejected' })
  })

  it('a 403 forbidden on a result is "no longer staff", not a channel problem; on a post it is the channel', () => {
    expect(judgeWrite(error({ code: 'forbidden', status: 403 }), 'result')).toEqual({ type: 'rejected' })
    expect(judgeWrite(error({ code: 'forbidden', status: 403 }), 'attendance')).toEqual({ type: 'channel' })
    expect(judgeWrite(error({ code: 'bot_cannot_send', status: 403 }), 'announcement')).toEqual({ type: 'channel' })
    expect(judgeWrite(error({ code: 'channel_not_found', status: 404 }), 'attendance')).toEqual({ type: 'channel' })
    expect(judgeWrite(error({ code: 'invalid_channel', status: 400 }), 'announcement')).toEqual({ type: 'channel' })
  })

  it('a denied write goes back to editing, with the action disabled by the screen', () => {
    expect(phaseAfter({ type: 'denied', rule: 'manager' })).toBe('editing')
    expect(phaseAfter({ type: 'channel' })).toBe('editing')
  })
})

describe('the phases', () => {
  it('while saving nothing can be done, so a second send is impossible', () => {
    expect(availableActions('saving')).toEqual([])
  })

  it('a lost answer offers only refresh and close', () => {
    expect(availableActions('lost')).toEqual(['refresh', 'close'])
  })

  it('every phase that can send is reached through the confirmation, and only from there', () => {
    const phases: WritePhase[] = ['editing', 'confirming', 'saving', 'lost', 'done']
    expect(phases.filter((phase) => availableActions(phase).includes('send'))).toEqual(['confirming'])
    expect(availableActions('editing')).toContain('review')
  })

  it('success finishes', () => {
    expect(phaseAfter('ok')).toBe('done')
  })
})
