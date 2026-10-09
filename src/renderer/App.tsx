import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorState, LoadingRegion, Skeleton, ToastProvider } from './components'
import { AuthProvider } from './hooks/auth'
import { useGuilds } from './hooks/data'
import { SettingsProvider, useSettings } from './hooks/settings'
import { RequireAuth } from './layout/AppShell'
import { describeError } from './lib/errors'
import { gameHomePage, LEAGUE_PAGES, routes } from './lib/routes'
import { Announcement } from './screens/Announcement'
import { ComingSoon } from './screens/ComingSoon'
import { GamePicker } from './screens/GamePicker'
import { GamesTiers } from './screens/GamesTiers'
import { LeagueRoute, useLeague } from './screens/LeagueRoute'
import { Login } from './screens/Login'
import { Overview } from './screens/Overview'
import { ServerRoute } from './screens/ServerRoute'
import { ServerSettingsScreen } from './screens/ServerSettings'
import { Servers } from './screens/Servers'

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
                  {[...LEAGUE_PAGES, 'esports' as const].map((page) => (
                    <Route key={page} path={page} element={<ComingSoon page={page} />} />
                  ))}
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
