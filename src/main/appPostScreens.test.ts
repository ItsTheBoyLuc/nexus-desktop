import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structural guards for deleting the posts made with the app (milestone 7). They read the source, so a later change cannot quietly replay a
 * delete after a lost answer, move the focus off Cancel, drop the "never deletes the team, event or result" sentence, store a post on disk,
 * or render a title as HTML.
 */
const SRC = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')
const DIALOG = 'renderer/screens/DeleteAppPostDialog.tsx'
const SECTION = 'renderer/screens/AppPostsSection.tsx'
const SERVER_SCREEN = 'renderer/screens/Announcement.tsx'
const GAME_SCREEN = 'renderer/screens/EsportsAnnouncement.tsx'

describe('the delete dialog', () => {
  const text = read(DIALOG)

  it('sends the delete through the single-flight write helper exactly once, and calls the API nowhere else', () => {
    expect(text.match(/write\.run\(/g) ?? []).toHaveLength(1)
    expect(text.match(/deleteAppPost\(/g) ?? []).toHaveLength(1)
    expect(text).not.toMatch(/setTimeout|setInterval|retry/i)
  })

  it('is only sent from the confirm phase, never when Manage Server was refused', () => {
    expect(text).toContain("if (phase !== 'confirming' || manage.denied) return")
    expect(text).toMatch(/disabled=\{manage\.denied\}/)
  })

  it('puts the focus on Cancel (the safe choice) and makes the delete button destructive', () => {
    expect(text).toMatch(/<Button data-autofocus variant="secondary" disabled=\{write\.busy\} onClick=\{onCancel\}>\s*Cancel/)
    expect(text).toMatch(/<Button destructive loading=\{write\.busy\}/)
    // Nothing else in the dialog asks for the focus, except the refresh button that replaces both buttons after a lost answer.
    expect(text.match(/data-autofocus/g) ?? []).toHaveLength(2)
  })

  it('names the title and the channel, says it cannot be undone and that a team, event or result is never deleted', () => {
    expect(text).toContain('{post.title === \'\' ? \'(no title)\' : post.title}')
    expect(text).toContain('{channelLabel(channelName)}')
    expect(text).toContain('It cannot be undone.')
    expect(text).toContain('{DELETE_NEVER_TEXT}')
  })

  it('after a lost, gone or out-of-date answer the only button is Refresh list; the dialog cannot be dismissed any other way', () => {
    expect(text).toContain("actions.includes('refresh')")
    expect(text).toMatch(/dismissible=\{!write\.busy && phase === 'confirming'\}/)
    expect(text).toMatch(/Refresh list\s*<\/Button>\s*\) : \(\s*<>/)
  })

  it('treats every answer through the verdicts and says the post is already gone for a 404', () => {
    for (const word of ['judgeDelete(outcome.error)', "verdict.type === 'denied'", "verdict.type === 'lost'", 'APP_POST_GONE_TEXT', 'DELETE_LOST_TEXT', 'describeAppPostError(outcome.error']) expect(text).toContain(word)
  })

  it('shows every title as plain text', () => {
    expect(text).toMatch(/className="plain-text">\{post\.title/)
    expect(text).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
  })
})

describe('the list section', () => {
  const text = read(SECTION)

  it('says it shows the posts among the last 100 messages, and reads nothing until a channel is chosen', () => {
    expect(text).toContain('{APP_POSTS_SCOPE_TEXT}')
    expect(text).toContain("useAppPosts(guild.id, channelId === '' ? null : channelId)")
    expect(read('renderer/lib/appPosts.ts')).toContain('Shows posts among the last 100 messages')
  })

  it('has an Open in Discord link built from the ids of the list and a Delete button per post, off without Manage Server', () => {
    expect(text).toContain('discordMessageLink(guild.id, post.channelId, post.messageId)')
    expect(text).toContain('Open in Discord')
    expect(text).toMatch(/destructive\s+disabled=\{manage\.denied\}/)
    expect(text).toContain('<DeleteAppPostDialog')
  })

  it('renders every title as plain text', () => {
    expect(text).toMatch(/className="table__key plain-text"/)
    expect(text).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
  })

  it('uses the shared channel picker', () => {
    expect(text).toContain('<SearchSelect')
    expect(text).toContain('useGuildChannels(guild.id)')
  })
})

describe('both announcement screens', () => {
  it.each([SERVER_SCREEN, GAME_SCREEN])('%s has the section, the delete button on the success panel and the confirm dialog', (path) => {
    const text = read(path)
    expect(text).toContain('<AppPostsSection')
    expect(text).toContain('Delete this announcement')
    expect(text).toContain('<DeleteAppPostDialog')
    expect(text).toContain('noun="announcement"')
    expect(text).toMatch(/disabled=\{manage\.denied\}/)
  })

  it.each([SERVER_SCREEN, GAME_SCREEN])('%s deletes with the channel and message ids the server returned for the post', (path) => {
    const text = read(path)
    expect(text).toMatch(/channelId: (result|posted\.result)\.channelId, messageId: (result|posted\.result)\.messageId/)
  })

  it('after a lost answer the delete is never offered again for that announcement', () => {
    // The server screen: any end of the dialog other than "deleted" leaves the status "unknown", which has no delete button.
    const text = read(SERVER_SCREEN)
    expect(text).toContain("settled: 'unknown'")
    expect(text).toContain("posted?.settled === 'live' ? (")
  })
})

describe('nothing about a post is stored', () => {
  const FILES = [DIALOG, SECTION, 'renderer/lib/appPosts.ts', 'main/appPostsApi.ts', 'shared/appPostInputs.ts', 'renderer/mock/appPostsMock.ts']

  it.each(FILES)('%s never writes to disk or browser storage and never logs', (path) => {
    expect(read(path)).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|writeFile|appendFile|from 'node:fs'|\blog\.(info|warn|error)\b|console\./)
  })

  it('the settings file has no field for posts, and the bridge has no call that stores one', () => {
    expect(read('shared/types.ts')).not.toMatch(/appPosts\s*:|postedMessages|storedPosts/)
    const preload = read('preload/index.ts')
    for (const line of preload.split('\n').filter((entry) => /AppPost/.test(entry))) expect(line).not.toMatch(/settings/i)
  })

  it('the main-process handlers of the app posts do not log', () => {
    const lines = read('main/ipc.ts').split('\n').filter((line) => /AppPost|appPost/.test(line))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).not.toMatch(/log\./)
  })
})
