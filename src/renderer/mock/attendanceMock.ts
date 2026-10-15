/**
 * FAKE attendance and sign-up backend for `npm run dev:mock` (milestone 4). Part of the mock bridge: it must never end up
 * in an Electron build (it is only reachable through installMock.ts, which main.tsx loads behind the compile-time
 * `__NEXUS_MOCK__` flag).
 *
 * It is stateful and follows docs/APP_API.md (codes, limits, shapes), including the facts the UI depends on: a list that
 * is left out of a division PUT keeps its value, `overlap` lists drivers that are in both lists, an attendance post is only
 * known by its message id, a sign-up has no reopen / edit / delete, and removing a participant works for someone who left.
 *
 * Sign-up participants are OBVIOUSLY FAKE ("Fake Driver 007", "Testland", age 99): nothing here looks like a real person.
 *
 * Scenarios (query string, on top of the ones in installMock.ts, f1Mock.ts and stewardMock.ts):
 *   nodivisions        no attendance division anywhere (so no post either)
 *   nosignups          the sign-up list is empty everywhere
 *   notadmin           (existing) staff, not Administrator: saving the sign-up questions answers 403 admin_required, can_edit is false
 *   nostaff            (existing) every attendance and sign-up call answers 403 forbidden
 *   noconfirmperms     creating a sign-up answers 403 bot_cannot_post_confirmations
 *   nomanagechannels   creating a sign-up with the default confirmation channel answers 403 bot_missing_manage_channels
 *   ambiguousconfirm   creating a sign-up with a chosen confirmation channel answers 409 confirmation_channel_ambiguous
 *   lostcreates        creating an attendance post or a sign-up IS applied, then the answer is lost (timeout)
 *
 * Hooks (normal scenario):
 *   circuit / title containing "timeout"   the post / sign-up IS created, then the answer is lost
 *   channel #timeout-test                  the same
 *   channel #bot-locked / #staff-only-hidden   403 bot_cannot_send / 403 forbidden (nothing is created)
 *   a sign-up whose title contains "panel-gone"   closes, but the panel in Discord cannot be edited (panel_message_not_found)
 *
 * Sample data: "Apex Racing League" has two divisions (Elite, and Pro-Am with a driver in BOTH lists, plus a driver who left),
 * six posts, an open sign-up with 8 participants (one has left the server, one answered with markup) and a closed one with 3.
 * "Midnight GT Championship" has 60 posts (post 1 has 22 present, 3 absent, 4 reserve) and an open sign-up with 130 participants.
 */
import type { NexusBridge } from '../../shared/bridge'
import type {
  AttendanceDivision,
  AttendanceDivisions,
  AttendanceDriver,
  AttendancePost,
  AttendancePostPage,
  AttendancePostResult,
  AttendancePostSummary,
  DivisionResult,
  IpcResult,
  ParticipantRemoveResult,
  Signup,
  SignupCloseResult,
  SignupCreateResult,
  SignupParticipant,
  SignupParticipantPage,
  SignupQuestion,
  SignupQuestions
} from '../../shared/types'
import { failure, notFound, refused, timeoutFailure } from './common'
import type { F1MockContext } from './f1Mock'
import { LEFT_SERVER, MEMBERS } from './f1Mock'
import { checkLongText } from './textLimitsMock'

type AttendanceMockApi = Pick<
  NexusBridge['api'],
  | 'attendanceDivisions'
  | 'saveAttendanceDivision'
  | 'attendancePosts'
  | 'attendancePost'
  | 'createAttendancePost'
  | 'signupQuestions'
  | 'saveSignupQuestions'
  | 'signups'
  | 'signup'
  | 'signupParticipants'
  | 'createSignup'
  | 'closeSignup'
  | 'removeParticipant'
>

const DAY_MS = 86_400_000
const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString()
const pad = (n: number, size = 3): string => String(n).padStart(size, '0')

/** The drivers of the fake servers: the members of the F1 mock plus 40 obviously fake ones. */
const fakeId = (n: number): string => `30000000000000${pad(n, 4)}`
const FAKE_DRIVERS = Array.from({ length: 40 }, (_, index) => ({ id: fakeId(index + 1), name: `Test Driver ${pad(index + 1, 2)}` }))
const NAMES = new Map<string, string>([...MEMBERS.map((member) => [member.id, member.displayName] as [string, string]), ...FAKE_DRIVERS.map((driver) => [driver.id, driver.name] as [string, string])])
const IN_SERVER = (id: string): boolean => NAMES.has(id) && !LEFT_SERVER.has(id)

const memberId = (n: number): string => `20000000000${pad(n, 7)}`

const DEFAULT_QUESTIONS: SignupQuestion[] = [
  'What is your first name?',
  'What is your nationality?',
  'How old are you?',
  'What is your racing experience?',
  'Which classes do you race?',
  'Anything else we should know?'
].map((label, index) => ({ label, placeholder: index === 0 ? null : 'Short answer', required: index < 3 }))

// ── State ───────────────────────────────────────────────────────────────────

interface DivisionState {
  name: string
  regular: string[]
  reserve: string[]
}
interface PostState {
  messageId: string
  season: string
  round: string
  circuit: string
  division: string | null
  description: string
  present: string[]
  absent: string[]
  reserve: string[]
  /** The name stored when a driver clicked: shown for someone who left the server. */
  storedNames: Map<string, string>
}
interface ParticipantState {
  userId: string
  username: string
  displayName: string
  inServer: boolean
  platform: string
  platformName: string
  platformUsername: string
  answers: Array<{ question: string; answer: string }>
  timestamp: string
}
interface SignupState {
  signupId: string
  title: string
  description: string
  status: 'open' | 'closed'
  closeDate: string | null
  customQuestions: string[]
  panelChannelId: string
  confirmationChannel: string
  createdBy: string
  createdAt: string
  participants: ParticipantState[]
}
interface GuildState {
  divisions: DivisionState[]
  legacy: { regular: string[]; reserve: string[] } | null
  posts: PostState[]
  signups: SignupState[]
}

const PLATFORMS: Array<[string, string]> = [['steam', 'Steam'], ['psn', 'PlayStation'], ['xbox', 'Xbox']]

function fakeParticipants(count: number, firstUser: number, leftAt = -1): ParticipantState[] {
  return Array.from({ length: count }, (_, index) => {
    const n = firstUser + index
    const [platform, platformName] = PLATFORMS[n % PLATFORMS.length] ?? PLATFORMS[0]!
    const left = index === leftAt
    const markup = index === 1
    return {
      userId: `40000000000000${pad(n, 4)}`,
      username: `fake_user_${pad(n)}`,
      displayName: `Fake Driver ${pad(n)}`,
      inServer: !left,
      platform,
      platformName,
      platformUsername: `FakeRacer${pad(n)}`,
      answers: [
        { question: DEFAULT_QUESTIONS[0]!.label, answer: markup ? '<b>Test</b> <script>alert("fake")</script>' : `Test${pad(n)}` },
        { question: DEFAULT_QUESTIONS[1]!.label, answer: 'Testland' },
        { question: DEFAULT_QUESTIONS[2]!.label, answer: '99' },
        { question: DEFAULT_QUESTIONS[3]!.label, answer: index % 3 === 0 ? 'Fake experience: none at all. '.repeat(8).trim() : 'Pretend rookie' },
        { question: DEFAULT_QUESTIONS[4]!.label, answer: 'Fake class A' },
        { question: DEFAULT_QUESTIONS[5]!.label, answer: 'Nothing, this is a test entry.' }
      ],
      timestamp: iso((count - index) * 3_600_000)
    }
  })
}

function post(messageId: string, season: string, round: string, circuit: string, division: string | null, present: string[], absent: string[], reserve: string[], description = ''): PostState {
  return { messageId, season, round, circuit, division, description, present, absent, reserve, storedNames: new Map([[memberId(3), 'charles_l (old name)']]) }
}

function seedApex(): GuildState {
  const ids = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, index) => memberId(from + index))
  return {
    divisions: [
      { name: 'Elite', regular: ids(1, 4), reserve: [memberId(5), memberId(3)] }, // member 3 has left the server
      { name: 'Pro-Am', regular: [memberId(6), memberId(7), memberId(8)], reserve: [memberId(8), memberId(9)] } // member 8 is in BOTH lists
    ],
    legacy: null,
    posts: [
      post('700000000000000106', '5', '6', 'Hungarian GP', 'Elite', ids(1, 2), [memberId(3)], [memberId(5)], 'Sprint weekend: please check in early.'),
      post('700000000000000105', '5', '5', 'Spa-Francorchamps GP', 'Elite', ids(1, 4), [], []),
      post('700000000000000104', '5', '4', 'Monza Grand Prix', 'Pro-Am', [memberId(6)], [memberId(7)], [memberId(9)]),
      post('700000000000000103', '5', '3', 'Dutch GP', 'Elite', ids(1, 3), [memberId(4)], [], '**Bold** and _italic_ in a description show up in Discord as formatting.'),
      post('700000000000000102', '4', '12', 'Brazilian GP', 'Elite', ids(1, 4), [], []),
      post('700000000000000101', '4', '11', 'Mexican GP', null, ids(1, 2), [], []) // made before divisions existed
    ],
    signups: [
      {
        signupId: '810000000000000201', title: 'Season 6 Sign-up', description: 'Open to everyone. Read the rules first.', status: 'open', closeDate: '1 December', customQuestions: [],
        panelChannelId: '777000000000000005', confirmationChannel: 'signup-confirmations', createdBy: '100000000000000001', createdAt: iso(9 * DAY_MS), participants: fakeParticipants(8, 1, 4)
      },
      {
        signupId: '810000000000000200', title: 'Season 5 Sign-up (closed)', description: '', status: 'closed', closeDate: null, customQuestions: [],
        panelChannelId: '777000000000000005', confirmationChannel: 'signup-confirmations', createdBy: '100000000000000001', createdAt: iso(120 * DAY_MS), participants: fakeParticipants(3, 100)
      }
    ]
  }
}

function seedMidnight(): GuildState {
  const roster = FAKE_DRIVERS.map((driver) => driver.id)
  const posts = Array.from({ length: 60 }, (_, index) => {
    const number = 60 - index
    return index === 0
      ? post('700000000000000260', '12', '10', 'Suzuka', 'Elite', roster.slice(0, 22), roster.slice(22, 25), roster.slice(25, 29), 'A post with 22 present drivers, 3 absent and 4 reserve.')
      : post(`70000000000000${String(1000 + number)}`, '12', String(((number - 1) % 10) + 1), `Fake Circuit ${number}`, number % 4 === 0 ? 'Pro-Am' : 'Elite', roster.slice(0, 4 + (number % 5)), roster.slice(30, 31 + (number % 2)), roster.slice(36, 37 + (number % 3)))
  })
  return {
    divisions: [
      { name: 'Elite', regular: roster.slice(0, 22), reserve: roster.slice(25, 29) },
      { name: 'Pro-Am', regular: roster.slice(10, 20), reserve: [] }
    ],
    legacy: { regular: roster.slice(0, 3), reserve: roster.slice(36, 37) },
    posts,
    signups: [
      {
        signupId: '810000000000000301', title: 'Midnight Season 12 Sign-up With A Rather Long Title To Check How The Table Wraps', description: 'This is a fake sign-up with many fake participants.', status: 'open', closeDate: '2026-12-31',
        customQuestions: ['Set in Discord'], panelChannelId: '777000000000000005', confirmationChannel: 'signup-confirmations', createdBy: '100000000000000001', createdAt: iso(30 * DAY_MS), participants: fakeParticipants(130, 1000, 7)
      }
    ]
  }
}

const emptyState = (): GuildState => ({ divisions: [], legacy: null, posts: [], signups: [] })

// ── The mock ────────────────────────────────────────────────────────────────

export function createAttendanceMock(ctx: F1MockContext): { api: AttendanceMockApi; openSignups: (guildId: string) => number | null } {
  const scenario = ctx.scenario
  const states: Record<string, GuildState> = { [ctx.apex]: seedApex(), [ctx.midnight]: seedMidnight() }
  if (scenario === 'nodivisions') for (const state of Object.values(states)) Object.assign(state, { divisions: [], legacy: null, posts: [] })
  if (scenario === 'nosignups') for (const state of Object.values(states)) state.signups = []
  const stateOf = (guildId: string): GuildState => (states[guildId] ??= emptyState())
  let questions: string[] = []
  let nextMessage = 700000000000009000n

  const nostaff = scenario === 'nostaff'
  const lostCreate = (text: string, channelId: string): boolean => scenario === 'lostcreates' || /timeout/i.test(text) || channelId === ctx.timeoutChannel

  const gate = <T,>(guildId: string, run: (state: GuildState) => IpcResult<T>): IpcResult<T> => {
    if (!ctx.known(guildId)) return notFound('guild_not_found', 'The bot is not in that server.')
    if (nostaff) return refused('forbidden', 'You need the Administrator permission, or the FIA or STAFF role, in this server.')
    return run(stateOf(guildId))
  }

  /** The channel checks the server runs before it posts anything. */
  const channelProblem = (channelId: string): IpcResult<never> | null => {
    if (channelId === ctx.hiddenChannel) return refused('forbidden', 'You cannot see that channel.')
    if (!ctx.channels.some((channel) => channel.id === channelId)) return notFound('channel_not_found', 'That text channel was not found in this server.')
    if (channelId === ctx.lockedChannel) return refused('bot_cannot_send', 'The bot cannot post in that channel.')
    return null
  }

  // ── Views ──
  const driverRow = (id: string, stored?: Map<string, string>): AttendanceDriver => {
    const inServer = IN_SERVER(id)
    return { userId: id, name: inServer ? (NAMES.get(id) ?? null) : (stored?.get(id) ?? null), inServer }
  }
  const divisionView = (division: DivisionState): AttendanceDivision => ({
    name: division.name,
    regularDrivers: division.regular.map((id) => driverRow(id)),
    reserveDrivers: division.reserve.map((id) => driverRow(id))
  })
  const summaryOf = (item: PostState): AttendancePostSummary => ({
    messageId: item.messageId, season: item.season, round: item.round, circuit: item.circuit, division: item.division, description: item.description,
    counts: { present: item.present.length, absent: item.absent.length, reserve: item.reserve.length }
  })
  const postView = (item: PostState): AttendancePost => ({
    ...summaryOf(item),
    attendance: { present: item.present.map((id) => driverRow(id, item.storedNames)), absent: item.absent.map((id) => driverRow(id, item.storedNames)), reserve: item.reserve.map((id) => driverRow(id, item.storedNames)) }
  })
  const signupView = (item: SignupState): Signup => ({
    signupId: item.signupId, title: item.title, description: item.description, status: item.status, closeDate: item.closeDate, customQuestionCount: item.customQuestions.length,
    panelChannelId: item.panelChannelId, confirmationChannel: item.confirmationChannel, createdBy: item.createdBy, createdAt: item.createdAt, participantCount: item.participants.length
  })
  const participantView = (item: ParticipantState): SignupParticipant => ({
    userId: item.userId, username: item.username, displayName: item.inServer ? item.displayName : null, inServer: item.inServer, platform: item.platform, platformName: item.platformName,
    platformUsername: item.platformUsername, answers: item.answers.map((answer) => ({ ...answer })), timestamp: item.timestamp
  })
  const questionsView = (): SignupQuestions => {
    const effective = questions.length > 0 ? questions.map((label): SignupQuestion => ({ label, placeholder: null, required: true })) : DEFAULT_QUESTIONS
    return { questions: [...questions], usingDefaults: questions.length === 0, defaultQuestions: DEFAULT_QUESTIONS.map((item) => ({ ...item })), effectiveQuestions: effective.map((item) => ({ ...item })), maxQuestions: 2, maxQuestionLength: 45, canEdit: ctx.isAdmin }
  }

  const api: AttendanceMockApi = {
    attendanceDivisions: (guildId) =>
      ctx.api<AttendanceDivisions>(() =>
        gate(guildId, (state) => ({
          ok: true,
          data: {
            divisions: [...state.divisions].sort((a, b) => a.name.localeCompare(b.name)).map(divisionView),
            legacy: state.legacy ? { regularDrivers: state.legacy.regular.map((id) => driverRow(id)), reserveDrivers: state.legacy.reserve.map((id) => driverRow(id)) } : null
          }
        }))
      ),

    saveAttendanceDivision: (guildId, input) =>
      ctx.api<DivisionResult>(() =>
        gate(guildId, (state) => {
          const existing = state.divisions.find((division) => division.name === input.name) // case-sensitive, like the command
          const lists = [input.regularDrivers, input.reserveDrivers]
          if (existing && lists.every((list) => list === undefined)) return failure('http', 'no_changes', 'The division exists and the request changes neither list.', 400)
          for (const list of lists) {
            if (list === undefined) continue
            if (list.length > 25) return failure('http', list === input.regularDrivers ? 'invalid_regular_drivers' : 'invalid_reserve_drivers', 'At most 25 drivers per list.', 400)
            if (list.some((id) => !NAMES.has(id))) return notFound('member_not_found', 'One of those members is not in this server.')
          }
          const division = existing ?? { name: input.name, regular: [], reserve: [] }
          // A list that is left out keeps its current value; [] clears it; duplicates are collapsed.
          if (input.regularDrivers !== undefined) division.regular = [...new Set(input.regularDrivers)]
          if (input.reserveDrivers !== undefined) division.reserve = [...new Set(input.reserveDrivers)]
          if (!existing) state.divisions.push(division)
          const overlap = division.regular.filter((id) => division.reserve.includes(id))
          return { ok: true, data: { division: divisionView(division), created: !existing, overlap } }
        })
      ),

    attendancePosts: (guildId, filters = {}) =>
      ctx.api<AttendancePostPage>(() =>
        gate(guildId, (state) => {
          const limit = filters.limit ?? 25
          const offset = filters.offset ?? 0
          const matches = state.posts.filter((item) => (filters.division === undefined || item.division === filters.division) && (filters.season === undefined || item.season === filters.season))
          return { ok: true, data: { posts: matches.slice(offset, offset + limit).map(summaryOf), total: matches.length, limit, offset } }
        })
      ),

    attendancePost: (guildId, messageId) =>
      ctx.api<AttendancePost>(() =>
        gate(guildId, (state) => {
          const found = state.posts.find((item) => item.messageId === messageId)
          return found ? { ok: true, data: postView(found) } : notFound('post_not_found', 'That attendance post was not found.')
        })
      ),

    createAttendancePost: (guildId, input) =>
      ctx.api<AttendancePostResult>(() =>
        gate(guildId, (state) => {
          const problem = channelProblem(input.channelId)
          if (problem) return problem
          const tooLong = checkLongText('f1AttendanceDescription', input.description) // the fake server's own check of the text limit
          if (tooLong) return tooLong
          const division = state.divisions.find((item) => item.name === input.division)
          if (!division) return notFound('division_not_found', `The division '${input.division}' does not exist.`)
          const created = post(String(nextMessage++), input.season, input.round, input.circuit, division.name, division.regular.filter(IN_SERVER), [], [], input.description ?? '')
          state.posts.unshift(created)
          if (lostCreate(`${input.circuit} ${input.description ?? ''}`, input.channelId)) return timeoutFailure() // posted and stored, but the answer "got lost"
          return { ok: true, data: { post: postView(created), channelId: input.channelId } }
        })
      ),

    signupQuestions: (guildId) => ctx.api<SignupQuestions>(() => gate(guildId, () => ({ ok: true, data: questionsView() }))),

    saveSignupQuestions: (guildId, input) =>
      ctx.api<SignupQuestions>(() =>
        gate(guildId, () => {
          if (!ctx.isAdmin) return refused('admin_required', 'Administrator permission is required to change the sign-up questions.')
          const bad = input.length > 2 || input.some((question) => question === '' || question.length > 45 || question.includes(',')) || new Set(input).size !== input.length
          if (bad) return failure('http', 'invalid_questions', 'The questions are not valid.', 400)
          questions = [...input]
          return { ok: true, data: questionsView() }
        })
      ),

    signups: (guildId, status) =>
      ctx.api<Signup[]>(() => gate(guildId, (state) => ({ ok: true, data: [...state.signups].reverse().filter((item) => status === undefined || item.status === status).map(signupView) }))),

    signup: (guildId, signupId) =>
      ctx.api<Signup>(() =>
        gate(guildId, (state) => {
          const found = state.signups.find((item) => item.signupId === signupId)
          return found ? { ok: true, data: signupView(found) } : notFound('signup_not_found', 'That sign-up was not found.')
        })
      ),

    signupParticipants: (guildId, signupId, page = {}) =>
      ctx.api<SignupParticipantPage>(() =>
        gate(guildId, (state) => {
          const found = state.signups.find((item) => item.signupId === signupId)
          if (!found) return notFound('signup_not_found', 'That sign-up was not found.')
          const limit = page.limit ?? 25
          const offset = page.offset ?? 0
          return { ok: true, data: { signup: signupView(found), total: found.participants.length, limit, offset, participants: found.participants.slice(offset, offset + limit).map(participantView) } }
        })
      ),

    createSignup: (guildId, input) =>
      ctx.api<SignupCreateResult>(() =>
        gate(guildId, (state) => {
          const problem = channelProblem(input.channelId)
          if (problem) return problem
          const tooLong = checkLongText('signupDescription', input.description)
          if (tooLong) return tooLong
          if (input.confirmationChannelId !== undefined) {
            if (!ctx.channels.some((channel) => channel.id === input.confirmationChannelId)) return notFound('confirmation_channel_not_found', 'The confirmation channel was not found.')
            if (input.confirmationChannelId === ctx.lockedChannel || scenario === 'noconfirmperms') return refused('bot_cannot_post_confirmations', 'The bot cannot post in the confirmation channel.')
            if (scenario === 'ambiguousconfirm') return failure('http', 'confirmation_channel_ambiguous', 'Another channel matches that name too, so confirmations could end up there.', 409)
          } else {
            if (scenario === 'noconfirmperms') return refused('bot_cannot_post_confirmations', 'The bot cannot post in the existing signup-confirmations channel.')
            if (scenario === 'nomanagechannels') return refused('bot_missing_manage_channels', 'There is no signup-confirmations channel yet and the bot cannot create one.')
          }
          const confirmationName = input.confirmationChannelId !== undefined ? (ctx.channels.find((channel) => channel.id === input.confirmationChannelId)?.name ?? 'signup-confirmations') : 'signup-confirmations'
          const created: SignupState = {
            signupId: String(nextMessage++), title: input.title, description: input.description ?? '', status: 'open', closeDate: input.closeDate ?? null, customQuestions: [],
            panelChannelId: input.channelId, confirmationChannel: confirmationName, createdBy: '100000000000000001', createdAt: new Date().toISOString(), participants: []
          }
          state.signups.push(created)
          if (lostCreate(input.title, input.channelId)) return timeoutFailure() // posted and stored, but the answer "got lost"
          return { ok: true, data: { signup: signupView(created), channelId: input.channelId } }
        })
      ),

    closeSignup: (guildId, signupId) =>
      ctx.api<SignupCloseResult>(() =>
        gate(guildId, (state) => {
          const found = state.signups.find((item) => item.signupId === signupId)
          if (!found) return notFound('signup_not_found', 'That sign-up was not found.')
          if (found.status === 'closed') return failure('http', 'already_closed', 'That sign-up is already closed.', 409)
          found.status = 'closed'
          const gone = /panel-gone/i.test(found.title)
          return { ok: true, data: { signup: signupView(found), panelUpdated: !gone, panelError: gone ? 'panel_message_not_found' : null } }
        })
      ),

    removeParticipant: (guildId, signupId, userId) =>
      ctx.api<ParticipantRemoveResult>(() =>
        gate(guildId, (state) => {
          const found = state.signups.find((item) => item.signupId === signupId)
          if (!found) return notFound('signup_not_found', 'That sign-up was not found.')
          const index = found.participants.findIndex((item) => item.userId === userId)
          const removed = found.participants[index]
          if (!removed) return notFound('participant_not_found', 'That member is not signed up.')
          found.participants.splice(index, 1) // also for a closed sign-up and for someone who left the server
          return { ok: true, data: { userId, username: removed.username, participantCount: found.participants.length } }
        })
      )
  }

  return {
    api,
    openSignups: (guildId) => (guildId in states ? stateOf(guildId).signups.filter((item) => item.status === 'open').length : null)
  }
}
