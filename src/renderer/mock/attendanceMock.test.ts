import { describe, expect, it } from 'vitest'
import type { IpcResult } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { createAttendanceMock } from './attendanceMock'

/**
 * The fake attendance and sign-up backend is what every M4 screen is reviewed against in `npm run dev:mock`, so the cases it
 * promises (see its header) are pinned here: no divisions, a division with an overlap, many posts, a post with 20+ drivers,
 * an empty sign-up list, an open and a closed sign-up, 100+ participants, the role and bot-permission errors, a lost answer
 * on both creates and a participant who left the server. The participants must be obviously fake.
 */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const CH_OK = '777000000000000001'
const CH_SIGNUP = '777000000000000005'
const CH_TIMEOUT = '777000000000000007'
const CH_LOCKED = '777000000000000008'
const CH_HIDDEN = '777000000000000009'
const CHANNELS = [CH_OK, CH_SIGNUP, CH_TIMEOUT, CH_LOCKED, CH_HIDDEN].map((id) => ({ id, name: `c${id.slice(-2)}` }))

function setup(scenario = 'normal', isAdmin = true) {
  return createAttendanceMock({
    scenario,
    isAdmin,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id: string) => id === APEX || id === MIDNIGHT,
    channels: CHANNELS,
    timeoutChannel: CH_TIMEOUT,
    lockedChannel: CH_LOCKED,
    hiddenChannel: CH_HIDDEN,
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSettings: () => undefined,
    liveMessages: new Set<string>(),
    newMessageId: () => '1',
    apex: APEX,
    midnight: MIDNIGHT
  }).api
}

const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}
const code = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.code)
const kind = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.kind)

describe('divisions', () => {
  it('Apex has Elite (with a driver who left) and Pro-Am (a driver in BOTH lists), sorted by name', async () => {
    const api = setup()
    const { divisions, legacy } = ok(await api.attendanceDivisions(APEX))
    expect(divisions.map((division) => division.name)).toEqual(['Elite', 'Pro-Am'])
    expect(legacy).toBeNull()
    expect(divisions[0]!.reserveDrivers.some((driver) => !driver.inServer && driver.name === null)).toBe(true)
    const proAm = divisions[1]!
    const both = proAm.regularDrivers.filter((driver) => proAm.reserveDrivers.some((reserve) => reserve.userId === driver.userId))
    expect(both).toHaveLength(1)
  })

  it('nodivisions: no division and no post', async () => {
    const api = setup('nodivisions')
    expect(ok(await api.attendanceDivisions(APEX)).divisions).toEqual([])
    expect(ok(await api.attendancePosts(MIDNIGHT)).total).toBe(0)
  })

  it('a list that is left out keeps its value; [] clears it; the response lists the overlap', async () => {
    const api = setup()
    const elite = ok(await api.attendanceDivisions(APEX)).divisions[0]!
    const regular = elite.regularDrivers.map((driver) => driver.userId)
    const onlyReserve = ok(await api.saveAttendanceDivision(APEX, { name: 'Elite', reserveDrivers: [] }))
    expect(onlyReserve).toMatchObject({ created: false, overlap: [] })
    expect(onlyReserve.division.reserveDrivers).toEqual([])
    expect(onlyReserve.division.regularDrivers.map((driver) => driver.userId)).toEqual(regular) // untouched
    const overlap = ok(await api.saveAttendanceDivision(APEX, { name: 'Elite', reserveDrivers: [regular[0]!] }))
    expect(overlap.overlap).toEqual([regular[0]])
    expect(overlap.division.regularDrivers.map((driver) => driver.userId)).toEqual(regular)
  })

  it('creating a division answers created: true, starts empty, is case-sensitive; a division with no list to change is no_changes', async () => {
    const api = setup()
    expect(ok(await api.saveAttendanceDivision(APEX, { name: 'Gold' }))).toMatchObject({ created: true, overlap: [], division: { name: 'Gold', regularDrivers: [], reserveDrivers: [] } })
    expect(code(await api.saveAttendanceDivision(APEX, { name: 'Gold' }))).toBe('no_changes')
    expect(ok(await api.saveAttendanceDivision(APEX, { name: 'gold' })).created).toBe(true) // another name
  })

  it('refuses a member who is not in the server and more than 25 drivers', async () => {
    const api = setup()
    expect(code(await api.saveAttendanceDivision(APEX, { name: 'Elite', regularDrivers: ['999999999999999999'] }))).toBe('member_not_found')
    expect(code(await api.saveAttendanceDivision(APEX, { name: 'Elite', regularDrivers: Array.from({ length: 26 }, (_, i) => `30000000000000${String(i + 1).padStart(4, '0')}`) }))).toBe('invalid_regular_drivers')
  })
})

describe('attendance posts', () => {
  it('Midnight has 60 posts (many), paged; filters by division and exact season', async () => {
    const api = setup()
    const first = ok(await api.attendancePosts(MIDNIGHT))
    expect(first).toMatchObject({ total: 60, limit: 25, offset: 0 })
    expect(first.posts).toHaveLength(25)
    expect(ok(await api.attendancePosts(MIDNIGHT, { limit: 100 })).posts).toHaveLength(60)
    expect(ok(await api.attendancePosts(MIDNIGHT, { division: 'Pro-Am', limit: 100 })).posts.every((item) => item.division === 'Pro-Am')).toBe(true)
    expect(ok(await api.attendancePosts(APEX, { season: '4' })).total).toBe(2)
    expect(ok(await api.attendancePosts(APEX, { season: '45' })).total).toBe(0)
  })

  it('the first Midnight post has 22 present, 3 absent and 4 reserve drivers, all with names', async () => {
    const api = setup()
    const first = ok(await api.attendancePosts(MIDNIGHT)).posts[0]!
    expect(first.counts).toEqual({ present: 22, absent: 3, reserve: 4 })
    const detail = ok(await api.attendancePost(MIDNIGHT, first.messageId))
    expect(detail.attendance.present).toHaveLength(22)
    expect(detail.attendance.present.every((driver) => driver.name !== null)).toBe(true)
  })

  it('a post made before divisions existed has no division; a driver who left keeps the name stored when they clicked', async () => {
    const api = setup()
    const old = ok(await api.attendancePosts(APEX, { limit: 100 })).posts.find((item) => item.division === null)
    expect(old).toBeDefined()
    const detail = ok(await api.attendancePost(APEX, '700000000000000106'))
    expect(detail.attendance.absent[0]).toMatchObject({ inServer: false, name: 'charles_l (old name)' })
    expect(code(await api.attendancePost(APEX, '700000000000099999'))).toBe('post_not_found')
  })

  it('creating a post stores it first in the list, with the regular drivers present, and returns the message id and channel', async () => {
    const api = setup()
    const created = ok(await api.createAttendancePost(APEX, { channelId: CH_OK, division: 'Elite', season: '5', round: '7', circuit: 'Silverstone', description: 'Weekend' }))
    expect(created.channelId).toBe(CH_OK)
    expect(created.post).toMatchObject({ circuit: 'Silverstone', division: 'Elite', description: 'Weekend', counts: { absent: 0, reserve: 0 } })
    expect(created.post.counts.present).toBeGreaterThan(0)
    expect(ok(await api.attendancePosts(APEX)).posts[0]!.messageId).toBe(created.post.messageId)
    expect(code(await api.createAttendancePost(APEX, { channelId: CH_OK, division: 'Nope', season: '5', round: '7', circuit: 'x' }))).toBe('division_not_found')
  })

  it('channel problems create nothing: bot_cannot_send, forbidden, channel_not_found', async () => {
    const api = setup()
    const before = ok(await api.attendancePosts(APEX)).total
    expect(code(await api.createAttendancePost(APEX, { channelId: CH_LOCKED, division: 'Elite', season: '5', round: '7', circuit: 'x' }))).toBe('bot_cannot_send')
    expect(code(await api.createAttendancePost(APEX, { channelId: CH_HIDDEN, division: 'Elite', season: '5', round: '7', circuit: 'x' }))).toBe('forbidden')
    expect(code(await api.createAttendancePost(APEX, { channelId: '777000000000000555', division: 'Elite', season: '5', round: '7', circuit: 'x' }))).toBe('channel_not_found')
    expect(ok(await api.attendancePosts(APEX)).total).toBe(before)
  })

  it('a lost answer (circuit "timeout", the timeout channel, or lostcreates): the post IS created, the answer is a timeout', async () => {
    for (const [scenario, input] of [
      ['normal', { channelId: CH_OK, circuit: 'Spa timeout' }],
      ['normal', { channelId: CH_TIMEOUT, circuit: 'Spa' }],
      ['lostcreates', { channelId: CH_OK, circuit: 'Spa' }]
    ] as const) {
      const api = setup(scenario)
      const before = ok(await api.attendancePosts(APEX)).total
      expect(kind(await api.createAttendancePost(APEX, { division: 'Elite', season: '5', round: '7', ...input })), scenario).toBe('timeout')
      expect(ok(await api.attendancePosts(APEX)).total, scenario).toBe(before + 1)
    }
  })

  it('nostaff: everything is forbidden', async () => {
    const api = setup('nostaff')
    expect(code(await api.attendanceDivisions(APEX))).toBe('forbidden')
    expect(code(await api.attendancePosts(APEX))).toBe('forbidden')
    expect(code(await api.signups(APEX))).toBe('forbidden')
  })
})

describe('sign-up questions', () => {
  it('start on the 6 defaults; saving changes the effective questions; [] restores the defaults', async () => {
    const api = setup()
    const start = ok(await api.signupQuestions(APEX))
    expect(start).toMatchObject({ usingDefaults: true, maxQuestions: 2, maxQuestionLength: 45, canEdit: true })
    expect(start.defaultQuestions).toHaveLength(6)
    const saved = ok(await api.saveSignupQuestions(APEX, ['What is your team?', 'Referred by']))
    expect(saved).toMatchObject({ usingDefaults: false, questions: ['What is your team?', 'Referred by'] })
    expect(saved.effectiveQuestions.map((question) => question.label)).toEqual(['What is your team?', 'Referred by'])
    expect(ok(await api.saveSignupQuestions(APEX, [])).usingDefaults).toBe(true)
  })

  it('notadmin: can_edit is false and saving answers 403 admin_required; the server refuses a comma, a duplicate and a third question', async () => {
    const staff = setup('notadmin', false)
    expect(ok(await staff.signupQuestions(APEX)).canEdit).toBe(false)
    expect(code(await staff.saveSignupQuestions(APEX, ['a']))).toBe('admin_required')
    const admin = setup()
    for (const bad of [['a,b'], ['x', 'x'], ['a', 'b', 'c'], ['y'.repeat(46)]]) expect(code(await admin.saveSignupQuestions(APEX, bad)), JSON.stringify(bad)).toBe('invalid_questions')
  })
})

describe('sign-ups', () => {
  it('Apex has an open and a closed sign-up (newest first); status filters; nosignups empties the list', async () => {
    const api = setup()
    const all = ok(await api.signups(APEX))
    expect(all.map((item) => item.status).sort()).toEqual(['closed', 'open'])
    expect(ok(await api.signups(APEX, 'open'))).toHaveLength(1)
    expect(ok(await api.signups(APEX, 'closed'))).toHaveLength(1)
    expect(ok(await setup('nosignups').signups(APEX))).toEqual([])
  })

  it('Midnight has 130 participants, served 100 at a time; the ones who left have no display name', async () => {
    const api = setup()
    const signup = ok(await api.signups(MIDNIGHT))[0]!
    expect(signup.participantCount).toBe(130)
    const first = ok(await api.signupParticipants(MIDNIGHT, signup.signupId, { limit: 100 }))
    expect(first).toMatchObject({ total: 130, limit: 100, offset: 0 })
    expect(first.participants).toHaveLength(100)
    expect(ok(await api.signupParticipants(MIDNIGHT, signup.signupId, { limit: 100, offset: 100 })).participants).toHaveLength(30)
    expect(first.participants.some((item) => !item.inServer && item.displayName === null)).toBe(true)
  })

  it('every participant is OBVIOUSLY FAKE: nothing in the mock can pass for a real person', async () => {
    const api = setup()
    for (const guild of [APEX, MIDNIGHT]) {
      for (const signup of ok(await api.signups(guild))) {
        for (const participant of ok(await api.signupParticipants(guild, signup.signupId, { limit: 100 })).participants) {
          expect(participant.username, participant.userId).toMatch(/^fake_user_\d+$/)
          expect(participant.displayName ?? 'Fake Driver 0').toMatch(/^Fake Driver \d+$/)
          expect(participant.platformUsername).toMatch(/^FakeRacer\d+$/)
          const nationality = participant.answers.find((answer) => /nationality/i.test(answer.question))
          expect(nationality?.answer).toBe('Testland')
          expect(participant.answers.find((answer) => /old/i.test(answer.question))?.answer).toBe('99')
        }
      }
    }
  })

  it('one participant answered with markup: it comes back untouched (the screen renders plain text)', async () => {
    const api = setup()
    const open = ok(await api.signups(APEX, 'open'))[0]!
    const answers = ok(await api.signupParticipants(APEX, open.signupId, { limit: 100 })).participants.flatMap((item) => item.answers.map((answer) => answer.answer))
    expect(answers).toContain('<b>Test</b> <script>alert("fake")</script>')
  })

  it('creating a sign-up lists it first, open, with no participants and the default confirmation channel name', async () => {
    const api = setup()
    const created = ok(await api.createSignup(APEX, { title: 'Season 7', channelId: CH_SIGNUP, closeDate: '1 June' }))
    expect(created.channelId).toBe(CH_SIGNUP)
    expect(created.signup).toMatchObject({ status: 'open', participantCount: 0, closeDate: '1 June', confirmationChannel: 'signup-confirmations' })
    expect(ok(await api.signups(APEX))[0]!.signupId).toBe(created.signup.signupId)
    expect(ok(await api.createSignup(APEX, { title: 'Other', channelId: CH_SIGNUP, confirmationChannelId: CH_OK })).signup.confirmationChannel).toBe('c01')
  })

  it('the bot problems are answered before anything is posted: nothing is created', async () => {
    const cases: Array<[string, { confirmationChannelId?: string }, string]> = [
      ['noconfirmperms', {}, 'bot_cannot_post_confirmations'],
      ['noconfirmperms', { confirmationChannelId: CH_OK }, 'bot_cannot_post_confirmations'],
      ['nomanagechannels', {}, 'bot_missing_manage_channels'],
      ['ambiguousconfirm', { confirmationChannelId: CH_OK }, 'confirmation_channel_ambiguous']
    ]
    for (const [scenario, extra, expected] of cases) {
      const api = setup(scenario)
      const before = ok(await api.signups(APEX)).length
      expect(code(await api.createSignup(APEX, { title: 'Season 7', channelId: CH_SIGNUP, ...extra })), scenario).toBe(expected)
      expect(ok(await api.signups(APEX)).length, scenario).toBe(before)
    }
    const api = setup()
    expect(code(await api.createSignup(APEX, { title: 'x', channelId: CH_LOCKED }))).toBe('bot_cannot_send')
    expect(code(await api.createSignup(APEX, { title: 'x', channelId: CH_HIDDEN }))).toBe('forbidden')
    expect(code(await api.createSignup(APEX, { title: 'x', channelId: CH_SIGNUP, confirmationChannelId: '777000000000000555' }))).toBe('confirmation_channel_not_found')
  })

  it('a lost answer on creating a sign-up (title "timeout", the timeout channel, lostcreates): it IS created', async () => {
    for (const [scenario, input] of [['normal', { channelId: CH_SIGNUP, title: 'timeout season' }], ['normal', { channelId: CH_TIMEOUT, title: 'Season' }], ['lostcreates', { channelId: CH_SIGNUP, title: 'Season' }]] as const) {
      const api = setup(scenario)
      const before = ok(await api.signups(APEX)).length
      expect(kind(await api.createSignup(APEX, input)), scenario).toBe('timeout')
      expect(ok(await api.signups(APEX)).length, scenario).toBe(before + 1)
    }
  })

  it('closing: status closed, the panel is updated (or says why not), closing twice is 409 already_closed; there is no reopen', async () => {
    const api = setup()
    const open = ok(await api.signups(APEX, 'open'))[0]!
    expect(ok(await api.closeSignup(APEX, open.signupId))).toMatchObject({ panelUpdated: true, panelError: null, signup: { status: 'closed' } })
    expect(code(await api.closeSignup(APEX, open.signupId))).toBe('already_closed')
    const gone = ok(await api.createSignup(APEX, { title: 'panel-gone sign-up', channelId: CH_SIGNUP })).signup
    expect(ok(await api.closeSignup(APEX, gone.signupId))).toMatchObject({ panelUpdated: false, panelError: 'panel_message_not_found', signup: { status: 'closed' } })
    expect(code(await api.closeSignup(APEX, '810000000000099999'))).toBe('signup_not_found')
  })

  it('removing a participant works on a closed sign-up and for someone who left, shifts the list and returns the new count', async () => {
    const api = setup()
    const open = ok(await api.signups(APEX, 'open'))[0]!
    const before = ok(await api.signupParticipants(APEX, open.signupId, { limit: 100 })).participants
    const left = before.find((item) => !item.inServer)!
    ok(await api.closeSignup(APEX, open.signupId))
    expect(ok(await api.removeParticipant(APEX, open.signupId, left.userId))).toMatchObject({ username: left.username, participantCount: before.length - 1 })
    const after = ok(await api.signupParticipants(APEX, open.signupId, { limit: 100 })).participants
    expect(after.some((item) => item.userId === left.userId)).toBe(false)
    expect(code(await api.removeParticipant(APEX, open.signupId, left.userId))).toBe('participant_not_found')
  })
})
