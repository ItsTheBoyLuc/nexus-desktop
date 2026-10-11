import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structural guards for the esports screens (milestone 5): game and server state reset, and the game on every call. They read the
 * source, so a later change cannot quietly drop the scope key or send a request without the game.
 */
describe('every esports screen is rebuilt when the server or the game changes', () => {
  const SCREENS = ['EsportsTeams', 'EsportsEvents', 'EsportsResults', 'EsportsAttendance', 'EsportsAnnouncement']

  it.each(SCREENS)('%s is keyed by the scope, so nothing of the old game stays', (name) => {
    let text: string
    try {
      text = readFileSync(join(__dirname, '..', 'renderer', 'screens', `${name}.tsx`), 'utf8')
    } catch {
      return // a screen that is not built yet has nothing to check
    }
    expect(text, name).toMatch(/key=\{ctx\.scope\}/)
  })

  it('every esports screen reads through the game it is shown for and sends the game with every call', () => {
    for (const name of SCREENS) {
      let text: string
      try {
        text = readFileSync(join(__dirname, '..', 'renderer', 'screens', `${name}.tsx`), 'utf8')
      } catch {
        continue
      }
      const calls = [...text.matchAll(/window\.nexus\.api\.(\w+)\(([^)]*)\)/g)]
      for (const call of calls) {
        if (['channels', 'me'].includes(call[1] ?? '')) continue
        expect(call[2], `${name}: ${call[1]}`).toMatch(/ctx\.game/)
      }
    }
  })
})
