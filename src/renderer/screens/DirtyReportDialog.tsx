import { useId, useState } from 'react'
import { DIRTY_LIMITS, validateDirtyReportDraft } from '../../shared/penaltyValidation'
import type { DirtyReportDraft, DirtyReportField } from '../../shared/penaltyValidation'
import { Button, Modal, Notice, TextField, useToast } from '../components'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, fieldErrorFor, outcomeUnknown, unwrap } from '../lib/errors'
import { invalidateDirty } from '../lib/invalidation'

const SERVER_FIELDS = {
  invalid_driver: 'driver',
  invalid_reason: 'reason',
  invalid_evidence_url: 'evidenceUrl',
  invalid_related_incident: 'relatedIncident'
} as const satisfies Record<string, DirtyReportField>

interface Props {
  guildId: string
  /** Set when opened from a driver's page. */
  driver?: string
  /** Drivers already on the list, suggested while typing. */
  suggestions: readonly string[]
  onClose: () => void
  onAdded: (driverName: string) => void
}

/**
 * Add a dirty-driver report (/league report-driver). Staff only; the reporter is the signed-in staff member, set by the
 * server. Sent once: after a lost answer the form locks, because a second send would file the report twice.
 */
export function DirtyReportDialog({ guildId, driver = '', suggestions, onClose, onAdded }: Props) {
  const toast = useToast()
  const write = useWriteAction()
  const listId = useId()
  const [draft, setDraft] = useState<DirtyReportDraft>({ driver, reason: '', evidenceUrl: '', relatedIncident: '' })
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<{ field: DirtyReportField; message: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [lost, setLost] = useState(false)

  const result = validateDirtyReportDraft(draft)
  const errors: Partial<Record<DirtyReportField, string>> = result.ok ? {} : result.errors
  const show = (field: DirtyReportField): string | null => (serverError?.field === field ? serverError.message : submitted ? (errors[field] ?? null) : null)
  const change = (field: DirtyReportField, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerError(null)
    setProblem(null)
  }

  const submit = async (): Promise<void> => {
    setSubmitted(true)
    if (!result.ok || lost) return
    const outcome = await write.run(() => unwrap(window.nexus.api.addDirtyReport(guildId, result.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateDirty(guildId)
      toast.push({ tone: 'success', title: 'Report added', message: `${outcome.value.displayName} now has ${outcome.value.totalReports} ${outcome.value.totalReports === 1 ? 'report' : 'reports'}.` })
      onAdded(outcome.value.displayName)
      onClose()
      return
    }
    if (outcomeUnknown(outcome.error)) {
      invalidateDirty(guildId)
      setLost(true)
      return
    }
    const field = fieldErrorFor(outcome.error, SERVER_FIELDS)
    if (field) setServerError(field)
    else setProblem(describeError(outcome.error))
  }

  return (
    <Modal
      open
      title="Add a dirty-driver report"
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={write.busy} disabled={lost} onClick={() => void submit()}>
            Add report
          </Button>
        </>
      }
    >
      <Notice tone="info">This report is private to the server&apos;s staff. It is filed under your Discord name, and it adds to the &quot;Reported&quot; flag in the penalty overview.</Notice>
      {lost ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={onClose}>Close and check the list</Button>}>
          Nexus did not get a clear answer, so <strong>the report may already have been filed</strong>. It is not sent again from here (it would be filed twice). The list was just read again: look at the driver&apos;s reports before you add anything.
        </Notice>
      ) : null}
      <TextField
        label="Driver"
        value={draft.driver}
        readOnly={driver !== ''}
        list={suggestions.length > 0 && driver === '' ? listId : undefined}
        maxLength={DIRTY_LIMITS.driverMax}
        hint="The driver's name as the league uses it: the server groups reports by name (ignoring case)."
        error={show('driver')}
        autoComplete="off"
        onChange={(event) => change('driver', event.target.value)}
      />
      {suggestions.length > 0 && driver === '' ? (
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}
      <TextField multiline label="Reason" rows={4} value={draft.reason} maxLength={DIRTY_LIMITS.reasonMax} error={show('reason')} onChange={(event) => change('reason', event.target.value)} />
      <TextField
        label="Evidence link"
        type="url"
        inputMode="url"
        value={draft.evidenceUrl}
        maxLength={DIRTY_LIMITS.evidenceMax}
        placeholder="https://"
        hint="A link to the clip or message. https is best: the app only opens https links."
        error={show('evidenceUrl')}
        autoComplete="off"
        onChange={(event) => change('evidenceUrl', event.target.value)}
      />
      <TextField label="Related incident" optional value={draft.relatedIncident} maxLength={DIRTY_LIMITS.incidentMax} placeholder="Race 5 - Silverstone" error={show('relatedIncident')} autoComplete="off" onChange={(event) => change('relatedIncident', event.target.value)} />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
    </Modal>
  )
}
