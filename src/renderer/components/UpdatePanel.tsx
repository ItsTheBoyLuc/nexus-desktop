import { Download, RefreshCw, RotateCw } from 'lucide-react'
import { useUpdates } from '../hooks/updates'
import { describeUpdate } from '../lib/updateView'
import type { UpdateAction } from '../lib/updateView'
import { Button } from './Button'

const ICONS: Record<UpdateAction, typeof RotateCw> = { check: RefreshCw, download: Download, install: RotateCw }

/**
 * The app updates in the Preferences popover: the version in use, a Check for updates button and the state of the update (checking, up to date,
 * available with its notes, downloading with progress, ready, error). Nothing is downloaded until the user chooses Download, and "Restart and install"
 * is off, with the reason written next to it, while a save, post or delete is in progress. The version and the notes come from the release and are
 * shown as plain text.
 */
export function UpdatePanel() {
  const { state, run } = useUpdates()
  const view = describeUpdate(state)
  const Icon = view.action ? ICONS[view.action.kind] : RefreshCw

  return (
    <section className="update" aria-labelledby="update-heading">
      <h3 id="update-heading" className="update__title">
        App updates
      </h3>
      <p className="update__version">Version {state ? <span className="plain-text">{state.currentVersion}</span> : '...'}</p>
      <div className="update__state" role={view.isError ? 'alert' : 'status'} aria-live="polite">
        <p className={view.isError ? 'update__headline update__headline--error' : 'update__headline'}>{view.headline}</p>
        {view.detail ? <p className="update__detail plain-text">{view.detail}</p> : null}
      </div>
      {view.progress !== null ? <progress className="update__progress" max={100} value={view.progress} aria-label="Download progress" /> : null}
      {view.notes ? (
        <div className="update__notes-wrap">
          <p className="field__label">What is new</p>
          {/* A read-only text box: it shows the notes as plain text (nothing in them is interpreted) and scrolls with the keyboard. */}
          <textarea className="update__notes plain-text" readOnly rows={6} value={view.notes} aria-label="Release notes" />
        </div>
      ) : null}
      {view.action ? (
        <Button
          size="sm"
          variant={view.action.kind === 'check' ? 'secondary' : 'primary'}
          icon={<Icon size={14} aria-hidden="true" />}
          disabled={view.action.disabled}
          loading={state?.status === 'checking'}
          aria-describedby={view.action.disabledReason ? 'update-disabled-reason' : undefined}
          onClick={() => void run(view.action!.kind)}
        >
          {view.action.label}
        </Button>
      ) : null}
      {state?.status === 'ready' && view.action?.disabled && view.action.disabledReason ? (
        <p id="update-disabled-reason" className="update__reason plain-text">
          {view.action.disabledReason}
        </p>
      ) : null}
    </section>
  )
}

/** The small badge in the sidebar footer: only when there is something to do (an update to download, a download running, one ready to install). */
export function UpdateBadge() {
  const { state } = useUpdates()
  const view = describeUpdate(state)
  if (view.badge === null) return null
  return (
    <span className="update-badge">
      {view.badge}
    </span>
  )
}
