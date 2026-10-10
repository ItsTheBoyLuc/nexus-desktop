/** Types shared by the main process, the preload bridge and the renderer. */

export const GAME_KEYS = ['f1', 'lmu', 'iracing', 'gt7', 'acc'] as const
export type GameKey = (typeof GAME_KEYS)[number]

export function isGameKey(value: unknown): value is GameKey {
  return typeof value === 'string' && (GAME_KEYS as readonly string[]).includes(value)
}

/** Short names for navigation and fallbacks; the API's own `label` wins when present. */
export const GAME_LABELS: Record<GameKey, string> = {
  f1: 'Formula 1',
  lmu: 'Le Mans Ultimate',
  iracing: 'iRacing',
  gt7: 'Gran Turismo 7',
  acc: 'Assetto Corsa Competizione'
}

export interface UserInfo {
  id: string
  username: string
  /** Avatar image URL (Discord CDN). */
  avatar: string
}

export interface Guild {
  id: string
  name: string
  icon: string | null
}

export interface Game {
  key: string
  label: string
  enabled: boolean
}

export interface Channel {
  id: string
  name: string
}

/** A Discord role as listed by GET /roles (for pickers). */
export interface Role {
  id: string
  name: string
  /** "#RRGGBB" or null for the default colour. */
  color: string | null
  position: number
  /** Bot / integration role: cannot be linked to a tier. */
  managed: boolean
  /** The bot may hand this role out (below the bot's highest role). */
  assignable: boolean
  /** Carries elevated permissions: only a server Administrator may link it. */
  privileged: boolean
}

export interface AnnouncementInput {
  title: string
  message: string
  channelId: string
  imageUrl?: string
}

export interface AnnouncementResult {
  messageId: string
  channelId: string
}

export type SignedOutReason =
  | 'logged-out'
  | 'denied'
  | 'cancelled'
  | 'timeout'
  | 'expired'
  | 'session-ended'
  | 'offline'
  | 'error'

/** What the login screen / app shell reacts to. Tokens are never part of it. */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; reason?: SignedOutReason }
  | { status: 'signing-in' }
  | { status: 'signed-in'; user: UserInfo }

// ── Server settings (GET/PUT /settings) ─────────────────────────────────────

export type SeasonSource = 'penalty_settings' | 'settings' | 'default'

export interface ServerSettings {
  /** "#RRGGBB", upper-case. */
  embedColor: string
  footerName: string
  /** The value stored in settings; null if never set. */
  seasonNumber: number | null
  /** The season every command actually uses. */
  effectiveSeason: number
  /** Which stored value decides `effectiveSeason`. */
  seasonSource: SeasonSource
  /** True when the caller is an Administrator (may PUT). null when the server did not say (older backend): rely on 403 admin_required. */
  canEdit: boolean | null
}

/** Any subset; only the fields present are changed. */
export interface ServerSettingsInput {
  embedColor?: string
  footerName?: string
  seasonNumber?: number
}

// ── League games and tiers (/league/games...) ───────────────────────────────

export interface Tier {
  key: string
  roleId: string
  signupPanelPosted: boolean
  signupChannelId: string | null
  pointsSystem: string | null
  /** Members holding the role right now; null if the role no longer exists. */
  driverCount: number | null
  roleName: string | null
}

export interface LeagueGame {
  key: string
  label: string
  category: string
  active: boolean
  tiers: Tier[]
}

export interface LeagueGames {
  games: LeagueGame[]
  /** False when Discord would not return the full member list: driver counts may be too low. */
  memberCacheComplete: boolean
}

export interface GameCreateInput {
  gameKey: string
  label: string
  category: string
}

export interface TierCreateInput {
  tierKey: string
  roleId: string
  /** null or absent = none. */
  pointsSystem?: string | null
}

export interface TierUpdateInput {
  roleId?: string
  pointsSystem?: string | null
  signupChannelId?: string | null
}

export interface PanelInput {
  channelId: string
  /** Present = edit that panel in place (refresh); absent = post a new panel. */
  messageId?: string
}

export interface PanelResult {
  messageId: string
  channelId: string
  refreshed: boolean
  tier: Tier
}

/** A sign-up panel this app posted: the API cannot look panels up, so the app remembers them. */
export interface StoredPanel {
  messageId: string
  channelId: string
}

// ── Overview (GET /overview) ────────────────────────────────────────────────

export interface OverviewCounts {
  games: number
  activeGames: number
  tiers: number
  tiersWithPanel: number
  tierDrivers: number
  teams: number
  teamDrivers: number
  calendarRounds: number
  openSignups: number
  reports: number
  pendingReports: number
}

export interface ChecklistItem {
  key: string
  label: string
  done: boolean
  detail: string | null
}

export interface NextEvent {
  round: number | string | null
  name: string
  flag: string | null
  /** As stored by the bot (text). */
  date: string
  time: string | null
  eventType: string
  countdownHours: number
}

export interface Overview {
  memberCount: number | null
  season: number
  counts: OverviewCounts
  nextEvent: NextEvent | null
  checklist: ChecklistItem[]
  setupComplete: boolean
  memberCacheComplete: boolean
}

// ── F1 league (milestone 2): calendar, teams, standings, points system ─────

/** The three event types the backend accepts, exactly as written. */
export const EVENT_TYPES = ['Normal Race', 'Sprint Weekend', 'Full Qualifying'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value)
}

export interface CalendarRound {
  /** As returned: rounds are never renumbered, so a deleted round leaves a gap. */
  round: number
  name: string
  /** DD/MM/YYYY or "TBD". */
  date: string
  /** HH:MM (24 h) or "" (to be decided). */
  time: string
  /** Up to 8 characters (a flag emoji or a short code); may be empty. */
  flag: string
  /** Normally one of EVENT_TYPES; kept as text so legacy data still shows. */
  eventType: string
}

export interface Calendar {
  name: string
  /** Someone is in the middle of the /f1 calendar wizard in Discord. */
  setupInProgress: boolean
  rounds: CalendarRound[]
}

export interface RoundInput {
  name: string
  date: string
  time: string
  flag: string
  eventType: EventType
  /** Optional 1-99: fills a gap. Absent = highest number + 1. */
  round?: number
}

/** Any subset; only the fields present are changed. */
export interface RoundPatch {
  name?: string
  date?: string
  time?: string
  flag?: string
  eventType?: EventType
}

export interface RoundResult {
  round: CalendarRound
  calendar: Calendar
}

export interface NextRace {
  calendarName: string
  race: CalendarRound
  /** False when every round is in the past: `race` is then the last round. */
  upcoming: boolean
  countdownHours: number | null
  countdown: { days: number; hours: number } | null
}

export interface CalendarPostInput {
  channelId: string
  /** Present = edit that message in place; absent = post a new one. */
  messageId?: string
}

export interface CalendarPostResult {
  messageId: string
  channelId: string
  refreshed: boolean
}

export interface TeamDriver {
  userId: string
  username: string
  displayName: string
  number: number | null
  points: number
  wins: number
  podiums: number
}

export interface Team {
  name: string
  abbreviation: string
  /** "#RRGGBB" upper-case, or null if the server sent something else. */
  color: string | null
  roleId: string | null
  roleName: string | null
  channelId: string | null
  channelName: string | null
  /** Sum of the drivers' points. */
  points: number
  drivers: TeamDriver[]
}

export interface TeamInput {
  name: string
  color: string
  abbreviation: string
}

export interface AddDriverInput {
  userId: string
  /** 0-999; absent or null = no number. */
  number?: number | null
}

export interface AddDriverResult {
  team: Team
  userId: string
}

export interface RemoveDriverResult {
  team: Team
  roleRemoved: boolean
  /** False when the driver has left the server (the roster entry is still removed). */
  memberInServer: boolean
}

export interface DriverStats {
  userId: string
  username: string
  displayName: string
  /** "—" for a driver on no team. */
  team: string
  points: number
  wins: number
  podiums: number
  number: number | null
}

/** A server member as listed by the member search (for pickers). */
export interface Member {
  id: string
  username: string
  displayName: string
  avatar: string | null
  bot: boolean
}

export interface MemberSearch {
  members: Member[]
  /** More than 25 matched: refine the search. */
  truncated: boolean
}

export interface StandingsDriver {
  position: number
  userId: string
  username: string
  team: string
  points: number
  wins: number
  podiums: number
  gap: number
}

export interface StandingsTeam {
  position: number
  team: string
  points: number
  drivers: number
  gap: number
}

export interface Standings {
  drivers: StandingsDriver[]
  constructors: StandingsTeam[]
}

/** One race to record. Drivers are always chosen from a picker and sent by user id, never typed. */
export interface ResultsInput {
  season: string
  round: string
  circuit: string
  /** Finishing order: position = index + 1. 1-20 distinct user ids. */
  results: string[]
  fastestLap?: string
  pole?: string
  /** Optional: post the results, WDC and WCC embeds in this channel (the server checks it before anything is recorded). */
  channelId?: string
  /** Only set after the user confirmed the "recording again adds the points a second time" warning. */
  confirmDuplicate?: boolean
}

export interface ResultLine {
  position: number
  name: string
  /** What the SERVER awarded; the app never computes points. */
  points: number
  matched: boolean
}

export interface RaceOutcome {
  raceTitle: string
  results: ResultLine[]
  /** Drivers the server could not match: they scored nothing. */
  notFound: string[]
  standings: Standings
  /** Where the three embeds were posted; null when no channel was chosen (or the post failed, see announceError). */
  posted: { channelId: string; messageIds: string[] } | null
  /** Backend code of a failed post. The points ARE recorded regardless. */
  announceError: string | null
  /** The server's own results ledger: `recorded` false = the points were applied but the ledger write failed. */
  ledger: { recorded: boolean; duplicate: boolean } | null
}

/** One race recorded through the app, as listed by GET /f1/standings/results-ledger (races recorded with Discord commands are not in it). */
export interface ServerLedgerEntry {
  season: string
  round: string
  circuit: string
  recordedBy: string
  timestamp: string
}

export interface PointsSystem {
  /** Always 20 entries, P1 first. */
  points: number[]
  pole: number
  fastestLap: number
  /** Nothing saved yet: the built-in defaults apply. */
  isDefault: boolean
  /** The built-in table, always returned by the server so the form can offer "Reset to defaults". null = the server did not send it. */
  defaults: PointsSystemInput | null
}

export interface PointsSystemInput {
  points: number[]
  pole: number
  fastestLap: number
}

// ── Reports, penalties and dirty drivers (milestone 3) ──────────────────────

export const REPORT_STATUSES = ['pending', 'under_investigation', 'penalty_issued', 'no_further_action'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

/** A driver report. Every text field is untrusted user text: it is rendered as plain text and nothing else. */
export interface Report {
  id: string
  /** The "Report #n" of /f1 report-overview: its position inside its round. */
  number: number
  roundKey: string
  /** As typed by the reporter. */
  season: string
  round: string
  circuit: string
  reporter: string
  reporterId: string | null
  driversInvolved: string
  lap: string
  description: string
  evidenceUrl: string | null
  evidenceImg: string | null
  status: ReportStatus
  /** True for penalty_issued and no_further_action. */
  decided: boolean
  /** The penalty text of a decided report. The NFA explanation and the awarded points are NOT returned by the API. */
  penalty: string | null
  decision: { type: string; penalty: string | null } | null
  threadName: string
  messageId: string | null
  timestamp: string
}

export interface ReportFilters {
  season?: string
  round?: string
  status?: ReportStatus
  driver?: string
  /** 1-100, default 50. */
  limit?: number
  offset?: number
}

export interface ReportPage {
  total: number
  limit: number
  offset: number
  reports: Report[]
}

export interface ReportRoundRow {
  season: string
  round: string
  roundKey: string
  circuit: string
  total: number
  pending: number
  underInvestigation: number
  penaltyIssued: number
  noFurtherAction: number
}

export interface ReportRoundDetail {
  season: string
  round: string
  roundKey: string
  circuit: string
  count: number
  reports: Report[]
}

export type DecisionInput =
  | { decision: 'no_further_action'; explanation: string }
  | {
      decision: 'penalty_issued'
      description: string
      /** Required when penaltyPoints > 0. A name, exactly as the server matches it (trimmed, case-insensitive). */
      driver?: string
      /** 0-999. */
      penaltyPoints: number
      /** Absent: the season in the report's title, then the current season. */
      season?: number
    }

export interface DecisionPoints {
  applied: boolean
  driver: string | null
  added: number
  season: number | null
  total: number | null
  qualiBanned: boolean
  raceBanned: boolean
  /** The ban text of a threshold that was crossed. */
  banNotice: string | null
  /** True when the server posted it in the report's thread. */
  banNoticePosted: boolean
}

export interface DecisionResult {
  decision: 'penalty_issued' | 'no_further_action'
  report: Report
  points: DecisionPoints
  /** Steps that failed AFTER the decision was applied (`points_field_failed:<code>`, `ban_notice_failed:<code>`). */
  warnings: string[]
}

export interface PenaltyDefaults {
  currentSeason: number
  expiryRaces: number
  qualiBanThreshold: number
  raceBanThreshold: number
}

export interface PenaltySettings {
  /** False: /league penalty-setup has not been done. The other values are then null (except the season). */
  configured: boolean
  /** The effective season, also when not configured. */
  currentSeason: number
  expiryRaces: number | null
  qualiBanThreshold: number | null
  raceBanThreshold: number | null
  setupBy: string | null
  setupAt: string | null
  defaults: PenaltyDefaults | null
}

/** All four fields are required by PUT. */
export type PenaltySettingsInput = PenaltyDefaults

export type BanState = 'race' | 'quali' | 'none'

export interface PenaltyRow {
  position: number
  key: string
  displayName: string
  totalPoints: number
  incidents: number
  ban: BanState
  qualiBanned: boolean
  raceBanned: boolean
  /** The "Reported (N)" flag: dirty-driver reports on file for this driver. */
  reportedCount: number
}

export interface PenaltyOverview {
  season: number
  currentSeason: number
  isCurrent: boolean
  settings: { expiryRaces: number | null; qualiBanThreshold: number | null; raceBanThreshold: number | null }
  drivers: PenaltyRow[]
}

export interface PenaltyHistoryItem {
  index: number
  /** Negative for an admin removal. */
  points: number
  reason: string
  race: string
  /** null for an admin removal: it never expires. */
  expiresAfterRace: number | null
  timestamp: string
}

export interface PenaltyHistory {
  season: number
  key: string
  displayName: string
  totalPoints: number
  incidents: number
  ban: BanState
  qualiBanned: boolean
  raceBanned: boolean
  history: PenaltyHistoryItem[]
}

export interface ManualPointsInput {
  driver: string
  penaltyType: string
  /** 0-999. 0 records nothing and needs a channel (it only posts the Stewards Decision embed). */
  points: number
  reason: string
  season?: number
  /** Optional: post the public Stewards Decision embed there. The ban text is never posted. */
  channelId?: string
}

export interface ManualPointsResult {
  driver: string
  season: number
  saved: boolean
  pointsAdded: number
  totalPoints: number | null
  qualiBanned: boolean
  raceBanned: boolean
  /** Returned, never posted by the server: shown to the issuer only. */
  banNotice: string | null
  posted: { channelId: string; messageId: string } | null
  announceError: string | null
}

export interface ClearPointsInput {
  driver: string
  /** Absent = clear all points and the whole history for the season. 1-99999 = remove that many. */
  points?: number
  reason: string
  season?: number
  /** Always true: the server answers 400 confirm_required without it, and the app only sends it after its confirm dialog. */
  confirm: true
}

export interface ClearPointsResult {
  driver: string
  season: number
  mode: 'all' | 'partial'
  pointsRemoved: number
  remaining: number
}

export type BanType = 'quali' | 'race'
export type BanAction = 'give' | 'remove'

export interface BanInput {
  driver: string
  banType: BanType
  action: BanAction
  season?: number
  reason?: string
  confirm: true
}

export interface BanResult {
  driver: string
  season: number
  action: BanAction
  banType: BanType
  qualiBanned: boolean
  raceBanned: boolean
  totalPoints: number
}

export interface AdvanceRaceInput {
  /** 0-9999. */
  raceNumber: number
  confirm: true
}

export interface AdvanceRaceResult {
  raceNumber: number
  season: number
  expired: Array<{ key: string; displayName: string; points: number; race: string }>
  updated: Array<{ key: string; displayName: string; oldTotal: number; newTotal: number }>
}

export interface DirtyReportBody {
  reason: string
  /** The evidence URL as stored: http(s) text. */
  evidence: string
  reportedBy: string
  relatedIncident: string | null
  timestamp: string
}

export interface DirtyDriver {
  key: string
  displayName: string
  reportCount: number
  latest: DirtyReportBody
}

export interface DirtyReport extends DirtyReportBody {
  /** The number remove-report takes (1-based). */
  index: number
}

export interface DirtyHistory {
  key: string
  displayName: string
  total: number
  reports: DirtyReport[]
}

export interface DirtyReportInput {
  driver: string
  reason: string
  evidenceUrl: string
  relatedIncident?: string
}

export interface DirtyReportResult {
  displayName: string
  totalReports: number
  report: DirtyReport
}

export interface DirtyRemoveResult {
  displayName: string
  removedIndex: number
  /** The last report was removed, so the driver left the list. */
  driverRemoved: boolean
  removed: DirtyReportBody
}

export type ApiErrorKind =
  | 'http'
  | 'network'
  | 'timeout'
  | 'session'
  | 'rate_limited'
  | 'invalid_response'
  | 'validation'
  | 'unexpected'

/** Serializable error that crosses the IPC boundary. */
export interface ApiErrorInfo {
  kind: ApiErrorKind
  /** Backend error code ("forbidden", "bot_cannot_send", ...) or a client-side code. */
  code: string
  message: string
  status?: number
  /** Seconds, for rate_limited. */
  retryAfter?: number
  /** Only for network / timeout failures: false when the request provably never reached the server. */
  mayHaveBeenSent?: boolean
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorInfo }

export type ApiStatus = 'unknown' | 'online' | 'waking' | 'offline'

/** A race this app recorded successfully, kept locally to warn before the same race is recorded twice. */
export interface LedgerEntry {
  guildId: string
  /** Free text exactly as entered (<= 20 characters). */
  season: string
  /** Free text exactly as entered (<= 10 characters). */
  round: string
  circuit: string
  /** ISO 8601 time of the confirmed answer. */
  recordedAt: string
}

/** App settings kept in userData/settings.json. Not sensitive, never contains tokens. */
export interface Settings {
  lastGuildId: string | null
  lastGame: GameKey | null
  /** Sign-up panels posted by this app, by `guildId:gameKey:tierKey` (see shared/panels.ts). */
  panels: Record<string, StoredPanel>
  /** The calendar message this app posted, per server id (the API does not store message ids). */
  calendarPosts: Record<string, StoredPanel>
  /** Races this app recorded, oldest first (see shared/f1Store.ts). Only the main process writes it. */
  ledger: LedgerEntry[]
}

export const DEFAULT_SETTINGS: Settings = { lastGuildId: null, lastGame: null, panels: {}, calendarPosts: {}, ledger: [] }

/** What the renderer may change itself; panels are only ever written by the main process. */
export type SettingsPatch = Partial<Pick<Settings, 'lastGuildId' | 'lastGame'>>
