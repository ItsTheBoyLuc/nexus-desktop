/**
 * FAKE "posts made with the app" backend for `npm run dev:mock` (milestone 7): GET /app-posts and DELETE /app-posts/{channel}/{message}.
 * Part of the mock bridge: it must never end up in an Electron build (it is only reachable through installMock.ts, which main.tsx loads
 * behind the compile-time `__NEXUS_MOCK__` flag).
 *
 * It is stateful and follows docs/APP_API.md: each channel keeps its messages (newest first), the list only looks at the LAST 100 of them and
 * returns at most 25 app posts, a delete removes one message and nothing else (a team, event or result is never touched), and every post
 * made in the other mocks (announcements of the server and of the five games, team / event / result cards) is recorded here too, so what is
 * posted can be deleted again in the same session.
 *
 * Scenarios (query string, on top of the ones in the other mock files):
 *   noappposts     no app post anywhere (the empty list)
 *   nomanage       (existing) staff without Manage Server: every delete answers 403 manage_server_required (the list stays readable)
 *   nostaff        (existing) every call answers 403 forbidden
 *   postgone       every delete answers 404 message_not_found (the message was deleted a moment earlier) and the post is gone from the next list
 *   notappost      every delete answers 403 not_an_app_post and deletes nothing (the message was edited, or is not ours)
 *   cannotread     list and delete answer 403 bot_cannot_read (the bot lacks View Channel or Read Message History)
 *   cannotdelete   every delete answers 403 bot_cannot_delete (the bot lacks Manage Messages and cannot delete this message)
 *   channelgone    list and delete answer 404 channel_not_found
 *   deletelimit    every delete answers 429 rate_limited with Retry-After 30 (the real limit is 10 deletes a minute per user and server; refused attempts count)
 *   lostdelete     a delete IS applied, then the answer is lost (timeout): the app must lock and offer only a refresh
 *   error          (existing) every call fails with a 500
 *
 * Hooks (normal scenario), by the title of the post:
 *   "timeout"   the delete IS applied, then the answer is lost            "fail"      502 discord_error (nothing is deleted; the outcome is unknown to the app)
 *   "gone"      404 message_not_found, and the post disappears            "notapp"    403 not_an_app_post, nothing is deleted
 * The channel #bot-locked answers 403 bot_cannot_read, the channel #staff-only-hidden 403 forbidden (the caller cannot see it).
 *
 * Sample data: "Apex Racing League" #announcements has 8 app posts among its last 100 messages (a title with HTML-looking text, a very long
 * title, one titled for each hook) and 2 more further back that are NOT found (older than the last 100 messages); #league-news has 2;
 * #race-results has 1. "Midnight GT Championship" has 1 in #announcements. Everything else is empty. Everything is obviously fake.
 */
import type { NexusBridge } from '../../shared/bridge'
import type { AppPost, AppPostDeleteResult, AppPostList, IpcResult } from '../../shared/types'
import { failure, notFound, refused, timeoutFailure } from './common'
import type { F1MockContext } from './f1Mock'

type AppPostsMockApi = Pick<NexusBridge['api'], 'appPosts' | 'deleteAppPost'>

interface Message {
  messageId: string
  /** An app post: the bot wrote it, its footer starts with "Posted via Nexus App" and it has no buttons. Everything else is never listed or deleted. */
  app: boolean
  title: string
  postedAt: string
}

const MINUTE_MS = 60_000
const stamp = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * MINUTE_MS).toISOString()

export interface AppPostsMock {
  api: AppPostsMockApi
  /** Called by the other mocks when something is posted, so it can be listed and deleted. */
  record: (guildId: string, channelId: string, messageId: string, title: string) => void
}

export function createAppPostsMock(ctx: F1MockContext): AppPostsMock {
  const scenario = ctx.scenario
  const channelIds = ctx.channels.map((channel) => channel.id)
  // guild -> channel -> messages, newest first.
  const store = new Map<string, Map<string, Message[]>>()
  const channelsOf = (guildId: string): Map<string, Message[]> => {
    let found = store.get(guildId)
    if (!found) {
      found = new Map()
      store.set(guildId, found)
    }
    return found
  }
  /** The ids are handed out per mock, so the same seed gives the same ids every time (and the tests can rely on them). Newer = bigger, like Discord's. */
  let seedCounter = 0
  const seedId = (): string => `66000000000000${String(++seedCounter).padStart(4, '0')}`
  /** The messages of a channel, newest first: the app posts with ordinary messages of people between them, then 100 older ordinary ones, then app posts that fell out of the window. */
  const seedChannel = (posts: Array<{ title: string; minutesAgo: number }>, olderApp: string[] = []): Message[] => {
    const newest = posts.flatMap((post, index): Message[] => [
      { messageId: seedId(), app: true, title: post.title, postedAt: stamp(post.minutesAgo) },
      { messageId: seedId(), app: false, title: `A message of a member ${index}`, postedAt: stamp(post.minutesAgo + 1) }
    ])
    const filler = Array.from({ length: 100 }, (_, index): Message => ({ messageId: seedId(), app: false, title: `A message of a member ${index + 100}`, postedAt: stamp(600 + index) }))
    const older = olderApp.map((title, index): Message => ({ messageId: seedId(), app: true, title, postedAt: stamp(5000 + index) }))
    return [...newest, ...filler, ...older]
  }
  const [announcements, raceResults, leagueNews] = [channelIds[0]!, channelIds[1]!, channelIds[2]!]
  if (scenario !== 'noappposts') {
    channelsOf(ctx.apex).set(
      announcements,
      seedChannel(
        [
          { title: 'Fake Round 3 starts on Friday', minutesAgo: 20 },
          { title: '<b>Fake</b> <script>alert(1)</script> & "quotes" (plain text only)', minutesAgo: 90 },
          { title: `Fake post with a very long title ${'x'.repeat(60)}`, minutesAgo: 200 },
          { title: 'Fake Endurance Racing', minutesAgo: 400 },
          { title: 'Fake post that is already gone', minutesAgo: 600 },
          { title: 'Fake post that is notapp any more', minutesAgo: 700 },
          { title: 'Fake post with a timeout', minutesAgo: 800 },
          { title: 'Fake post with a fail', minutesAgo: 900 }
        ],
        ['Fake old post, older than the last 100 messages', 'Fake older post, also not found']
      )
    )
    channelsOf(ctx.apex).set(leagueNews, seedChannel([{ title: 'Fake season recap', minutesAgo: 300 }, { title: 'Fake Round 2 results', minutesAgo: 1500 }]))
    channelsOf(ctx.apex).set(raceResults, seedChannel([{ title: 'Fake Round 1 result', minutesAgo: 2500 }]))
    channelsOf(ctx.midnight).set(announcements, seedChannel([{ title: 'Fake Midnight GT welcome', minutesAgo: 120 }]))
  }

  const nostaff = scenario === 'nostaff'
  const deleteTimes = new Map<string, number[]>()

  const gate = <T,>(guildId: string, run: () => IpcResult<T>): IpcResult<T> => {
    if (!ctx.known(guildId)) return notFound('guild_not_found', 'The bot is not in that server.')
    if (nostaff) return refused('forbidden', 'You need the Administrator permission, or the FIA or STAFF role, in this server.')
    return run()
  }
  /** The channel checks the server runs first: a text channel of THIS server that the caller can see and the bot can read. */
  const channelProblem = (channelId: string): IpcResult<never> | null => {
    if (scenario === 'channelgone' || !channelIds.includes(channelId)) return notFound('channel_not_found', 'That text channel was not found in this server.')
    if (channelId === ctx.hiddenChannel) return refused('forbidden', 'You cannot see that channel.')
    if (scenario === 'cannotread' || channelId === ctx.lockedChannel) return refused('bot_cannot_read', 'The bot needs View Channel and Read Message History there.')
    return null
  }

  const view = (channelId: string, message: Message): AppPost => ({ channelId, messageId: message.messageId, title: message.title, postedAt: message.postedAt })

  const api: AppPostsMockApi = {
    appPosts: (guildId, channelId) =>
      ctx.api<AppPostList>(() =>
        gate(guildId, () => {
          const problem = channelProblem(channelId)
          if (problem) return problem
          // Only the last 100 messages are looked at; at most 25 app posts of them are returned.
          const lastHundred = (channelsOf(guildId).get(channelId) ?? []).slice(0, 100)
          const posts = lastHundred.filter((message) => message.app).slice(0, 25).map((message) => view(channelId, message))
          return { ok: true, data: { channelId, posts } }
        })
      ),

    deleteAppPost: (guildId, channelId, messageId) =>
      ctx.api<AppPostDeleteResult>(() =>
        gate(guildId, () => {
          // The real limit is 10 deletes a minute per user and server, refused attempts included.
          const now = Date.now()
          const recent = (deleteTimes.get(guildId) ?? []).filter((time) => now - time < MINUTE_MS)
          recent.push(now)
          deleteTimes.set(guildId, recent)
          if (scenario === 'deletelimit' || recent.length > 10) return failure('rate_limited', 'rate_limited', 'Too many deletes. Try again later.', 429, { retryAfter: 30 })
          if (scenario === 'nomanage') return refused('manage_server_required', 'You need the Manage Server permission, or Administrator, to do this.')
          const problem = channelProblem(channelId)
          if (problem) return problem
          const messages = channelsOf(guildId).get(channelId) ?? []
          const index = messages.findIndex((message) => message.messageId === messageId)
          const message = messages[index]
          if (scenario === 'postgone' || (message && /\bgone\b/i.test(message.title))) {
            if (index !== -1) messages.splice(index, 1) // it was deleted a moment earlier
            return notFound('message_not_found', 'That message was not found (it may have been deleted a moment earlier).')
          }
          if (!message) return notFound('message_not_found', 'That message was not found.')
          if (scenario === 'notappost' || /\bnotapp\b/i.test(message.title) || !message.app) return refused('not_an_app_post', 'That message is not a post made with the app. Nothing was deleted.')
          if (scenario === 'cannotdelete') return refused('bot_cannot_delete', 'The bot cannot delete that message.')
          if (/\bfail\b/i.test(message.title)) return failure('http', 'discord_error', 'Discord rejected the delete.', 502)
          messages.splice(index, 1) // the message and nothing else: no team, event or result is touched
          if (scenario === 'lostdelete' || /\btimeout\b/i.test(message.title)) return timeoutFailure() // deleted, but the answer "got lost"
          return { ok: true, data: { deleted: true } }
        })
      )
  }

  return {
    api,
    record: (guildId, channelId, messageId, title) => {
      const messages = channelsOf(guildId).get(channelId) ?? []
      messages.unshift({ messageId, app: true, title, postedAt: new Date().toISOString() })
      channelsOf(guildId).set(channelId, messages)
    }
  }
}
