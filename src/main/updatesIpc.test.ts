import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import type { UpdateCommand, UpdateState } from '../shared/updates'

/**
 * The IPC surface of the app updates: four calls without any argument, sender verification on every one, and nothing the renderer sends can
 * reach the updater (no URL, no feed, no version). The `electron` module is replaced by a fake that records the handlers.
 */
// ipc.ts reaches config.ts, whose build-time constant electron-vite defines.
vi.hoisted(() => {
  ;(globalThis as { __API_BASE_URL__?: string }).__API_BASE_URL__ = 'https://api.test'
})
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, listener) },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { writeText: () => undefined },
  shell: { openExternal: async () => undefined }
}))

const { registerIpc } = await import('./ipc')

const TRUSTED = 'file:///app/out/renderer/index.html'
const state: UpdateState = { status: 'idle', currentVersion: '0.2.0' }
const trustedEvent = { senderFrame: { url: TRUSTED } }

function setup() {
  handlers.clear()
  const run = vi.fn(async (command: UpdateCommand): Promise<UpdateState> => {
    void command
    return state
  })
  const getState = vi.fn(() => state)
  registerIpc({
    auth: {} as never,
    api: {} as never,
    settings: {} as never,
    getApiStatus: () => 'online',
    updates: { getState, run },
    isTrustedUrl: (url) => url.startsWith(TRUSTED)
  })
  return { run, getState }
}

const CALLS: Array<[string, UpdateCommand | null]> = [
  [IPC.updatesGetState, null],
  [IPC.updatesCheck, 'check'],
  [IPC.updatesDownload, 'download'],
  [IPC.updatesInstall, 'install']
]

describe('the update calls', () => {
  beforeEach(() => handlers.clear())

  it('are exactly four, each answers the state, and each runs only its own command', async () => {
    const { run, getState } = setup()
    for (const [channel, command] of CALLS) {
      expect(handlers.has(channel), channel).toBe(true)
      expect(await handlers.get(channel)!(trustedEvent)).toEqual(state)
      if (command) expect(run).toHaveBeenLastCalledWith(command)
    }
    expect(getState).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(3)
    expect([...handlers.keys()].filter((channel) => channel.startsWith('updates:')).sort()).toEqual(CALLS.map(([channel]) => channel).sort())
  })

  it.each(CALLS)('%s refuses a caller that is not our own page, before anything runs', (channel) => {
    const { run, getState } = setup()
    for (const event of [{ senderFrame: { url: 'https://evil.example/' } }, { senderFrame: { url: 'file:///other/index.html' } }, { senderFrame: null }, {}]) {
      expect(() => handlers.get(channel)!(event)).toThrow('Untrusted sender')
    }
    expect(run).not.toHaveBeenCalled()
    expect(getState).not.toHaveBeenCalled()
  })

  it.each(CALLS)('%s refuses any argument: a URL, a feed, a version or a path cannot be passed along', (channel) => {
    const { run } = setup()
    for (const args of [['https://evil.example/latest.yml'], [{ url: 'https://evil.example', version: '9.9.9' }], ['1.0.0'], [null], [undefined], [1, 2]]) {
      expect(() => handlers.get(channel)!(trustedEvent, ...args), JSON.stringify(args)).toThrow('no arguments')
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('the interface carries no way to name a URL, a feed or a version', () => {
    const names = Object.keys(IPC).filter((key) => key.startsWith('updates'))
    expect(names.sort()).toEqual(['updatesCheck', 'updatesDownload', 'updatesGetState', 'updatesInstall', 'updatesStateChanged'])
  })
})
