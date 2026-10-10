import { useState } from 'react'
import type { FormEvent } from 'react'
import { draftOfRound, ROUND_LIMITS, validateRoundDraft, validateRoundEdit } from '../../shared/f1Validation'
import type { RoundDraft, RoundField } from '../../shared/f1Validation'
import { EVENT_TYPES } from '../../shared/types'
import type { CalendarRound } from '../../shared/types'
import { Button, Modal, Select, TextField, useToast, WriteProblemNotice } from '../components'
import { useWriteAction } from '../hooks/useWriteAction'
import { fieldErrorFor, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { invalidateCalendar } from '../lib/invalidation'

interface RoundDialogProps {
  guildId: string
  /** Absent = a new round; present = edit that round. */
  round?: CalendarRound
  onClose: () => void
}

/** Backend validation codes shown under the field they belong to. */
const FIELD_OF_CODE = {
  invalid_name: 'name',
  invalid_date: 'date',
  invalid_time: 'time',
  invalid_flag: 'flag',
  invalid_event_type: 'eventType',
  invalid_round: 'round',
  round_exists: 'round'
} as const satisfies Record<string, RoundField>

const BLANK: RoundDraft = { name: '', date: '', dateTbd: false, time: '', flag: '', eventType: 'Normal Race', round: '' }

/**
 * Create or edit one calendar round. Validation mirrors the backend (real DD/MM/YYYY date or TBD, HH:MM,
 * the three event types, name <= 100, flag <= 8); an edit sends only what changed. The round number cannot
 * be changed afterwards: a new round gets the next free number, or one you choose to fill a gap.
 */
export function RoundDialog({ guildId, round, onClose }: RoundDialogProps) {
  const toast = useToast()
  const write = useWriteAction()
  const editing = round !== undefined
  const [draft, setDraft] = useState<RoundDraft>(() => (round ? draftOfRound(round) : BLANK))
  const [submitted, setSubmitted] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<RoundField, boolean>>>({})
  const [serverError, setServerError] = useState<{ field: RoundField; message: string } | null>(null)
  const [problem, setProblem] = useState<WriteProblem | null>(null)

  // A new round is validated as a whole; an edit only checks (and sends) the fields that changed.
  const created = round ? null : validateRoundDraft(draft)
  const edited = round ? validateRoundEdit(draft, round) : null
  const checked = created ?? edited
  const valid = checked?.ok === true
  const errors: Partial<Record<RoundField, string>> = checked && !checked.ok ? checked.errors : {}
  const dirty = edited ? edited.ok && Object.keys(edited.value).length > 0 : true

  const update = <K extends keyof RoundDraft>(field: K, value: RoundDraft[K]): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setTouched((current) => ({ ...current, [field === 'dateTbd' ? 'date' : (field as RoundField)]: true }))
    setServerError(null)
    setProblem(null)
  }
  const show = (field: RoundField): string | null => (serverError?.field === field ? serverError.message : submitted || touched[field] ? (errors[field] ?? null) : null)

  const refresh = (): void => {
    invalidateCalendar(guildId)
    onClose()
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    if (!valid || !dirty) return
    setProblem(null)
    setServerError(null)
    const outcome = await write.run(() => {
      if (round && edited?.ok) return unwrap(window.nexus.api.updateRound(guildId, round.round, edited.value))
      if (created?.ok) return unwrap(window.nexus.api.createRound(guildId, created.value))
      return Promise.reject(new Error('The form is not valid.'))
    })
    if (!outcome) return
    if (outcome.ok) {
      invalidateCalendar(guildId)
      toast.push({ tone: 'success', title: editing ? 'Round saved' : 'Round added', message: `Round ${outcome.value.round.round} - ${outcome.value.round.name}` })
      onClose()
      return
    }
    const field = fieldErrorFor(outcome.error, FIELD_OF_CODE)
    if (field) setServerError(field)
    else setProblem(writeProblem(outcome.error, editing ? 'The change' : 'Adding the round'))
  }

  return (
    <Modal open title={editing ? `Edit round ${round.round}` : 'Add a round'} dismissible={!write.busy} onClose={onClose}>
      <form className="stack stack--tight" onSubmit={(event) => void save(event)} noValidate aria-label={editing ? 'Edit round' : 'Add a round'}>
        <TextField
          label="Race name"
          value={draft.name}
          maxLength={ROUND_LIMITS.nameMax}
          placeholder="Australian GP"
          error={show('name')}
          autoComplete="off"
          onChange={(event) => update('name', event.target.value)}
        />

        <div className="field-pair">
          <TextField
            label="Date"
            value={draft.dateTbd ? '' : draft.date}
            placeholder={draft.dateTbd ? 'TBD' : 'DD/MM/YYYY'}
            disabled={draft.dateTbd}
            hint="Day/month/year, for example 15/03/2026."
            error={show('date')}
            autoComplete="off"
            inputMode="numeric"
            onChange={(event) => update('date', event.target.value)}
          />
          <TextField
            label="Time"
            optional
            value={draft.time}
            placeholder="19:30"
            hint="24-hour HH:MM. Empty shows TBD."
            error={show('time')}
            autoComplete="off"
            inputMode="numeric"
            onChange={(event) => update('time', event.target.value)}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={draft.dateTbd} onChange={(event) => update('dateTbd', event.target.checked)} />
          <span>Date to be decided (TBD)</span>
        </label>

        <div className="field-pair">
          <Select
            label="Event type"
            value={draft.eventType}
            options={EVENT_TYPES.map((type) => ({ value: type, label: type }))}
            error={show('eventType')}
            onChange={(value) => update('eventType', value)}
          />
          <TextField
            label="Flag"
            optional
            value={draft.flag}
            placeholder="NL"
            hint={`Up to ${ROUND_LIMITS.flagMax} characters: a flag emoji or a country code.`}
            error={show('flag')}
            autoComplete="off"
            onChange={(event) => update('flag', event.target.value)}
          />
        </div>

        {editing ? (
          <p className="muted">
            This is round {round.round}. The number cannot be changed; to renumber, delete the round and add it again with the number you want.
          </p>
        ) : (
          <TextField
            label="Round number"
            optional
            value={draft.round}
            placeholder="Next free number"
            hint="Leave empty to use the highest number plus one. Enter a number to fill a gap left by a deleted round."
            error={show('round')}
            autoComplete="off"
            inputMode="numeric"
            onChange={(event) => update('round', event.target.value)}
          />
        )}

        <WriteProblemNotice problem={problem} onRefresh={refresh} refreshLabel="Refresh the calendar" />

        <div className="dialog-actions">
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={write.busy} disabled={editing && !dirty}>
            {editing ? 'Save round' : 'Add round'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
