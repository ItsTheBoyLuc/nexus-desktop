import { describe, expect, it, vi } from 'vitest'
import { INSTALL_BLOCKED_BY_WRITE } from '../../shared/updates'
import type { UpdateState } from '../../shared/updates'
import { createUpdatesMock } from './updatesMock'

/** The fake update states of dev:mock: the updater itself is always off there; these only let the panel and the badge be reviewed. */
vi.mock('./common', async (original) => ({ ...(await original<typeof import('./common')>()), sleep: async () => undefined }))

describe('the fake updates', () => {
  it('are disabled in the normal scenario and in every scenario that is not an update scenario', async () => {
    for (const scenario of ['normal', 'slow', 'error', 'nomanage', 'lostracing', '']) {
      const mock = createUpdatesMock(scenario)
      expect((await mock.getState()).status, scenario).toBe('disabled')
      expect((await mock.check()).status, scenario).toBe('disabled')
    }
  })

  it('updateavailable: check finds a version, download shows progress and ends ready, install is accepted', async () => {
    const mock = createUpdatesMock('updateavailable')
    const seen: UpdateState[] = []
    mock.onStateChange((state) => seen.push(state))
    expect((await mock.check()).status).toBe('available')
    expect(((await mock.getState()) as { notes: string }).notes).toContain('<b>plain text only</b>')
    const ready = await mock.download()
    expect(ready).toMatchObject({ status: 'ready', installBlockedReason: null })
    expect(seen.map((state) => state.status)).toEqual(['checking', 'available', 'downloading', 'downloading', 'downloading', 'downloading', 'downloading', 'downloading', 'downloading', 'ready'])
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await mock.install()
    expect(info).toHaveBeenCalled()
  })

  it('does not download before an update was found', async () => {
    const mock = createUpdatesMock('updateavailable')
    expect((await mock.download()).status).toBe('idle')
  })

  it('updatebusy: ready, but the restart is off with its reason; install does nothing', async () => {
    const mock = createUpdatesMock('updatebusy')
    await mock.check()
    const ready = await mock.download()
    expect(ready).toMatchObject({ status: 'ready', installBlockedReason: INSTALL_BLOCKED_BY_WRITE })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await mock.install()
    expect(info).not.toHaveBeenCalled()
  })

  it('updatecurrent, updateerror and updatedownloaderror end where their names say', async () => {
    expect((await createUpdatesMock('updatecurrent').check()).status).toBe('up-to-date')
    expect(await createUpdatesMock('updateerror').check()).toMatchObject({ status: 'error', during: 'check' })
    const failing = createUpdatesMock('updatedownloaderror')
    await failing.check()
    expect(await failing.download()).toMatchObject({ status: 'error', during: 'download' })
  })
})
