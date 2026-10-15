import { describe, expect, it, vi } from 'vitest'
import type { ApiClient, RequestOptions } from './apiClient'
import { createAttendanceApi } from './attendanceApi'
import { createStewardApi } from './f1StewardApi'
import { createRacingApi } from './racingApi'
import { TEXT_LIMITS } from '../shared/textLimits'

/**
 * Texts the API now takes (docs/APP_API.md, "Text limits") come back in lists and details. A response parser that cuts at an
 * old, smaller number would show a legal text half: so each parser keeps a text of exactly the limit, even when it is all emoji
 * (two UTF-16 units per character).
 */
const G = '555000000000000001'
const CH = '777000000000000002'
const MSG = '700000000000000001'
const SIGNUP = '810000000000000001'
const text = (length: number): string => 'x'.repeat(length)
const emoji = (length: number): string => '\u{1F3C1}'.repeat(length)

function client(...answers: unknown[]): ApiClient {
  const queue = [...answers]
  return { request: vi.fn(async (_options: RequestOptions) => queue.shift()) } as unknown as ApiClient
}

describe('attendance and sign-up responses keep the longest legal description', () => {
  const postJson = (description: string) => ({
    message_id: MSG, season: '16', round: '5', circuit: 'Zandvoort', division: 'Elite', description, counts: { present: 0, absent: 0, reserve: 0 },
    attendance: { present: [], absent: [], reserve: [] }
  })
  const signupJson = (description: string) => ({
    signup_id: SIGNUP, title: 'Season 16', description, status: 'open', close_date: null, fields: [], panel_channel_id: CH, confirmation_channel: 'x',
    created_by: '1001', created_at: '2026-01-01T00:00:00Z', participant_count: 0
  })

  it.each([text, emoji])('F1 attendance post: %o', async (make) => {
    const api = createAttendanceApi(client(postJson(make(TEXT_LIMITS.f1AttendanceDescription))))
    expect((await api.attendancePost(G, MSG)).description).toBe(make(TEXT_LIMITS.f1AttendanceDescription))
  })

  it.each([text, emoji])('sign-up panel: %o', async (make) => {
    const api = createAttendanceApi(client({ signup: signupJson(make(TEXT_LIMITS.signupDescription)) }))
    expect((await api.signup(G, SIGNUP)).description).toBe(make(TEXT_LIMITS.signupDescription))
  })
})

describe('esports responses keep the longest legal notes and description', () => {
  it('events: notes of 911', async () => {
    const event = { id: 'e1', name: 'Daytona', date: '2026-09-14', time: '20:00 UTC', class: 'GT3', notes: emoji(TEXT_LIMITS.eventNotes), date_iso: '2026-09-14', created_by: '1', created_at: 't' }
    const page = await createRacingApi(client({ game: 'lmu', total: 1, limit: 25, offset: 0, events: [event] })).racingEvents(G, 'lmu')
    expect(page.events[0]?.notes).toBe(emoji(TEXT_LIMITS.eventNotes))
  })

  it('results: notes of 714', async () => {
    const entry = { id: 'r1', event_name: 'Daytona', team_name: 'Apex', result: 'P3', drivers: 'alice', notes: emoji(TEXT_LIMITS.resultNotes), logged_by: '1', logged_at: 't' }
    const page = await createRacingApi(client({ game: 'lmu', team: null, total: 1, limit: 25, offset: 0, results: [entry] })).racingResults(G, 'lmu')
    expect(page.results[0]?.notes).toBe(emoji(TEXT_LIMITS.resultNotes))
  })

  it('attendance posts: description of 3645', async () => {
    const post = { message_id: MSG, name: 'Practice', date: 'Tuesday', description: emoji(TEXT_LIMITS.racingAttendanceDescription), created_by: '1', created_at: 't', counts: { available: 0, unavailable: 0 } }
    const page = await createRacingApi(client({ game: 'lmu', total: 1, limit: 25, offset: 0, posts: [post] })).racingAttendance(G, 'lmu')
    expect(page.posts[0]?.description).toBe(emoji(TEXT_LIMITS.racingAttendanceDescription))
  })
})

describe('steward responses keep the longest legal reasons', () => {
  it('penalty history: a clear reason of 4000 behind "Admin removed N pts: "', async () => {
    const reason = `Admin removed 99999 pts: ${emoji(TEXT_LIMITS.penaltyClearReason)}`
    const history = [{ index: 1, points: -2, reason, race: 'x', expires_after_race: null, timestamp: 't' }]
    const api = createStewardApi(client({ season: 5, key: 'max_v', display_name: 'Max_V', total_points: 3, incidents: 1, ban: 'none', quali_banned: false, race_banned: false, history }))
    expect((await api.penaltyHistory(G, 'Max V', 5)).history[0]?.reason).toBe(reason)
  })

  it('a report decided with a penalty text of 1024', async () => {
    const penalty = emoji(TEXT_LIMITS.decisionDescription)
    const report = {
      id: '9f1c2ab3d4', number: 1, round_key: 'S5R3', season: '5', round: '3', circuit: 'Zandvoort', reporter: 'alice', reporter_id: '200000000000000001', drivers_involved: 'alice',
      lap: '4', description: 'x', evidence_url: null, evidence_img: null, status: 'penalty_issued', decided: true, penalty, decision: { type: 'penalty_issued', penalty },
      thread_name: 't', message_id: '123456789012345678', timestamp: 't'
    }
    const parsed = await createStewardApi(client(report)).report(G, '9f1c2ab3d4')
    expect(parsed.penalty).toBe(penalty)
    expect(parsed.decision?.penalty).toBe(penalty)
  })
})
