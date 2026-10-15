import { isMessageId } from '../shared/attendanceValidation'
import { TEXT_LIMITS, utf16Units } from '../shared/textLimits'
import type {
  AttendanceCounts,
  AttendanceDivision,
  AttendanceDivisions,
  AttendanceDriver,
  AttendancePost,
  AttendancePostFilters,
  AttendancePostInput,
  AttendancePostPage,
  AttendancePostResult,
  AttendancePostSummary,
  DivisionInput,
  DivisionResult,
  ParticipantRemoveResult,
  Signup,
  SignupCloseResult,
  SignupCreateResult,
  SignupInput,
  SignupParticipant,
  SignupParticipantPage,
  SignupQuestion,
  SignupQuestions,
  SignupStatus
} from '../shared/types'
import { isValidSnowflake } from '../shared/validation'
import type { ApiClient } from './apiClient'
import { clientError, invalid, isCount, isRecord, list } from './apiParse'

/**
 * The attendance and sign-up endpoints of docs/APP_API.md (milestone 4). Paths, methods, bodies and response shapes
 * follow that document and nothing else; every response is validated before the UI sees it.
 *
 * Every write goes out exactly once. The ApiClient never replays a POST / PUT / DELETE after a timeout or a lost answer,
 * which matters most for creating an attendance post or a sign-up: a lost answer may well have posted a message.
 *
 * Nothing in here logs, stores or caches a response. In particular the participants of a sign-up (names, nationality, age
 * and other personal answers) only ever live in the objects returned to the caller.
 */
export interface AttendanceApi {
  attendanceDivisions: (guildId: string) => Promise<AttendanceDivisions>
  /** Creates a division or replaces the lists that are present. A list that is left out keeps its value on the server. */
  saveAttendanceDivision: (guildId: string, input: DivisionInput) => Promise<DivisionResult>
  attendancePosts: (guildId: string, filters?: AttendancePostFilters) => Promise<AttendancePostPage>
  attendancePost: (guildId: string, messageId: string) => Promise<AttendancePost>
  createAttendancePost: (guildId: string, input: AttendancePostInput) => Promise<AttendancePostResult>

  signupQuestions: (guildId: string) => Promise<SignupQuestions>
  saveSignupQuestions: (guildId: string, questions: string[]) => Promise<SignupQuestions>
  signups: (guildId: string, status?: SignupStatus) => Promise<Signup[]>
  signup: (guildId: string, signupId: string) => Promise<Signup>
  signupParticipants: (guildId: string, signupId: string, page?: { limit?: number; offset?: number }) => Promise<SignupParticipantPage>
  createSignup: (guildId: string, input: SignupInput) => Promise<SignupCreateResult>
  closeSignup: (guildId: string, signupId: string) => Promise<SignupCloseResult>
  removeParticipant: (guildId: string, signupId: string, userId: string) => Promise<ParticipantRemoveResult>
}

// ── Small readers ───────────────────────────────────────────────────────────

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value).slice(0, max) : '')
const optionalText = (value: unknown, max: number): string | null => (typeof value === 'string' && value !== '' ? value.slice(0, max) : null)
const countOr = (value: unknown, fallback: number): number => (isCount(value) ? value : fallback)
const TEXT_MAX = 2000
/** Room for the longest description the API takes (docs/APP_API.md, "Text limits"), so a legal text is never cut when it is shown. */
const POST_DESCRIPTION_MAX = utf16Units(TEXT_LIMITS.f1AttendanceDescription)
const SIGNUP_DESCRIPTION_MAX = utf16Units(TEXT_LIMITS.signupDescription)

function parseDriver(json: unknown): AttendanceDriver {
  if (!isRecord(json) || !isValidSnowflake(json['user_id'])) throw invalid('attendance')
  const inServer = json['in_server'] !== false
  // A post may still carry the name stored when the driver clicked, also after they left: keep whatever name the server sends.
  return { userId: json['user_id'], name: optionalText(json['name'], 100), inServer }
}

function parseDrivers(value: unknown): AttendanceDriver[] {
  if (!Array.isArray(value)) throw invalid('attendance')
  return value.slice(0, 500).map(parseDriver)
}

function parseDivision(json: unknown): AttendanceDivision {
  if (!isRecord(json) || typeof json['name'] !== 'string' || json['name'] === '') throw invalid('division')
  return { name: json['name'].slice(0, 100), regularDrivers: parseDrivers(json['regular_drivers']), reserveDrivers: parseDrivers(json['reserve_drivers']) }
}

function parseSummary(json: unknown): AttendancePostSummary {
  if (!isRecord(json) || !isMessageId(json['message_id'])) throw invalid('attendance post')
  const counts = isRecord(json['counts']) ? json['counts'] : {}
  return {
    messageId: json['message_id'],
    season: str(json['season'], 60),
    round: str(json['round'], 60),
    circuit: str(json['circuit'], 200),
    division: optionalText(json['division'], 100),
    description: str(json['description'], POST_DESCRIPTION_MAX),
    counts: { present: countOr(counts['present'], 0), absent: countOr(counts['absent'], 0), reserve: countOr(counts['reserve'], 0) }
  }
}

function parsePost(json: unknown): AttendancePost {
  const summary = parseSummary(json)
  if (!isRecord(json) || !isRecord(json['attendance'])) throw invalid('attendance post')
  const attendance = { present: parseDrivers(json['attendance']['present']), absent: parseDrivers(json['attendance']['absent']), reserve: parseDrivers(json['attendance']['reserve']) }
  // The single read may leave `counts` out: the lists are the truth.
  const counts: AttendanceCounts = isRecord(json['counts']) ? summary.counts : { present: attendance.present.length, absent: attendance.absent.length, reserve: attendance.reserve.length }
  return { ...summary, counts, attendance }
}

function parseQuestionList(value: unknown): SignupQuestion[] {
  if (!Array.isArray(value)) throw invalid('sign-up questions')
  return value.slice(0, 50).map((item): SignupQuestion => {
    if (!isRecord(item) || typeof item['label'] !== 'string') throw invalid('sign-up questions')
    return { label: item['label'].slice(0, 200), placeholder: optionalText(item['placeholder'], 200), required: item['required'] !== false }
  })
}

function parseQuestions(json: unknown): SignupQuestions {
  if (!isRecord(json) || !Array.isArray(json['questions']) || !isCount(json['max_questions']) || !isCount(json['max_question_length'])) throw invalid('sign-up questions')
  return {
    questions: json['questions'].filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 200)),
    usingDefaults: json['using_defaults'] === true,
    defaultQuestions: parseQuestionList(json['default_questions']),
    effectiveQuestions: parseQuestionList(json['effective_questions']),
    maxQuestions: json['max_questions'],
    maxQuestionLength: json['max_question_length'],
    canEdit: typeof json['can_edit'] === 'boolean' ? json['can_edit'] : null
  }
}

function parseSignup(json: unknown): Signup {
  if (!isRecord(json) || !isMessageId(json['signup_id']) || (json['status'] !== 'open' && json['status'] !== 'closed')) throw invalid('sign-up')
  return {
    signupId: json['signup_id'],
    title: str(json['title'], 300),
    description: str(json['description'], SIGNUP_DESCRIPTION_MAX),
    status: json['status'],
    closeDate: optionalText(json['close_date'], 100),
    customQuestionCount: Array.isArray(json['fields']) ? json['fields'].length : 0,
    panelChannelId: isValidSnowflake(json['panel_channel_id']) ? json['panel_channel_id'] : null,
    confirmationChannel: str(json['confirmation_channel'], 200),
    createdBy: str(json['created_by'], 40),
    createdAt: str(json['created_at'], 40),
    participantCount: countOr(json['participant_count'], 0)
  }
}

function parseParticipant(json: unknown): SignupParticipant {
  if (!isRecord(json) || !isValidSnowflake(json['user_id']) || !Array.isArray(json['answers'])) throw invalid('participant')
  const inServer = json['in_server'] !== false
  return {
    userId: json['user_id'],
    username: str(json['username'], 100),
    displayName: inServer ? optionalText(json['display_name'], 100) : null,
    inServer,
    platform: str(json['platform'], 60),
    platformName: str(json['platform_name'], 100),
    platformUsername: str(json['platform_username'], 200),
    answers: json['answers'].slice(0, 50).map((item) => {
      if (!isRecord(item)) throw invalid('participant')
      return { question: str(item['question'], 200), answer: str(item['answer'], TEXT_MAX) }
    }),
    timestamp: str(json['timestamp'], 40)
  }
}

export function createAttendanceApi(client: ApiClient): AttendanceApi {
  const guildPath = (guildId: string, suffix: string): string => {
    if (!isValidSnowflake(guildId)) throw clientError('invalid_guild_id', 'That server ID is not valid.')
    return `/api/app/v1/guilds/${guildId}/${suffix}`
  }
  const messagePath = (guildId: string, base: string, messageId: string, code: string, suffix = ''): string => {
    if (!isMessageId(messageId)) throw clientError(code, 'That ID is not valid.')
    return guildPath(guildId, `${base}/${messageId}${suffix}`)
  }
  const query = (params: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
    const text = search.toString()
    return text === '' ? '' : `?${text}`
  }

  return {
    async attendanceDivisions(guildId) {
      const json = await client.request({ path: guildPath(guildId, 'f1/attendance/divisions') })
      if (!isRecord(json)) throw invalid('divisions')
      const legacy = json['legacy']
      return {
        divisions: list(json, 'divisions', 'divisions').map(parseDivision),
        legacy: isRecord(legacy) ? { regularDrivers: parseDrivers(legacy['regular_drivers']), reserveDrivers: parseDrivers(legacy['reserve_drivers']) } : null
      }
    },

    async saveAttendanceDivision(guildId, input) {
      // A list is part of the body ONLY when the caller passed it: the API keeps a list that is left out.
      const body: Record<string, unknown> = { name: input.name }
      if (input.regularDrivers !== undefined) body['regular_drivers'] = input.regularDrivers
      if (input.reserveDrivers !== undefined) body['reserve_drivers'] = input.reserveDrivers
      const json = await client.request({ method: 'PUT', path: guildPath(guildId, 'f1/attendance/divisions'), body })
      if (!isRecord(json) || typeof json['created'] !== 'boolean') throw invalid('division')
      const overlap = Array.isArray(json['overlap']) ? json['overlap'].filter(isValidSnowflake) : []
      return { division: parseDivision(json['division']), created: json['created'], overlap }
    },

    async attendancePosts(guildId, filters = {}) {
      const json = await client.request({
        path: `${guildPath(guildId, 'f1/attendance/posts')}${query({ division: filters.division, season: filters.season, limit: filters.limit, offset: filters.offset })}`
      })
      if (!isRecord(json) || !isCount(json['total'])) throw invalid('attendance posts')
      return { posts: list(json, 'posts', 'attendance posts').map(parseSummary), total: json['total'], limit: countOr(json['limit'], 25), offset: countOr(json['offset'], 0) }
    },

    async attendancePost(guildId, messageId) {
      return parsePost(await client.request({ path: messagePath(guildId, 'f1/attendance/posts', messageId, 'invalid_message_id') }))
    },

    async createAttendancePost(guildId, input) {
      if (!isValidSnowflake(input.channelId)) throw clientError('invalid_channel', 'That channel is not valid.')
      // One attempt, never replayed: a lost answer may still have posted the message in Discord.
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'f1/attendance/posts'),
        body: {
          channel_id: input.channelId,
          division: input.division,
          season: input.season,
          round: input.round,
          circuit: input.circuit,
          ...(input.description !== undefined && input.description !== '' ? { description: input.description } : {})
        }
      })
      if (!isRecord(json) || !isValidSnowflake(json['channel_id'])) throw invalid('attendance post')
      return { post: parsePost(json['post']), channelId: json['channel_id'] }
    },

    async signupQuestions(guildId) {
      return parseQuestions(await client.request({ path: guildPath(guildId, 'league/signup-questions') }))
    },

    async saveSignupQuestions(guildId, questions) {
      return parseQuestions(await client.request({ method: 'PUT', path: guildPath(guildId, 'league/signup-questions'), body: { questions } }))
    },

    async signups(guildId, status) {
      return list(await client.request({ path: `${guildPath(guildId, 'league/signups')}${query({ status })}` }), 'signups', 'sign-up list').map(parseSignup)
    },

    async signup(guildId, signupId) {
      const json = await client.request({ path: messagePath(guildId, 'league/signups', signupId, 'invalid_signup_id') })
      if (!isRecord(json)) throw invalid('sign-up')
      return parseSignup(json['signup'])
    },

    async signupParticipants(guildId, signupId, page = {}) {
      const json = await client.request({ path: `${messagePath(guildId, 'league/signups', signupId, 'invalid_signup_id', '/participants')}${query({ limit: page.limit, offset: page.offset })}` })
      if (!isRecord(json) || !isCount(json['total'])) throw invalid('participants')
      return {
        signup: parseSignup(json['signup']),
        total: json['total'],
        limit: countOr(json['limit'], 25),
        offset: countOr(json['offset'], 0),
        participants: list(json, 'participants', 'participants').map(parseParticipant)
      }
    },

    async createSignup(guildId, input) {
      for (const [id, code] of [[input.channelId, 'invalid_channel'], [input.confirmationChannelId, 'invalid_confirmation_channel']] as const) {
        if (id !== undefined && !isValidSnowflake(id)) throw clientError(code, 'That channel is not valid.')
      }
      // One attempt, never replayed: a lost answer may still have posted the sign-up panel in Discord.
      const json = await client.request({
        method: 'POST',
        path: guildPath(guildId, 'league/signups'),
        body: {
          title: input.title,
          channel_id: input.channelId,
          ...(input.description !== undefined && input.description !== '' ? { description: input.description } : {}),
          ...(input.confirmationChannelId !== undefined ? { confirmation_channel_id: input.confirmationChannelId } : {}),
          ...(input.closeDate !== undefined && input.closeDate !== '' ? { close_date: input.closeDate } : {})
        }
      })
      if (!isRecord(json) || !isValidSnowflake(json['channel_id'])) throw invalid('sign-up')
      return { signup: parseSignup(json['signup']), channelId: json['channel_id'] }
    },

    async closeSignup(guildId, signupId) {
      const json = await client.request({ method: 'POST', path: messagePath(guildId, 'league/signups', signupId, 'invalid_signup_id', '/close') })
      if (!isRecord(json) || json['ok'] !== true || typeof json['panel_updated'] !== 'boolean') throw invalid('sign-up')
      return { signup: parseSignup(json['signup']), panelUpdated: json['panel_updated'], panelError: optionalText(json['panel_error'], 64) }
    },

    async removeParticipant(guildId, signupId, userId) {
      if (!isValidSnowflake(userId)) throw clientError('invalid_user_id', 'That member ID is not valid.')
      const json = await client.request({ method: 'DELETE', path: messagePath(guildId, 'league/signups', signupId, 'invalid_signup_id', `/participants/${userId}`) })
      if (!isRecord(json) || json['ok'] !== true || !isRecord(json['removed']) || !isCount(json['participant_count'])) throw invalid('participant removal')
      return { userId: isValidSnowflake(json['removed']['user_id']) ? json['removed']['user_id'] : userId, username: str(json['removed']['username'], 100), participantCount: json['participant_count'] }
    }
  }
}
