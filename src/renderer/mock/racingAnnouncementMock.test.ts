import { describe, expect, it } from 'vitest'
import { GAME_KEYS } from '../../shared/types'
import type { IpcResult, RacingGame } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { createRacingMock } from './racingMock'

/** The fake backend for the per-game announcement (milestone 5, part 2): 403 manager_required (per game), channel refusals, a lost answer, unknown_game. */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const OTHER = '555000000000000002'
const CH = '777000000000000001'
const TIMEOUT_CH = '777000000000000007'
const LOCKED = '777000000000000008'
const HIDDEN = '777000000000000009'

function setup(scenario = 'normal') {
  const live = new Set<string>()
  const api = createRacingMock({
    scenario,
    isAdmin: true,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id: string) => [APEX, MIDNIGHT, OTHER].includes(id),
    channels: [{ id: CH, name: 'c1' }, { id: TIMEOUT_CH, name: 'timeout' }, { id: LOCKED, name: 'locked' }],
    timeoutChannel: TIMEOUT_CH,
    lockedChannel: LOCKED,
    hiddenChannel: HIDDEN,
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSettings: () => undefined,
    liveMessages: live,
    newMessageId: (() => {
      let next = 900000000000000000n
      return () => String(next++)
    })(),
    apex: APEX,
    midnight: MIDNIGHT
  }).api
  return { api, live }
}

const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}
const code = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.code)
const kind = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.kind)
const input = { channelId: CH, title: 'Fake Round 3', message: 'Fake text :emoji:' }

describe.each(GAME_KEYS)('announcement of %s in the mock', (game: RacingGame) => {
  it('posts and returns the ids of the message and the channel', async () => {
    const { api, live } = setup()
    const result = ok(await api.postRacingAnnouncement(APEX, game, input))
    expect(result.channelId).toBe(CH)
    expect(live.has(result.messageId)).toBe(true)
  })

  it('403 manager_required in the nomanager scenario; per game with nomanager-<game>', async () => {
    expect(code(await setup('nomanager').api.postRacingAnnouncement(APEX, game, input))).toBe('manager_required')
    const { api } = setup(`nomanager-${game}`)
    expect(code(await api.postRacingAnnouncement(APEX, game, input))).toBe('manager_required')
    for (const other of GAME_KEYS.filter((key) => key !== game)) expect(code(await api.postRacingAnnouncement(APEX, other, input)), other).toBe('ok')
  })

  it('a lost answer: the message IS posted, the answer is a timeout', async () => {
    for (const [scenario, over] of [['lostracing', {}], ['normal', { title: 'Fake timeout round' }], ['normal', { channelId: TIMEOUT_CH }]] as const) {
      const { api, live } = setup(scenario)
      expect(kind(await api.postRacingAnnouncement(APEX, game, { ...input, ...over })), scenario).toBe('timeout')
      expect(live.size, scenario).toBe(1)
    }
  })

  it('refuses an image that is not https, like the server', async () => {
    const { api, live } = setup()
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...input, imageUrl: 'http://example.com/x.png' }))).toBe('invalid_image_url')
    expect(live.size).toBe(0)
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...input, imageUrl: 'https://example.com/x.png' }))).toBe('ok')
  })

  it('channel problems post nothing: not found, the bot cannot send, hidden; a Discord rejection posts nothing either', async () => {
    const { api, live } = setup()
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...input, channelId: '777000000000000099' }))).toBe('channel_not_found')
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...input, channelId: LOCKED }))).toBe('bot_cannot_send')
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...input, channelId: HIDDEN }))).toBe('forbidden')
    expect(code(await api.postRacingAnnouncement(APEX, game, { ...input, title: 'Fake fail' }))).toBe('discord_error')
    expect(live.size).toBe(0)
  })
})

describe('the announcement mock', () => {
  it('an unknown game is unknown_game', async () => {
    expect(code(await setup().api.postRacingAnnouncement(APEX, 'f2' as RacingGame, input))).toBe('unknown_game')
  })
})
