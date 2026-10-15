import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkPublishConfig, findForbidden, RELEASES_OWNER, RELEASES_REPO } from '../../scripts/buildGuards.mjs'
import { createUpdatesMock } from '../renderer/mock/updatesMock'
import { updaterDisabledReason } from '../shared/updates'
import { ApiClient } from './apiClient'
import { UpdateService } from './updateService'

/**
 * The updater must be off wherever it must be off (development, dev:mock, the portable build), the production build must not carry a way to force it
 * on or a place for a token, and the feed must be exactly the public releases-only repository with draft releases.
 */
const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
  })
}
/** The code of a file without its comments: the rules are about what runs, and the comments explain them by name. */
const code = (path: string): string => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const rel = (path: string): string => relative(SRC, path).replace(/\\/g, '/')

describe('the updater is disabled outside the installed app', () => {
  it('a development run (not packaged) and the dev server both disable it, and nothing of electron-updater is loaded', async () => {
    const load = vi.fn()
    for (const env of [
      { isPackaged: false, isDev: true, platform: 'win32', isPortable: false },
      { isPackaged: false, isDev: false, platform: 'win32', isPortable: false }
    ]) {
      const service = new UpdateService({ currentVersion: '0.2.0', disabledReason: updaterDisabledReason(env), loadUpdater: load, writesInFlight: () => 0, onState: () => undefined })
      service.start()
      for (const command of ['check', 'download', 'install'] as const) expect((await service.run(command)).status).toBe('disabled')
    }
    expect(load).not.toHaveBeenCalled()
  })

  it('dev:mock is disabled: its updates are off by default and there is no updater in it at all', async () => {
    const mock = createUpdatesMock('normal')
    const state = await mock.getState()
    expect(state.status).toBe('disabled')
    for (const call of [mock.check, mock.download, mock.install]) expect((await call()).status).toBe('disabled')
    const text = code(join(ROOT, 'src/renderer/mock/updatesMock.ts'))
    expect(text).not.toMatch(/from 'electron-updater'|require\('electron-updater'\)|import\('electron-updater'\)/)
    // The fake states only exist for the named review scenarios.
    for (const scenario of ['updatecurrent', 'updateavailable', 'updatebusy', 'updateerror', 'updatedownloaderror']) expect((await createUpdatesMock(scenario).getState()).status).toBe('idle')
  })

  it('electron-updater is imported in exactly one file, which only the main process loads and only through a dynamic import behind the enabled check', () => {
    const importers = sourceFiles(SRC).filter((file) => /['"]electron-updater['"]/.test(code(file))).map(rel)
    expect(importers).toEqual(['main/electronUpdater.ts'])
    const index = read('src/main/index.ts')
    expect(index).toContain("import('./electronUpdater')")
    expect(index).not.toMatch(/from '\.\/electronUpdater'/)
    expect(index).toContain('updaterDisabledReason({ isPackaged: app.isPackaged, isDev,')
    // The renderer and the preload never see the library.
    for (const file of sourceFiles(SRC).filter((path) => /^(renderer|preload)\//.test(rel(path)))) expect(code(file), rel(file)).not.toMatch(/electron-updater/)
  })

  it('nothing forces the updater on in development, and nothing sets a feed, a token or a channel from code', () => {
    for (const file of sourceFiles(SRC)) {
      const text = code(file)
      expect(text, rel(file)).not.toMatch(/forceDevUpdateConfig|dev-app-update|setFeedURL|requestHeaders|addAuthHeader|GH_TOKEN|GITHUB_TOKEN/)
    }
  })

  it('the updater is set up with nothing automatic: no auto download, no install on quit, no pre-releases, no downgrades', () => {
    const text = read('src/main/updateService.ts')
    for (const line of ['updater.autoDownload = false', 'updater.autoInstallOnAppQuit = false', 'updater.allowPrerelease = false', 'updater.allowDowngrade = false']) expect(text).toContain(line)
    expect(text).not.toMatch(/autoDownload = true|autoInstallOnAppQuit = true|allowPrerelease = true|allowDowngrade = true/)
    expect(read('src/main/electronUpdater.ts')).toContain('autoUpdater.logger = null')
  })

  it('the library is a runtime dependency and the integrity check is not touched', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> }
    expect(pkg.dependencies?.['electron-updater']).toMatch(/^\d+\.\d+\.\d+$/)
    const all = sourceFiles(SRC).map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(all).not.toMatch(/disableWebInstaller|verifyUpdateCodeSignature|publisherName|sha512\s*=|skipSignature/)
  })
})

describe('the production build guard', () => {
  it('accepts the real electron-builder.yml', () => {
    expect(checkPublishConfig(read('electron-builder.yml'))).toEqual([])
    expect(RELEASES_OWNER).toBe('ItsTheBoyLuc')
    expect(RELEASES_REPO).toBe('nexus-desktop-releases')
  })

  const GOOD = 'publish:\n  provider: github\n  owner: ItsTheBoyLuc\n  repo: nexus-desktop-releases\n  private: false\n  releaseType: draft\n'

  it.each([
    ['no publish block', 'appId: x\n'],
    ['another provider', GOOD.replace('github', 's3')],
    ['another owner', GOOD.replace('ItsTheBoyLuc', 'someone')],
    ['the source repository', GOOD.replace('nexus-desktop-releases', 'nexus-desktop')],
    ['releases published at once', GOOD.replace('draft', 'release')],
    ['a prerelease type', GOOD.replace('draft', 'prerelease')],
    ['a private feed', GOOD.replace('private: false', 'private: true')],
    ['a token in the file', `${GOOD}  token: abc\n`],
    ['a secret in the file', `${GOOD}  secretKey: abc\n`]
  ])('refuses %s', (_name, text) => {
    expect(checkPublishConfig(text).length).toBeGreaterThan(0)
  })

  it('refuses a build that contains the dev switch, the dev feed file or a token name', () => {
    expect(findForbidden([['out/main/index.js', 'autoUpdater.forceDevUpdateConfig = true']])).toHaveLength(1)
    expect(findForbidden([['out/main/index.js', 'x dev-app-update.yml x']])).toHaveLength(1)
    expect(findForbidden([['out/main/index.js', 'process.env.GH_TOKEN']])).toHaveLength(1)
    expect(findForbidden([['out/main/index.js', 'import("electron-updater")'], ['out/renderer/index.js', 'nothing']])).toEqual([])
  })

  it('is wired into the build: the config is checked before bundling and the bundle after', () => {
    const script = read('scripts/check-no-mock.mjs')
    expect(script).toContain("checkPublishConfig(readFileSync(join(root, 'electron-builder.yml')")
    expect(script).toContain('findForbidden(')
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['build']).toMatch(/check-no-mock\.mjs pre && electron-vite build && node scripts\/check-no-mock\.mjs post/)
  })
})

describe('the writes in flight (what a restart for an update waits for)', () => {
  const answer = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  async function client(fetchImpl: typeof fetch, counts: number[]) {
    const api = new ApiClient({ baseUrl: 'https://api.test', fetchImpl, timeoutMs: 50, wakeAfterMs: 1000, sleep: async () => undefined, onWritesChange: (count) => counts.push(count) })
    api.setSession({ access_token: 'access', refresh_token: 'refresh' })
    return api
  }

  it('counts POST, PUT, PATCH and DELETE while they run, and not GET', async () => {
    const counts: number[] = []
    let release: () => void = () => undefined
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') return answer(200, {})
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return answer(200, {})
    }) as typeof fetch
    const api = await client(fetchImpl, counts)
    await api.request({ path: '/x' })
    expect(api.writesInFlight()).toBe(0)
    expect(counts).toEqual([])
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const pending = api.request({ method, path: '/x', body: {} })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(api.writesInFlight(), method).toBe(1)
      release()
      await pending
      expect(api.writesInFlight(), method).toBe(0)
    }
    expect(counts).toEqual([1, 0, 1, 0, 1, 0, 1, 0])
  })

  it('goes back to 0 when a write fails or times out, so a restart is never blocked for ever', async () => {
    const counts: number[] = []
    const api = await client((async () => answer(403, { error: 'manage_server_required', message: 'x' })) as typeof fetch, counts)
    await expect(api.request({ method: 'POST', path: '/x', body: {} })).rejects.toMatchObject({ code: 'manage_server_required' })
    expect(api.writesInFlight()).toBe(0)
    const hanging = await client(((_url: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch, counts)
    await expect(hanging.request({ method: 'DELETE', path: '/x' })).rejects.toMatchObject({ kind: 'timeout' })
    expect(hanging.writesInFlight()).toBe(0)
    expect(counts[counts.length - 1]).toBe(0)
  })

  it('two writes at once count as 2', async () => {
    const counts: number[] = []
    const releases: Array<() => void> = []
    const api = await client((async () => {
      await new Promise<void>((resolve) => releases.push(resolve))
      return answer(200, {})
    }) as typeof fetch, counts)
    const a = api.request({ method: 'POST', path: '/a', body: {} })
    const b = api.request({ method: 'POST', path: '/b', body: {} })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(api.writesInFlight()).toBe(2)
    releases.forEach((release) => release())
    await Promise.all([a, b])
    expect(api.writesInFlight()).toBe(0)
  })

  it('the main process wires the count into the updater', () => {
    const index = read('src/main/index.ts')
    expect(index).toContain('writesInFlight: () => client.writesInFlight()')
    expect(index).toContain('onWritesChange: () => updates.notifyWritesChanged()')
  })
})
