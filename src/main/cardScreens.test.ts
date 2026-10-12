import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structural guards for the cards of teams, events and results (milestone 6, part 2). They read the source, so a later change cannot
 * quietly turn the section on by default, drop the confirmation, replay a write or let a card post itself.
 */
const SRC = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')

const CREATE_FILES = ['renderer/screens/RacingTeamDialog.tsx', 'renderer/screens/EsportsEvents.tsx', 'renderer/screens/EsportsResults.tsx']
const SCREENS = ['renderer/screens/EsportsTeams.tsx', 'renderer/screens/EsportsEvents.tsx', 'renderer/screens/EsportsResults.tsx']
const NEW_FILES = ['renderer/screens/CardPostDialogs.tsx', 'renderer/components/PostTargetSection.tsx', 'renderer/hooks/postTarget.ts', 'renderer/lib/postTarget.ts']

describe('"Post in a channel" on the create forms', () => {
  it('is a switch that is OFF by default', () => {
    const hook = read('renderer/hooks/postTarget.ts')
    expect(hook).toMatch(/useState\(initial\.enabled \?\? false\)/)
    const section = read('renderer/components/PostTargetSection.tsx')
    expect(section).toContain('role="switch"')
    expect(section).toContain('Post in a channel')
  })

  it.each(CREATE_FILES)('%s uses the section (not forced on), sends only target.fields, and confirms before a card is posted', (path) => {
    const text = read(path)
    expect(text).toContain('<PostTargetSection')
    expect(text).not.toMatch(/<PostTargetSection[^>]*\brequired\b/)
    expect(text).toContain('...target.fields')
    expect(text).toContain('<PostConfirmDialog')
    // The create goes through the single-flight write helper once, and the confirmation is what starts it when a card is on.
    expect(text.match(/write\.run\(/g) ?? []).toHaveLength(1)
    expect(text).toMatch(/onConfirm=\{\(\) => void submit\(\)\}/)
    expect(text).toMatch(/if \(posting\) (setConfirming\(true\)|setStep)|setStep\('confirm'\)/)
  })

  it.each(CREATE_FILES)('%s explains refusals about the card as "nothing was created/added/logged or posted"', (path) => {
    expect(read(path)).toMatch(/explainRefusal\(error, verdict, [\w.]+, 'Nothing was (created|added|logged) or posted\.'\)/)
  })

  it.each(CREATE_FILES)('%s says after a lost answer that the card may already be in the channel', (path) => {
    expect(read(path)).toContain('createLostText(')
  })

  it('switching the section off forgets the roles, so an off section can never ping', () => {
    expect(read('renderer/hooks/postTarget.ts')).toMatch(/if \(!value\) setPingIds\(\[\]\)/)
  })

  it('remembers the channel id and nothing else', () => {
    const calls = [...read('renderer/hooks/postTarget.ts').matchAll(/rememberPostChannel\(([^)]*)\)/g)].map((match) => match[1] ?? '')
    expect(calls.length).toBeGreaterThan(0)
    for (const args of calls) expect(args).not.toMatch(/ping|role|name|title|message|draft/i)
  })
})

describe('"Post to Discord" on an existing item', () => {
  it('the team detail, the event rows and the result rows each have the action, disabled without Manage Server', () => {
    expect(read('renderer/screens/EsportsTeams.tsx')).toMatch(/Post to Discord/)
    for (const path of ['renderer/screens/EsportsEvents.tsx', 'renderer/screens/EsportsResults.tsx']) expect(read(path)).toMatch(/aria-label=\{`Post the card of [^`]*to Discord`\}/)
    for (const path of SCREENS) expect(read(path)).toMatch(/disabled=\{manage\.denied\}/)
  })

  it.each([
    ['renderer/screens/EsportsTeams.tsx', 'postRacingTeam'],
    ['renderer/screens/EsportsEvents.tsx', 'postRacingEvent'],
    ['renderer/screens/EsportsResults.tsx', 'postRacingResult']
  ])('%s posts with the dedicated call %s and the game of the screen', (path, call) => {
    const text = read(path)
    const calls = [...text.matchAll(new RegExp(`window\\.nexus\\.api\\.${call}\\(([^)]*)\\)`, 'g'))]
    expect(calls.length).toBeGreaterThan(0)
    for (const one of calls) expect(one[1]).toMatch(/ctx\.guild\.id, ctx\.game/)
  })

  it('the dialog sends once, only after the confirmation, and never posts by itself', () => {
    const text = read('renderer/screens/CardPostDialogs.tsx')
    expect(text.match(/write\.run\(/g) ?? []).toHaveLength(1)
    expect(text).toMatch(/onConfirm=\{\(\) => void submit\(\)\}/)
    expect(text).not.toMatch(/useEffect|setTimeout|setInterval|requestAnimationFrame/)
    // `send` is only ever called inside submit().
    expect(text.match(/\bsend\(/g) ?? []).toHaveLength(1)
  })

  it('after a lost answer the dialog only offers Close and says to look at the channel', () => {
    const text = read('renderer/screens/CardPostDialogs.tsx')
    expect(text).toContain("setPhase('lost')")
    expect(text).toContain('CARD_POST_LOST_TEXT')
    const lostFooter = text.slice(text.indexOf("phase === 'lost' ? ("), text.indexOf(') : (', text.indexOf("phase === 'lost' ? (")))
    expect(lostFooter).toContain('Close')
    expect(lostFooter).not.toMatch(/review|Post again|send/i)
  })

  it('"Post again" after a post_error is the same dialog: the user reviews and confirms, and it calls the dedicated endpoint, never the create', () => {
    const text = read('renderer/screens/CardPostDialogs.tsx')
    expect(text).toContain('reviewLabel="Post again"')
    expect(text).toContain('was saved, but its card could not be posted')
    expect(text).not.toMatch(/createRacing|addRacingEvent|logRacingResult/)
    for (const path of SCREENS) {
      const screen = read(path)
      expect(screen).toContain('<CardOutcomeDialog')
      expect(screen).not.toMatch(/onClick=\{[^}]*\bsend\(/)
    }
  })

  it('the item is never created again by a card: no create call outside the create dialogs', () => {
    for (const path of [...SCREENS, 'renderer/screens/CardPostDialogs.tsx']) {
      const text = read(path)
      const creates = (text.match(/api\.(createRacingTeam|addRacingEvent|logRacingResult)\(/g) ?? []).length
      expect(creates, path).toBe(path.endsWith('EsportsTeams.tsx') || path.endsWith('CardPostDialogs.tsx') ? 0 : 1)
    }
    expect(read('renderer/screens/RacingTeamDialog.tsx').match(/api\.createRacingTeam\(/g)).toHaveLength(1)
  })
})

describe('the new files follow the design rules', () => {
  it.each([...NEW_FILES, ...CREATE_FILES, 'renderer/screens/EsportsTeams.tsx'])('%s has no emoji and no yellow', (path) => {
    const text = read(path)
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(text).not.toMatch(/yellow|#ffff00|#fc0|#facc15/i)
  })

  it.each(['renderer/screens/CardPostDialogs.tsx', 'renderer/hooks/postTarget.ts', 'renderer/components/PostTargetSection.tsx', 'renderer/lib/postTarget.ts'])('%s never logs and never touches the file system or browser storage', (path) => {
    expect(read(path)).not.toMatch(/\blog\.(info|warn|error)\b|console\.|from 'node:fs'|localStorage|sessionStorage|indexedDB|writeFile/)
  })
})
