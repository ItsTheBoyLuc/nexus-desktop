import type { RacingTeam } from '../../shared/types'
import { describeError, errorCode } from './errors'
import { describeRacingError } from './racingView'
import { judgeWrite } from './racingWriteFlow'

/**
 * Editing a team (M7): what the dialog says about the answers of `PATCH …/teams`, and how a rename reaches the state the screens keep
 * under a team's NAME. Free of React so the rules can be tested. Every text of a team is untrusted: nothing here builds HTML.
 */

/** Shown plainly in the dialog, always. */
export const TEAM_EDIT_NOTE = "Renames the Discord role and updates this team's results. Messages already posted in Discord are not changed."

/** Said when the answer was lost: the form is locked, the edit is never sent again, and the only way forward is to look. */
export const TEAM_EDIT_LOST_TEXT =
  'Nexus did not get a clear answer, so the team (and its Discord role) may already carry the new name or class. The edit is not sent again. The list of teams was just read again: look at it, and at the role in Discord, before you change anything.'

export type TeamEditField = 'name' | 'focus'

/** What the dialog does with a refused or lost edit. */
export type TeamEditVerdict =
  /** The server may have carried it out: lock the form, refresh, never offer a retry. */
  | { type: 'lost' }
  /** 403 manage_server_required: disable the action for this server, keep the data readable. */
  | { type: 'denied' }
  /** A problem with one field; nothing was changed. */
  | { type: 'field'; field: TeamEditField }
  /** The team is gone (renamed or removed meanwhile): nothing to edit any more, refresh the list. */
  | { type: 'gone' }
  /** The server found nothing to change (the values already are what was sent): refresh, nothing was done. */
  | { type: 'nothing' }
  /** Any other refusal: nothing was changed, the user may correct and send again. */
  | { type: 'rejected' }

const FIELD_OF_CODE: Record<string, TeamEditField> = { team_exists: 'name', invalid_name: 'name', invalid_focus: 'focus' }

export function judgeTeamEdit(error: unknown): TeamEditVerdict {
  const verdict = judgeWrite(error, 'team')
  if (verdict.type === 'lost') return { type: 'lost' }
  if (verdict.type === 'denied') return { type: 'denied' }
  const code = errorCode(error)
  if (code !== null && code in FIELD_OF_CODE) return { type: 'field', field: FIELD_OF_CODE[code]! }
  if (code === 'team_not_found') return { type: 'gone' }
  if (code === 'no_changes') return { type: 'nothing' }
  return { type: 'rejected' }
}

/** The words for every refusal of the edit. Each one says that nothing was changed: a refusal happens before the server changes anything. */
export function describeTeamEditError(error: unknown, gameLabel: string): string {
  switch (errorCode(error)) {
    case 'no_changes':
      return 'Nothing to change: the name and the class already are what you entered (someone may have changed them in the meantime). Nothing was changed. The list was refreshed.'
    case 'bot_missing_manage_roles':
      return 'Nexus is missing the Manage Roles permission in this server, so the Discord role cannot be renamed and the team was not changed. Give the Nexus role the Manage Roles permission in Discord and try again.'
    case 'role_not_assignable':
      return "The team's Discord role is above Nexus's highest role, so Nexus cannot rename it and the team was not changed. Move the Nexus role above the team role in Discord and try again."
    case 'team_exists':
      return `Another ${gameLabel} team already has that name. Team names are compared ignoring capitals (only the capitals of this team's own name may change), so choose another name. Nothing was changed.`
    case 'team_not_found':
      return 'That team no longer exists under this name. It may have been renamed or removed in Discord. The list was refreshed.'
    case 'rate_limited':
      // The generic wording of the posts ("too many posts") does not fit an edit.
      return describeError(error)
    default:
      return describeRacingError(error, gameLabel)
  }
}

// ── State keyed by a team's name ────────────────────────────────────────────

const sameTeam = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * The team a screen has open, by name (`selected`), after `from` was saved as `saved`. A rename moves the selection with the team: the old
 * name no longer exists on the server, so keeping it would reload a team that is "gone" and show it as removed. Another selection stays.
 */
export function selectionAfterRename(selected: string | null, from: string, saved: string): string | null {
  return selected !== null && sameTeam(selected, from) ? saved : selected
}

export type SelectedTeamView =
  | { kind: 'none' }
  | { kind: 'found'; team: RacingTeam }
  /** The list on screen is the one from before a write and a fresh one is on its way: say nothing about the team yet. */
  | { kind: 'refreshing' }
  | { kind: 'gone' }

/**
 * Finds the selected team in the list. A team missing from a list that is being re-read is NOT reported as gone: right after a rename the
 * old list still has the old name, and "the team no longer exists" would be a false alarm for a team that was just saved.
 */
export function selectedTeamView(list: readonly RacingTeam[], selected: string | null, refreshing: boolean): SelectedTeamView {
  if (selected === null) return { kind: 'none' }
  const team = list.find((item) => sameTeam(item.name, selected))
  if (team) return { kind: 'found', team }
  return refreshing ? { kind: 'refreshing' } : { kind: 'gone' }
}

/** The toast after a saved edit: says what changed, and whether the Discord role was renamed too. */
export function describeSavedEdit(from: string, saved: string, focusChanged: boolean, roleUpdated: boolean): string {
  const parts: string[] = []
  if (from !== saved) parts.push(`${from} is now ${saved}${roleUpdated ? ', and its Discord role was renamed' : ''}`)
  if (focusChanged) parts.push('the class or category was updated')
  const text = parts.join('; ')
  return text === '' ? 'The team was saved.' : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}
