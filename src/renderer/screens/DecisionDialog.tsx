import { Gavel } from 'lucide-react'
import { useState } from 'react'
import { DECISION_LIMITS, validateDecisionDraft } from '../../shared/penaltyValidation'
import type { DecisionDraft, DecisionField } from '../../shared/penaltyValidation'
import type { DecisionInput, Report } from '../../shared/types'
import { Button, Modal, Notice, TextField } from '../components'
import { usePenaltySettings } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import type { DecisionRun } from '../lib/decisionFlow'
import { describeEffects, runDecision } from '../lib/decisionFlow'
import { splitDrivers } from '../lib/reportView'

/** What the dialog hands to the report screen: everything except the failures it explains itself (blocked, field errors, refusals). */
export type DecisionFinish = Extract<DecisionRun, { kind: 'decided' | 'already_decided' | 'message_not_found' | 'points_failed' | 'lost' }>

interface DecisionDialogProps {
  guildId: string
  report: Report
  onClose: () => void
  onFinished: (run: DecisionFinish) => void
  onOpenPenaltySettings: () => void
}

type Step = 'form' | 'confirm'

const FIELD_LABELS: Record<DecisionField, string> = { description: 'Description', explanation: 'Explanation', driver: 'Driver', points: 'Penalty points', season: 'Season' }

/**
 * "Penalty issued" or "No further action". Two steps: the form, then a confirmation that names the report and says what
 * happens in Discord. The decision is sent ONCE (see lib/decisionFlow.ts): a lost answer, penalty_points_failed,
 * already_decided and report_message_not_found are handed to the report screen, which explains them and refreshes; the
 * dialog itself only deals with what leaves the report untouched (rules not set up, a field the server rejects, a refusal).
 */
export function DecisionDialog({ guildId, report, onClose, onFinished, onOpenPenaltySettings }: DecisionDialogProps) {
  const write = useWriteAction()
  const settings = usePenaltySettings(guildId)

  const [step, setStep] = useState<Step>('form')
  const [draft, setDraft] = useState<DecisionDraft>({ decision: 'penalty_issued', description: '', explanation: '', driver: '', points: '0', season: '' })
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<DecisionField, string>>>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [blockedByServer, setBlockedByServer] = useState(false)

  const result = validateDecisionDraft(draft)
  const errors: Partial<Record<DecisionField, string>> = result.ok ? {} : result.errors
  const show = (field: DecisionField): string | null => serverErrors[field] ?? (submitted ? (errors[field] ?? null) : null)
  const wantsPoints = draft.decision === 'penalty_issued' && Number(draft.points.trim() === '' ? '0' : draft.points) > 0
  // The server is the authority; reading the settings first only avoids a decision that is certain to be refused.
  const notConfigured = wantsPoints && ((settings.status === 'ready' && !settings.data.configured) || blockedByServer)
  const suggestions = splitDrivers(report.driversInvolved)

  const change = (patch: Partial<DecisionDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
    setServerErrors({})
    setRefusal(null)
    setBlockedByServer(false)
  }

  const review = (): void => {
    setSubmitted(true)
    if (result.ok && !notConfigured) setStep('confirm')
  }

  const send = async (input: DecisionInput): Promise<void> => {
    setRefusal(null)
    const outcome = await write.run(() => runDecision(window.nexus.api, guildId, report, input))
    if (!outcome || !outcome.ok) return
    const run = outcome.value
    switch (run.kind) {
      case 'decided':
      case 'already_decided':
      case 'message_not_found':
      case 'points_failed':
      case 'lost':
        onFinished(run)
        return
      case 'penalty_not_configured':
        setBlockedByServer(true)
        setStep('form')
        return
      case 'field':
        setServerErrors({ [run.field]: run.message })
        setStep('form')
        return
      case 'refused':
        setRefusal(run.message)
        return
    }
  }

  return (
    <Modal
      key={step}
      open
      title={step === 'form' ? `Decide report #${report.number} (${report.roundKey})` : `Confirm the decision on report #${report.number}`}
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        step === 'form' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button icon={<Gavel size={16} aria-hidden="true" />} disabled={notConfigured} onClick={review}>
              Review decision
            </Button>
          </>
        ) : (
          <>
            {/* Back is the default focus: Enter never decides a report by accident. */}
            <Button variant="secondary" data-autofocus disabled={write.busy} onClick={() => setStep('form')}>
              Back to editing
            </Button>
            <Button loading={write.busy} onClick={() => result.ok && void send(result.value)}>
              Confirm decision
            </Button>
          </>
        )
      }
    >
      {step === 'form' ? (
        <>
          <p className="muted">
            {report.circuit}, drivers involved: {report.driversInvolved || 'not given'}. Deciding updates the report message in Discord and removes its buttons.
          </p>
          <fieldset className="choice-group">
            <legend className="field__label">Decision</legend>
            <div className="choice">
              <input type="radio" id="decision-penalty" name="decision" checked={draft.decision === 'penalty_issued'} onChange={() => change({ decision: 'penalty_issued' })} />
              <label htmlFor="decision-penalty">
                Penalty issued
                <span className="choice__note">A penalty, with or without penalty points.</span>
              </label>
            </div>
            <div className="choice">
              <input type="radio" id="decision-nfa" name="decision" checked={draft.decision === 'no_further_action'} onChange={() => change({ decision: 'no_further_action' })} />
              <label htmlFor="decision-nfa">
                No further action
                <span className="choice__note">Nobody is penalised. An explanation is required.</span>
              </label>
            </div>
          </fieldset>

          {draft.decision === 'no_further_action' ? (
            <TextField multiline label="Explanation" rows={5} value={draft.explanation} maxLength={DECISION_LIMITS.textMax} hint="Shown in the Discord report message. The app cannot show it again later." error={show('explanation')} onChange={(event) => change({ explanation: event.target.value })} />
          ) : (
            <>
              <TextField multiline label="Description of the penalty" rows={3} value={draft.description} maxLength={DECISION_LIMITS.textMax} placeholder="5 second time penalty" error={show('description')} onChange={(event) => change({ description: event.target.value })} />
              <div className="field-pair">
                <TextField label="Penalty points" inputMode="numeric" value={draft.points} hint={`0 to ${DECISION_LIMITS.pointsMax}. 0 = no points.`} error={show('points')} autoComplete="off" onChange={(event) => change({ points: event.target.value })} />
                <TextField label="Season" optional inputMode="numeric" value={draft.season} placeholder="From the report" hint="Empty: the season in the report's title, else the current season." error={show('season')} autoComplete="off" onChange={(event) => change({ season: event.target.value })} />
              </div>
              <TextField
                label="Driver who receives the points"
                optional={!wantsPoints}
                value={draft.driver}
                maxLength={DECISION_LIMITS.driverMax}
                hint={wantsPoints ? 'Required: the points are saved under this name.' : 'Only needed when penalty points are given.'}
                error={show('driver')}
                autoComplete="off"
                onChange={(event) => change({ driver: event.target.value })}
              />
              {suggestions.length > 0 ? (
                <div className="chip-row" role="group" aria-label="Drivers named in the report">
                  <span className="muted">Named in the report:</span>
                  {suggestions.map((name) => (
                    <Button key={name} variant="secondary" size="sm" onClick={() => change({ driver: name })}>
                      {name}
                    </Button>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {notConfigured ? (
            <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={onOpenPenaltySettings}>Open Penalty settings</Button>}>
              <strong>The penalty rules have not been set up yet, so a penalty with points cannot be decided.</strong> Nothing was changed. Save the Penalty settings first (that needs the Administrator permission), or set the penalty points to 0 to decide without points.
            </Notice>
          ) : null}
        </>
      ) : (
        <>
          <p>
            You are about to decide <strong>report #{report.number}</strong> of <strong>{report.roundKey}</strong> ({report.circuit}), filed by {report.reporter || 'a driver'}, about {report.driversInvolved || 'the drivers involved'}.
          </p>
          {result.ok ? (
            <>
              <div className="preview">
                <div className="preview__title">{result.value.decision === 'penalty_issued' ? 'Penalty issued' : 'No further action'}</div>
                <div className="preview__message">{result.value.decision === 'penalty_issued' ? result.value.description : result.value.explanation}</div>
              </div>
              <h3 className="section-title">What happens in Discord</h3>
              <ul className="plain-list">
                {describeEffects(report, result.value).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Notice tone="warning">
                A decision <strong>cannot be undone from the app</strong>. It is sent once: if the answer gets lost, the app will not send it again; you refresh the report and look.
              </Notice>
            </>
          ) : null}
          {refusal ? <Notice tone="danger">{refusal}</Notice> : null}
        </>
      )}
      {Object.keys(serverErrors).length > 0 && step === 'form' ? (
        <Notice tone="danger">The server did not accept: {Object.keys(serverErrors).map((field) => FIELD_LABELS[field as DecisionField]).join(', ')}. Nothing was changed.</Notice>
      ) : null}
    </Modal>
  )
}
