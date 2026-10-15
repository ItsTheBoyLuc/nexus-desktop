/**
 * FAKE app updates for `npm run dev:mock` (auto-update milestone). Part of the mock bridge: it must never end up in an Electron build (it is only
 * reachable through installMock.ts). There is NO updater here at all: electron-updater is not imported, nothing is checked, nothing is downloaded. In
 * the normal scenario the updates are DISABLED, exactly as they are in development and in the portable build. The scenarios below only play fake states
 * so the Preferences panel and the sidebar badge can be reviewed.
 *
 * Scenarios (query string):
 *   (normal)             disabled: "Updates are only checked in the installed app ..." (no Check button works, no badge)
 *   updatecurrent        a check answers "up to date"
 *   updateavailable      a check finds version 9.9.9 (its notes contain HTML-looking text: it must show as plain text); Download shows progress and ends ready;
 *                        Restart and install only pretends (a browser cannot restart)
 *   updatebusy           like updateavailable, but a write is "in progress": Restart and install is off with its reason
 *   updateerror          every check fails with the plain message
 *   updatedownloaderror  a check finds 9.9.9, the download fails with the plain message
 */
import type { NexusBridge, Unsubscribe } from '../../shared/bridge'
import { describeUpdateError, INSTALL_BLOCKED_BY_WRITE } from '../../shared/updates'
import type { UpdateState } from '../../shared/updates'
import { sleep } from './common'

const CURRENT = '0.2.0'
const NEXT = '9.9.9'

type UpdatesMockApi = NexusBridge['updates']

export function createUpdatesMock(scenario: string): UpdatesMockApi {
  const enabled = ['updatecurrent', 'updateavailable', 'updatebusy', 'updateerror', 'updatedownloaderror'].includes(scenario)
  let state: UpdateState = enabled ? { status: 'idle', currentVersion: CURRENT } : { status: 'disabled', currentVersion: CURRENT, reason: 'Updates are only checked in the installed app, not while the app is run from source.' }
  const listeners = new Set<(next: UpdateState) => void>()
  const set = (next: UpdateState): UpdateState => {
    state = next
    listeners.forEach((listener) => listener(next))
    return next
  }
  let busy = false

  return {
    getState: async () => state,

    check: async () => {
      if (!enabled || ['checking', 'downloading', 'ready'].includes(state.status)) return state
      set({ status: 'checking', currentVersion: CURRENT })
      await sleep(900)
      if (scenario === 'updateerror') return set({ status: 'error', currentVersion: CURRENT, during: 'check', message: describeUpdateError('check'), reason: 'No published release' })
      if (scenario === 'updatecurrent') return set({ status: 'up-to-date', currentVersion: CURRENT, checkedAt: new Date().toISOString() })
      return set({ status: 'available', currentVersion: CURRENT, version: NEXT, notes: 'What is new\n- Edit a team\n- Delete posts made with the app\n<b>plain text only</b> <script>alert(1)</script> & more' })
    },

    download: async () => {
      if (!enabled || state.status !== 'available' || busy) return state
      busy = true
      set({ status: 'downloading', currentVersion: CURRENT, version: NEXT, percent: 0 })
      for (const percent of [8, 23, 41, 66, 87, 100]) {
        await sleep(450)
        if (scenario === 'updatedownloaderror' && percent > 40) {
          busy = false
          return set({ status: 'error', currentVersion: CURRENT, during: 'download', message: describeUpdateError('download'), reason: 'No network' })
        }
        set({ status: 'downloading', currentVersion: CURRENT, version: NEXT, percent })
      }
      busy = false
      return set({ status: 'ready', currentVersion: CURRENT, version: NEXT, installBlockedReason: scenario === 'updatebusy' ? INSTALL_BLOCKED_BY_WRITE : null })
    },

    install: async () => {
      // A browser cannot restart: the mock only shows that the call was accepted.
      if (state.status === 'ready' && state.installBlockedReason === null) console.info('[mock] Restart and install pressed (nothing restarts in the mock).')
      return state
    },

    onStateChange: (callback): Unsubscribe => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    }
  }
}
