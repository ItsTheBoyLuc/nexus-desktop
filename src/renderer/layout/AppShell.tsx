import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '../components'
import { useApiStatus, useAuth } from '../hooks/auth'
import { RefreshProvider } from '../hooks/data'
import { routes } from '../lib/routes'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

/** Full-window splash while the saved session is being restored. */
export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Starting Nexus">
      <Logo size={64} />
      <span className="spinner" aria-hidden="true" />
    </div>
  )
}

/** Route guard: signed-in users get the app shell, everyone else goes to the login screen. */
export function RequireAuth() {
  const { state } = useAuth()
  if (state.status === 'loading') return <Splash />
  if (state.status !== 'signed-in') return <Navigate to={routes.login} replace />
  return (
    <RefreshProvider>
      <Shell />
    </RefreshProvider>
  )
}

function Shell() {
  const { pathname } = useLocation()
  const status = useApiStatus()
  const contentRef = useRef<HTMLElement>(null)
  const firstRender = useRef(true)

  // After navigation, move focus to the content so keyboard and screen-reader users start at the top of the new page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    contentRef.current?.focus()
  }, [pathname])

  return (
    <div className="shell">
      <button type="button" className="skip-link" onClick={() => contentRef.current?.focus()}>
        Skip to content
      </button>
      <Sidebar />
      <div className="shell__main">
        <TopBar />
        {status === 'waking' ? (
          <div className="banner" role="status">
            <LoaderCircle size={16} aria-hidden="true" className="is-spinning" />
            The server is waking up. This can take up to a minute, please wait.
          </div>
        ) : null}
        <main id="content" ref={contentRef} className="shell__content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
