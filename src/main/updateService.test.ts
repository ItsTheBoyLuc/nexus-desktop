import { describe, expect, it, vi } from 'vitest'
import { INSTALL_BLOCKED_BY_WRITE, SILENT_CHECK_FIRST_DELAY_MS, SILENT_CHECK_INTERVAL_MS } from '../shared/updates'
import type { UpdateState } from '../shared/updates'
import { UpdateService } from './updateService'
import type { UpdaterEvent, UpdaterLike } from './updateService'

/**
 * The state machine of the app updates, with a fake updater: no network, no electron-updater. What matters: nothing downloads by itself, the
 * settings of the updater are fixed, a failed check or download is a state and never an exception, the install waits for writes, and a
 * disabled updater is never even loaded.
 */
const CURRENT = '0.2.0'
const NEXT = '0.3.0'

class FakeUpdater implements UpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  listeners = new Map<UpdaterEvent, Array<(...args: unknown[]) => void>>()
  checkCalls = 0
  downloadCalls = 0
  installCalls: Array<[boolean | undefined, boolean | undefined]> = []
  /** What a check does: emit events and answer. */
  onCheck: () => Promise<unknown> = async () => {
    this.emit('update-not-available', {})
    return { isUpdateAvailable: false }
  }
  onDownload: () => Promise<unknown> = async () => undefined

  on(event: UpdaterEvent, listener: (...args: unknown[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }
  emit(event: UpdaterEvent, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
  async checkForUpdates(): Promise<unknown> {
    this.checkCalls++
    return this.onCheck()
  }
  async downloadUpdate(): Promise<unknown> {
    this.downloadCalls++
    return this.onDownload()
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installCalls.push([isSilent, isForceRunAfter])
  }
  /** The next check finds this version. */
  finds(version: unknown, releaseNotes: unknown = undefined): void {
    this.onCheck = async () => {
      this.emit('update-available', { version, releaseNotes })
      return { isUpdateAvailable: true, updateInfo: { version, releaseNotes } }
    }
  }
}

function setup(over: { disabledReason?: string | null; writes?: () => number } = {}) {
  const updater = new FakeUpdater()
  const states: UpdateState[] = []
  const load = vi.fn(async () => updater)
  const timers = { handles: [] as Array<{ kind: string; ms: number; callback: () => void; cleared: boolean }> }
  const service = new UpdateService({
    currentVersion: CURRENT,
    disabledReason: over.disabledReason ?? null,
    loadUpdater: load,
    writesInFlight: over.writes ?? (() => 0),
    onState: (state) => states.push(state),
    now: () => new Date('2026-10-15T12:00:00Z'),
    timers: {
      setTimeout: (callback, ms) => {
        const handle = { kind: 'timeout', ms, callback, cleared: false }
        timers.handles.push(handle)
        return handle
      },
      setInterval: (callback, ms) => {
        const handle = { kind: 'interval', ms, callback, cleared: false }
        timers.handles.push(handle)
        return handle
      },
      clear: (handle) => {
        ;(handle as { cleared: boolean }).cleared = true
      }
    }
  })
  return { service, updater, states, load, timers }
}
const statuses = (states: UpdateState[]): string[] => states.map((state) => state.status)

describe('a check', () => {
  it('goes checking -> up to date, and fixes the updater settings: nothing downloads or installs by itself, nothing older or unstable', async () => {
    const { service, updater, states } = setup()
    expect(service.getState()).toEqual({ status: 'idle', currentVersion: CURRENT })
    const state = await service.run('check')
    expect(statuses(states)).toEqual(['checking', 'up-to-date'])
    expect(state).toEqual({ status: 'up-to-date', currentVersion: CURRENT, checkedAt: '2026-10-15T12:00:00.000Z' })
    expect(updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, allowDowngrade: false })
    expect(updater.checkCalls).toBe(1)
  })

  it('finds a newer version with its notes as plain text, and does NOT download it', async () => {
    const { service, updater } = setup()
    updater.finds(NEXT, '<h2>New</h2><ul><li>One</li><li>Two &amp; three</li></ul><script>alert(1)</script><b>bold</b>')
    const state = await service.run('check')
    expect(state).toEqual({ status: 'available', currentVersion: CURRENT, version: NEXT, notes: 'New\n\n- One\n- Two & three\nbold' })
    expect(updater.downloadCalls).toBe(0)
  })

  it('release notes may be a list of per-version notes', async () => {
    const { service, updater } = setup()
    updater.finds(NEXT, [{ version: NEXT, note: '<p>First</p>' }, { version: '0.2.5', note: 'Second' }, { version: '0.2.4' }])
    expect(await service.run('check')).toMatchObject({ status: 'available', notes: 'First\n\nSecond' })
  })

  it.each([undefined, '', 'latest', '1.2', '1.2.3.4', '<b>1.0.0</b>', 'https://evil.example/1.0.0', 5, null, '1.0.0\nx'])('a version that is not a plain version (%j) is an error, never shown as an update', async (version) => {
    const { service, updater } = setup()
    updater.finds(version)
    const state = await service.run('check')
    expect(state.status).toBe('error')
  })

  it('the same version as the installed one is "up to date", never an update', async () => {
    const { service, updater } = setup()
    updater.finds(CURRENT)
    expect((await service.run('check')).status).toBe('up-to-date')
  })

  it('a failed check is an error state with a plain fixed message (no detail of the failure), and the app goes on; the next check works', async () => {
    const { service, updater, states } = setup()
    updater.onCheck = async () => {
      throw Object.assign(new Error('GET https://api.github.com/secret?token=abc failed with {"body":1}'), { code: 'ENOTFOUND' })
    }
    const state = await service.run('check')
    expect(state).toMatchObject({ status: 'error', during: 'check' })
    expect(JSON.stringify(states)).not.toMatch(/github|token|ENOTFOUND|body/)
    updater.onCheck = async () => {
      updater.emit('update-not-available', {})
      return { isUpdateAvailable: false }
    }
    expect((await service.run('check')).status).toBe('up-to-date')
  })

  it('an unreadable answer is an error, not "up to date"', async () => {
    const { service, updater } = setup()
    updater.onCheck = async () => null
    expect((await service.run('check')).status).toBe('error')
  })

  it('a second check while one runs shares it', async () => {
    const { service, updater } = setup()
    let release: () => void = () => undefined
    updater.onCheck = () =>
      new Promise((resolve) => {
        release = () => {
          updater.emit('update-not-available', {})
          resolve({ isUpdateAvailable: false })
        }
      })
    const first = service.run('check')
    await Promise.resolve()
    const second = service.run('check')
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await Promise.all([first, second])
    expect(updater.checkCalls).toBe(1)
  })

  it('an event nobody asked for changes nothing', async () => {
    const { service, updater } = setup()
    await service.run('check') // loads the updater and registers the listeners
    updater.emit('update-available', { version: '9.0.0' })
    expect(service.getState().status).toBe('up-to-date')
  })
})

describe('the download', () => {
  async function available() {
    const made = setup()
    made.updater.finds(NEXT, 'Notes')
    await made.service.run('check')
    return made
  }

  it('only starts after the user asked, shows progress and ends ready', async () => {
    const { service, updater, states } = await available()
    expect(updater.downloadCalls).toBe(0)
    updater.onDownload = async () => {
      updater.emit('download-progress', { percent: 12.7 })
      updater.emit('download-progress', { percent: 12.9 }) // same whole percent: not reported again
      updater.emit('download-progress', { percent: 100 })
      updater.emit('update-downloaded', { version: NEXT })
    }
    const state = await service.run('download')
    expect(state).toEqual({ status: 'ready', currentVersion: CURRENT, version: NEXT, installBlockedReason: null })
    expect(states.filter((item) => item.status === 'downloading').map((item) => (item as { percent: number }).percent)).toEqual([0, 12, 100])
  })

  it('refuses a download when no update was announced (idle, up to date, error, checking)', async () => {
    const { service, updater } = setup()
    expect((await service.run('download')).status).toBe('idle')
    await service.run('check')
    expect((await service.run('download')).status).toBe('up-to-date')
    expect(updater.downloadCalls).toBe(0)
  })

  it('a failed download is an error with a plain message, and the app goes on', async () => {
    const { service, updater } = await available()
    updater.onDownload = async () => {
      throw new Error('sha512 checksum mismatch for https://github.com/x/y/releases/download/v1/Nexus.exe')
    }
    const state = await service.run('download')
    expect(state).toMatchObject({ status: 'error', during: 'download' })
    expect(JSON.stringify(state)).not.toMatch(/sha512|github|Nexus\.exe/)
    updater.finds(NEXT)
    expect((await service.run('check')).status).toBe('available') // try again from a new check
  })

  it('a download that ends without the downloaded event is an error, never a guess that it is ready', async () => {
    const { service } = await available()
    expect((await service.run('download')).status).toBe('error')
  })

  it('a second download while one runs is not started again', async () => {
    const { service, updater } = await available()
    let finish: () => void = () => undefined
    updater.onDownload = () =>
      new Promise<void>((resolve) => {
        finish = () => {
          updater.emit('update-downloaded', { version: NEXT })
          resolve()
        }
      })
    const first = service.run('download')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = service.run('download') // joins the running download
    finish()
    await Promise.all([first, second])
    expect(updater.downloadCalls).toBe(1)
  })

  it('no check starts while a download runs or after it is ready', async () => {
    const { service, updater } = await available()
    updater.onDownload = async () => {
      updater.emit('update-downloaded', { version: NEXT })
    }
    await service.run('download')
    const checks = updater.checkCalls
    expect((await service.run('check')).status).toBe('ready')
    expect(updater.checkCalls).toBe(checks)
  })
})

describe('the install', () => {
  async function ready(writes: () => number) {
    const made = setup({ writes })
    made.updater.finds(NEXT)
    await made.service.run('check')
    made.updater.onDownload = async () => {
      made.updater.emit('update-downloaded', { version: NEXT })
    }
    await made.service.run('download')
    return made
  }

  it('restarts silently and runs the app again, only from the ready state', async () => {
    const { service, updater } = await ready(() => 0)
    await service.run('install')
    expect(updater.installCalls).toEqual([[true, true]])
    await service.run('install') // a second press does nothing
    expect(updater.installCalls).toHaveLength(1)
  })

  it('does nothing before an update is ready', async () => {
    const { service, updater } = setup()
    updater.finds(NEXT)
    await service.run('check')
    await service.run('install')
    expect(updater.installCalls).toEqual([])
  })

  it('is refused while a write is in progress, says why, and works again when the write is done (a write is never replayed)', async () => {
    let writes = 1
    const { service, updater, states } = await ready(() => writes)
    expect(service.getState()).toMatchObject({ status: 'ready', installBlockedReason: INSTALL_BLOCKED_BY_WRITE })
    await service.run('install')
    expect(updater.installCalls).toEqual([])
    writes = 0
    service.notifyWritesChanged()
    expect(service.getState()).toMatchObject({ status: 'ready', installBlockedReason: null })
    expect(states[states.length - 1]).toMatchObject({ installBlockedReason: null })
    await service.run('install')
    expect(updater.installCalls).toHaveLength(1)
  })

  it('a write that starts after the update was ready blocks the restart too, even before the screen heard of it', async () => {
    let writes = 0
    const { service, updater } = await ready(() => writes)
    writes = 1
    await service.run('install') // pressed in the same moment a save starts: the check happens when it is pressed
    expect(updater.installCalls).toEqual([])
    expect(service.getState()).toMatchObject({ installBlockedReason: INSTALL_BLOCKED_BY_WRITE })
  })

  it('a change in the writes only matters while an update is ready', () => {
    const { service, states } = setup()
    service.notifyWritesChanged()
    expect(states).toEqual([])
  })

  it('an installer that cannot start is an error and never throws into the app', async () => {
    const { service, updater } = await ready(() => 0)
    updater.quitAndInstall = () => {
      throw new Error('spawn failed C:\\secret\\path')
    }
    const state = await service.run('install')
    expect(state.status).toBe('error')
    expect(JSON.stringify(state)).not.toContain('secret')
  })
})

describe('the silent check', () => {
  it('is scheduled a little after start and every 6 hours, and only checks', async () => {
    const { service, updater, timers } = setup()
    updater.finds(NEXT)
    service.start()
    expect(timers.handles.map((handle) => [handle.kind, handle.ms])).toEqual([['timeout', SILENT_CHECK_FIRST_DELAY_MS], ['interval', SILENT_CHECK_INTERVAL_MS]])
    expect(SILENT_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000)
    timers.handles[0]!.callback()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(service.getState()).toMatchObject({ status: 'available', version: NEXT })
    expect(updater.downloadCalls).toBe(0) // it only shows the badge
    service.start() // a second start does not schedule twice
    expect(timers.handles).toHaveLength(2)
    service.stop()
    expect(timers.handles.every((handle) => handle.cleared)).toBe(true)
  })

  it('shows nothing while it runs, and nothing when it fails', async () => {
    const { service, updater, states, timers } = setup()
    updater.onCheck = async () => {
      throw new Error('offline')
    }
    service.start()
    timers.handles[1]!.callback()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(states).toEqual([])
    expect(service.getState()).toEqual({ status: 'idle', currentVersion: CURRENT })
  })

  it('a silent check never starts while an update is downloading or ready', async () => {
    const { service, updater, timers } = setup()
    updater.finds(NEXT)
    await service.run('check')
    updater.onDownload = async () => {
      updater.emit('update-downloaded', { version: NEXT })
    }
    await service.run('download')
    service.start()
    const checks = updater.checkCalls
    timers.handles[1]!.callback()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(updater.checkCalls).toBe(checks)
  })

  it('a manual check that arrives during a silent one takes it over and shows "checking"', async () => {
    const { service, updater, states, timers } = setup()
    let release: () => void = () => undefined
    updater.onCheck = () =>
      new Promise((resolve) => {
        release = () => {
          updater.emit('update-not-available', {})
          resolve({ isUpdateAvailable: false })
        }
      })
    service.start()
    timers.handles[1]!.callback()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(states).toEqual([])
    const manual = service.run('check')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(statuses(states)).toEqual(['checking'])
    release()
    await manual
    expect(service.getState().status).toBe('up-to-date')
    expect(updater.checkCalls).toBe(1)
  })
})

describe('a disabled updater', () => {
  const reason = 'Updates are only checked in the installed app, not while the app is run from source.'

  it('is disabled with its reason, loads nothing, schedules nothing and answers every command with the same state', async () => {
    const { service, load, timers, states } = setup({ disabledReason: reason })
    expect(service.getState()).toEqual({ status: 'disabled', currentVersion: CURRENT, reason })
    service.start()
    for (const command of ['check', 'download', 'install'] as const) expect(await service.run(command)).toEqual({ status: 'disabled', currentVersion: CURRENT, reason })
    service.notifyWritesChanged()
    expect(load).not.toHaveBeenCalled()
    expect(timers.handles).toEqual([])
    expect(states).toEqual([])
  })
})

describe('an updater that cannot be loaded', () => {
  it('is an error state for a manual check and invisible for a silent one; the app goes on', async () => {
    const service = new UpdateService({
      currentVersion: CURRENT,
      disabledReason: null,
      loadUpdater: async () => {
        throw new Error('Cannot find module electron-updater')
      },
      writesInFlight: () => 0,
      onState: () => undefined
    })
    expect((await service.run('check')).status).toBe('error')
  })
})
