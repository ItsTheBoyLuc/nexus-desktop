import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sanitizeSettings, SettingsStore } from './settings'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexus-settings-'))
  file = join(dir, 'settings.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('settings store', () => {
  it('starts empty and remembers the last server and game across restarts', () => {
    const store = new SettingsStore(file)
    expect(store.get()).toEqual({ lastGuildId: null, lastGame: null, panels: {}, calendarPosts: {}, ledger: [], reduceMotion: false })
    store.set({ lastGuildId: '555000000000000001', lastGame: 'f1' })
    expect(new SettingsStore(file).get()).toEqual({ lastGuildId: '555000000000000001', lastGame: 'f1', panels: {}, calendarPosts: {}, ledger: [], reduceMotion: false })
  })

  it('drops invalid values instead of storing them', () => {
    expect(sanitizeSettings({ lastGuildId: '../../etc', lastGame: 'solitaire' })).toEqual({ lastGuildId: null, lastGame: null })
    expect(sanitizeSettings({ lastGuildId: 42, lastGame: {} })).toEqual({ lastGuildId: null, lastGame: null })
    expect(sanitizeSettings({ unknownKey: 'x', lastGame: 'acc' })).toEqual({ lastGame: 'acc' })
    expect(sanitizeSettings(null)).toEqual({})
    expect(sanitizeSettings('text')).toEqual({})
  })

  it('remembers the Reduce animations switch, as a real boolean only', () => {
    const store = new SettingsStore(file)
    expect(store.get().reduceMotion).toBe(false)
    store.set({ reduceMotion: true })
    expect(new SettingsStore(file).get().reduceMotion).toBe(true)
    store.set({ reduceMotion: 'yes' })
    expect(store.get().reduceMotion).toBe(false)
    expect(sanitizeSettings({ reduceMotion: 1 })).toEqual({ reduceMotion: false })
    expect(sanitizeSettings({ reduceMotion: true })).toEqual({ reduceMotion: true })
  })

  it('a patch that only changes the server leaves the Reduce animations switch alone', () => {
    const store = new SettingsStore(file)
    store.set({ reduceMotion: true })
    store.set({ lastGuildId: '555000000000000001' })
    expect(store.get().reduceMotion).toBe(true)
  })

  it('reads the switch from a hand-edited file only when it is exactly true', () => {
    writeFileSync(file, JSON.stringify({ reduceMotion: 'true' }))
    expect(new SettingsStore(file).get().reduceMotion).toBe(false)
    writeFileSync(file, JSON.stringify({ reduceMotion: true }))
    expect(new SettingsStore(file).get().reduceMotion).toBe(true)
  })

  it('survives a corrupt settings file', () => {
    writeFileSync(file, '{ not json')
    expect(new SettingsStore(file).get()).toEqual({ lastGuildId: null, lastGame: null, panels: {}, calendarPosts: {}, ledger: [], reduceMotion: false })
  })

  it('never writes anything but the known settings (no tokens can end up in this file)', () => {
    const store = new SettingsStore(file)
    store.set({ lastGuildId: '1', lastGame: 'gt7', accessToken: 'secret', refresh_token: 'secret' })
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort()).toEqual(['calendarPosts', 'lastGame', 'lastGuildId', 'ledger', 'panels', 'reduceMotion'])
  })
})
