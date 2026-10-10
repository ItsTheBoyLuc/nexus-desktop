import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from './apiClient'
import type { RequestOptions } from './apiClient'
import { createAttendanceApi } from './attendanceApi'

const G = '555000000000000001'
const CH = '777000000000000002'
const MSG = '700000000000000001'
const SIGNUP = '810000000000000001'
const BASE = `/api/app/v1/guilds/${G}`

/** An ApiClient whose answers are scripted; records every request so paths, methods and bodies can be checked. */
function setup(...answers: unknown[]) {
  const calls: RequestOptions[] = []
  const queue = [...answers]
  const request = vi.fn(async (options: RequestOptions) => {
    calls.push(options)
    const next = queue.shift()
    if (next instanceof Error) throw next
    return next
  })
  return { api: createAttendanceApi({ request } as unknown as ApiClient), calls, request }
}

const driver = (id: string, name: string | null, inServer = true) => ({ user_id: id, name, in_server: inServer })
const divisionJson = (over: Record<string, unknown> = {}) => ({ name: 'Elite', regular_drivers: [driver('2001', 'Ally')], reserve_drivers: [driver('2003', 'carol_x')], ...over })
const postJson = (over: Record<string, unknown> = {}) => ({
  message_id: MSG, season: '16', round: '5', circuit: 'Zandvoort', division: 'Elite', description: 'Sprint weekend', counts: { present: 1, absent: 1, reserve: 0 },
  attendance: { present: [driver('2001', 'Ally')], absent: [driver('2002', null, false)], reserve: [] }, ...over
})
const signupJson = (over: Record<string, unknown> = {}) => ({
  signup_id: SIGNUP, title: 'Season 16 Sign-up', description: 'Rules', status: 'open', close_date: '2026-06-01', fields: [], panel_channel_id: CH, confirmation_channel: 'signup-confirmations',
  created_by: '1001', created_at: '2026-01-01T00:00:00Z', participant_count: 2, ...over
})
const participantJson = (over: Record<string, unknown> = {}) => ({
  user_id: '2001', username: 'fake_user_001', display_name: 'Fake Driver 001', in_server: true, platform: 'steam', platform_name: 'Steam', platform_emoji: '🖥️', platform_username: 'FakeRacer1',
  answers: [{ question: 'What is your first name?', answer: 'Test' }], timestamp: '2026-01-02T00:00:00Z', ...over
})

describe('attendance divisions', () => {
  it('GET reads the lists as names, a driver who left has no name, and the legacy lists only when sent', async () => {
    const { api, calls } = setup(
      { divisions: [divisionJson(), divisionJson({ name: 'Pro-Am', regular_drivers: [driver('2004', null, false)] })], legacy: null },
      { divisions: [], legacy: { regular_drivers: [driver('2001', 'Ally')], reserve_drivers: [] } }
    )
    const first = await api.attendanceDivisions(G)
    expect(calls[0]).toMatchObject({ path: `${BASE}/f1/attendance/divisions` })
    expect(calls[0]?.method).toBeUndefined()
    expect(first.divisions[0]).toEqual({ name: 'Elite', regularDrivers: [{ userId: '2001', name: 'Ally', inServer: true }], reserveDrivers: [{ userId: '2003', name: 'carol_x', inServer: true }] })
    expect(first.divisions[1]?.regularDrivers[0]).toEqual({ userId: '2004', name: null, inServer: false })
    expect(first.legacy).toBeNull()
    expect((await api.attendanceDivisions(G)).legacy?.regularDrivers).toHaveLength(1)
  })

  it('PUT sends only the lists that are in the input: a list that is left out is NOT in the body (the server keeps it)', async () => {
    const answer = { division: divisionJson(), created: false, overlap: [] }
    const { api, calls } = setup(answer, answer, answer, answer)
    await api.saveAttendanceDivision(G, { name: 'Elite', regularDrivers: ['2001'] })
    await api.saveAttendanceDivision(G, { name: 'Elite', reserveDrivers: ['2003'] })
    await api.saveAttendanceDivision(G, { name: 'Elite', regularDrivers: ['2001'], reserveDrivers: [] })
    await api.saveAttendanceDivision(G, { name: 'Elite' })
    expect(calls.map((call) => [call.method, call.path])).toEqual(Array(4).fill(['PUT', `${BASE}/f1/attendance/divisions`]))
    expect(calls[0]?.body).toEqual({ name: 'Elite', regular_drivers: ['2001'] })
    expect(calls[1]?.body).toEqual({ name: 'Elite', reserve_drivers: ['2003'] })
    expect(calls[2]?.body).toEqual({ name: 'Elite', regular_drivers: ['2001'], reserve_drivers: [] }) // [] is an edit: it clears the list
    expect(calls[3]?.body).toEqual({ name: 'Elite' })
  })

  it('reads created and the overlap (user ids in both lists)', async () => {
    const { api } = setup({ division: divisionJson(), created: true, overlap: ['2001', 'junk'] })
    expect(await api.saveAttendanceDivision(G, { name: 'Elite', regularDrivers: ['2001'], reserveDrivers: ['2001'] })).toMatchObject({ created: true, overlap: ['2001'] })
  })

  it('a missing overlap is no overlap; a malformed answer is rejected', async () => {
    expect((await setup({ division: divisionJson(), created: false }).api.saveAttendanceDivision(G, { name: 'Elite', regularDrivers: [] })).overlap).toEqual([])
    await expect(setup({ division: {}, created: false }).api.saveAttendanceDivision(G, { name: 'Elite', regularDrivers: [] })).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('attendance posts', () => {
  it('GET list sends the filters as query parameters and parses the page', async () => {
    const { api, calls } = setup({ posts: [{ message_id: MSG, season: '16', round: '5', circuit: 'Zandvoort', division: 'Elite', description: '', counts: { present: 1, absent: 1, reserve: 0 } }], total: 2, limit: 25, offset: 0 })
    const page = await api.attendancePosts(G, { division: 'Pro Am', season: '16', limit: 100, offset: 25 })
    expect(calls[0]?.path).toBe(`${BASE}/f1/attendance/posts?division=Pro+Am&season=16&limit=100&offset=25`)
    expect(page).toMatchObject({ total: 2, limit: 25, offset: 0 })
    expect(page.posts[0]).toEqual({ messageId: MSG, season: '16', round: '5', circuit: 'Zandvoort', division: 'Elite', description: '', counts: { present: 1, absent: 1, reserve: 0 } })
  })

  it('has no query without filters; a post of the pre-division days has no division', async () => {
    const { api, calls } = setup({ posts: [{ message_id: MSG, season: '1', round: '1', circuit: 'x', division: null, description: '', counts: {} }], total: 1, limit: 25, offset: 0 })
    expect((await api.attendancePosts(G)).posts[0]).toMatchObject({ division: null, counts: { present: 0, absent: 0, reserve: 0 } })
    expect(calls[0]?.path).toBe(`${BASE}/f1/attendance/posts`)
  })

  it('GET one reads present, absent and reserve as names (the stored name of someone who left is kept)', async () => {
    const { api, calls } = setup(postJson({ attendance: { present: [driver('2001', 'Ally')], absent: [driver('2002', 'old_name', false)], reserve: [driver('2003', 'carol_x')] } }))
    const post = await api.attendancePost(G, MSG)
    expect(calls[0]?.path).toBe(`${BASE}/f1/attendance/posts/${MSG}`)
    expect(post.attendance.absent[0]).toEqual({ userId: '2002', name: 'old_name', inServer: false })
    expect(post.attendance.reserve[0]?.name).toBe('carol_x')
  })

  it('refuses a message id that could change the path before any request', async () => {
    const { api, request } = setup()
    for (const bad of ['', '../x', 'a/b', '12 3', 'abc']) await expect(api.attendancePost(G, bad), bad).rejects.toMatchObject({ kind: 'validation', code: 'invalid_message_id' })
    expect(request).not.toHaveBeenCalled()
  })

  it('POST sends the documented body, the optional description only when given, and returns the message id and channel the API returned', async () => {
    const answer = { post: postJson(), channel_id: CH }
    const { api, calls } = setup(answer, answer)
    const created = await api.createAttendancePost(G, { channelId: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort' })
    await api.createAttendancePost(G, { channelId: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort', description: 'Sprint weekend' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/f1/attendance/posts` })
    expect(calls[0]?.body).toEqual({ channel_id: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort' })
    expect(calls[1]?.body).toMatchObject({ description: 'Sprint weekend' })
    expect(created.channelId).toBe(CH)
    expect(created.post.messageId).toBe(MSG)
  })

  it('refuses an invalid channel before any request', async () => {
    const { api, request } = setup()
    await expect(api.createAttendancePost(G, { channelId: 'general', division: 'Elite', season: '1', round: '1', circuit: 'x' })).rejects.toMatchObject({ code: 'invalid_channel' })
    expect(request).not.toHaveBeenCalled()
  })
})

describe('sign-up questions', () => {
  const questionsJson = (over: Record<string, unknown> = {}) => ({
    questions: ['What is your team?'], using_defaults: false,
    default_questions: [{ label: 'What is your first name?', placeholder: null, required: true }],
    effective_questions: [{ label: 'What is your team?', placeholder: null, required: true }],
    max_questions: 2, max_question_length: 45, can_edit: true, ...over
  })

  it('GET reads the custom, default and effective questions with the limits and can_edit', async () => {
    const { api, calls } = setup(questionsJson(), questionsJson({ can_edit: undefined, questions: [], using_defaults: true }))
    expect(await api.signupQuestions(G)).toMatchObject({ questions: ['What is your team?'], usingDefaults: false, maxQuestions: 2, maxQuestionLength: 45, canEdit: true })
    expect(calls[0]?.path).toBe(`${BASE}/league/signup-questions`)
    expect(await api.signupQuestions(G)).toMatchObject({ usingDefaults: true, canEdit: null })
  })

  it('PUT replaces the whole list (an empty list restores the defaults)', async () => {
    const { api, calls } = setup(questionsJson(), questionsJson({ questions: [], using_defaults: true }))
    await api.saveSignupQuestions(G, ['What is your team?', 'Referred by'])
    await api.saveSignupQuestions(G, [])
    expect(calls[0]).toMatchObject({ method: 'PUT', path: `${BASE}/league/signup-questions`, body: { questions: ['What is your team?', 'Referred by'] } })
    expect(calls[1]?.body).toEqual({ questions: [] })
  })

  it('rejects an answer without the limits', async () => {
    await expect(setup({ questions: [] }).api.signupQuestions(G)).rejects.toMatchObject({ kind: 'invalid_response' })
  })
})

describe('sign-ups', () => {
  it('GET list passes the status filter and reads status, close date, count and the confirmation channel name', async () => {
    const { api, calls } = setup({ signups: [signupJson(), signupJson({ signup_id: '810000000000000002', status: 'closed', close_date: null, fields: ['Own question'] })] }, { signups: [] })
    const all = await api.signups(G)
    expect(calls[0]?.path).toBe(`${BASE}/league/signups`)
    expect(all[0]).toMatchObject({ signupId: SIGNUP, title: 'Season 16 Sign-up', status: 'open', closeDate: '2026-06-01', participantCount: 2, confirmationChannel: 'signup-confirmations', customQuestionCount: 0 })
    expect(all[1]).toMatchObject({ status: 'closed', closeDate: null, customQuestionCount: 1 })
    expect(await api.signups(G, 'open')).toEqual([])
    expect(calls[1]?.path).toBe(`${BASE}/league/signups?status=open`)
  })

  it('an unknown status is a malformed answer', async () => {
    await expect(setup({ signups: [signupJson({ status: 'archived' })] }).api.signups(G)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('GET one reads {signup}', async () => {
    const { api, calls } = setup({ signup: signupJson() })
    expect((await api.signup(G, SIGNUP)).title).toBe('Season 16 Sign-up')
    expect(calls[0]?.path).toBe(`${BASE}/league/signups/${SIGNUP}`)
  })

  it('participants: paged query, every answer in order, plain text kept exactly as typed, and a member who left has no display name', async () => {
    const { api, calls } = setup({
      signup: signupJson(), total: 130, limit: 100, offset: 100,
      participants: [participantJson({ answers: [{ question: 'Age', answer: '<script>alert(1)</script>' }, { question: 'Nationality', answer: 'Testland' }] }), participantJson({ user_id: '2002', display_name: null, in_server: false })]
    })
    const page = await api.signupParticipants(G, SIGNUP, { limit: 100, offset: 100 })
    expect(calls[0]?.path).toBe(`${BASE}/league/signups/${SIGNUP}/participants?limit=100&offset=100`)
    expect(page).toMatchObject({ total: 130, limit: 100, offset: 100 })
    expect(page.participants[0]?.answers).toEqual([{ question: 'Age', answer: '<script>alert(1)</script>' }, { question: 'Nationality', answer: 'Testland' }])
    expect(page.participants[1]).toMatchObject({ inServer: false, displayName: null })
    expect(page.participants[0]).not.toHaveProperty('platformEmoji') // the app shows no emoji
  })

  it('a participant without a user id or answer list is rejected rather than shown wrong', async () => {
    await expect(setup({ signup: signupJson(), total: 1, limit: 25, offset: 0, participants: [{ username: 'x' }] }).api.signupParticipants(G, SIGNUP)).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('refuses a sign-up id that could change the path', async () => {
    const { api, request } = setup()
    for (const bad of ['', '../x', '1/2', 'abc']) {
      await expect(api.signup(G, bad), bad).rejects.toMatchObject({ code: 'invalid_signup_id' })
      await expect(api.closeSignup(G, bad), bad).rejects.toMatchObject({ code: 'invalid_signup_id' })
      await expect(api.signupParticipants(G, bad), bad).rejects.toMatchObject({ code: 'invalid_signup_id' })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('POST creates with the documented body: the confirmation channel and close date only when given, no per-sign-up questions', async () => {
    const answer = { signup: signupJson(), channel_id: CH }
    const { api, calls } = setup(answer, answer)
    await api.createSignup(G, { title: 'Season 16 Sign-up', channelId: CH })
    const created = await api.createSignup(G, { title: 'Season 16 Sign-up', description: 'Rules', channelId: CH, confirmationChannelId: '777000000000000003', closeDate: '2026-06-01' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/league/signups` })
    expect(calls[0]?.body).toEqual({ title: 'Season 16 Sign-up', channel_id: CH })
    expect(calls[1]?.body).toEqual({ title: 'Season 16 Sign-up', description: 'Rules', channel_id: CH, confirmation_channel_id: '777000000000000003', close_date: '2026-06-01' })
    expect(Object.keys(calls[1]?.body as object)).not.toContain('fields')
    expect(created).toMatchObject({ channelId: CH, signup: { signupId: SIGNUP } })
  })

  it('refuses invalid channel ids before any request', async () => {
    const { api, request } = setup()
    await expect(api.createSignup(G, { title: 'x', channelId: 'general' })).rejects.toMatchObject({ code: 'invalid_channel' })
    await expect(api.createSignup(G, { title: 'x', channelId: CH, confirmationChannelId: 'logs' })).rejects.toMatchObject({ code: 'invalid_confirmation_channel' })
    expect(request).not.toHaveBeenCalled()
  })

  it('close sends no body and reports whether the panel could be greyed out', async () => {
    const { api, calls } = setup({ ok: true, signup: signupJson({ status: 'closed' }), panel_updated: true, panel_error: null }, { ok: true, signup: signupJson({ status: 'closed' }), panel_updated: false, panel_error: 'panel_message_not_found' })
    expect(await api.closeSignup(G, SIGNUP)).toMatchObject({ panelUpdated: true, panelError: null, signup: { status: 'closed' } })
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${BASE}/league/signups/${SIGNUP}/close` })
    expect(calls[0]?.body).toBeUndefined()
    expect(await api.closeSignup(G, SIGNUP)).toMatchObject({ panelUpdated: false, panelError: 'panel_message_not_found' })
  })

  it('DELETE removes one participant by user id, no body, and returns the new count', async () => {
    const { api, calls } = setup({ ok: true, removed: { user_id: '2001', username: 'fake_user_001' }, participant_count: 1 })
    expect(await api.removeParticipant(G, SIGNUP, '2001')).toEqual({ userId: '2001', username: 'fake_user_001', participantCount: 1 })
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: `${BASE}/league/signups/${SIGNUP}/participants/2001` })
    expect(calls[0]?.body).toBeUndefined()
    await expect(api.removeParticipant(G, SIGNUP, '../x')).rejects.toMatchObject({ code: 'invalid_user_id' })
  })
})

describe('writes are sent exactly once (never replayed, whatever goes wrong)', () => {
  function realClient(handler: (signal: AbortSignal | undefined) => Promise<Response>) {
    let calls = 0
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls++
      return handler(init?.signal ?? undefined)
    }) as typeof fetch
    const client = new ApiClient({ baseUrl: 'https://api.test', fetchImpl, timeoutMs: 30, wakeAfterMs: 1000, sleep: async () => undefined })
    client.setSession({ access_token: 'access', refresh_token: 'refresh' })
    return { api: createAttendanceApi(client), calls: () => calls }
  }
  const hang = (signal: AbortSignal | undefined): Promise<Response> =>
    new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  const dropped = async (): Promise<Response> => {
    const error = new TypeError('fetch failed')
    ;(error as { cause?: unknown }).cause = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
    throw error
  }
  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const creates: Array<[string, (api: ReturnType<typeof createAttendanceApi>) => Promise<unknown>]> = [
    ['create an attendance post', (api) => api.createAttendancePost(G, { channelId: CH, division: 'Elite', season: '16', round: '5', circuit: 'Zandvoort' })],
    ['create a sign-up', (api) => api.createSignup(G, { title: 'Season 16 Sign-up', channelId: CH })],
    ['close a sign-up', (api) => api.closeSignup(G, SIGNUP)],
    ['remove a participant', (api) => api.removeParticipant(G, SIGNUP, '2001')],
    ['save a division', (api) => api.saveAttendanceDivision(G, { name: 'Elite', regularDrivers: ['2001'] })],
    ['save the questions', (api) => api.saveSignupQuestions(G, ['What is your team?'])]
  ]

  it.each(creates)('%s: a timeout is reported once and the request is not repeated', async (_name, run) => {
    const { api, calls } = realClient(hang)
    await expect(run(api)).rejects.toMatchObject({ kind: 'timeout', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it.each(creates)('%s: a dropped connection is not repeated', async (_name, run) => {
    const { api, calls } = realClient(dropped)
    await expect(run(api)).rejects.toMatchObject({ kind: 'network', mayHaveBeenSent: true })
    expect(calls()).toBe(1)
  })

  it.each([[504, 'bot_timeout'], [502, 'discord_error'], [500, 'internal_error']] as const)('creating a post or a sign-up after %i %s is reported as it is, once', async (status, code) => {
    for (const run of [creates[0]![1], creates[1]![1]]) {
      const { api, calls } = realClient(async () => json(status, { error: code, message: code }))
      await expect(run(api)).rejects.toBeInstanceOf(ApiError)
      expect(calls()).toBe(1)
    }
  })

  it.each([
    [403, 'bot_cannot_post_confirmations'],
    [403, 'bot_missing_manage_channels'],
    [409, 'confirmation_channel_ambiguous'],
    [404, 'confirmation_channel_not_found'],
    [403, 'bot_cannot_send'],
    [409, 'already_closed']
  ])('%i %s comes through with its code', async (status, code) => {
    const { api } = realClient(async () => json(status, { error: code, message: code }))
    await expect(api.createSignup(G, { title: 'x', channelId: CH })).rejects.toMatchObject({ kind: 'http', code, status })
  })
})
