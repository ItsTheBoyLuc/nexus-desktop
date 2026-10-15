import { describe, expect, it, vi } from 'vitest'
import { TEXT_LIMITS } from '../../shared/textLimits'
import type { IpcResult, RacingGame } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { createAttendanceMock } from './attendanceMock'
import { createRacingMock } from './racingMock'
import { createStewardMock } from './stewardMock'
import { checkLongText, checkResultText, fillerText, runLongTextScenario, serverLength } from './textLimitsMock'

/**
 * The two dev:mock scenarios for the long texts: maxtext submits every raised text at exactly its limit (all accepted), overtext
 * one character more (all refused with the documented invalid_* code, nothing stored). The fake server counts like the docs say:
 * trimmed, one Unicode character is 1, and for the fields with a star each underscore is 2.
 */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const CHANNELS = [{ id: '777000000000000001', name: 'announcements' }]

function bridge(scenario = 'normal') {
  let next = 888000000000000700n
  const context = {
    scenario,
    isAdmin: true,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id: string) => id === APEX || id === MIDNIGHT,
    channels: CHANNELS,
    timeoutChannel: '777000000000000007',
    lockedChannel: '777000000000000008',
    hiddenChannel: '777000000000000009',
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSettings: () => undefined,
    liveMessages: new Set<string>(),
    newMessageId: () => String(next++),
    apex: APEX,
    midnight: MIDNIGHT
  }
  const racing = createRacingMock(context).api
  const attendance = createAttendanceMock(context).api
  const steward = createStewardMock(context)
  return { api: { channels: async () => ({ ok: true as const, data: CHANNELS }), ...racing, ...attendance, ...steward.api } } as unknown as Parameters<typeof runLongTextScenario>[0]
}

type EventsApi = { racingEvents: (guild: string, game: RacingGame, page?: { limit: number }) => Promise<IpcResult<{ events: Array<{ name: string; notes: string }> }>> }

describe('the fake server counts like the docs', () => {
  it('trims, counts an emoji as 1, and counts an underscore twice only where the docs have a star', () => {
    expect(serverLength('signupDescription', `  ${'\u{1F3C1}'.repeat(5)}  `)).toBe(5)
    expect(serverLength('signupDescription', '__')).toBe(2)
    expect(serverLength('eventNotes', '__')).toBe(4)
  })
  it('accepts the limit and refuses one more, with the code of the endpoint', () => {
    expect(checkLongText('eventNotes', 'x'.repeat(911))).toBeNull()
    expect(checkLongText('eventNotes', 'x'.repeat(912))).toMatchObject({ ok: false, error: { code: 'invalid_notes', status: 400 } })
    expect(checkLongText('signupDescription', 'x'.repeat(4097))).toMatchObject({ error: { code: 'invalid_description' } })
    expect(checkLongText('penaltyClearReason', 'x'.repeat(4001))).toMatchObject({ error: { code: 'invalid_reason' } })
    expect(checkLongText('decisionExplanation', 'x'.repeat(1025))).toMatchObject({ error: { code: 'invalid_explanation' } })
    expect(checkLongText('eventNotes', undefined)).toBeNull()
  })
  it('a result: the notes alone stop at 714, and result + drivers + notes together at 1014', () => {
    expect(checkResultText({ result: 'x'.repeat(100), drivers: 'y'.repeat(200), notes: 'z'.repeat(714) })).toBeNull()
    expect(checkResultText({ result: 'x', drivers: 'y', notes: 'z'.repeat(715) })).toMatchObject({ error: { code: 'invalid_notes' } })
    expect(checkResultText({ result: '_'.repeat(51), drivers: 'y'.repeat(200), notes: 'z'.repeat(714) })).toMatchObject({ error: { code: 'invalid_notes' } })
  })
  it('the filler is exactly the asked length, plain text, and shows where it starts and ends', () => {
    for (const length of [1, 20, 911, 4096]) expect([...fillerText(length, 'x')].length).toBe(length)
    expect(fillerText(300, 'notes')).toMatch(/^\[notes start\] .* \[notes end\]$/)
  })
})

describe('the scenarios', () => {
  it('maxtext: all nine texts of exactly their limit are accepted', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const outcomes = await runLongTextScenario(bridge('maxtext'), 'maxtext', 'test')
    expect(outcomes.map((item) => item.result)).toEqual(Array(9).fill('accepted'))
    expect(outcomes.map((item) => item.length)).toEqual([
      TEXT_LIMITS.eventNotes, TEXT_LIMITS.resultNotes, TEXT_LIMITS.racingAttendanceDescription, TEXT_LIMITS.f1AttendanceDescription, TEXT_LIMITS.signupDescription,
      TEXT_LIMITS.penaltyPointsReason, TEXT_LIMITS.penaltyClearReason, TEXT_LIMITS.decisionExplanation, TEXT_LIMITS.decisionDescription
    ])
  })

  it('overtext: the same nine texts one character too long are all refused, each with its own code', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const outcomes = await runLongTextScenario(bridge('overtext'), 'overtext', 'test')
    expect(outcomes.map((item) => item.result)).toEqual([
      'refused: invalid_notes', 'refused: invalid_notes', 'refused: invalid_description', 'refused: invalid_description', 'refused: invalid_description',
      'refused: invalid_reason', 'refused: invalid_reason', 'refused: invalid_explanation', 'refused: invalid_description'
    ])
    expect(outcomes.map((item) => item.length)).toEqual([912, 715, 3646, 2521, 4097, 1025, 4001, 1025, 1025])
  })

  it('overtext stores nothing: the event of the scenario is not in the list', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const fake = bridge('overtext')
    await runLongTextScenario(fake, 'overtext', 'test')
    const events = await (fake.api as unknown as EventsApi).racingEvents(APEX, 'lmu', { limit: 100 })
    expect(events.ok && events.data.events.some((event) => event.name === 'Fake Max Text Event')).toBe(false)
  })

  it('maxtext stores them: the event with its 911 characters comes back whole', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const fake = bridge('maxtext')
    await runLongTextScenario(fake, 'maxtext', 'test')
    const events = await (fake.api as unknown as EventsApi).racingEvents(APEX, 'lmu', { limit: 100 })
    const stored = events.ok ? events.data.events.find((event) => event.name === 'Fake Max Text Event') : undefined
    expect([...(stored?.notes ?? '')].length).toBe(TEXT_LIMITS.eventNotes)
  })
})
