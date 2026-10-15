import { describe, expect, it } from 'vitest'
import { INSTALL_BLOCKED_BY_WRITE } from '../../shared/updates'
import type { UpdateState } from '../../shared/updates'
import { describeUpdate } from './updateView'

const V = '0.2.0'
const states: Record<string, UpdateState> = {
  disabled: { status: 'disabled', currentVersion: V, reason: 'Updates are off in development.' },
  idle: { status: 'idle', currentVersion: V },
  checking: { status: 'checking', currentVersion: V },
  upToDate: { status: 'up-to-date', currentVersion: V, checkedAt: '2026-10-15T12:00:00Z' },
  available: { status: 'available', currentVersion: V, version: '0.3.0', notes: 'Edit a team\n<b>not bold</b>' },
  downloading: { status: 'downloading', currentVersion: V, version: '0.3.0', percent: 41 },
  ready: { status: 'ready', currentVersion: V, version: '0.3.0', installBlockedReason: null },
  readyBusy: { status: 'ready', currentVersion: V, version: '0.3.0', installBlockedReason: INSTALL_BLOCKED_BY_WRITE },
  checkError: { status: 'error', currentVersion: V, during: 'check', message: 'Could not check for updates. The app keeps working as it is.' },
  downloadError: { status: 'error', currentVersion: V, during: 'download', message: 'Could not download the update. The app keeps working as it is.' }
}

describe('what the update panel shows', () => {
  it('knows every state: checking, up to date, available, downloading, ready and error, plus idle and off', () => {
    for (const [name, state] of Object.entries(states)) {
      const view = describeUpdate(state)
      expect(view.headline.length, name).toBeGreaterThan(5)
    }
  })

  it('before the main process answers it shows nothing but a neutral line, and no button', () => {
    const view = describeUpdate(null)
    expect(view.action).toBeNull()
    expect(view.badge).toBeNull()
  })

  it('a disabled updater has a Check button that is off, with the reason in words, and no badge', () => {
    const view = describeUpdate(states['disabled']!)
    expect(view.action).toMatchObject({ kind: 'check', disabled: true, disabledReason: 'Updates are off in development.' })
    expect(view.detail).toBe('Updates are off in development.')
    expect(view.badge).toBeNull()
  })

  it('idle and up to date offer a check; while checking the button is off', () => {
    expect(describeUpdate(states['idle']!).action).toMatchObject({ kind: 'check', disabled: false })
    expect(describeUpdate(states['upToDate']!)).toMatchObject({ headline: 'Nexus is up to date', action: { kind: 'check', disabled: false } })
    expect(describeUpdate(states['checking']!).action).toMatchObject({ kind: 'check', disabled: true })
  })

  it('an available update names the version, shows its notes as given (text) and offers Download: nothing is downloaded until then', () => {
    const view = describeUpdate(states['available']!)
    expect(view.headline).toBe('Version 0.3.0 is available')
    expect(view.notes).toBe('Edit a team\n<b>not bold</b>')
    expect(view.action).toMatchObject({ kind: 'download', label: 'Download the update', disabled: false })
    expect(view.detail).toMatch(/not downloaded until you choose Download/)
    expect(view.badge).toBe('Update 0.3.0 available')
  })

  it('downloading shows the percentage as progress and the button is off', () => {
    const view = describeUpdate(states['downloading']!)
    expect(view.progress).toBe(41)
    expect(view.detail).toContain('41%')
    expect(view.action).toMatchObject({ disabled: true })
    expect(view.badge).toBe('Downloading 41%')
  })

  it('ready offers Restart and install', () => {
    const view = describeUpdate(states['ready']!)
    expect(view.action).toEqual({ kind: 'install', label: 'Restart and install', disabled: false, disabledReason: null })
    expect(view.badge).toBe('Update ready')
  })

  it('ready while a write is in progress: Restart and install is off and the reason is written out', () => {
    const view = describeUpdate(states['readyBusy']!)
    expect(view.action).toEqual({ kind: 'install', label: 'Restart and install', disabled: true, disabledReason: INSTALL_BLOCKED_BY_WRITE })
    expect(view.detail).toBe(INSTALL_BLOCKED_BY_WRITE)
  })

  it('an error says what failed in plain words, is marked as an error, and offers Try again; no badge', () => {
    const check = describeUpdate(states['checkError']!)
    expect(check).toMatchObject({ headline: 'Could not check for updates', isError: true, badge: null, action: { kind: 'check', label: 'Try again', disabled: false } })
    expect(check.detail).toMatch(/keeps working/)
    expect(describeUpdate(states['downloadError']!).headline).toBe('Could not download the update')
  })

  it('only an update that needs the user shows a badge', () => {
    const withBadge = Object.entries(states).filter(([, state]) => describeUpdate(state).badge !== null).map(([name]) => name)
    expect(withBadge.sort()).toEqual(['available', 'downloading', 'ready', 'readyBusy'])
  })

  it('has no emoji in any text', () => {
    for (const state of Object.values(states)) {
      const view = describeUpdate(state)
      const text = [view.headline, view.detail, view.action?.label, view.badge].join(' ')
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })
})
