import { describeUpdateError } from '../../shared/updates'
import type { UpdateState } from '../../shared/updates'

/**
 * What the screens say about the app updates, and which buttons they offer. Free of React so the rules can be tested. Every text that comes from
 * the release (the version, the notes) is untrusted: the screens show it as plain text only.
 */

export type UpdateAction = 'check' | 'download' | 'install'

export interface UpdateView {
  /** One line, always shown. */
  headline: string
  /** More words under it (a reason, a hint), or null. */
  detail: string | null
  /** The one button that moves the update forward, or null. */
  action: { kind: UpdateAction; label: string; disabled: boolean; /** Why it is off, in words (not only in a tooltip). */ disabledReason: string | null } | null
  /** Download progress 0..100 while downloading, else null. */
  progress: number | null
  /** The notes of the new version as plain text, or null. */
  notes: string | null
  /** The text of the small badge in the sidebar footer, or null when there is nothing to tell. */
  badge: string | null
  /** The error tone (red outline) rather than a neutral one. */
  isError: boolean
}

export function describeUpdate(state: UpdateState | null): UpdateView {
  const base: UpdateView = { headline: 'Reading the update status', detail: null, action: null, progress: null, notes: null, badge: null, isError: false }
  if (state === null) return base
  switch (state.status) {
    case 'disabled':
      return { ...base, headline: 'Updates are off here', detail: state.reason, action: { kind: 'check', label: 'Check for updates', disabled: true, disabledReason: state.reason } }
    case 'idle':
      return { ...base, headline: 'Nexus has not checked for updates yet', action: { kind: 'check', label: 'Check for updates', disabled: false, disabledReason: null } }
    case 'checking':
      return { ...base, headline: 'Checking for updates', action: { kind: 'check', label: 'Checking', disabled: true, disabledReason: 'A check is running.' } }
    case 'up-to-date':
      return { ...base, headline: 'Nexus is up to date', action: { kind: 'check', label: 'Check for updates', disabled: false, disabledReason: null } }
    case 'available':
      return {
        ...base,
        headline: `Version ${state.version} is available`,
        detail: 'It is not downloaded until you choose Download. Nothing changes until you restart.',
        action: { kind: 'download', label: 'Download the update', disabled: false, disabledReason: null },
        notes: state.notes === '' ? null : state.notes,
        badge: `Update ${state.version} available`
      }
    case 'downloading':
      return {
        ...base,
        headline: `Downloading version ${state.version}`,
        detail: `${state.percent}% done. You can keep working.`,
        action: { kind: 'download', label: 'Downloading', disabled: true, disabledReason: 'The download is running.' },
        progress: state.percent,
        badge: `Downloading ${state.percent}%`
      }
    case 'ready':
      return {
        ...base,
        headline: `Version ${state.version} is ready to install`,
        detail: state.installBlockedReason ?? 'Nexus restarts to install it. Nothing you have saved is lost.',
        action: { kind: 'install', label: 'Restart and install', disabled: state.installBlockedReason !== null, disabledReason: state.installBlockedReason },
        badge: 'Update ready'
      }
    case 'error':
      return {
        ...base,
        headline: state.during === 'check' ? 'Could not check for updates' : 'Could not download the update',
        detail: state.message || describeUpdateError(state.during),
        action: { kind: 'check', label: 'Try again', disabled: false, disabledReason: null },
        isError: true
      }
  }
}
