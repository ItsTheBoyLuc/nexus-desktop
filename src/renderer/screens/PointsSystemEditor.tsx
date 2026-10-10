import { RotateCcw, Save } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { draftOfPoints, pointsChanged, POINTS_LIMITS, validatePointsDraft } from '../../shared/f1Validation'
import type { PointsDraft, PointsField } from '../../shared/f1Validation'
import type { PointsSystem } from '../../shared/types'
import { Badge, Button, Card, ErrorState, LoadingRegion, Notice, Skeleton, TextField, useToast, WriteProblemNotice } from '../components'
import { usePointsSystem } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, fieldErrorFor, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { invalidatePointsSystem } from '../lib/invalidation'

interface EditorProps {
  guildId: string
  system: PointsSystem
  denied: boolean
  onDenied: () => void
  onCheckAgain: () => void
}

const SERVER_FIELDS = { invalid_pole: 'pole', invalid_fastest_lap: 'fastestLap' } as const satisfies Record<string, PointsField>

function PointsForm({ guildId, system, denied, onDenied, onCheckAgain }: EditorProps) {
  const toast = useToast()
  const write = useWriteAction()
  const [draft, setDraft] = useState<PointsDraft>(() => draftOfPoints(system))
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<{ field: PointsField; message: string } | null>(null)
  const [problem, setProblem] = useState<WriteProblem | null>(null)

  const result = validatePointsDraft(draft)
  const errors: Partial<Record<PointsField, string>> = result.ok ? {} : result.errors
  const dirty = result.ok ? pointsChanged(result.value, system) : JSON.stringify(draft) !== JSON.stringify(draftOfPoints(system))
  const show = (field: PointsField, value: string, original: string): string | null =>
    serverError?.field === field ? serverError.message : submitted || value !== original ? (errors[field] ?? null) : null

  const original = draftOfPoints(system)
  const setPoints = (index: number, value: string): void => {
    setDraft((current) => ({ ...current, points: current.points.map((entry, position) => (position === index ? value : entry)) }))
    setServerError(null)
    setProblem(null)
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    if (!result.ok || !dirty || denied) return
    setProblem(null)
    setServerError(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.savePointsSystem(guildId, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidatePointsSystem(guildId)
      toast.push({ tone: 'success', title: 'Points system saved', message: 'It applies to races recorded from now on.' })
      return
    }
    if (errorCode(outcome.error) === 'fia_required') {
      onDenied()
      setDraft(draftOfPoints(system)) // read-only now: show what is really stored
      return
    }
    const field = fieldErrorFor(outcome.error, SERVER_FIELDS)
    if (field) setServerError(field)
    else setProblem(writeProblem(outcome.error, 'The change'))
  }

  return (
    <form className="stack" onSubmit={(event) => void save(event)} noValidate aria-label="Points system">
      <Notice tone="info">
        The points system decides how many points each finishing position, the pole and the fastest lap give when a race is recorded from now on. Races that were already recorded are not recalculated: the server only keeps running totals.
      </Notice>
      {denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={onCheckAgain}>Check again</Button>}>
          Only members with the FIA role, or server administrators, can change the points system. The values below are read-only. If your roles changed, choose Check again.
        </Notice>
      ) : null}

      <Card className="stack">
        <div className="section-head">
          <h2 className="section-title">Points per finishing position</h2>
          {system.isDefault ? <Badge>Built-in defaults in use: nothing saved yet</Badge> : <Badge tone="primary">Custom points system</Badge>}
        </div>
        <fieldset className="points-grid">
          <legend className="sr-only">Points for positions 1 to 20</legend>
          {draft.points.map((value, index) => (
            <TextField
              key={index}
              label={`P${index + 1}`}
              value={value}
              inputMode="numeric"
              readOnly={denied}
              error={show(`p${index + 1}`, value, original.points[index] ?? '')}
              autoComplete="off"
              onChange={(event) => setPoints(index, event.target.value)}
            />
          ))}
        </fieldset>
        <div className="field-pair">
          <TextField
            label="Pole position bonus"
            value={draft.pole}
            inputMode="numeric"
            readOnly={denied}
            hint={`Whole number from ${POINTS_LIMITS.min} to ${POINTS_LIMITS.max}.`}
            error={show('pole', draft.pole, original.pole)}
            autoComplete="off"
            onChange={(event) => {
              setDraft((current) => ({ ...current, pole: event.target.value }))
              setServerError(null)
            }}
          />
          <TextField
            label="Fastest lap bonus"
            value={draft.fastestLap}
            inputMode="numeric"
            readOnly={denied}
            hint="Not given to the race winner."
            error={show('fastestLap', draft.fastestLap, original.fastestLap)}
            autoComplete="off"
            onChange={(event) => {
              setDraft((current) => ({ ...current, fastestLap: event.target.value }))
              setServerError(null)
            }}
          />
        </div>
        <p className="muted">All 20 positions are saved together. Enter 0 for a position that gives no points.</p>
      </Card>

      <WriteProblemNotice problem={problem} onRefresh={() => invalidatePointsSystem(guildId)} refreshLabel="Refresh" />

      <div className="form-actions form-actions--split">
        <Button
          variant="ghost"
          disabled={!dirty || write.busy}
          icon={<RotateCcw size={16} aria-hidden="true" />}
          onClick={() => {
            setDraft(draftOfPoints(system))
            setSubmitted(false)
            setServerError(null)
            setProblem(null)
          }}
        >
          Discard changes
        </Button>
        <Button type="submit" loading={write.busy} disabled={denied || !dirty} icon={<Save size={16} aria-hidden="true" />}>
          Save points system
        </Button>
      </div>
    </form>
  )
}

export function PointsSystemEditor(props: Omit<EditorProps, 'system'>) {
  const points = usePointsSystem(props.guildId)
  if (points.status === 'loading') {
    return (
      <LoadingRegion label="Loading the points system" className="stack">
        <Skeleton height={220} radius={12} />
      </LoadingRegion>
    )
  }
  if (points.status === 'error') return <ErrorState title="Could not load the points system" message={describeError(points.error)} onRetry={points.reload} />
  // Keyed by what the server holds: after a save and re-read the form is rebuilt from the stored values.
  return <PointsForm key={`${points.data.points.join(',')}|${points.data.pole}|${points.data.fastestLap}|${points.data.isDefault}`} system={points.data} {...props} />
}
