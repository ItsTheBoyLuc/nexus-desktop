import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = join(process.cwd(), 'scripts', 'check-no-mock.mjs')

function run(phase: string, env: Record<string, string> = {}, cwd?: string) {
  const base = { ...process.env }
  delete base['NEXUS_MOCK']
  delete base['VITE_USE_MOCK']
  return spawnSync(process.execPath, [script, phase], { env: { ...base, ...env }, cwd, encoding: 'utf8' })
}

describe('build guard against the mock bridge', () => {
  it('passes when no mock flag is set', () => {
    expect(run('pre').status).toBe(0)
  })

  it.each([
    ['NEXUS_MOCK', '1'],
    ['NEXUS_MOCK', 'true'],
    ['VITE_USE_MOCK', 'true'],
    ['VITE_USE_MOCK', '1']
  ])('fails the build when %s=%s', (name, value) => {
    const result = run('pre', { [name]: value })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Build refused')
  })

  it('treats 0 / false as off', () => {
    expect(run('pre', { VITE_USE_MOCK: 'false' }).status).toBe(0)
    expect(run('pre', { NEXUS_MOCK: '0' }).status).toBe(0)
  })

  it('fails when the bundle contains the mock marker, passes when it does not', () => {
    // The script resolves out/ relative to its own location, so run a copy of it inside a
    // throwaway tree instead of touching the real out/.
    const root = mkdtempSync(join(tmpdir(), 'nexus-guard-'))
    try {
      mkdirSync(join(root, 'scripts'), { recursive: true })
      mkdirSync(join(root, 'out', 'renderer', 'assets'), { recursive: true })
      writeFileSync(join(root, 'scripts', 'check-no-mock.mjs'), readFileSync(script, 'utf8'))
      writeFileSync(join(root, 'scripts', 'buildGuards.mjs'), readFileSync(join(process.cwd(), 'scripts', 'buildGuards.mjs'), 'utf8'))
      writeFileSync(join(root, 'out', 'renderer', 'assets', 'index.js'), 'console.log("clean bundle")')
      const clean = spawnSync(process.execPath, [join(root, 'scripts', 'check-no-mock.mjs'), 'post'], { encoding: 'utf8' })
      expect(clean.status).toBe(0)

      writeFileSync(join(root, 'out', 'renderer', 'assets', 'index.js'), 'console.info("[NEXUS_MOCK_BRIDGE_ACTIVE] hi")')
      const dirty = spawnSync(process.execPath, [join(root, 'scripts', 'check-no-mock.mjs'), 'post'], { encoding: 'utf8' })
      expect(dirty.status).toBe(1)
      expect(dirty.stderr).toContain('mock bridge code found')

      // The updater guard: a build that can force the updater on in development, or that names a token, is refused too.
      for (const needle of ['autoUpdater.forceDevUpdateConfig = true', 'process.env.GH_TOKEN', 'dev-app-update.yml']) {
        writeFileSync(join(root, 'out', 'renderer', 'assets', 'index.js'), `console.log(${JSON.stringify(needle)})`)
        const forbidden = spawnSync(process.execPath, [join(root, 'scripts', 'check-no-mock.mjs'), 'post'], { encoding: 'utf8' })
        expect(forbidden.status, needle).toBe(1)
        expect(forbidden.stderr, needle).toContain('updater must never ship')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
