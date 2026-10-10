import { useState } from 'react'
import { DIVISION_LIMITS, findOverlap, validateDivisionDraft } from '../../shared/attendanceValidation'
import type { DivisionField } from '../../shared/attendanceValidation'
import type { AttendanceDivision, DivisionResult } from '../../shared/types'
import { Button, MemberListPicker, Modal, Notice, TextField, useToast, WriteProblemNotice } from '../components'
import type { Person } from '../components'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { invalidateAttendance } from '../lib/invalidation'

const LEFT = 'A member who left the server'

interface DivisionDialogProps {
  guildId: string
  /** The division to edit; null creates one. */
  division: AttendanceDivision | null
  onClose: () => void
}

/** What a driver who is in both lists means in Discord, said wherever the overlap is shown. */
export const OVERLAP_EXPLANATION =
  'A driver in both lists is marked Present automatically when a post is created, and the Present button in Discord then refuses them, because a reserve driver may only use Reserve. The command has no rule against it and neither does the API, so it is stored as you set it.'

/**
 * Create or edit a division (/f1 attendance-setup): the name and two lists of members, chosen by name. Only a list the user
 * edited is sent: the API keeps a list that is left out, so editing the reserve drivers can never change the regular ones
 * (and a list that was not touched is not even checked). After saving, `overlap` from the answer is shown by name.
 */
export function DivisionDialog({ guildId, division, onClose }: DivisionDialogProps) {
  const toast = useToast()
  const write = useWriteAction()
  const editing = division !== null

  const [name, setName] = useState(division?.name ?? '')
  const [regular, setRegular] = useState<string[]>(() => division?.regularDrivers.map((driver) => driver.userId) ?? [])
  const [reserve, setReserve] = useState<string[]>(() => division?.reserveDrivers.map((driver) => driver.userId) ?? [])
  const [regularEdited, setRegularEdited] = useState(false)
  const [reserveEdited, setReserveEdited] = useState(false)
  const [people, setPeople] = useState<Map<string, Person>>(() => new Map())
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<DivisionField, string>>>({})
  const [problem, setProblem] = useState<WriteProblem | null>(null)
  const [saved, setSaved] = useState<DivisionResult | null>(null)

  // Names the server already sent, then the people picked just now.
  const serverNames = new Map<string, string | null>([...(division?.regularDrivers ?? []), ...(division?.reserveDrivers ?? [])].map((driver) => [driver.userId, driver.name]))
  const nameOf = (id: string): string => people.get(id)?.displayName ?? serverNames.get(id) ?? LEFT
  const known = [...(division?.regularDrivers ?? []), ...(division?.reserveDrivers ?? [])].flatMap((driver): Person[] => (driver.name ? [{ id: driver.userId, displayName: driver.name, username: driver.name }] : []))

  const result = validateDivisionDraft({ name, regular, reserve, regularEdited, reserveEdited, exists: editing })
  const errors: Partial<Record<DivisionField, string>> = result.ok ? {} : result.errors
  const show = (field: DivisionField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const overlapNow = findOverlap(regular, reserve)

  const touch = (): void => {
    setServerErrors({})
    setProblem(null)
  }
  const rememberPerson = (person: Person): void => setPeople((current) => new Map(current).set(person.id, person))

  const save = async (): Promise<void> => {
    setSubmitted(true)
    if (!result.ok) return
    touch()
    const outcome = await write.run(() => unwrap(window.nexus.api.saveAttendanceDivision(guildId, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateAttendance(guildId)
      toast.push({ tone: 'success', title: outcome.value.created ? 'Division created' : 'Division saved', message: outcome.value.division.name })
      if (outcome.value.overlap.length > 0) setSaved(outcome.value)
      else onClose()
      return
    }
    const code = errorCode(outcome.error)
    if (code === 'member_not_found') setServerErrors({ lists: `${describeError(outcome.error)} Remove the member and pick them again; nothing was saved.` })
    else if (code === 'invalid_regular_drivers') setServerErrors({ regular: describeError(outcome.error) })
    else if (code === 'invalid_reserve_drivers') setServerErrors({ reserve: describeError(outcome.error) })
    else if (code === 'invalid_name') setServerErrors({ name: describeError(outcome.error) })
    else if (code === 'no_changes') setServerErrors({ lists: 'There is nothing to change: the division exists and neither list was edited.' })
    else setProblem(writeProblem(outcome.error, 'The save'))
  }

  if (saved) {
    const names = new Map([...saved.division.regularDrivers, ...saved.division.reserveDrivers].map((driver) => [driver.userId, driver.name ?? nameOf(driver.userId)]))
    return (
      <Modal key="overlap" open title="Some drivers are in both lists" onClose={onClose} footer={<Button data-autofocus onClick={onClose}>Close</Button>}>
        <Notice tone="warning">
          <strong>The division {saved.division.name} was saved, but {saved.overlap.length === 1 ? 'one driver is' : `${saved.overlap.length} drivers are`} in both the regular and the reserve list:</strong>
          <ul className="plain-list">
            {saved.overlap.map((id) => (
              <li key={id}>{names.get(id) ?? nameOf(id)}</li>
            ))}
          </ul>
        </Notice>
        <p>{OVERLAP_EXPLANATION}</p>
        <p className="muted">To fix it, edit the division and remove each of these drivers from one of the two lists.</p>
      </Modal>
    )
  }

  return (
    <Modal
      key="form"
      open
      title={editing ? `Edit the division ${division.name}` : 'Create a division'}
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={write.busy} onClick={() => void save()}>
            {editing ? 'Save the division' : 'Create the division'}
          </Button>
        </>
      }
    >
      <p className="muted">
        Like <code>/f1 attendance-setup</code>. <strong>Regular drivers</strong> are marked Present automatically when a post is created. <strong>Reserve drivers</strong> cannot use the Present button, only Reserve. Each list holds at most {DIVISION_LIMITS.listMax} drivers.
      </p>
      <TextField
        label="Division name"
        value={name}
        readOnly={editing}
        maxLength={DIVISION_LIMITS.nameMax}
        hint={editing ? 'The name of a division cannot be changed. Create a new division for another name.' : 'Case matters: Elite and elite are two divisions.'}
        error={show('name')}
        autoComplete="off"
        onChange={(event) => { setName(event.target.value); touch() }}
      />
      {editing ? <Notice tone="info">Only a list you change is saved. A list you do not touch keeps exactly what it has now, even if somebody changed it in Discord meanwhile.</Notice> : null}
      <div className="division-grid">
        <MemberListPicker
          label="Regular drivers"
          guildId={guildId}
          ids={regular}
          nameOf={nameOf}
          known={known}
          max={DIVISION_LIMITS.listMax}
          error={show('regular')}
          onAdd={(person) => { rememberPerson(person); setRegular((current) => [...current, person.id]); setRegularEdited(true); touch() }}
          onRemove={(id) => { setRegular((current) => current.filter((item) => item !== id)); setRegularEdited(true); touch() }}
        />
        <MemberListPicker
          label="Reserve drivers"
          guildId={guildId}
          ids={reserve}
          nameOf={nameOf}
          known={known}
          max={DIVISION_LIMITS.listMax}
          error={show('reserve')}
          onAdd={(person) => { rememberPerson(person); setReserve((current) => [...current, person.id]); setReserveEdited(true); touch() }}
          onRemove={(id) => { setReserve((current) => current.filter((item) => item !== id)); setReserveEdited(true); touch() }}
        />
      </div>
      {overlapNow.length > 0 ? (
        <Notice tone="warning">
          <strong>{overlapNow.map(nameOf).join(', ')} {overlapNow.length === 1 ? 'is' : 'are'} in both lists.</strong> {OVERLAP_EXPLANATION} You can still save.
        </Notice>
      ) : null}
      {show('lists') ? <Notice tone="danger">{show('lists')}</Notice> : null}
      <WriteProblemNotice problem={problem} onRefresh={() => { invalidateAttendance(guildId); onClose() }} refreshLabel="Close and refresh" />
    </Modal>
  )
}
