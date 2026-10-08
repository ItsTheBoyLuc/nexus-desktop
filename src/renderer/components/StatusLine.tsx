import { useApiStatus } from '../hooks/auth'

const COPY = {
  unknown: { text: 'Connecting to server', tone: 'muted' },
  online: { text: 'Server connected', tone: 'success' },
  waking: { text: 'Server is waking up', tone: 'muted' },
  offline: { text: 'No connection', tone: 'danger' }
} as const

/** Small live API-connection line (text + dot, so it never relies on colour alone). */
export function StatusLine() {
  const status = useApiStatus()
  const { text, tone } = COPY[status]
  return (
    <div className="status-line" role="status" aria-live="polite">
      <span className={`status-line__dot status-line__dot--${tone}`} aria-hidden="true" />
      <span>{text}</span>
    </div>
  )
}
