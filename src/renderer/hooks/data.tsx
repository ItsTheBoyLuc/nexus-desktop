import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AttendanceDivisions,
  AttendancePost,
  Calendar,
  Channel,
  DirtyDriver,
  DirtyHistory,
  Game,
  Guild,
  LeagueGames,
  NextRace,
  Overview,
  PenaltyHistory,
  PenaltyOverview,
  PenaltySettings,
  PointsSystem,
  RacingDriverProfile,
  RacingGame,
  RacingTeam,
  RacingTeamDetail,
  Report,
  ReportRoundDetail,
  ReportRoundRow,
  Role,
  ServerSettings,
  Signup,
  SignupQuestions,
  Standings,
  Team
} from '../../shared/types'
import { cached, clearCache, dropCached, onInvalidate } from '../lib/cache'
import { errorCode, unwrap } from '../lib/errors'
import { racingKey } from '../lib/racingScope'
import { useAsync } from './useAsync'
import type { AsyncState } from './useAsync'

interface RefreshContextValue {
  /** Changes on every manual refresh; part of every data hook's request key. */
  tick: number
  refresh: () => void
}

const RefreshContext = createContext<RefreshContextValue | null>(null)

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => {
    clearCache()
    setTick((value) => value + 1)
  }, [])
  const value = useMemo(() => ({ tick, refresh }), [tick, refresh])
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
}

export function useRefresh(): RefreshContextValue {
  const context = useContext(RefreshContext)
  if (!context) throw new Error('useRefresh must be used inside <RefreshProvider>')
  return context
}

export type Loaded<T> = AsyncState<T> & { reload: () => void }

/**
 * Shared plumbing of every data hook: global refresh tick, stale-while-revalidate, and
 * invalidate(prefix) from the screens that just wrote something.
 *
 *  - `share` true: the answer goes through the short TTL cache (several components read it);
 *    false: every mount asks the server (screens that must show the real, current state).
 *  - `key` null: nothing to load yet.
 */
export function useApiData<T>(key: string | null, load: () => Promise<T>, share: boolean): Loaded<T> {
  const { tick } = useRefresh()
  const [invalidations, setInvalidations] = useState(0)

  useEffect(
    () =>
      onInvalidate((prefix) => {
        if (key !== null && key.startsWith(prefix)) setInvalidations((count) => count + 1)
      }),
    [key]
  )

  const result = useAsync(
    () => {
      if (key === null) return new Promise<T>(() => undefined) // nothing to load: stay in "loading", never fake an answer
      return share ? cached(key, load) : load()
    },
    key ?? 'none',
    `${tick}.${invalidations}`
  )
  const reload = useCallback(() => {
    if (key !== null) dropCached(key)
    result.reload()
  }, [key, result])
  return { ...result, reload }
}

export function useGuilds(): Loaded<Guild[]> {
  return useApiData('guilds', () => unwrap(window.nexus.api.guilds()), true)
}

export function useGuildGames(guildId: string | undefined): Loaded<Game[]> {
  return useApiData(guildId ? `games:${guildId}` : null, () => unwrap(window.nexus.api.games(guildId ?? '')), true)
}

export function useGuildChannels(guildId: string | undefined): Loaded<Channel[]> {
  return useApiData(guildId ? `channels:${guildId}` : null, () => unwrap(window.nexus.api.channels(guildId ?? '')), true)
}

export function useGuildRoles(guildId: string | undefined): Loaded<Role[]> {
  return useApiData(guildId ? `roles:${guildId}` : null, () => unwrap(window.nexus.api.roles(guildId ?? '')), true)
}

/** Screens that show server state read it fresh every time they open (no TTL cache). */
export function useOverview(guildId: string | undefined): Loaded<Overview> {
  return useApiData(guildId ? `overview:${guildId}` : null, () => unwrap(window.nexus.api.overview(guildId ?? '')), false)
}

export function useServerSettings(guildId: string | undefined): Loaded<ServerSettings> {
  return useApiData(guildId ? `server-settings:${guildId}` : null, () => unwrap(window.nexus.api.serverSettings(guildId ?? '')), false)
}

export function useLeagueGames(guildId: string | undefined): Loaded<LeagueGames> {
  return useApiData(guildId ? `league-games:${guildId}` : null, () => unwrap(window.nexus.api.leagueGames(guildId ?? '')), false)
}

// ── F1 league (milestone 2): always read fresh, like every screen that shows server state ──

export function useCalendar(guildId: string | undefined): Loaded<Calendar> {
  return useApiData(guildId ? `f1-calendar:${guildId}` : null, () => unwrap(window.nexus.api.calendar(guildId ?? '')), false)
}

/** `null` data = there is no calendar (404 calendar_not_found), which is a normal state, not an error. */
export function useNextRace(guildId: string | undefined): Loaded<NextRace | null> {
  return useApiData(
    guildId ? `f1-next-race:${guildId}` : null,
    async () => {
      try {
        return await unwrap(window.nexus.api.nextRace(guildId ?? ''))
      } catch (error) {
        if (errorCode(error) === 'calendar_not_found') return null
        throw error
      }
    },
    false
  )
}

export function useTeams(guildId: string | undefined): Loaded<Team[]> {
  return useApiData(guildId ? `f1-teams:${guildId}` : null, () => unwrap(window.nexus.api.teams(guildId ?? '')), false)
}

export function useStandings(guildId: string | undefined): Loaded<Standings> {
  return useApiData(guildId ? `f1-standings:${guildId}` : null, () => unwrap(window.nexus.api.standings(guildId ?? '')), false)
}

export function usePointsSystem(guildId: string | undefined): Loaded<PointsSystem> {
  return useApiData(guildId ? `f1-points:${guildId}` : null, () => unwrap(window.nexus.api.pointsSystem(guildId ?? '')), false)
}

// ── Reports, penalties and dirty drivers (milestone 3): always read fresh ──
// Key layout: every report key starts with `f1-reports:<guild>`, every penalty key with `f1-penalty:<guild>` and every
// dirty-driver key with `f1-dirty:<guild>`, so lib/invalidation.ts can refresh a whole area with one prefix.

export function useReport(guildId: string | undefined, reportId: string | null): Loaded<Report> {
  return useApiData(guildId && reportId ? `f1-reports:${guildId}:one:${reportId}` : null, () => unwrap(window.nexus.api.report(guildId ?? '', reportId ?? '')), false)
}

export function useReportRounds(guildId: string | undefined): Loaded<ReportRoundRow[]> {
  return useApiData(guildId ? `f1-reports:${guildId}:rounds` : null, () => unwrap(window.nexus.api.reportRounds(guildId ?? '')), false)
}

export function useReportRound(guildId: string | undefined, round: { season: string; round: string } | null): Loaded<ReportRoundDetail> {
  return useApiData(
    guildId && round ? `f1-reports:${guildId}:round:${round.season}:${round.round}` : null,
    () => unwrap(window.nexus.api.reportRound(guildId ?? '', round?.season ?? '', round?.round ?? '')),
    false
  )
}

export function usePenaltySettings(guildId: string | undefined): Loaded<PenaltySettings> {
  return useApiData(guildId ? `f1-penalty:${guildId}:settings` : null, () => unwrap(window.nexus.api.penaltySettings(guildId ?? '')), false)
}

/** `season` undefined = the current season. A 404 penalty_not_configured arrives as an error (the screen explains it). */
export function usePenaltyOverview(guildId: string | undefined, season: number | undefined): Loaded<PenaltyOverview> {
  return useApiData(guildId ? `f1-penalty:${guildId}:overview:${season ?? 'current'}` : null, () => unwrap(window.nexus.api.penaltyOverview(guildId ?? '', season)), false)
}

export function usePenaltyHistory(guildId: string | undefined, driver: string | null, season: number | undefined): Loaded<PenaltyHistory> {
  return useApiData(
    guildId && driver ? `f1-penalty:${guildId}:history:${season ?? 'current'}:${driver.toLowerCase()}` : null,
    () => unwrap(window.nexus.api.penaltyHistory(guildId ?? '', driver ?? '', season)),
    false
  )
}

export function useDirtyDrivers(guildId: string | undefined): Loaded<DirtyDriver[]> {
  return useApiData(guildId ? `f1-dirty:${guildId}:list` : null, () => unwrap(window.nexus.api.dirtyDrivers(guildId ?? '')), false)
}

export function useDirtyHistory(guildId: string | undefined, driver: string | null): Loaded<DirtyHistory> {
  return useApiData(guildId && driver ? `f1-dirty:${guildId}:history:${driver.toLowerCase()}` : null, () => unwrap(window.nexus.api.dirtyHistory(guildId ?? '', driver ?? '')), false)
}

// ── Attendance and sign-ups (milestone 4): always read fresh ──
// Keys: `f1-attendance:<guild>:...`, `league-signups:<guild>:...` and `signup-questions:<guild>`, so lib/invalidation.ts can refresh
// a whole area with one prefix. Participants (personal data) are never put in the shared cache: they only live in component state.

export function useAttendanceDivisions(guildId: string | undefined): Loaded<AttendanceDivisions> {
  return useApiData(guildId ? `f1-attendance:${guildId}:divisions` : null, () => unwrap(window.nexus.api.attendanceDivisions(guildId ?? '')), false)
}

export function useAttendancePost(guildId: string | undefined, messageId: string | null): Loaded<AttendancePost> {
  return useApiData(guildId && messageId ? `f1-attendance:${guildId}:post:${messageId}` : null, () => unwrap(window.nexus.api.attendancePost(guildId ?? '', messageId ?? '')), false)
}

export function useSignupQuestions(guildId: string | undefined): Loaded<SignupQuestions> {
  return useApiData(guildId ? `signup-questions:${guildId}` : null, () => unwrap(window.nexus.api.signupQuestions(guildId ?? '')), false)
}

export function useSignups(guildId: string | undefined): Loaded<Signup[]> {
  return useApiData(guildId ? `league-signups:${guildId}:list` : null, () => unwrap(window.nexus.api.signups(guildId ?? '')), false)
}

export function useSignup(guildId: string | undefined, signupId: string | null): Loaded<Signup> {
  return useApiData(guildId && signupId ? `league-signups:${guildId}:one:${signupId}` : null, () => unwrap(window.nexus.api.signup(guildId ?? '', signupId ?? '')), false)
}

// ── Esports teams (milestone 5): always read fresh, keyed by server AND game (see lib/racingScope.ts) ──
// Roster and member data is personal data: it is never put in the shared cache, it only lives in component state.

export function useRacingTeams(guildId: string | undefined, game: RacingGame): Loaded<RacingTeam[]> {
  return useApiData(guildId ? racingKey(guildId, game, 'teams') : null, () => unwrap(window.nexus.api.racingTeams(guildId ?? '', game)), false)
}

export function useRacingTeam(guildId: string | undefined, game: RacingGame, name: string | null): Loaded<RacingTeamDetail> {
  return useApiData(guildId && name ? racingKey(guildId, game, 'team', name.toLowerCase()) : null, () => unwrap(window.nexus.api.racingTeam(guildId ?? '', game, name ?? '')), false)
}

export function useRacingDriver(guildId: string | undefined, game: RacingGame, userId: string | null): Loaded<RacingDriverProfile> {
  return useApiData(guildId && userId ? racingKey(guildId, game, 'driver', userId) : null, () => unwrap(window.nexus.api.racingDriver(guildId ?? '', game, userId ?? '')), false)
}
