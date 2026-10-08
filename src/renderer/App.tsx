import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorState, LoadingRegion, Skeleton, ToastProvider } from './components'
import { AuthProvider } from './hooks/auth'
import { useGuilds } from './hooks/data'
import { SettingsProvider, useSettings } from './hooks/settings'
import { RequireAuth } from './layout/AppShell'
import { describeError } from './lib/errors'
import { routes } from './lib/routes'
import { Announcement } from './screens/Announcement'
import { ComingSoon } from './screens/ComingSoon'
import { GamePicker } from './screens/GamePicker'
import { LeagueRoute } from './screens/LeagueRoute'
import { Login } from './screens/Login'
import { Overview } from './screens/Overview'
import { Servers } from './screens/Servers'

/** Entry point after login: reopen the last server and game if they are still valid, else pick a server. */
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
  if (lastGuild && settings.lastGame) return <Navigate to={routes.league(lastGuild, settings.lastGame)} replace />
  if (lastGuild) return <Navigate to={routes.games(lastGuild)} replace />
  return <Navigate to={routes.servers} replace />
}

export function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <ToastProvider>
          <HashRouter>
            <Routes>
              <Route path="login" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route index element={<Home />} />
                <Route path="servers" element={<Servers />} />
                <Route path="g/:guildId" element={<GamePicker />} />
                <Route path="g/:guildId/:game" element={<LeagueRoute />}>
                  <Route index element={<Navigate to="overview" replace />} />
                  <Route path="overview" element={<Overview />} />
                  <Route path="calendar" element={<ComingSoon page="calendar" />} />
                  <Route path="reports" element={<ComingSoon page="reports" />} />
                  <Route path="standings" element={<ComingSoon page="standings" />} />
                  <Route path="teams" element={<ComingSoon page="teams" />} />
                  <Route path="announcement" element={<Announcement />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </HashRouter>
        </ToastProvider>
      </SettingsProvider>
    </AuthProvider>
  )
}
