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
    expect(store.get()).toEqual({ lastGuildId: null, lastGame: null, panels: {}, calendarPosts: {}, ledger: [], reduceMotion: false, postChannels: {} })
    store.set({ lastGuildId: '555000000000000001', lastGame: 'f1' })
    expect(new SettingsStore(file).get()).toEqual({ lastGuildId: '555000000000000001', lastGame: 'f1', panels: {}, calendarPosts: {}, ledger: [], reduceMotion: false, postChannels: {} })
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
    expect(new SettingsStore(file).get()).toEqual({ lastGuildId: null, lastGame: null, panels: {}, calendarPosts: {}, ledger: [], reduceMotion: false, postChannels: {} })
  })

  it('never writes anything but the known settings (no tokens can end up in this file)', () => {
    const store = new SettingsStore(file)
    store.set({ lastGuildId: '1', lastGame: 'gt7', accessToken: 'secret', refresh_token: 'secret' })
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort()).toEqual(['calendarPosts', 'lastGame', 'lastGuildId', 'ledger', 'panels', 'postChannels', 'reduceMotion'])
  })
})

describe('the remembered post channel (milestone 6)', () => {
  const G = '555000000000000001'
  const CH = '777000000000000001'
  const ROLE = '820000000000000001'

  it('remembers a channel id per server and game across restarts, and nothing else', () => {
    const store = new SettingsStore(file)
    store.rememberPostChannel(G, 'iracing', CH)
    store.rememberPostChannel(G, 'gt7', '777000000000000002')
    expect(new SettingsStore(file).get().postChannels).toEqual({ [`${G}:iracing`]: CH, [`${G}:gt7`]: '777000000000000002' })
    // The file holds those two ids and not a single other value from the posts.
    const written = JSON.parse(readFileSync(file, 'utf8')) as { postChannels: Record<string, unknown> }
    expect(Object.values(written.postChannels).every((value) => typeof value === 'string' && /^\d+$/.test(value))).toBe(true)
  })

  it('the last choice for a server and game wins; another game or server is untouched', () => {
    const store = new SettingsStore(file)
    store.rememberPostChannel(G, 'lmu', CH)
    store.rememberPostChannel(G, 'f1', CH)
    store.rememberPostChannel(G, 'lmu', '777000000000000002')
    expect(store.get().postChannels).toEqual({ [`${G}:f1`]: CH, [`${G}:lmu`]: '777000000000000002' })
  })

  it('refuses anything that is not a server id, a real game and a channel id', () => {
    const store = new SettingsStore(file)
    store.rememberPostChannel('../x', 'lmu', CH)
    store.rememberPostChannel(G, 'solitaire', CH)
    store.rememberPostChannel(G, 'lmu', 'general')
    store.rememberPostChannel(G, 'lmu', `${CH} Tuesday Practice`)
    store.rememberPostChannel(G, 'lmu', ROLE.concat('@everyone'))
    expect(store.get().postChannels).toEqual({})
  })

  it('the renderer\'s generic settings patch cannot write it: no role ids, names or text can be slipped in that way', () => {
    expect(sanitizeSettings({ postChannels: { [`${G}:lmu`]: CH } })).toEqual({})
    const store = new SettingsStore(file)
    store.set({ postChannels: { [`${G}:lmu`]: CH }, pingRoleIds: [ROLE], message: 'Tuesday Practice' })
    expect(store.get().postChannels).toEqual({})
    expect(readFileSync(file, 'utf8')).not.toContain(ROLE)
    expect(readFileSync(file, 'utf8')).not.toContain('Tuesday Practice')
  })

  it('a hand-edited file is read field by field: only guild:game -> channel id entries survive', () => {
    writeFileSync(file, JSON.stringify({ postChannels: { [`${G}:lmu`]: CH, [`${G}:acc`]: { channelId: CH, roles: [ROLE] }, [`${G}:nope`]: CH, bad: CH } }))
    const store = new SettingsStore(file)
    expect(store.get().postChannels).toEqual({ [`${G}:lmu`]: CH })
    store.set({ lastGame: 'f1' })
    expect(readFileSync(file, 'utf8')).not.toContain(ROLE)
  })

  it('a changed switch or server leaves the remembered channels alone', () => {
    const store = new SettingsStore(file)
    store.rememberPostChannel(G, 'acc', CH)
    store.set({ reduceMotion: true, lastGuildId: G })
    expect(store.get().postChannels).toEqual({ [`${G}:acc`]: CH })
  })
})
