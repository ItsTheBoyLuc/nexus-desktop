import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorState, LoadingRegion, Skeleton, ToastProvider } from './components'
import { AuthProvider } from './hooks/auth'
import { useGuilds } from './hooks/data'
import { SettingsProvider, useSettings } from './hooks/settings'
import { UpdatesProvider } from './hooks/updates'
import { RequireAuth } from './layout/AppShell'
import { describeError } from './lib/errors'
import { gameHomePage, LEAGUE_PAGES, routes } from './lib/routes'
import { Announcement } from './screens/Announcement'
import { Attendance } from './screens/Attendance'
import { Calendar } from './screens/Calendar'
import { ComingSoon } from './screens/ComingSoon'
import { DirtyDrivers } from './screens/DirtyDrivers'
import { EsportsAnnouncement } from './screens/EsportsAnnouncement'
import { EsportsAttendance } from './screens/EsportsAttendance'
import { EsportsEvents } from './screens/EsportsEvents'
import { EsportsResults } from './screens/EsportsResults'
import { EsportsRoute } from './screens/EsportsRoute'
import { EsportsTeams } from './screens/EsportsTeams'
import { GamePicker } from './screens/GamePicker'
import { GamesTiers } from './screens/GamesTiers'
import { LeagueRoute, useLeague } from './screens/LeagueRoute'
import { Login } from './screens/Login'
import { Overview } from './screens/Overview'
import { Penalties } from './screens/Penalties'
import { Reports } from './screens/Reports'
import { ServerRoute } from './screens/ServerRoute'
import { ServerSettingsScreen } from './screens/ServerSettings'
import { Servers } from './screens/Servers'
import { Signups } from './screens/Signups'
import { Standings } from './screens/Standings'
import { Teams } from './screens/Teams'

/** League pages that have a real screen; the others still show "Coming in the next phase". */
const IMPLEMENTED_PAGES: ReadonlySet<string> = new Set(['calendar', 'teams', 'standings', 'reports', 'penalties', 'dirty-drivers', 'attendance', 'signups', 'esports'])

/** A game's landing page: Formula 1 opens its league, every other game its esports team. */
function GameIndex() {
  const { guild, game } = useLeague()
  return <Navigate to={routes.game(guild.id, game.key, gameHomePage(game.key))} replace />
}

/** Entry point after login: reopen the last server if it is still valid, else pick a server. */
function Home() {
  const { settings, loaded } = useSettings()
  const guilds = useGuilds()

  if (guilds.status === 'error') return <ErrorState title="Could not load your servers" message={describeError(guilds.error)} onRetry={guilds.reload} />
  if (!loaded || guilds.status === 'loading') {
    return (
      <LoadingRegion label="Loading" className="page">
        <Skeleton width={240} height={28} />
      </LoadingRegion>
    )
  }

  const lastGuild = settings.lastGuildId && guilds.data.some((guild) => guild.id === settings.lastGuildId) ? settings.lastGuildId : null
  if (lastGuild) return <Navigate to={routes.server(lastGuild, 'overview')} replace />
  return <Navigate to={routes.servers} replace />
}

export function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <UpdatesProvider>
        <ToastProvider>
          <HashRouter>
            <Routes>
              <Route path="login" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route index element={<Home />} />
                <Route path="servers" element={<Servers />} />
                <Route path="g/:guildId" element={<GamePicker />} />
                <Route path="g/:guildId/server" element={<ServerRoute />}>
                  <Route index element={<Navigate to="overview" replace />} />
                  <Route path="overview" element={<Overview />} />
                  <Route path="tiers" element={<GamesTiers />} />
                  <Route path="settings" element={<ServerSettingsScreen />} />
                  <Route path="announcement" element={<Announcement />} />
                </Route>
                <Route path="g/:guildId/:game" element={<LeagueRoute />}>
                  <Route index element={<GameIndex />} />
                  <Route path="calendar" element={<Calendar />} />
                  <Route path="teams" element={<Teams />} />
                  <Route path="standings" element={<Standings />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="penalties" element={<Penalties />} />
                  <Route path="dirty-drivers" element={<DirtyDrivers />} />
                  <Route path="attendance" element={<Attendance />} />
                  <Route path="signups" element={<Signups />} />
                  {[...LEAGUE_PAGES, 'esports' as const]
                    .filter((page) => !IMPLEMENTED_PAGES.has(page))
                    .map((page) => (
                      <Route key={page} path={page} element={<ComingSoon page={page} />} />
                    ))}
                </Route>
                {/* The Esports team of every game: its own route group, which does NOT require the game to be enabled in Games & Tiers. */}
                <Route path="g/:guildId/:game/esports" element={<EsportsRoute />}>
                  <Route index element={<Navigate to="teams" replace />} />
                  <Route path="teams" element={<EsportsTeams />} />
                  <Route path="events" element={<EsportsEvents />} />
                  <Route path="results" element={<EsportsResults />} />
                  <Route path="attendance" element={<EsportsAttendance />} />
                  <Route path="announcement" element={<EsportsAnnouncement />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </HashRouter>
        </ToastProvider>
        </UpdatesProvider>
      </SettingsProvider>
    </AuthProvider>
  )
}
