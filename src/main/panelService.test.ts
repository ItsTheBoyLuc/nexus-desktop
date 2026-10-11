import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findPanel, panelKey } from '../shared/panels'
import type { PanelResult } from '../shared/types'
import { ApiError } from './apiClient'
import { deleteGameAndForget, deleteTierAndForget, postPanelAndRemember } from './panelService'
import { SettingsStore } from './settings'

const G = '555000000000000001'
const CH = '777000000000000001'
const CH2 = '777000000000000002'
const MSG = '999000000000000001'
const MSG2 = '999000000000000002'

let dir: string
let file: string
let store: SettingsStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexus-panels-'))
  file = join(dir, 'settings.json')
  store = new SettingsStore(file)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const result = (messageId: string, channelId: string, refreshed: boolean): PanelResult => ({
  messageId,
  channelId,
  refreshed,
  tier: { key: 'T1', roleId: '1', signupPanelPosted: true, signupChannelId: channelId, pointsSystem: null, driverCount: 1, roleName: 'R' }
})
const httpError = (code: string, status: number): ApiError => new ApiError({ kind: 'http', code, message: code, status })
const timeoutError = (): ApiError => new ApiError({ kind: 'timeout', code: 'timeout', message: 'slow', mayHaveBeenSent: true })

function fakeApi(over: { postPanel?: () => Promise<PanelResult>; deleteTier?: () => Promise<void>; deleteGame?: () => Promise<void> } = {}) {
  return {
    postPanel: vi.fn(over.postPanel ?? (async () => result(MSG, CH, false))),
    deleteTier: vi.fn(over.deleteTier ?? (async () => undefined)),
    deleteGame: vi.fn(over.deleteGame ?? (async () => undefined))
  }
}

describe('remembering the message id of a posted panel', () => {
  it('stores the id per server, game and tier after a successful post, and it survives a restart', async () => {
    const api = fakeApi()
    await postPanelAndRemember(api, store, G, 'f1_2025', 'T1', { channelId: CH })
    expect(findPanel(store.get().panels, G, 'f1_2025', 'T1')).toEqual({ messageId: MSG, channelId: CH })
    expect(findPanel(store.get().panels, G, 'f1_2025', 'T2')).toBeNull() // other tier
    expect(findPanel(store.get().panels, G, 'acc', 'T1')).toBeNull() // other game
    expect(findPanel(store.get().panels, '555000000000000002', 'f1_2025', 'T1')).toBeNull() // other server
    expect(findPanel(new SettingsStore(file).get().panels, G, 'f1_2025', 'T1')).toEqual({ messageId: MSG, channelId: CH })
  })

  it('posting a new panel replaces the remembered one', async () => {
    await postPanelAndRemember(fakeApi(), store, G, 'f1', 'T1', { channelId: CH })
    await postPanelAndRemember(fakeApi({ postPanel: async () => result(MSG2, CH2, false) }), store, G, 'f1', 'T1', { channelId: CH2 })
    expect(findPanel(store.get().panels, G, 'f1', 'T1')).toEqual({ messageId: MSG2, channelId: CH2 })
  })

  it('a refresh passes the stored message id on and keeps the entry', async () => {
    await postPanelAndRemember(fakeApi(), store, G, 'f1', 'T1', { channelId: CH })
    const api = fakeApi({ postPanel: async () => result(MSG, CH, true) })
    await postPanelAndRemember(api, store, G, 'f1', 'T1', { channelId: CH, messageId: MSG })
    expect(api.postPanel).toHaveBeenCalledWith(G, 'f1', 'T1', { channelId: CH, messageId: MSG })
    expect(findPanel(store.get().panels, G, 'f1', 'T1')).toEqual({ messageId: MSG, channelId: CH })
  })

  it('forgets a panel whose message is gone, is not ours, or whose tier no longer exists', async () => {
    for (const code of ['message_not_found', 'not_a_bot_message', 'tier_not_found']) {
      store.rememberPanel(G, 'f1', 'T1', { messageId: MSG, channelId: CH })
      const api = fakeApi({ postPanel: async () => Promise.reject(httpError(code, 404)) })
      await expect(postPanelAndRemember(api, store, G, 'f1', 'T1', { channelId: CH, messageId: MSG })).rejects.toMatchObject({ code })
      expect(findPanel(store.get().panels, G, 'f1', 'T1'), code).toBeNull()
    }
  })

  it('keeps the panel when the outcome is unknown (timeout) or the error is unrelated', async () => {
    store.rememberPanel(G, 'f1', 'T1', { messageId: MSG, channelId: CH })
    for (const error of [timeoutError(), httpError('bot_cannot_send', 403), httpError('discord_error', 502)]) {
      const api = fakeApi({ postPanel: async () => Promise.reject(error) })
      await expect(postPanelAndRemember(api, store, G, 'f1', 'T1', { channelId: CH, messageId: MSG })).rejects.toBe(error)
      expect(findPanel(store.get().panels, G, 'f1', 'T1')).toEqual({ messageId: MSG, channelId: CH })
    }
  })

  it('a failed NEW post does not touch an existing entry, and remembers nothing', async () => {
    const api = fakeApi({ postPanel: async () => Promise.reject(httpError('channel_not_found', 404)) })
    await expect(postPanelAndRemember(api, store, G, 'f1', 'T1', { channelId: CH })).rejects.toBeInstanceOf(ApiError)
    expect(store.get().panels).toEqual({})
  })
})

describe('deleting tiers and games', () => {
  beforeEach(() => {
    store.rememberPanel(G, 'f1', 'T1', { messageId: MSG, channelId: CH })
    store.rememberPanel(G, 'f1', 'T2', { messageId: MSG2, channelId: CH })
    store.rememberPanel(G, 'acc', 'T1', { messageId: MSG, channelId: CH })
  })

  it('a deleted tier takes only its own panel with it', async () => {
    await deleteTierAndForget(fakeApi(), store, G, 'f1', 'T1')
    expect(Object.keys(store.get().panels).sort()).toEqual([panelKey(G, 'acc', 'T1'), panelKey(G, 'f1', 'T2')].sort())
  })

  it('a deleted game takes every panel of its tiers, and nothing else', async () => {
    await deleteGameAndForget(fakeApi(), store, G, 'f1')
    expect(Object.keys(store.get().panels)).toEqual([panelKey(G, 'acc', 'T1')])
  })

  it('keeps the panels when the delete fails or its outcome is unknown', async () => {
    const before = store.get().panels
    for (const error of [timeoutError(), httpError('forbidden', 403)]) {
      await expect(deleteTierAndForget(fakeApi({ deleteTier: async () => Promise.reject(error) }), store, G, 'f1', 'T1')).rejects.toBe(error)
      await expect(deleteGameAndForget(fakeApi({ deleteGame: async () => Promise.reject(error) }), store, G, 'f1')).rejects.toBe(error)
    }
    expect(store.get().panels).toEqual(before)
  })

  it('a tier or game that is already gone no longer needs its remembered panel', async () => {
    await expect(deleteTierAndForget(fakeApi({ deleteTier: async () => Promise.reject(httpError('tier_not_found', 404)) }), store, G, 'f1', 'T1')).rejects.toMatchObject({ code: 'tier_not_found' })
    expect(findPanel(store.get().panels, G, 'f1', 'T1')).toBeNull()
    await expect(deleteGameAndForget(fakeApi({ deleteGame: async () => Promise.reject(httpError('game_not_found', 404)) }), store, G, 'acc')).rejects.toMatchObject({ code: 'game_not_found' })
    expect(findPanel(store.get().panels, G, 'acc', 'T1')).toBeNull()
  })
})

describe('the settings file holds message ids only, never anything secret', () => {
  it('stores nothing but lastGuildId, lastGame and panels', async () => {
    await postPanelAndRemember(fakeApi(), store, G, 'f1', 'T1', { channelId: CH })
    const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(Object.keys(json).sort()).toEqual(['calendarPosts', 'lastGame', 'lastGuildId', 'ledger', 'panels', 'reduceMotion'])
    expect(json['panels']).toEqual({ [panelKey(G, 'f1', 'T1')]: { messageId: MSG, channelId: CH } })
  })

  it('drops malformed panel entries when the file is read (it is user-editable)', () => {
    writeFileSync(
      file,
      JSON.stringify({
        panels: {
          [panelKey(G, 'f1', 'T1')]: { messageId: MSG, channelId: CH, extra: 'x' },
          'not-a-key': { messageId: MSG, channelId: CH },
          [panelKey(G, 'f1', 'T2')]: { messageId: 'abc', channelId: CH },
          [panelKey(G, 'f1', 'T3')]: 'text',
          [`${G}:f1:../../x`]: { messageId: MSG, channelId: CH }
        }
      })
    )
    expect(new SettingsStore(file).get().panels).toEqual({ [panelKey(G, 'f1', 'T1')]: { messageId: MSG, channelId: CH } })
  })

  it('the renderer-facing patch can neither add nor wipe panels', () => {
    store.rememberPanel(G, 'f1', 'T1', { messageId: MSG, channelId: CH })
    store.set({ lastGuildId: G, panels: {} })
    store.set({ panels: { [panelKey(G, 'f1', 'T9')]: { messageId: MSG, channelId: CH } } })
    expect(Object.keys(store.get().panels)).toEqual([panelKey(G, 'f1', 'T1')])
    expect(store.get().lastGuildId).toBe(G)
  })

  it('ignores malformed input to rememberPanel', () => {
    store.rememberPanel('abc', 'f1', 'T1', { messageId: MSG, channelId: CH })
    store.rememberPanel(G, '../x', 'T1', { messageId: MSG, channelId: CH })
    store.rememberPanel(G, 'f1', 'T1', { messageId: 'x', channelId: CH })
    expect(store.get().panels).toEqual({})
  })

  it('caps the number of remembered panels, keeping the newest', () => {
    for (let n = 0; n < 505; n++) store.rememberPanel(G, 'f1', `T${n}`.slice(0, 20), { messageId: MSG, channelId: CH })
    const keys = Object.keys(store.get().panels)
    expect(keys).toHaveLength(500)
    expect(keys).toContain(panelKey(G, 'f1', 'T504'))
    expect(keys).not.toContain(panelKey(G, 'f1', 'T0'))
  })
})
