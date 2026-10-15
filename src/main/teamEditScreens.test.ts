import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structural guards for "Edit team" (milestone 7). They read the source, so a later change cannot quietly replay the write after a lost
 * answer, drop the Manage Server rule, forget to move the open team to its new name, or send fields that did not change.
 */
const SRC = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')
const DIALOG = 'renderer/screens/RacingTeamEditDialog.tsx'
const SCREEN = 'renderer/screens/EsportsTeams.tsx'

describe('the edit dialog', () => {
  const text = read(DIALOG)

  it('sends the edit through the single-flight write helper exactly once, and never calls the API anywhere else', () => {
    expect(text.match(/write\.run\(/g) ?? []).toHaveLength(1)
    expect(text.match(/editRacingTeam\(/g) ?? []).toHaveLength(1)
    expect(text).not.toMatch(/setTimeout|setInterval|retry|again\(/i)
  })

  it('sends only what changed: the input is the team name plus the validated changes', () => {
    expect(text).toContain('const input: RacingTeamEditInput = { team: team.name, ...result.value }')
    expect(text).toContain('validateRacingTeamEditDraft(team, draft)')
  })

  it('is never sent when nothing changed, when the answer was lost, when the team is gone, or when Manage Server was refused', () => {
    expect(text).toMatch(/if \(!result\.ok \|\| unchanged \|\| phase !== 'editing' \|\| manage\.denied\) return/)
    expect(text).toMatch(/disabled=\{manage\.denied \|\| unchanged\}/)
  })

  it('after a lost answer the form is locked and the only button is the refresh', () => {
    // The footer of the lost phase is one button: no Cancel, no Save.
    const lost = /phase === 'lost' \? \(\s*<Button[\s\S]*?onClick=\{refreshAndClose\}>\s*Refresh the list\s*<\/Button>\s*\) : phase === 'gone'/
    expect(text).toMatch(lost)
    expect(text.match(/disabled=\{phase !== 'editing'\}/g) ?? []).toHaveLength(2) // both fields
    expect(text).toContain("setPhase('lost')")
  })

  it('shows the note about the role and the results, plainly', () => {
    expect(text).toContain('{TEAM_EDIT_NOTE}')
  })

  it('refreshes the teams, the results and the roles after a save, and handles every refusal through the verdicts', () => {
    expect(text).toContain('invalidateRacing(guildId, game)')
    expect(text).toContain('invalidate(`roles:${guildId}`)')
    for (const word of ["verdict.type === 'lost'", "verdict.type === 'denied'", "verdict.type === 'field'", "verdict.type === 'gone'", "verdict.type === 'nothing'"]) expect(text).toContain(word)
    expect(text).toContain('manage.markDenied()')
  })

  it('is plain text throughout: no raw HTML from a team name', () => {
    expect(text).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
  })
})

describe('the Teams screen', () => {
  const text = read(SCREEN)

  it('has an Edit team action per team in the list and in the detail, both off without Manage Server', () => {
    expect(text).toContain('aria-label={`Edit team ${team.name}`}')
    expect(text).toMatch(/Edit team\s*<\/Button>/)
    expect(text.match(/disabled=\{editDenied\}/g) ?? []).toHaveLength(1)
    expect(text).toMatch(/icon=\{<Pencil size=\{16\} aria-hidden="true" \/>\} disabled=\{manage\.denied\}/)
  })

  it('moves the open team to its new name when a rename is saved, with the saved name from the server', () => {
    expect(text).toContain('selectionAfterRename(now, from, result.team.name)')
  })

  it('does not call a team "gone" while the list is being re-read after a save', () => {
    expect(text).toContain('selectedTeamView(list, selected, teams.status === \'ready\' && teams.refreshing === true)')
    expect(text).not.toContain('no longer exists. It may have been removed in Discord.</Notice>')
  })

  it('no longer says that teams cannot be edited', () => {
    expect(text).not.toMatch(/Teams cannot be edited/)
    expect(text).toMatch(/can be changed with Edit team/)
  })
})
