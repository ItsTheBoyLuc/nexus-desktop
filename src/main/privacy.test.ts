import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/types'
import { SettingsStore } from './settings'

/**
 * Sign-up participants carry personal data (first name, nationality, age ...). The rule of milestone 4: they live in
 * memory only. Never written to disk, to the settings file, to a log or to browser storage; cleared when the screen is left.
 *
 * These tests guard that rule structurally, so a later change cannot quietly break it:
 *  - only two files in the whole app may write to disk at all (the settings file and the encrypted token store),
 *  - the settings file cannot be made to hold anything but what it is meant to hold,
 *  - the renderer never touches browser storage, and nothing that handles participants logs.
 */
const SRC = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
  })
}
const rel = (path: string): string => relative(SRC, path).replace(/\\/g, '/')
const read = (path: string): string => readFileSync(path, 'utf8')

describe('participant data is never written to disk or browser storage', () => {
  const files = sourceFiles(SRC)

  it('only the settings store and the token store write files', () => {
    const writers = files.filter((file) => /writeFileSync|appendFileSync|writeFile\(|createWriteStream|renameSync|copyFileSync|mkdirSync/.test(read(file))).map(rel)
    expect(writers.sort()).toEqual(['main/settings.ts', 'main/tokenStore.ts'])
  })

  it('the renderer never uses localStorage, sessionStorage, IndexedDB or cookies', () => {
    const offenders = files.filter((file) => rel(file).startsWith('renderer/') && /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./.test(read(file))).map(rel)
    expect(offenders).toEqual([])
  })

  it('the code that fetches or shows participants never logs and never touches the file system', () => {
    const handlers = ['main/attendanceApi.ts', 'renderer/screens/Signups.tsx', 'renderer/screens/SignupParticipants.tsx', 'renderer/hooks/paged.ts']
    for (const name of handlers) {
      const text = read(join(SRC, name))
      expect(text, name).not.toMatch(/\blog\.(info|warn|error)\b|console\.|from 'node:fs'|from "fs"|writeFile/)
    }
  })

  it('the main-process IPC handlers of the sign-up participants do not log', () => {
    const ipc = read(join(SRC, 'main/ipc.ts'))
    const lines = ipc.split('\n').filter((line) => /Signup|Participant/.test(line))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).not.toMatch(/log\./)
  })

  it('the app exports nothing: no save dialog, no CSV or JSON download of participants', () => {
    const offenders = files.filter((file) => /showSaveDialog|dialog\.show|createObjectURL|download=|\.csv/.test(read(file))).map(rel)
    expect(offenders).toEqual([])
  })
})

describe('the settings file cannot be made to hold participant data', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-privacy-'))
    file = join(dir, 'settings.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const SECRET = 'Fake Person Testland 99'

  it('a patch from the renderer with participants, answers or sign-ups is dropped; only the last server and game survive', () => {
    const store = new SettingsStore(file)
    store.set({
      lastGuildId: '555000000000000001',
      participants: [{ username: SECRET, answers: [{ question: 'Age', answer: SECRET }] }],
      signups: { '810000000000000001': { participants: { 1: { username: SECRET } } } },
      answers: SECRET,
      panels: { x: { messageId: SECRET } }
    })
    const written = readFileSync(file, 'utf8')
    expect(written).not.toContain(SECRET)
    expect(JSON.parse(written)).toEqual({ ...DEFAULT_SETTINGS, lastGuildId: '555000000000000001' })
  })

  it('a hand-edited settings file with participant data is read field by field and never written back', () => {
    writeFileSync(file, JSON.stringify({ lastGuildId: '555000000000000001', participants: [SECRET], signups: { a: SECRET }, ledger: 'nope' }))
    const store = new SettingsStore(file)
    store.set({ lastGame: 'f1' }) // any save rewrites the file from what the store knows
    const written = readFileSync(file, 'utf8')
    expect(written).not.toContain(SECRET)
    expect(Object.keys(JSON.parse(written) as object).sort()).toEqual(['calendarPosts', 'lastGame', 'lastGuildId', 'ledger', 'panels'])
  })
})
