import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { IpcResult } from '../../shared/types'
import { createAppPostsMock } from './appPostsMock'
import { createRacingMock } from './racingMock'

/**
 * Milestone 7: what the esports mock posts (announcements and the cards of teams, events and results) is recorded in the app posts mock, so
 * it can be listed and deleted again in the same dev:mock session, and a delete leaves the team, event or result itself alone.
 */
const APEX = '555000000000000001'
const CH = '777000000000000001'
const TEAM = 'Fake Endurance Racing'

function setup() {
  let next = 5000n
  const ctx = {
    scenario: 'noappposts',
    isAdmin: true,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id: string) => id === APEX,
    channels: [{ id: CH, name: 'announcements' }],
    timeoutChannel: '777000000000000007',
    lockedChannel: '777000000000000008',
    hiddenChannel: '777000000000000009',
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSettings: () => undefined,
    liveMessages: new Set<string>(),
    newMessageId: () => String(900000000000000000n + next++),
    apex: APEX,
    midnight: '555000000000000004'
  }
  const posts = createAppPostsMock(ctx)
  const mock = { ...ctx, recordPost: posts.record }
  return { racing: createRacingMock(mock).api, posts: posts.api }
}
const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}

describe('posts of the esports mock are listed and can be deleted', () => {
  it('an announcement of a game is listed under its title, and deleting it leaves everything else alone', async () => {
    const { racing, posts } = setup()
    const posted = ok(await racing.postRacingAnnouncement(APEX, 'lmu', { channelId: CH, title: 'Fake Round 9', message: 'Text' }))
    const list = ok(await posts.appPosts(APEX, CH)).posts
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ messageId: posted.messageId, title: 'Fake Round 9' })
    const teamsBefore = ok(await racing.racingTeams(APEX, 'lmu')).length
    expect(ok(await posts.deleteAppPost(APEX, CH, posted.messageId))).toEqual({ deleted: true })
    expect(ok(await posts.appPosts(APEX, CH)).posts).toEqual([])
    expect(ok(await racing.racingTeams(APEX, 'lmu'))).toHaveLength(teamsBefore)
  })

  it('the card of a team is listed; deleting it never deletes the team, and the team can be posted again', async () => {
    const { racing, posts } = setup()
    const card = ok(await racing.postRacingTeam(APEX, 'lmu', { team: TEAM, channelId: CH }))
    expect(ok(await posts.appPosts(APEX, CH)).posts.map((post) => post.title)).toEqual([TEAM])
    ok(await posts.deleteAppPost(APEX, CH, card.messageId))
    expect(ok(await racing.racingTeam(APEX, 'lmu', TEAM)).name).toBe(TEAM)
    ok(await racing.postRacingTeam(APEX, 'lmu', { team: TEAM, channelId: CH }))
    expect(ok(await posts.appPosts(APEX, CH)).posts).toHaveLength(1)
  })

  it('the card of an event and of a result are listed too, and deleting them leaves the event and the result in the archive', async () => {
    const { racing, posts } = setup()
    const event = ok(await racing.racingEvents(APEX, 'lmu')).events[0]!
    const result = ok(await racing.racingResults(APEX, 'lmu', { limit: 1 })).results[0]!
    const eventCard = ok(await racing.postRacingEvent(APEX, 'lmu', { id: event.id, channelId: CH }))
    const resultCard = ok(await racing.postRacingResult(APEX, 'lmu', { id: result.id, channelId: CH }))
    expect(ok(await posts.appPosts(APEX, CH)).posts).toHaveLength(2)
    const total = ok(await racing.racingResults(APEX, 'lmu')).total
    ok(await posts.deleteAppPost(APEX, CH, eventCard.messageId))
    ok(await posts.deleteAppPost(APEX, CH, resultCard.messageId))
    expect(ok(await posts.appPosts(APEX, CH)).posts).toEqual([])
    expect(ok(await racing.racingEvents(APEX, 'lmu')).events.some((item) => item.id === event.id)).toBe(true)
    expect(ok(await racing.racingResults(APEX, 'lmu')).total).toBe(total)
  })

  it('a create with a card records the card under the name of the new team', async () => {
    const { racing, posts } = setup()
    ok(await racing.createRacingTeam(APEX, 'gt7', { name: 'Fake Brand New', color: '#112233', channelId: CH }))
    expect(ok(await posts.appPosts(APEX, CH)).posts.map((post) => post.title)).toEqual(['Fake Brand New'])
  })

  it('a post that failed (nothing in Discord) is not recorded', async () => {
    const { racing, posts } = setup()
    await racing.postRacingAnnouncement(APEX, 'lmu', { channelId: CH, title: 'Fake fail', message: 'Text' })
    expect(ok(await posts.appPosts(APEX, CH)).posts).toEqual([])
  })
})
