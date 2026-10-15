import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import { hasTeamEditChanges, RACING_LIMITS, validateRacingTeamEditDraft } from '../../shared/racingValidation'
import type { RacingTeamEditDraft, RacingTeamEditField } from '../../shared/racingValidation'
import type { RacingGame, RacingTeamEditInput, RacingTeamEditResult } from '../../shared/types'
import { Button, Modal, Notice, TextField, useToast } from '../components'
import { useManageDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { invalidate } from '../lib/cache'
import { unwrap } from '../lib/errors'
import { invalidateRacing } from '../lib/racingScope'
import { MANAGE_SERVER_RULE } from '../lib/racingView'
import { describeSavedEdit, describeTeamEditError, judgeTeamEdit, TEAM_EDIT_LOST_TEXT, TEAM_EDIT_NOTE } from '../lib/teamEdit'
import type { EsportsContext } from './EsportsRoute'

interface Props {
  ctx: EsportsContext
  /** The team as the screen shows it now: the edit is compared against this, and its name is the one the request names. */
  team: { name: string; focus: string }
  onClose: () => void
  /** The server saved the edit. `from` is the name the team had before. The lists have been invalidated already. */
  onSaved: (result: RacingTeamEditResult, from: string) => void
}

type Phase = 'editing' | 'lost' | 'gone'

/**
 * Edit a team of one game (`PATCH …/teams`): its name and its class or category. Needs Manage Server or Administrator. Only the fields that
 * changed are sent. The edit is sent once: after a lost answer the form locks and offers only a refresh, because the Discord role and the
 * results may already carry the new name and a second send would be refused (or race with the first).
 */
export function RacingTeamEditDialog({ ctx, team, onClose, onSaved }: Props) {
  const game: RacingGame = ctx.game
  const guildId = ctx.guild.id
  const toast = useToast()
  const write = useWriteAction()
  const manage = useManageDenied(guildId)
  const [draft, setDraft] = useState<RacingTeamEditDraft>({ name: team.name, focus: team.focus })
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<RacingTeamEditField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('editing')

  const result = validateRacingTeamEditDraft(team, draft)
  const errors: Partial<Record<RacingTeamEditField, string>> = result.ok ? {} : result.errors
  const unchanged = result.ok && !hasTeamEditChanges(result.value)
  const show = (field: RacingTeamEditField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const change = (field: RacingTeamEditField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
  }
  const refreshLists = (): void => invalidateRacing(guildId, game)

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!result.ok || unchanged || phase !== 'editing' || manage.denied) return
    const input: RacingTeamEditInput = { team: team.name, ...result.value }
    const outcome = await write.run(() => unwrap(window.nexus.api.editRacingTeam(guildId, game, input)))
    if (!outcome) return
    if (outcome.ok) {
      const saved = outcome.value
      // The team lists, the team detail, the results (their team name changed) and the team roles of this game are read again; the roles of the
      // server too, because the Discord role may carry a new name (the ping pickers list roles by name).
      refreshLists()
      invalidate(`roles:${guildId}`)
      toast.push({ tone: 'success', title: 'Team saved', message: describeSavedEdit(team.name, saved.team.name, input.focus !== undefined, saved.roleUpdated) })
      onSaved(saved, team.name)
      return
    }
    const error = outcome.error
    const verdict = judgeTeamEdit(error)
    if (verdict.type === 'lost') {
      refreshLists()
      setPhase('lost')
      return
    }
    if (verdict.type === 'denied') {
      manage.markDenied()
      return
    }
    const message = describeTeamEditError(error, ctx.gameLabel)
    if (verdict.type === 'field') {
      setServerErrors({ [verdict.field]: message })
      return
    }
    if (verdict.type === 'gone' || verdict.type === 'nothing') {
      // The list on screen is out of date: read it again. A team that is gone cannot be edited any more.
      refreshLists()
      if (verdict.type === 'gone') setPhase('gone')
    }
    setProblem(message)
  }

  const refreshAndClose = (): void => {
    refreshLists()
    onClose()
  }

  const footer =
    phase === 'lost' ? (
      <Button icon={<RotateCw size={14} aria-hidden="true" />} onClick={refreshAndClose}>
        Refresh the list
      </Button>
    ) : phase === 'gone' ? (
      <Button onClick={onClose}>Close</Button>
    ) : (
      <>
        <Button variant="secondary" disabled={write.busy} onClick={onClose}>
          Cancel
        </Button>
        <Button loading={write.busy} disabled={manage.denied || unchanged} title={unchanged ? 'Change the name or the class first' : undefined} onClick={() => void submit()}>
          Save changes
        </Button>
      </>
    )

  return (
    <Modal open title={`Edit ${ctx.gameLabel} team`} size="lg" dismissible={!write.busy} onClose={phase === 'lost' ? refreshAndClose : onClose} footer={footer}>
      <Notice tone="info">{TEAM_EDIT_NOTE}</Notice>
      {manage.denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
          {MANAGE_SERVER_RULE} The server refused your account, so editing is off. If your permissions changed, choose Check again.
        </Notice>
      ) : null}
      {phase === 'lost' ? (
        <Notice tone="danger">
          <strong>The team may already be changed.</strong> {TEAM_EDIT_LOST_TEXT}
        </Notice>
      ) : null}
      <TextField
        label="Team name"
        value={draft.name}
        maxLength={RACING_LIMITS.teamNameMax}
        hint="Names are compared ignoring capitals: another team called Apex blocks the name APEX, but you may change the capitals of this team's own name."
        error={show('name')}
        autoComplete="off"
        disabled={phase !== 'editing'}
        onChange={(event) => change('name', event.target.value)}
      />
      <TextField
        label="Class or category"
        optional
        value={draft.focus}
        maxLength={RACING_LIMITS.focusMax}
        placeholder="GT3, Hypercar, Gr.3 ..."
        hint="Free text, up to 30 characters. Leave it empty to clear it. The colour and the roster are not changed."
        error={show('focus')}
        autoComplete="off"
        disabled={phase !== 'editing'}
        onChange={(event) => change('focus', event.target.value)}
      />
      {phase === 'editing' && unchanged ? <p className="muted">Nothing changed yet.</p> : null}
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </Modal>
  )
}
