/**
 * FAKE bridge for `npm run dev:mock` (renderer only, normal browser, no Discord login).
 *
 * This file must never end up in an Electron build:
 *  - it is only reachable through `if (__NEXUS_MOCK__)` in main.tsx, a compile-time constant
 *    that electron.vite.config.ts hard-codes to false (dead-code elimination removes it),
 *  - it refuses to run when a real bridge (the preload's window.nexus) already exists,
 *  - `npm run build` fails if the marker string below shows up anywhere in out/.
 *
 * The fake backend is stateful (writes change what the next read returns) and follows the rules
 * documented in docs/APP_API.md, so the screens can be exercised end to end without Discord.
 *
 * Scenarios (query string, e.g. http://localhost:5174/?scenario=notadmin):
 *   signedout | denied | expired   login states
 *   empty                          the account has no servers
 *   error                          every API call fails with a 500
 *   slow                           slow answers and the "server is waking up" banner
 *   nogames                        no game is enabled in any server
 *   norounds | nobotperms | nofia | lostresults | noledger   F1 league cases, see mock/f1Mock.ts
 *   noreports | nopenaltyconfig | nostaff | lostdecisions | nodirty   reports and penalties, see mock/stewardMock.ts
 *   nodivisions | nosignups | noconfirmperms | nomanagechannels | ambiguousconfirm | lostcreates   attendance and sign-ups, see mock/attendanceMock.ts
 *   noracingteams | nomanage | nomanageroles | lostracing | noresults | noattendance | nomanager | nomanager-<game>   esports teams of the five games, see mock/racingMock.ts
 *   roleabove | editnochanges | editgone   editing a team (M7), see mock/racingMock.ts
 *   manyteamroles | norolelist | invalidping | toomanyping | pingrefused | pinglimit | posterror   role pings and cards of the esports features, see mock/pingMock.ts and mock/racingMock.ts
 *   notadmin                       staff only, not Administrator: saving settings returns 403
 *                                  admin_required and linking an admin-level role returns
 *                                  403 role_too_privileged
 *
 * Hooks for the uncertain-write case ("the answer got lost"): the write IS applied, then a timeout
 * is reported. Put the word "timeout" in the footer name, in a tier's points system, in a game's
 * name, or post a panel to the channel #timeout-test.
 *
 * Sample data in "Apex Racing League": tier T1 has a remembered panel that still exists, T2 has a
 * remembered panel whose Discord message was deleted, T3 has a panel posted outside this app
 * (nothing remembered), T4 was never posted. "Turbo Club EU" has no enabled game; "Midnight GT"
 * has all five games, a tier whose role was deleted, and an incomplete member cache.
 */
import type { NexusBridge, Unsubscribe } from '../../shared/bridge'
import { isCatalogGameEnabled } from '../../shared/leagueGames'
import { panelKey, sanitizePanels } from '../../shared/panels'
import { postChannelKey } from '../../shared/pingRoles'
import { DEFAULT_SETTINGS, GAME_KEYS, GAME_LABELS } from '../../shared/types'
import type {
  AnnouncementResult,
  ApiStatus,
  AuthState,
  Channel,
  ChecklistItem,
  Game,
  Guild,
  IpcResult,
  LeagueGame,
  Overview,
  Role,
  SeasonSource,
  ServerSettings,
  Settings,
  StoredPanel,
  Tier,
  UserInfo
} from '../../shared/types'

import { clone, failure, notFound, sleep, timeoutFailure } from './common'
import { createAttendanceMock } from './attendanceMock'
import { createF1Mock } from './f1Mock'
import { createRacingMock } from './racingMock'
import { MENTION_ALL_CHANNEL, ROLE_DELETED_MEANWHILE, ROLE_NOT_MENTIONABLE } from './pingMock'
import type { F1MockContext } from './f1Mock'
import { createStewardMock } from './stewardMock'

/** Marker searched for by scripts/check-no-mock.mjs. Do not rename without updating it. */
export const MOCK_MARKER = 'NEXUS_MOCK_BRIDGE_ACTIVE'

/** Decorative icon: a coloured rounded square with initials, as a data: URI (allowed by the CSP too). */
function iconFor(name: string, hue: number): string {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${hue} 55% 28%)"/><text x="48" y="60" font-family="sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="#fff">${initials}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const USER: UserInfo = { id: '100000000000000001', username: 'DemoStaff', avatar: iconFor('Demo Staff', 0) }

const APEX = '555000000000000001'
const NIGHTFALL = '555000000000000002'
const TURBO = '555000000000000003'
const MIDNIGHT = '555000000000000004'

const GUILDS: Guild[] = [
  { id: APEX, name: 'Apex Racing League', icon: iconFor('Apex Racing', 355) },
  { id: NIGHTFALL, name: 'Nightfall Sim Series', icon: iconFor('Nightfall Sim', 230) },
  { id: TURBO, name: 'Turbo Club EU', icon: null },
  { id: MIDNIGHT, name: 'Midnight GT Championship With A Very Long Name', icon: iconFor('Midnight GT', 140) }
]

const CHANNELS: Channel[] = [
  { id: '777000000000000001', name: 'announcements' },
  { id: '777000000000000002', name: 'race-results' },
  { id: '777000000000000003', name: 'league-news' },
  { id: '777000000000000004', name: 'stewards-decisions' },
  { id: '777000000000000005', name: 'sign-ups' },
  { id: '777000000000000006', name: 'tier-1-sign-ups' },
  { id: '777000000000000007', name: 'timeout-test' },
  // Listed, but the bot / the caller lost access after the list was loaded: posting there is refused (see mock/f1Mock.ts).
  { id: '777000000000000008', name: 'bot-locked' },
  { id: '777000000000000009', name: 'staff-only-hidden' },
  // Where the bot has Mention Everyone: a role that is not mentionable can be pinged here (see mock/pingMock.ts).
  { id: MENTION_ALL_CHANNEL, name: 'mention-everyone-ok' }
]
const CH_SIGNUPS = '777000000000000005'
const CH_TIER1 = '777000000000000006'
const TIMEOUT_CHANNEL = '777000000000000007'
const LOCKED_CHANNEL = '777000000000000008' // the bot cannot post here: 403 bot_cannot_send
const HIDDEN_CHANNEL = '777000000000000009' // the caller cannot see it: 403 forbidden

// ── Roles ───────────────────────────────────────────────────────────────────

const MEMBER_COUNTS: Record<string, number> = {
  '800000000000000001': 18, '800000000000000002': 24, '800000000000000003': 31, '800000000000000004': 6,
  '800000000000000005': 2, '800000000000000009': 4, '800000000000000010': 12, '800000000000000011': 9,
  '800000000000000012': 7, '800000000000000013': 15, '800000000000000014': 11, '800000000000000015': 28, '800000000000000016': 3,
  '800000000000000017': 40, '800000000000000018': 5,
  // For the role pings (M6): one role above 50 members, one that is not mentionable, one whose count is only approximate.
  '800000000000000019': 60, [ROLE_NOT_MENTIONABLE]: 8, '800000000000000021': 14, [ROLE_DELETED_MEANWHILE]: 3
}

const role = (n: number, name: string, over: Partial<Role> = {}): Role => {
  const id = `8000000000000000${String(n).padStart(2, '0')}`
  return {
    id,
    name,
    color: null,
    position: 50 - n,
    managed: false,
    assignable: true,
    privileged: false,
    mentionable: true,
    memberCount: MEMBER_COUNTS[id] ?? 0,
    memberCountApproximate: false,
    ...over
  }
}

const ROLES: Role[] = [
  role(1, 'Tier 1 Drivers', { color: '#FF8800' }),
  role(2, 'Tier 2 Drivers', { color: '#22C55E' }),
  role(3, 'Rookies'),
  role(4, 'Reserve Drivers'),
  role(5, 'Race Director', { privileged: true, color: '#CC0000' }),
  role(6, 'Nexus', { managed: true, assignable: false }),
  role(7, 'Server Booster', { managed: true, assignable: false }),
  role(8, 'Server Owner Above The Bot', { assignable: false, privileged: true }),
  role(9, 'Stewards', { privileged: true }),
  role(10, 'Team Alpha'),
  role(11, 'Team Bravo'),
  role(12, 'Team Charlie'),
  role(13, 'Pro-Am Class'),
  role(14, 'Endurance Crew'),
  role(15, 'GT3 Drivers'),
  role(16, 'Sprint Series'),
  role(17, 'Streamers'),
  role(18, 'Commentators'),
  role(19, 'Big Announcements Group', { color: '#E62020' }), // 60 members: needs the extra checkbox before it is pinged
  role(20, 'Quiet Role (not mentionable)', { mentionable: false }),
  role(21, 'Cache Still Filling', { memberCountApproximate: true }), // "about 14 members"
  role(22, 'Role Deleted Meanwhile') // listed, but the server answers role_not_found when it is pinged
]
const MISSING_ROLE = '899000000000000099' // a tier whose Discord role was deleted
/** The roles a server lists: Midnight GT has an incomplete member cache, so every count there is approximate ("about N members"). */
const rolesOf = (guildId: string): Role[] => (guildId === MIDNIGHT ? ROLES.map((item) => ({ ...item, memberCountApproximate: true })) : ROLES)

// ── League games and tiers (the league_games.json of each fake server) ─────

interface MockTier {
  key: string
  roleId: string
  signupPanelPosted: boolean
  signupChannelId: string | null
  pointsSystem: string | null
}
interface MockGame {
  key: string
  label: string
  category: string
  active: boolean
  tiers: MockTier[]
}

const tier = (key: string, roleN: number, over: Partial<MockTier> = {}): MockTier => ({
  key,
  roleId: ROLES[roleN - 1]?.id ?? MISSING_ROLE,
  signupPanelPosted: false,
  signupChannelId: null,
  pointsSystem: null,
  ...over
})

function seedGames(): Record<string, MockGame[]> {
  return {
    [APEX]: [
      {
        key: 'f1', label: 'Formula 1', category: 'Open Wheel', active: true,
        tiers: [
          tier('T1', 1, { signupPanelPosted: true, signupChannelId: CH_TIER1, pointsSystem: 'F1 2025' }),
          tier('T2', 2, { signupPanelPosted: true, signupChannelId: CH_SIGNUPS, pointsSystem: 'F1 2025' }),
          tier('T3', 3, { signupPanelPosted: true, signupChannelId: CH_SIGNUPS }),
          tier('T4', 4)
        ]
      },
      { key: 'f1_2023', label: 'Formula 1 (2023 archive)', category: 'Open Wheel', active: false, tiers: [tier('Legacy', 3)] },
      { key: 'acc', label: 'Assetto Corsa Competizione', category: 'GT', active: true, tiers: [tier('GT3_Pro', 15, { pointsSystem: 'GT points' })] },
      { key: 'lmu', label: 'Le Mans Ultimate', category: 'Endurance', active: false, tiers: [] }
    ],
    [NIGHTFALL]: [
      { key: 'lmu', label: 'Le Mans Ultimate', category: 'Endurance', active: true, tiers: [tier('Hypercar', 14), tier('LMP2', 14)] },
      { key: 'iracing', label: 'iRacing', category: 'Sim racing', active: true, tiers: [] },
      { key: 'gt7', label: 'Gran Turismo 7', category: 'Console', active: true, tiers: [] }
    ],
    [TURBO]: [],
    [MIDNIGHT]: [
      {
        key: 'f1', label: 'Formula 1', category: 'Open Wheel', active: true,
        tiers: [
          tier('Premier', 1, { pointsSystem: 'F1 2025' }), tier('Division_2', 2), tier('Division_3', 3), tier('Reserves', 4),
          tier('Team_Alpha', 10), tier('Team_Bravo', 11), tier('Team_Charlie', 12),
          tier('Legacy_Tier_With_Long', 99, { pointsSystem: 'A very long points system name that keeps going and going for the layout test' })
        ]
      },
      { key: 'lmu', label: 'Le Mans Ultimate', category: 'Endurance', active: true, tiers: [tier('Hypercar', 14)] },
      { key: 'iracing', label: 'iRacing', category: 'Sim racing', active: true, tiers: [] },
      { key: 'gt7', label: 'Gran Turismo 7', category: 'Console', active: true, tiers: [] },
      { key: 'acc', label: 'Assetto Corsa Competizione', category: 'GT', active: true, tiers: [] }
    ]
  }
}

interface MockSettings {
  embedColor: string
  footerName: string
  seasonNumber: number | null
  penaltySeason: number | null
}
function seedSettings(): Record<string, MockSettings> {
  return {
    [APEX]: { embedColor: '#E62020', footerName: 'Apex Racing', seasonNumber: 3, penaltySeason: 5 }, // the penalty season wins
    [NIGHTFALL]: { embedColor: '#FF3333', footerName: 'Nexus', seasonNumber: null, penaltySeason: null },
    [TURBO]: { embedColor: '#FF3333', footerName: 'Nexus', seasonNumber: null, penaltySeason: null },
    [MIDNIGHT]: { embedColor: '#2563EB', footerName: 'Midnight GT', seasonNumber: 12, penaltySeason: null }
  }
}

/** Fixed extras per server (teams, calendar, reports ... belong to later milestones). */
interface Extras {
  teams: number
  teamDrivers: number
  rounds: number
  openSignups: number
  reports: number
  pending: number
  next: boolean
  points: boolean
  penalties: boolean
}
const NO_EXTRAS: Extras = { teams: 0, teamDrivers: 0, rounds: 0, openSignups: 0, reports: 0, pending: 0, next: false, points: false, penalties: false }
const EXTRAS: Record<string, Extras> = {
  [APEX]: { teams: 4, teamDrivers: 9, rounds: 8, openSignups: 1, reports: 5, pending: 2, next: true, points: true, penalties: false },
  [MIDNIGHT]: { teams: 8, teamDrivers: 16, rounds: 24, openSignups: 2, reports: 40, pending: 7, next: true, points: true, penalties: true }
}

export function installMockBridge(): void {
  // Typed as always-present on Window, so look at it through a loose type to keep the check meaningful.
  if ((window as { nexus?: unknown }).nexus !== undefined) throw new Error('Mock bridge refused: a real bridge is already installed.')

  const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'normal'
  console.info(`[${MOCK_MARKER}] fake bridge installed, scenario "${scenario}". No real data, no Discord.`)

  const latency = scenario === 'slow' ? 2500 : 350
  const isAdmin = scenario !== 'notadmin'
  const authListeners = new Set<(state: AuthState) => void>()
  const statusListeners = new Set<(status: ApiStatus) => void>()
  let loginTimer: number | undefined

  // The fake server's data and the fake userData settings file (with the panel registry).
  const leagueGames = seedGames()
  if (scenario === 'nogames') for (const id of Object.keys(leagueGames)) leagueGames[id] = []
  const serverSettings = seedSettings()
  const liveMessages = new Set<string>(['888000000000000101']) // panel messages that still exist in Discord
  let settings: Settings = {
    ...DEFAULT_SETTINGS,
    panels:
      scenario === 'nogames'
        ? {}
        : sanitizePanels({
            [panelKey(APEX, 'f1', 'T1')]: { messageId: '888000000000000101', channelId: CH_TIER1 },
            [panelKey(APEX, 'f1', 'T2')]: { messageId: '888000000000000102', channelId: CH_SIGNUPS } // this message is gone
          })
  }
  let nextMessage = 888000000000000200n

  // The F1 league mock (calendar, teams, standings ...) and its share of the fake settings file.
  const mockContext: F1MockContext = {
    scenario,
    isAdmin,
    api,
    known: (guildId) => GUILDS.some((guild) => guild.id === guildId),
    channels: CHANNELS,
    timeoutChannel: TIMEOUT_CHANNEL,
    lockedChannel: LOCKED_CHANNEL,
    hiddenChannel: HIDDEN_CHANNEL,
    getSettings: () => settings,
    setSettings: (next) => {
      settings = next
    },
    liveMessages,
    newMessageId: () => String(nextMessage++),
    apex: APEX,
    midnight: MIDNIGHT,
    serverRoles: (guildId) => rolesOf(guildId),
    mentionAllChannel: MENTION_ALL_CHANNEL
  }
  const f1 = createF1Mock(mockContext)
  const steward = createStewardMock(mockContext)
  const attendance = createAttendanceMock(mockContext)
  const racing = createRacingMock(mockContext)
  settings = f1.seedSettings(settings)

  let authState: AuthState =
    scenario === 'signedout'
      ? { status: 'signed-out' }
      : scenario === 'denied'
        ? { status: 'signed-out', reason: 'denied' }
        : scenario === 'expired'
          ? { status: 'signed-out', reason: 'expired' }
          : { status: 'signed-in', user: USER }

  const setAuth = (next: AuthState): void => {
    authState = next
    authListeners.forEach((listener) => listener(next))
  }
  let currentStatus: ApiStatus = 'online'
  const emitStatus = (status: ApiStatus): void => {
    currentStatus = status
    statusListeners.forEach((listener) => listener(status))
  }

  /** Every fake API call: simulated latency, the "server waking up" notice in the slow scenario, and the error scenario. */
  async function api<T>(produce: () => IpcResult<T>): Promise<IpcResult<T>> {
    if (scenario === 'slow') emitStatus('waking')
    await sleep(latency)
    emitStatus('online')
    if (scenario === 'error') return failure('http', 'internal_error', 'The server hit an unexpected problem.', 500)
    return produce()
  }

  const guildsFor = (): Guild[] => (scenario === 'empty' ? [] : GUILDS)
  const known = (guildId: string): boolean => GUILDS.some((guild) => guild.id === guildId)
  const gamesOf = (guildId: string): MockGame[] => (leagueGames[guildId] ??= [])
  const roleById = (id: string): Role | undefined => ROLES.find((item) => item.id === id)
  const findGame = (guildId: string, gameKey: string): MockGame | undefined => gamesOf(guildId).find((item) => item.key === gameKey)
  const withoutPanels = (keep: (key: string) => boolean): void => {
    settings = { ...settings, panels: Object.fromEntries(Object.entries(settings.panels).filter(([key]) => keep(key))) }
  }

  const toTier = (item: MockTier): Tier => {
    const found = roleById(item.roleId)
    return { ...item, driverCount: found ? (MEMBER_COUNTS[found.id] ?? 0) : null, roleName: found ? found.name : null }
  }
  const toGame = (item: MockGame): LeagueGame => ({ ...item, tiers: item.tiers.map(toTier) })

  /** The role rules of POST/PATCH tiers, in the order the backend checks them. */
  function checkRole(roleId: string): IpcResult<never> | null {
    const found = roleById(roleId)
    if (!found) return notFound('role_not_found', `Role ${roleId} was not found in this server.`)
    if (found.managed) return failure('http', 'invalid_role', 'That role cannot be used (@everyone and bot/integration roles are not allowed).', 400)
    if (!found.assignable) return failure('http', 'role_not_assignable', "The bot cannot assign that role (it is above the bot's highest role).", 403)
    if (found.privileged && !isAdmin) {
      return failure('http', 'role_too_privileged', 'That role has elevated permissions; only an Administrator can link it to a tier.', 403)
    }
    return null
  }

  function settingsView(guildId: string): ServerSettings {
    const s = serverSettings[guildId] ?? { embedColor: '#FF3333', footerName: 'Nexus', seasonNumber: null, penaltySeason: null }
    const source: SeasonSource = s.penaltySeason !== null ? 'penalty_settings' : s.seasonNumber !== null ? 'settings' : 'default'
    return {
      embedColor: s.embedColor,
      footerName: s.footerName,
      seasonNumber: s.seasonNumber,
      effectiveSeason: s.penaltySeason ?? s.seasonNumber ?? 1,
      seasonSource: source,
      canEdit: isAdmin
    }
  }

  function overviewOf(guildId: string): Overview {
    const games = gamesOf(guildId)
    const tiers = games.flatMap((game) => game.tiers)
    const extra = EXTRAS[guildId] ?? NO_EXTRAS
    const rolesFound = tiers.filter((item) => roleById(item.roleId)).length
    const s = serverSettings[guildId]
    const roleIds = [...new Set(tiers.map((item) => item.roleId))]
    const f1Counts = f1.counts(guildId)
    const stewardCounts = steward.counts(guildId)
    const counts = {
      games: games.length,
      activeGames: games.filter((game) => game.active).length,
      tiers: tiers.length,
      tiersWithPanel: tiers.filter((item) => item.signupPanelPosted).length,
      tierDrivers: roleIds.reduce((sum, id) => sum + (MEMBER_COUNTS[id] ?? 0), 0),
      teams: f1Counts?.teams ?? extra.teams,
      teamDrivers: f1Counts?.teamDrivers ?? extra.teamDrivers,
      calendarRounds: f1Counts?.rounds ?? extra.rounds,
      openSignups: attendance.openSignups(guildId) ?? extra.openSignups,
      reports: stewardCounts?.reports ?? extra.reports,
      pendingReports: stewardCounts?.pending ?? extra.pending
    }
    const item = (key: string, label: string, done: boolean, detail: string | null = null): ChecklistItem => ({ key, label, done, detail })
    const checklist: ChecklistItem[] = [
      item('appearance', 'Embed color or footer set', Boolean(s && (s.embedColor !== '#FF3333' || s.footerName !== 'Nexus'))),
      item('game', 'At least one game enabled', counts.activeGames > 0),
      item('tier', 'At least one tier created', counts.tiers > 0),
      item('tier_roles', 'Every tier is linked to a real role', counts.tiers > 0 && rolesFound === counts.tiers, `${rolesFound}/${counts.tiers} roles found`),
      item('signup_panel', 'A sign-up panel is posted', counts.tiersWithPanel > 0),
      item('calendar', 'Season calendar created', counts.calendarRounds > 0),
      item('teams', 'At least one team created', counts.teams > 0),
      item('points', 'Custom points system configured', extra.points),
      item('penalties', 'Penalty points configured', stewardCounts?.penaltiesConfigured ?? extra.penalties)
    ]
    return {
      memberCount: guildId === APEX ? 120 : guildId === MIDNIGHT ? 2400 : 40,
      season: settingsView(guildId).effectiveSeason,
      counts,
      nextEvent: f1Counts ? f1Counts.next : null,
      checklist,
      setupComplete: checklist.every((entry) => entry.done),
      memberCacheComplete: guildId !== MIDNIGHT
    }
  }

  const guildMissing = (): IpcResult<never> => notFound('guild_not_found', 'The bot is not in that server.')

  const bridge: NexusBridge = {
    auth: {
      getState: async () => authState,
      login: async () => {
        setAuth({ status: 'signing-in' })
        loginTimer = window.setTimeout(() => setAuth({ status: 'signed-in', user: USER }), 1500)
      },
      cancelLogin: async () => {
        window.clearTimeout(loginTimer)
        setAuth({ status: 'signed-out', reason: 'cancelled' })
      },
      retrySession: async () => setAuth({ status: 'signed-in', user: USER }),
      logout: async () => {
        window.clearTimeout(loginTimer)
        setAuth({ status: 'signed-out', reason: 'logged-out' })
      },
      onStateChange: (callback): Unsubscribe => {
        authListeners.add(callback)
        return () => authListeners.delete(callback)
      }
    },

    api: {
      me: () => api(() => ({ ok: true, data: USER })),
      guilds: () => api(() => ({ ok: true, data: guildsFor() })),

      // GET /games: derived from the league games, with the same matching rule as the backend.
      games: (guildId) =>
        api(() => {
          if (!known(guildId)) return guildMissing()
          const games = gamesOf(guildId).map(toGame)
          const data: Game[] = Object.entries(GAME_LABELS).map(([key, label]) => ({ key, label, enabled: isCatalogGameEnabled(key, games) }))
          return { ok: true, data }
        }),

      channels: (guildId) => api(() => (known(guildId) ? { ok: true, data: guildId === TURBO ? [] : CHANNELS } : guildMissing())),
      // The server's roles plus the role of every team (M6: with member counts, and "about" counts on the server with an incomplete member cache).
      roles: (guildId) =>
        api(() => {
          if (!known(guildId)) return guildMissing()
          if (scenario === 'norolelist') return failure('http', 'internal_error', 'The server hit an unexpected problem.', 500)
          return { ok: true, data: clone(racing.roles(guildId)) }
        }),

      postAnnouncement: (_guildId, input) =>
        api<AnnouncementResult>(() => {
          // Hooks for reviewing error states: put one of these words in the title.
          if (/\bfail\b/i.test(input.title) || input.channelId === LOCKED_CHANNEL) return failure('http', 'bot_cannot_send', 'The bot cannot post in that channel.', 403)
          if (input.channelId === HIDDEN_CHANNEL) return failure('http', 'forbidden', 'You cannot see that channel.', 403)
          if (/\btimeout\b/i.test(input.title)) return timeoutFailure()
          return { ok: true, data: { messageId: '888000000000000001', channelId: input.channelId } }
        }),

      overview: (guildId) => api(() => (known(guildId) ? { ok: true, data: overviewOf(guildId) } : guildMissing())),
      serverSettings: (guildId) => api(() => (known(guildId) ? { ok: true, data: settingsView(guildId) } : guildMissing())),

      saveServerSettings: (guildId, input) =>
        api(() => {
          if (!known(guildId)) return guildMissing()
          if (!isAdmin) return failure('http', 'admin_required', 'Administrator permission is required to change server settings.', 403)
          const current = (serverSettings[guildId] ??= { embedColor: '#FF3333', footerName: 'Nexus', seasonNumber: null, penaltySeason: null })
          if (input.embedColor !== undefined) current.embedColor = input.embedColor
          if (input.footerName !== undefined) current.footerName = input.footerName === '' ? 'Nexus' : input.footerName
          if (input.seasonNumber !== undefined) current.seasonNumber = input.seasonNumber
          if (/timeout/i.test(current.footerName)) return timeoutFailure() // applied, but the answer "got lost"
          return { ok: true, data: settingsView(guildId) }
        }),

      leagueGames: (guildId) =>
        api(() => (known(guildId) ? { ok: true, data: { games: gamesOf(guildId).map(toGame), memberCacheComplete: guildId !== MIDNIGHT } } : guildMissing())),

      createGame: (guildId, input) =>
        api(() => {
          if (!known(guildId)) return guildMissing()
          const games = gamesOf(guildId)
          if (games.some((game) => game.key === input.gameKey)) return failure('http', 'game_exists', `Game '${input.gameKey}' already exists.`, 409)
          if (games.length >= 25) return failure('http', 'too_many_games', 'A server can have at most 25 games.', 409)
          const created: MockGame = { key: input.gameKey, label: input.label, category: input.category, active: true, tiers: [] }
          games.push(created)
          if (/timeout/i.test(input.label)) return timeoutFailure()
          return { ok: true, data: toGame(created) }
        }),

      setGameActive: (guildId, gameKey, active) =>
        api(() => {
          const game = known(guildId) ? findGame(guildId, gameKey) : undefined
          if (!game) return notFound('game_not_found', `Game '${gameKey}' not found.`)
          game.active = active
          return { ok: true, data: toGame(game) }
        }),

      deleteGame: (guildId, gameKey) =>
        api(() => {
          const games = known(guildId) ? gamesOf(guildId) : []
          const index = games.findIndex((game) => game.key === gameKey)
          if (index < 0) return notFound('game_not_found', `Game '${gameKey}' not found.`)
          games.splice(index, 1)
          withoutPanels((key) => !key.startsWith(`${guildId}:${gameKey}:`)) // like the real main process
          return { ok: true, data: null }
        }),

      createTier: (guildId, gameKey, input) =>
        api(() => {
          const game = known(guildId) ? findGame(guildId, gameKey) : undefined
          if (!game) return notFound('game_not_found', `Game '${gameKey}' not found.`)
          const roleProblem = checkRole(input.roleId)
          if (roleProblem) return roleProblem
          if (game.tiers.some((item) => item.key === input.tierKey)) return failure('http', 'tier_exists', `Tier '${input.tierKey}' already exists.`, 409)
          if (game.tiers.length >= 50) return failure('http', 'too_many_tiers', 'A game can have at most 50 tiers.', 409)
          const created: MockTier = { key: input.tierKey, roleId: input.roleId, signupPanelPosted: false, signupChannelId: null, pointsSystem: input.pointsSystem ?? null }
          game.tiers.push(created)
          if (/timeout/i.test(created.pointsSystem ?? '')) return timeoutFailure()
          return { ok: true, data: toTier(created) }
        }),

      updateTier: (guildId, gameKey, tierKey, input) =>
        api(() => {
          const game = known(guildId) ? findGame(guildId, gameKey) : undefined
          if (!game) return notFound('game_not_found', `Game '${gameKey}' not found.`)
          const target = game.tiers.find((item) => item.key === tierKey)
          if (!target) return notFound('tier_not_found', `Tier '${tierKey}' not found.`)
          if (input.roleId !== undefined) {
            const roleProblem = checkRole(input.roleId)
            if (roleProblem) return roleProblem
            target.roleId = input.roleId
          }
          if (input.pointsSystem !== undefined) target.pointsSystem = input.pointsSystem
          if (input.signupChannelId !== undefined) target.signupChannelId = input.signupChannelId
          if (/timeout/i.test(target.pointsSystem ?? '')) return timeoutFailure()
          return { ok: true, data: toTier(target) }
        }),

      deleteTier: (guildId, gameKey, tierKey) =>
        api(() => {
          const game = known(guildId) ? findGame(guildId, gameKey) : undefined
          const index = game ? game.tiers.findIndex((item) => item.key === tierKey) : -1
          if (!game || index < 0) return notFound('tier_not_found', `Tier '${tierKey}' not found.`)
          game.tiers.splice(index, 1)
          withoutPanels((key) => key !== panelKey(guildId, gameKey, tierKey))
          return { ok: true, data: null }
        }),

      // POST post-panel + the main process's panel registry (only a confirmed outcome changes it).
      postPanel: (guildId, gameKey, tierKey, input) =>
        api(() => {
          const game = known(guildId) ? findGame(guildId, gameKey) : undefined
          if (!game) return notFound('game_not_found', `Game '${gameKey}' not found.`)
          const target = game.tiers.find((item) => item.key === tierKey)
          if (!target) return notFound('tier_not_found', `Tier '${tierKey}' not found.`)
          if (!CHANNELS.some((channel) => channel.id === input.channelId)) return notFound('channel_not_found', 'That text channel was not found in this server.')
          if (!roleById(target.roleId)) return notFound('role_not_found', "This tier's linked role was not found - fix it before posting.")

          const key = panelKey(guildId, gameKey, tierKey)
          let messageId: string
          if (input.messageId !== undefined) {
            if (!liveMessages.has(input.messageId)) {
              withoutPanels((k) => k !== key) // the real main process forgets a panel the API says is gone
              return notFound('message_not_found', 'That panel message was not found in the channel.')
            }
            messageId = input.messageId
          } else {
            messageId = String(nextMessage++)
            liveMessages.add(messageId)
          }
          target.signupPanelPosted = true
          target.signupChannelId = input.channelId
          if (input.channelId === TIMEOUT_CHANNEL) return timeoutFailure() // posted, but the answer "got lost"
          const stored: StoredPanel = { messageId, channelId: input.channelId }
          settings = { ...settings, panels: { ...settings.panels, [key]: stored } }
          return { ok: true, data: { messageId, channelId: input.channelId, refreshed: input.messageId !== undefined, tier: toTier(target) } }
        }),

      ...f1.api,
      ...steward.api,
      ...attendance.api,
      ...racing.api,

      getStatus: async () => currentStatus,
      onStatusChange: (callback): Unsubscribe => {
        statusListeners.add(callback)
        return () => statusListeners.delete(callback)
      }
    },

    settings: {
      get: async () => clone(settings),
      set: async (patch) => {
        settings = {
          ...settings,
          ...(patch.lastGuildId !== undefined ? { lastGuildId: patch.lastGuildId } : {}),
          ...(patch.lastGame !== undefined ? { lastGame: patch.lastGame } : {}),
          ...(patch.reduceMotion !== undefined ? { reduceMotion: patch.reduceMotion } : {})
        }
        return clone(settings)
      },
      // Like the real main process: a channel id of a real game, nothing else.
      rememberPostChannel: async (guildId, game, channelId) => {
        if (/^\d{15,25}$/.test(guildId) && /^\d{15,25}$/.test(channelId) && GAME_KEYS.includes(game)) settings = { ...settings, postChannels: { ...settings.postChannels, [postChannelKey(guildId, game)]: channelId } }
        return clone(settings)
      }
    },

    system: {
      // Like the real main process: only https links on the allowlist (here: discord.com and the project's pages) are opened.
      openExternal: async (url) => {
        const allowed = /^https:\/\/(discord\.com|nexus-b67\.pages\.dev)(\/|$)/i.test(url)
        console.info(`[${MOCK_MARKER}] ${allowed ? 'would open in the system browser' : 'refused (not on the allowlist)'}: ${url}`)
        return allowed
      },
      copyText: async (text) => {
        console.info(`[${MOCK_MARKER}] copied ${text.length} characters to the clipboard`)
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          // A browser without clipboard access: the mock still reports success so the UI can be reviewed.
        }
        return text.length > 0 && text.length <= 4000
      }
    }
  }

  Object.defineProperty(window, 'nexus', { value: bridge, writable: false, configurable: false })
}
