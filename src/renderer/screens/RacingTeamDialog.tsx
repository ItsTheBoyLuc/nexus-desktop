import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import { RACING_LIMITS, validateRacingTeamDraft } from '../../shared/racingValidation'
import type { RacingTeamDraft, RacingTeamField } from '../../shared/racingValidation'
import type { RacingGame, RacingTeamDetail } from '../../shared/types'
import { Button, ColorField, Modal, Notice, TextField, useToast } from '../components'
import { useManageDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { errorCode, outcomeUnknown, unwrap } from '../lib/errors'
import { invalidateRacing } from '../lib/racingScope'
import { describeRacingError, MANAGE_SERVER_RULE } from '../lib/racingView'

const FIELD_OF_CODE = { invalid_name: 'name', invalid_color: 'color', invalid_focus: 'focus' } as const satisfies Record<string, RacingTeamField>

interface Props {
  guildId: string
  game: RacingGame
  gameLabel: string
  onClose: () => void
  onCreated: (team: RacingTeamDetail) => void
}

/**
 * Create an esports team (/racing {game} team-create): the team AND a Discord role in the team colour. Needs Manage Server or
 * Administrator. The class or category is free text for every game. It is sent once: after a lost answer the form locks,
 * because the team and its Discord role may already exist and a second send would be refused (or, with another spelling,
 * create a second role).
 */
export function RacingTeamDialog({ guildId, game, gameLabel, onClose, onCreated }: Props) {
  const toast = useToast()
  const write = useWriteAction()
  const manage = useManageDenied(guildId)
  const [draft, setDraft] = useState<RacingTeamDraft>({ name: '', color: '#1E41FF', focus: '' })
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<RacingTeamField, string>>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  const result = validateRacingTeamDraft(draft)
  const errors: Partial<Record<RacingTeamField, string>> = result.ok ? {} : result.errors
  const show = (field: RacingTeamField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const change = (field: RacingTeamField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerErrors({})
    setProblem(null)
  }

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!result.ok || lost || manage.denied) return
    const outcome = await write.run(() => unwrap(window.nexus.api.createRacingTeam(guildId, game, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateRacing(guildId, game)
      toast.push({ tone: 'success', title: 'Team created', message: `${outcome.value.name} and its Discord role were created.` })
      onCreated(outcome.value)
      return
    }
    const error = outcome.error
    if (outcomeUnknown(error)) {
      invalidateRacing(guildId, game)
      setLost(true)
      return
    }
    const code = errorCode(error)
    if (code === 'manage_server_required') {
      manage.markDenied()
      return
    }
    if (code === 'team_exists') setServerErrors({ name: describeRacingError(error, gameLabel) })
    else if (code !== null && code in FIELD_OF_CODE) setServerErrors({ [FIELD_OF_CODE[code as keyof typeof FIELD_OF_CODE]]: describeRacingError(error, gameLabel) })
    else setProblem(describeRacingError(error, gameLabel))
  }

  return (
    <Modal
      open
      title={`Create a ${gameLabel} team`}
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={write.busy} disabled={lost || manage.denied} onClick={() => void submit()}>
            Create the team
          </Button>
        </>
      }
    >
      <p className="muted">
        Like <code>/racing {game} team-create</code>. Nexus creates the team <strong>and a Discord role</strong> with this colour, named after the team; the members you add later get that role. A team cannot be edited or deleted afterwards.
      </p>
      {manage.denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
          {MANAGE_SERVER_RULE} The server refused your account, so this action is off. If your permissions changed, choose Check again.
        </Notice>
      ) : null}
      {lost ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={onClose}>Close and refresh the list</Button>}>
          Nexus did not get a clear answer, so <strong>the team and its Discord role may already have been created</strong>. It is not sent again with the same data. The list of teams was just read again: look at it, and at the roles in Discord, before you create anything.
        </Notice>
      ) : null}
      <TextField label="Team name" value={draft.name} maxLength={RACING_LIMITS.teamNameMax} hint="Names are compared ignoring capitals: Apex and APEX are the same team." error={show('name')} autoComplete="off" onChange={(event) => change('name', event.target.value)} />
      <ColorField label="Colour" value={draft.color} onChange={(value) => change('color', value)} hint="Hex colour, for example #1E41FF. The Discord role gets this colour." error={show('color')} />
      <TextField
        label="Class or category"
        optional
        value={draft.focus}
        maxLength={RACING_LIMITS.focusMax}
        placeholder="GT3, Hypercar, Gr.3 ..."
        hint="Free text, up to 30 characters. It is not a fixed list: type whatever your team races in."
        error={show('focus')}
        autoComplete="off"
        onChange={(event) => change('focus', event.target.value)}
      />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </Modal>
  )
}
