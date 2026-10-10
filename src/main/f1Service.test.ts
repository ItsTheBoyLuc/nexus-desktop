import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findLedgerEntries } from '../shared/f1Store'
import type { CalendarPostResult, RaceOutcome, ResultsInput } from '../shared/types'
import { ApiError } from './apiClient'
import { postCalendarAndRemember, recordResultsAndLog } from './f1Service'
import { SettingsStore } from './settings'

const G = '555000000000000001'
const G2 = '555000000000000002'
const CH = '777000000000000001'
const CH2 = '777000000000000002'
const MSG = '999000000000000001'
const MSG2 = '999000000000000002'

let dir: string
let file: string
let store: SettingsStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexus-f1-'))
  file = join(dir, 'settings.json')
  store = new SettingsStore(file)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const httpError = (code: string, status: number): ApiError => new ApiError({ kind: 'http', code, message: code, status })
const timeoutError = (): ApiError => new ApiError({ kind: 'timeout', code: 'timeout', message: 'slow', mayHaveBeenSent: true })
const networkError = (): ApiError => new ApiError({ kind: 'network', code: 'network_error', message: 'reset', mayHaveBeenSent: true })

describe('remembering the message id of the posted calendar (per server)', () => {
  const posted = (messageId: string, channelId: string, refreshed: boolean): CalendarPostResult => ({ messageId, channelId, refreshed })
  const api = (answer: () => Promise<CalendarPostResult>) => ({ postCalendar: vi.fn(answer) })

  it('stores the id after the API confirmed the post, per server, and it survives a restart', async () => {
    await postCalendarAndRemember(api(async () => posted(MSG, CH, false)), store, G, { channelId: CH })
    expect(store.get().calendarPosts).toEqual({ [G]: { messageId: MSG, channelId: CH } })
    expect(store.get().calendarPosts[G2]).toBeUndefined() // another server has none
    expect(new SettingsStore(file).get().calendarPosts[G]).toEqual({ messageId: MSG, channelId: CH })
  })

  it('posting a new calendar replaces the remembered one', async () => {
    await postCalendarAndRemember(api(async () => posted(MSG, CH, false)), store, G, { channelId: CH })
    await postCalendarAndRemember(api(async () => posted(MSG2, CH2, false)), store, G, { channelId: CH2 })
    expect(store.get().calendarPosts[G]).toEqual({ messageId: MSG2, channelId: CH2 })
  })

  it('an update passes the stored id on and keeps the entry', async () => {
    await postCalendarAndRemember(api(async () => posted(MSG, CH, false)), store, G, { channelId: CH })
    const update = api(async () => posted(MSG, CH, true))
    await postCalendarAndRemember(update, store, G, { channelId: CH, messageId: MSG })
    expect(update.postCalendar).toHaveBeenCalledWith(G, { channelId: CH, messageId: MSG })
    expect(store.get().calendarPosts[G]).toEqual({ messageId: MSG, channelId: CH })
  })

  it('forgets the id when the API says the message no longer exists, so "Update" is no longer offered', async () => {
    for (const code of ['message_not_found', 'not_a_bot_message']) {
      store.rememberCalendarPost(G, { messageId: MSG, channelId: CH })
      const failing = api(async () => Promise.reject(httpError(code, 404)))
      await expect(postCalendarAndRemember(failing, store, G, { channelId: CH, messageId: MSG })).rejects.toMatchObject({ code })
      expect(store.get().calendarPosts[G], code).toBeUndefined()
    }
  })

  it('writes nothing when posting fails or the answer is lost (nothing was confirmed)', async () => {
    store.rememberCalendarPost(G, { messageId: MSG, channelId: CH })
    for (const error of [timeoutError(), networkError(), httpError('bot_cannot_send', 403), httpError('discord_error', 502), httpError('calendar_not_found', 404)]) {
      await expect(postCalendarAndRemember(api(async () => Promise.reject(error)), store, G, { channelId: CH, messageId: MSG })).rejects.toBe(error)
      expect(store.get().calendarPosts[G], error.code).toEqual({ messageId: MSG, channelId: CH })
    }
    // A failed NEW post does not invent an entry either.
    const fresh = new SettingsStore(join(dir, 'other.json'))
    await expect(postCalendarAndRemember(api(async () => Promise.reject(timeoutError())), fresh, G, { channelId: CH })).rejects.toBeInstanceOf(ApiError)
    expect(fresh.get().calendarPosts).toEqual({})
  })

  it('a missing message is only forgotten for an update: a failed new post never touches a stored id', async () => {
    store.rememberCalendarPost(G, { messageId: MSG, channelId: CH })
    await expect(postCalendarAndRemember(api(async () => Promise.reject(httpError('message_not_found', 404))), store, G, { channelId: CH })).rejects.toBeInstanceOf(ApiError)
    expect(store.get().calendarPosts[G]).toEqual({ messageId: MSG, channelId: CH })
  })

  it('ignores a malformed answer id instead of storing it', () => {
    store.rememberCalendarPost('not-a-server', { messageId: MSG, channelId: CH })
    store.rememberCalendarPost(G, { messageId: 'abc', channelId: CH })
    expect(store.get().calendarPosts).toEqual({})
  })

  it('the file only ever holds ids (nothing secret)', async () => {
    await postCalendarAndRemember(api(async () => posted(MSG, CH, false)), store, G, { channelId: CH })
    const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(json['calendarPosts']).toEqual({ [G]: { messageId: MSG, channelId: CH } })
    expect(JSON.stringify(json)).not.toMatch(/token|secret|password/i)
  })
})

describe('the results ledger', () => {
  const input: ResultsInput = { season: '5', round: '3', circuit: 'Zandvoort', results: ['200000000000000001'] }
  const outcome: RaceOutcome = { raceTitle: 'Season 5 Round 3 — Zandvoort', results: [], notFound: [], standings: { drivers: [], constructors: [] } }
  const api = (answer: () => Promise<RaceOutcome>) => ({ recordResults: vi.fn(answer) })
  const NOW = () => new Date('2026-10-10T12:00:00.000Z')

  it('writes one entry (server, season, round, circuit, time) after the API confirmed success, and keeps it across a restart', async () => {
    const result = await recordResultsAndLog(api(async () => outcome), store, G, input, NOW)
    expect(result).toBe(outcome)
    expect(store.get().ledger).toEqual([{ guildId: G, season: '5', round: '3', circuit: 'Zandvoort', recordedAt: '2026-10-10T12:00:00.000Z' }])
    expect(new SettingsStore(file).get().ledger).toHaveLength(1)
  })

  it('a repeat is warned about: the ledger finds the earlier recording of the same server + season + round', async () => {
    expect(findLedgerEntries(store.get().ledger, G, '5', '3')).toHaveLength(0)
    await recordResultsAndLog(api(async () => outcome), store, G, input, NOW)
    expect(findLedgerEntries(store.get().ledger, G, ' 5 ', '03')).toHaveLength(1) // same race, written differently
    expect(findLedgerEntries(store.get().ledger, G, '5', '4')).toHaveLength(0) // another round
    expect(findLedgerEntries(store.get().ledger, G, '6', '3')).toHaveLength(0) // another season
    expect(findLedgerEntries(store.get().ledger, G2, '5', '3')).toHaveLength(0) // another server
  })

  it('recording again (after the warning) adds a second entry: the ledger mirrors what really happened', async () => {
    await recordResultsAndLog(api(async () => outcome), store, G, input, NOW)
    await recordResultsAndLog(api(async () => outcome), store, G, input, NOW)
    expect(findLedgerEntries(store.get().ledger, G, '5', '3')).toHaveLength(2)
  })

  it('NEVER writes after a failure: refusals, server errors, a timeout or a lost answer', async () => {
    const failures = [
      httpError('fia_required', 403),
      httpError('ambiguous_name', 400),
      httpError('invalid_results', 400),
      httpError('bot_cannot_send', 403),
      httpError('internal_error', 500),
      httpError('bot_timeout', 504),
      timeoutError(),
      networkError(),
      new ApiError({ kind: 'invalid_response', code: 'invalid_response', message: 'garbled' })
    ]
    for (const error of failures) {
      const failing = api(async () => Promise.reject(error))
      await expect(recordResultsAndLog(failing, store, G, input, NOW), error.code).rejects.toBe(error)
      expect(failing.recordResults, error.code).toHaveBeenCalledTimes(1) // and it is not tried again by the service
      expect(store.get().ledger, error.code).toEqual([])
      expect(new SettingsStore(file).get().ledger, error.code).toEqual([])
    }
  })

  it('sends the request once even when it succeeds, and never calls the API a second time', async () => {
    const once = api(async () => outcome)
    await recordResultsAndLog(once, store, G, input, NOW)
    expect(once.recordResults).toHaveBeenCalledTimes(1)
    expect(once.recordResults).toHaveBeenCalledWith(G, input)
  })

  it('drops malformed entries from a hand-edited file and keeps the good ones', () => {
    writeFileSync(
      file,
      JSON.stringify({
        ledger: [
          { guildId: G, season: '5', round: '3', circuit: 'Zandvoort', recordedAt: '2026-10-10T12:00:00.000Z' },
          { guildId: 'x', season: '5', round: '3', circuit: 'Zandvoort', recordedAt: '2026-10-10T12:00:00.000Z' },
          { guildId: G, season: '', round: '3', circuit: 'Zandvoort', recordedAt: '2026-10-10T12:00:00.000Z' },
          { guildId: G, season: '5', round: '3', circuit: 'Zandvoort', recordedAt: 'yesterday-ish' },
          'junk'
        ]
      })
    )
    expect(new SettingsStore(file).get().ledger).toHaveLength(1)
  })

  it('the renderer can neither add to nor wipe the ledger or the calendar posts through settings:set', () => {
    store.recordRace({ guildId: G, season: '5', round: '3', circuit: 'Zandvoort', recordedAt: '2026-10-10T12:00:00.000Z' })
    store.rememberCalendarPost(G, { messageId: MSG, channelId: CH })
    store.set({ ledger: [], calendarPosts: {}, lastGame: 'f1' })
    expect(store.get().ledger).toHaveLength(1)
    expect(store.get().calendarPosts[G]).toBeDefined()
    expect(store.get().lastGame).toBe('f1')
  })
})
