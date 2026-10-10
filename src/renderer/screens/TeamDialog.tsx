import { useState } from 'react'
import type { FormEvent } from 'react'
import { TEAM_LIMITS, validateTeamDraft } from '../../shared/f1Validation'
import type { TeamDraft, TeamField } from '../../shared/f1Validation'
import { Button, ColorField, Modal, Notice, TextField, useToast, WriteProblemNotice } from '../components'
import { useWriteAction } from '../hooks/useWriteAction'
import { fieldErrorFor, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { invalidateTeams } from '../lib/invalidation'

const FIELD_OF_CODE = {
  team_exists: 'name',
  invalid_name: 'name',
  invalid_color: 'color',
  invalid_abbreviation: 'abbreviation'
} as const satisfies Record<string, TeamField>

const BLANK: TeamDraft = { name: '', color: '#E10600', abbreviation: '' }

/** Create a team. A duplicate name is refused by the API (409 team_exists) and shown under the name field. */
export function TeamDialog({ guildId, onClose, onCreated }: { guildId: string; onClose: () => void; onCreated: (teamName: string) => void }) {
  const toast = useToast()
  const write = useWriteAction()
  const [draft, setDraft] = useState<TeamDraft>(BLANK)
  const [submitted, setSubmitted] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<TeamField, boolean>>>({})
  const [serverError, setServerError] = useState<{ field: TeamField; message: string } | null>(null)
  const [problem, setProblem] = useState<WriteProblem | null>(null)

  const result = validateTeamDraft(draft)
  const errors: Partial<Record<TeamField, string>> = result.ok ? {} : result.errors
  const show = (field: TeamField): string | null => (serverError?.field === field ? serverError.message : submitted || touched[field] ? (errors[field] ?? null) : null)
  const update = (field: TeamField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setTouched((current) => ({ ...current, [field]: true }))
    setServerError(null)
    setProblem(null)
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    if (!result.ok) return
    setProblem(null)
    setServerError(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.createTeam(guildId, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateTeams(guildId)
      toast.push({ tone: 'success', title: 'Team created', message: `${outcome.value.name}: the role and the private channel were created in Discord.` })
      onCreated(outcome.value.name)
      onClose()
      return
    }
    const field = fieldErrorFor(outcome.error, FIELD_OF_CODE)
    if (field) setServerError(field)
    else setProblem(writeProblem(outcome.error, 'Creating the team'))
  }

  return (
    <Modal open title="Create a team" dismissible={!write.busy} onClose={onClose}>
      <form className="stack stack--tight" onSubmit={(event) => void save(event)} noValidate aria-label="Create a team">
        <Notice tone="info">
          Creating a team also creates, in Discord, a <strong>role</strong> in the team colour and a <strong>private text channel</strong> in the Teams category (visible to the team, FIA and STAFF). Nexus needs the Manage Roles and
          Manage Channels permissions; if one is missing, nothing is created.
        </Notice>
        <TextField
          label="Team name"
          value={draft.name}
          maxLength={TEAM_LIMITS.nameMax}
          placeholder="Red Racing"
          hint="Must be unique. Slashes are not allowed."
          error={show('name')}
          autoComplete="off"
          onChange={(event) => update('name', event.target.value)}
        />
        <TextField
          label="Abbreviation"
          value={draft.abbreviation}
          placeholder="RED"
          hint={`1-${TEAM_LIMITS.abbreviationMax} letters or digits. Stored in capitals.`}
          error={show('abbreviation')}
          autoComplete="off"
          onChange={(event) => update('abbreviation', event.target.value)}
        />
        <ColorField label="Team colour" value={draft.color} hint="Hex colour with a #, for example #E10600. Used for the Discord role." error={show('color')} onChange={(value) => update('color', value)} />
        <p className="muted">A team cannot be renamed, recoloured or deleted from the app: Discord has no command for it either. Check the details before you create it.</p>
        <WriteProblemNotice
          problem={problem}
          onRefresh={() => {
            invalidateTeams(guildId)
            onClose()
          }}
          refreshLabel="Refresh the teams"
        />
        <div className="dialog-actions">
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={write.busy}>
            Create team
          </Button>
        </div>
      </form>
    </Modal>
  )
}
