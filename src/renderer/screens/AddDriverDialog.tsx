import { useState } from 'react'
import type { FormEvent } from 'react'
import { TEAM_LIMITS, validateDriverDraft } from '../../shared/f1Validation'
import type { DriverField } from '../../shared/f1Validation'
import type { Team } from '../../shared/types'
import { Button, MemberPicker, Modal, TextField, useToast, WriteProblemNotice } from '../components'
import { useWriteAction } from '../hooks/useWriteAction'
import { fieldErrorFor, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { invalidateTeams } from '../lib/invalidation'

const FIELD_OF_CODE = {
  member_not_found: 'userId',
  invalid_driver: 'userId',
  invalid_user_id: 'userId',
  invalid_username: 'userId',
  invalid_number: 'number'
} as const satisfies Record<string, DriverField>

/** Add a driver to a team: the member is searched by name (never typed as an ID), the number is optional. */
export function AddDriverDialog({ guildId, team, onClose }: { guildId: string; team: Team; onClose: () => void }) {
  const toast = useToast()
  const write = useWriteAction()
  const [userId, setUserId] = useState('')
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<{ field: DriverField; message: string } | null>(null)
  const [problem, setProblem] = useState<WriteProblem | null>(null)

  const result = validateDriverDraft({ userId, number })
  const errors: Partial<Record<DriverField, string>> = result.ok ? {} : result.errors
  const show = (field: DriverField): string | null => (serverError?.field === field ? serverError.message : submitted ? (errors[field] ?? null) : null)
  const onTeam = new Map(team.drivers.map((driver) => [driver.userId, 'Already on this team']))

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    if (!result.ok) return
    setProblem(null)
    setServerError(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.addDriver(guildId, team.name, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateTeams(guildId)
      toast.push({ tone: 'success', title: 'Driver added', message: `${name || 'The member'} joined ${team.name}${team.roleName ? ` and received the role ${team.roleName}` : ''}.` })
      onClose()
      return
    }
    const field = fieldErrorFor(outcome.error, FIELD_OF_CODE)
    if (field) setServerError(field)
    else setProblem(writeProblem(outcome.error, 'Adding the driver'))
  }

  return (
    <Modal open title={`Add a driver to ${team.name}`} dismissible={!write.busy} onClose={onClose}>
      <form className="stack stack--tight" onSubmit={(event) => void save(event)} noValidate aria-label="Add a driver">
        <MemberPicker
          label="Member"
          guildId={guildId}
          value={userId}
          taken={onTeam}
          hint={`Search by name or username. The member receives the team role${team.roleName ? ` "${team.roleName}"` : ''} in Discord.`}
          error={show('userId')}
          onChange={(person) => {
            setUserId(person?.id ?? '')
            setName(person?.displayName ?? '')
            setServerError(null)
            setProblem(null)
          }}
        />
        <TextField
          label="Driver number"
          optional
          value={number}
          inputMode="numeric"
          placeholder="No number"
          hint={`Whole number from ${TEAM_LIMITS.numberMin} to ${TEAM_LIMITS.numberMax}.`}
          error={show('number')}
          autoComplete="off"
          onChange={(event) => {
            setNumber(event.target.value)
            setServerError(null)
          }}
        />
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
            Add driver
          </Button>
        </div>
      </form>
    </Modal>
  )
}
