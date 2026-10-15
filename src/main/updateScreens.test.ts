import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structural guards for the update UI: it only shows what the main process reports, as plain text, never downloads by itself and cannot pass
 * anything but "check", "download" or "install".
 */
const SRC = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')

describe('the update panel and badge', () => {
  const panel = read('renderer/components/UpdatePanel.tsx')

  it('show the version and the notes as plain text: no HTML is ever built from a release', () => {
    expect(panel).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
    expect(panel).toContain('className="update__version"')
    expect(panel).toMatch(/<textarea className="update__notes plain-text" readOnly/)
    expect(panel).toMatch(/<span className="plain-text">\{state\.currentVersion\}/)
  })

  it('offer one button that asks for check, download or install, and nothing else; the restart button is off with its reason written out', () => {
    expect(panel.match(/void run\(/g) ?? []).toHaveLength(1)
    expect(panel).toContain('disabled={view.action.disabled}')
    expect(panel).toContain("state?.status === 'ready' && view.action?.disabled && view.action.disabledReason")
    expect(panel).toContain('aria-describedby')
  })

  it('the hook asks the main process for exactly check, download and install, with no argument, and keeps no state on disk', () => {
    const hook = read('renderer/hooks/updates.tsx')
    expect(hook).toContain('window.nexus.updates[action]()')
    expect(hook).not.toMatch(/localStorage|sessionStorage|indexedDB|writeFile|settings\./)
    expect(read('renderer/lib/updateView.ts')).toContain("export type UpdateAction = 'check' | 'download' | 'install'")
  })

  it('nothing downloads by itself: the only caller of download is the button, and the start-up and the badge never call it', () => {
    for (const file of ['renderer/components/UpdatePanel.tsx', 'renderer/hooks/updates.tsx', 'renderer/layout/PreferencesMenu.tsx', 'renderer/App.tsx']) {
      expect(read(file).match(/\.download\(|run\('download'\)/g) ?? [], file).toEqual([])
    }
    expect(read('renderer/hooks/updates.tsx')).not.toMatch(/\.check\(|run\('check'\)/) // the silent check is the main process's job
  })

  it('the badge sits on the Preferences button in the sidebar footer, and the panel is in its popover; the provider wraps the app', () => {
    const prefs = read('renderer/layout/PreferencesMenu.tsx')
    expect(prefs).toContain('<UpdateBadge />')
    expect(prefs).toContain('<UpdatePanel />')
    expect(read('renderer/layout/Sidebar.tsx')).toContain('<PreferencesMenu />')
    expect(read('renderer/App.tsx')).toContain('<UpdatesProvider>')
  })

  it('the bridge has the updates calls and nothing in them takes an argument', () => {
    const bridge = read('shared/bridge.ts')
    expect(bridge).toMatch(/getState: \(\) => Promise<UpdateState>/)
    for (const call of ['check', 'download', 'install']) expect(bridge).toContain(`${call}: () => Promise<UpdateState>`)
    const preload = read('preload/index.ts')
    for (const line of preload.split('\n').filter((entry) => /IPC\.updates(Check|Download|Install|GetState)/.test(entry))) expect(line).toMatch(/\(\) => ipcRenderer\.invoke\(IPC\.updates\w+\)/)
  })
})
