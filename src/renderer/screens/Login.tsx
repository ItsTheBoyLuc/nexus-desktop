import { LogIn, RotateCw } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { PRIVACY_URL, TERMS_URL } from '../../shared/constants'
import type { SignedOutReason } from '../../shared/types'
import { Button, Card, ExternalLink, Logo, Notice, WakingNote } from '../components'
import { useApiStatus, useAuth } from '../hooks/auth'
import { Splash } from '../layout/AppShell'

const MESSAGES: Record<SignedOutReason, { tone: 'info' | 'danger'; text: string }> = {
  'logged-out': { tone: 'info', text: 'You have been signed out.' },
  denied: { tone: 'danger', text: 'Access was denied. Nexus needs to know who you are on Discord to sign you in. Try again when you are ready.' },
  cancelled: { tone: 'info', text: 'Sign-in was cancelled.' },
  timeout: { tone: 'danger', text: 'Sign-in timed out because it was not finished in the browser. Start again when you are ready.' },
  expired: { tone: 'danger', text: 'Your session has expired. Please sign in again.' },
  'session-ended': { tone: 'danger', text: 'We could not renew your session. Please sign in again.' },
  offline: { tone: 'danger', text: "Can't connect to the Nexus server. Check your internet connection and try again." },
  error: { tone: 'danger', text: 'Sign-in could not be completed. Please try again.' }
}

export function Login() {
  const { state, login, cancelLogin, retrySession } = useAuth()
  const apiStatus = useApiStatus()

  if (state.status === 'loading') return <Splash />
  if (state.status === 'signed-in') return <Navigate to="/" replace />

  const signingIn = state.status === 'signing-in'
  const message = state.status === 'signed-out' && state.reason ? MESSAGES[state.reason] : null
  const offline = state.status === 'signed-out' && state.reason === 'offline'

  return (
    <main className="login">
      <Card className="login__card">
        <Logo size={64} label="Nexus" animated />
        <h1 className="login__title">Nexus</h1>
        <p className="login__tagline">Run your racing league from your desktop. Sign in with Discord to manage your servers.</p>

        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {apiStatus === 'waking' ? <WakingNote /> : null}

        {signingIn ? (
          <>
            <Button block loading disabled>
              Waiting for Discord
            </Button>
            <p className="login__hint" role="status">
              Finish signing in in your browser, then come back here.
            </p>
            <Button variant="ghost" block onClick={cancelLogin}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button block icon={<LogIn size={18} aria-hidden="true" />} onClick={login}>
              Continue with Discord
            </Button>
            {offline ? (
              <Button variant="secondary" block icon={<RotateCw size={16} aria-hidden="true" />} onClick={retrySession}>
                Try again
              </Button>
            ) : null}
          </>
        )}

        <p className="login__legal">
          By continuing you agree to the <ExternalLink href={TERMS_URL}>Terms</ExternalLink> and the <ExternalLink href={PRIVACY_URL}>Privacy Policy</ExternalLink>.
        </p>
      </Card>
    </main>
  )
}
