import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structural guards for the role pings of the esports posts (milestone 6, part 1). They read the source, so a later change cannot
 * quietly drop the confirmation, the default focus on Cancel, the required channel or the "never retry" rule.
 */
const SRC = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')

const SCREENS = ['renderer/screens/EsportsAttendance.tsx', 'renderer/screens/EsportsAnnouncement.tsx']
const SHARED = ['renderer/components/PingRolesField.tsx', 'renderer/components/PostConfirmDialog.tsx', 'renderer/components/PostResultDialog.tsx', 'renderer/lib/pingRoles.ts']

describe('the attendance post and the announcement ping roles through the shared components', () => {
  it.each(SCREENS)('%s uses the ping picker, the confirmation and the result dialog', (path) => {
    const text = read(path)
    expect(text).toContain('<PingRolesField')
    expect(text).toContain('<PostConfirmDialog')
    expect(text).toContain('PostResultDialog')
  })

  it.each(SCREENS)('%s has NO on/off switch for posting: the channel stays required and only the roles are optional', (path) => {
    const text = read(path)
    expect(text).not.toMatch(/Post in a channel/i)
    expect(text).not.toMatch(/role="switch"|type="checkbox"|switch__/)
    // The channel picker is always there and the channel is part of the validation of the form.
    expect(text).toMatch(/<SearchSelect[\s\S]*label="Channel"/)
    expect(text).toMatch(/validate(Announcement|RacingAttendanceDraft)\(/)
  })

  it.each(SCREENS)('%s sends the roles only from the picker (ids), through pingRoleIds', (path) => {
    const text = read(path)
    expect(text).toMatch(/pingRoleIds: pingIds/)
    expect(text).not.toMatch(/@everyone|@here/)
  })

  it.each(SCREENS)('%s remembers the channel id and nothing else', (path) => {
    const text = read(path)
    const calls = [...text.matchAll(/rememberPostChannel\(([^)]*)\)/g)].map((match) => match[1] ?? '')
    expect(calls.length).toBeGreaterThan(0)
    for (const args of calls) expect(args).not.toMatch(/ping|role|name|title|message|draft/i)
  })

  it.each(SCREENS)('%s never retries or schedules a post by itself: it has one write, started by a user action', (path) => {
    const text = read(path)
    expect(text).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/)
    // The post (or create) call goes through the single-flight write helper, and nothing else in the file sends one.
    expect(text.match(/api\.(postRacingAnnouncement|createRacingAttendance)\(/g) ?? []).toHaveLength(1)
    expect(text.match(/write\.run\(/g) ?? []).toHaveLength(1)
  })

  it.each(SCREENS)('%s is rebuilt when the server or the game changes (so chosen roles and the draft are reset)', (path) => {
    expect(read(path)).toMatch(/key=\{ctx\.scope\}/)
  })

  it.each(SCREENS)('%s reads the roles fresh (member counts and mentionable flags decide the confirmation) and the team roles of THIS game', (path) => {
    const text = read(path)
    expect(text).toMatch(/usePingRoles\(ctx\.guild\.id\)/)
    expect(text).toMatch(/useRacingTeamRoles\(ctx\.guild\.id, ctx\.game\)/)
  })
})

describe('the confirmation before every post', () => {
  const dialog = read('renderer/components/PostConfirmDialog.tsx')

  it('Cancel has the initial focus and the confirm button does not', () => {
    const marked = dialog.split('\n').filter((line) => line.includes('data-autofocus'))
    expect(marked).toHaveLength(1)
    const cancelBlock = dialog.slice(dialog.indexOf('data-autofocus'), dialog.indexOf('</Button>', dialog.indexOf('data-autofocus')))
    expect(cancelBlock).toContain('onClick={onCancel}')
    expect(cancelBlock).toContain('Cancel')
  })

  it('the confirm button waits for the checkbox when a role is big, and nothing else disables Cancel but a running request', () => {
    expect(dialog).toMatch(/disabled=\{!view\.canConfirm\}/)
    expect(dialog).toMatch(/type="checkbox"/)
  })

  it('the dialog is not dismissible while the request runs, and it is rebuilt every time it opens (the checkbox starts unticked)', () => {
    expect(dialog).toMatch(/dismissible=\{!busy\}/)
    expect(dialog).toMatch(/props\.open \? <OpenDialog/)
  })

  it('both screens put the confirmation between the form and the request: the post is only sent from onConfirm', () => {
    for (const path of SCREENS) {
      const text = read(path)
      expect(text, path).toMatch(/onConfirm=\{\(\) => void (post|submit)\(\)\}/)
      // The form's own button only opens the confirmation.
      expect(text, path).toMatch(/setPhase\('confirming'\)/)
    }
  })
})

describe('the result dialog', () => {
  const dialog = read('renderer/components/PostResultDialog.tsx')

  it('builds "Open in Discord" only from the server id of the screen and the ids of the answer', () => {
    expect(dialog).toMatch(/discordMessageLink\(guildId, channelId, messageId\)/)
    expect(dialog).not.toMatch(/https?:\/\/discord/)
  })

  it('shows the channel, the message id and the roles that were pinged', () => {
    expect(dialog).toContain('Channel')
    expect(dialog).toContain('Message ID')
    expect(dialog).toContain('Roles pinged')
    expect(dialog).toContain('Open in Discord')
  })

  it.each(SCREENS)('%s passes the roles of the ANSWER (pingedRoles) to it', (path) => {
    expect(read(path)).toMatch(/pingedRoles=\{[\w.]*pingedRoles\}/)
  })
})

describe('the new files follow the design rules', () => {
  it.each([...SHARED, ...SCREENS])('%s has no emoji and no yellow', (path) => {
    const text = read(path)
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(text).not.toMatch(/yellow|#ffff00|#fc0|#facc15/i)
  })

  it('the new styles use no yellow', () => {
    const css = read('renderer/theme/screens.css')
    const added = css.slice(css.indexOf('Role pings of the esports posts'))
    expect(added).not.toMatch(/yellow|#ffff00|#fc0|#facc15/i)
  })
})
