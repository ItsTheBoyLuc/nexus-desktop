import { describe, expect, it } from 'vitest'
import { GAME_KEYS } from '../../shared/types'
import type { IpcResult, RacingGame } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { createRacingMock } from './racingMock'

/**
 * The fake backend for the attendance posts (milestone 5, part 2): each of the five games has its own posts, the cases the screens
 * are reviewed with exist (empty list, a post with 20+ drivers, 403 manager_required, lost answer, unknown_game), the app can only
 * read and create (drivers press the buttons in Discord), and everything is obviously fake.
 */
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
const input = { channelId: CH, name: 'Fake New Practice', date: '2026-09-14', description: 'fake' }

describe.each(GAME_KEYS)('attendance posts of %s in the mock', (game: RacingGame) => {
  it('Apex has posts, newest first, including one with 20+ drivers; another server has none', async () => {
    const { api } = setup()
    const page = ok(await api.racingAttendance(APEX, game, { limit: 100 }))
    expect(page.total).toBeGreaterThanOrEqual(3)
    const created = page.posts.map((post) => Date.parse(post.createdAt))
    expect(created).toEqual([...created].sort((a, b) => b - a))
    const big = page.posts.find((post) => post.counts.available >= 20)
    expect(big).toBeDefined()
    const detail = ok(await api.racingAttendancePost(APEX, game, big!.messageId))
    expect(detail.attendance.available.length).toBeGreaterThanOrEqual(20)
    expect(detail.attendance.available.length).toBe(big!.counts.available)
    expect(detail.attendance.available.some((row) => !row.inServer)).toBe(true) // a member who left keeps the stored name
    expect(ok(await api.racingAttendance(OTHER, game)).total).toBe(0)
  })

  it('an empty post list in the noattendance scenario', async () => {
    const { api } = setup('noattendance')
    expect(ok(await api.racingAttendance(APEX, game))).toMatchObject({ total: 0, posts: [] })
  })

  it('creating a post puts it first in the list, empty, and the message exists', async () => {
    const { api, live } = setup()
    const before = ok(await api.racingAttendance(APEX, game, { limit: 1 })).total
    const created = ok(await api.createRacingAttendance(APEX, game, input))
    expect(created.channelId).toBe(CH)
    expect(created.post).toMatchObject({ name: 'Fake New Practice', counts: { available: 0, unavailable: 0 } })
    expect(live.has(created.post.messageId)).toBe(true)
    const page = ok(await api.racingAttendance(APEX, game))
    expect(page.total).toBe(before + 1)
    expect(page.posts[0]?.messageId).toBe(created.post.messageId)
  })

  it('a post of this game is never visible in another game', async () => {
    const { api } = setup()
    const created = ok(await api.createRacingAttendance(APEX, game, { ...input, name: 'Fake Only Here' }))
    for (const other of GAME_KEYS.filter((key) => key !== game)) {
      expect(ok(await api.racingAttendance(APEX, other, { limit: 100 })).posts.some((post) => post.name === 'Fake Only Here'), other).toBe(false)
      expect(code(await api.racingAttendancePost(APEX, other, created.post.messageId)), other).toBe('post_not_found')
    }
  })

  it('403 manager_required for creating in the nomanager scenario, while reading still works', async () => {
    const { api } = setup('nomanager')
    expect(code(await api.createRacingAttendance(APEX, game, input))).toBe('manager_required')
    expect(ok(await api.racingAttendance(APEX, game)).total).toBeGreaterThan(0)
  })

  it('the manager rule is per game: nomanager-<game> refuses this game and no other', async () => {
    const { api } = setup(`nomanager-${game}`)
    expect(code(await api.createRacingAttendance(APEX, game, input))).toBe('manager_required')
    for (const other of GAME_KEYS.filter((key) => key !== game)) expect(code(await api.createRacingAttendance(APEX, other, input)), other).toBe('ok')
  })

  it('a lost answer: the post IS stored, the answer is a timeout (lostracing, "timeout" in the name, or the #timeout channel)', async () => {
    for (const [scenario, over] of [['lostracing', {}], ['normal', { name: 'Fake timeout Practice' }], ['normal', { channelId: TIMEOUT_CH }]] as const) {
      const { api } = setup(scenario)
      const before = ok(await api.racingAttendance(APEX, game, { limit: 1 })).total
      expect(kind(await api.createRacingAttendance(APEX, game, { ...input, ...over })), scenario).toBe('timeout')
      expect(ok(await api.racingAttendance(APEX, game, { limit: 1 })).total, scenario).toBe(before + 1)
    }
  })

  it('channel problems: not found, the bot cannot send, hidden', async () => {
    const { api } = setup()
    expect(code(await api.createRacingAttendance(APEX, game, { ...input, channelId: '777000000000000099' }))).toBe('channel_not_found')
    expect(code(await api.createRacingAttendance(APEX, game, { ...input, channelId: LOCKED }))).toBe('bot_cannot_send')
    expect(code(await api.createRacingAttendance(APEX, game, { ...input, channelId: HIDDEN }))).toBe('forbidden')
  })

  it('an unknown post is post_not_found', async () => {
    expect(code(await setup().api.racingAttendancePost(APEX, game, '700000000009999999'))).toBe('post_not_found')
  })
})

describe('the attendance mock is read-only apart from creating, and fake', () => {
  it('offers no way to set a status or to edit or delete a post', () => {
    const { api } = setup()
    expect(Object.keys(api).filter((name) => /attendance/i.test(name)).sort()).toEqual(['createRacingAttendance', 'racingAttendance', 'racingAttendancePost'])
  })

  it('has paging to try: iRacing has 100+ posts', async () => {
    const { api } = setup()
    const first = ok(await api.racingAttendance(APEX, 'iracing', { limit: 100, offset: 0 }))
    const second = ok(await api.racingAttendance(APEX, 'iracing', { limit: 100, offset: 100 }))
    expect(first.total).toBeGreaterThan(100)
    expect(first.posts).toHaveLength(100)
    expect(second.posts.length).toBe(first.total - 100)
  })

  it('names are obviously fake, and html-looking text stays text', async () => {
    const { api } = setup()
    const page = ok(await api.racingAttendance(APEX, 'lmu', { limit: 100 }))
    expect(page.posts.some((post) => /<b>Fake<\/b>/.test(post.name))).toBe(true)
    const big = ok(await api.racingAttendancePost(APEX, 'lmu', page.posts.find((post) => post.counts.available >= 20)!.messageId))
    for (const row of [...big.attendance.available, ...big.attendance.unavailable]) expect(row.name ?? '').toMatch(/Fake/)
  })

  it('an unknown game is unknown_game for every attendance call', async () => {
    const { api } = setup()
    expect(code(await api.racingAttendance(APEX, 'f2' as RacingGame))).toBe('unknown_game')
    expect(code(await api.racingAttendancePost(APEX, 'f2' as RacingGame, '1'))).toBe('unknown_game')
    expect(code(await api.createRacingAttendance(APEX, 'f2' as RacingGame, input))).toBe('unknown_game')
  })
})
