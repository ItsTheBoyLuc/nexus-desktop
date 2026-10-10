import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IpcResult } from '../../shared/types'
import { Button, Modal, Notice } from '../components'
import { useWriteAction } from '../hooks/useWriteAction'
import { invalidatePenalties } from '../lib/invalidation'
import { runAction } from '../lib/penaltyActions'

interface ActionShellProps<T> {
  title: string
  confirmTitle: string
  confirmLabel: string
  /** The form fields. */
  form: ReactNode
  /** Validates the form. Returns what the confirm step shows, or null when something is wrong (the form then shows it). */
  review: () => ReactNode | null
  /** Sends the one request (it is only ever called from the confirm step). */
  send: () => Promise<IpcResult<T>>
  onDone: (value: T) => void
  onClose: () => void
  guildId: string
  /** A server-side field error to show in the form again. */
  onField: (field: string, message: string) => void
  /** The server said the role is missing (`fia` for clear, bans and advance race). */
  onDenied: () => void
  /** The role was refused earlier: the action stays off. */
  deniedMessage: string | null
  onOpenPenaltySettings: () => void
}

type Step = 'form' | 'confirm' | 'lost'

/**
 * The frame of every destructive penalty action: the form, then a confirm dialog that names the driver, the season and
 * the effect, then ONE request. Everything the server can answer is handled the same way (see lib/penaltyActions.ts):
 * a missing role switches the action off, "not configured" and "no record" prove nothing changed, and a lost answer
 * means it may have happened, so the dialog never offers to send it again.
 */
export function ActionShell<T>({ title, confirmTitle, confirmLabel, form, review, send, onDone, onClose, guildId, onField, onDenied, deniedMessage, onOpenPenaltySettings }: ActionShellProps<T>) {
  const write = useWriteAction()
  const [step, setStep] = useState<Step>('form')
  const [confirmBody, setConfirmBody] = useState<ReactNode>(null)
  const [message, setMessage] = useState<{ tone: 'danger'; text: ReactNode } | null>(null)

  const goReview = (): void => {
    setMessage(null)
    const body = review()
    if (body === null) return
    setConfirmBody(body)
    setStep('confirm')
  }

  const confirm = async (): Promise<void> => {
    setMessage(null)
    const outcome = await write.run(() => runAction(send))
    if (!outcome || !outcome.ok) return
    const run = outcome.value
    switch (run.kind) {
      case 'done':
        onDone(run.value)
        return
      case 'denied':
        if (run.role === 'fia') onDenied()
        setMessage({ tone: 'danger', text: run.role === 'fia' ? 'The server refused: only members with the FIA role, or server administrators, can do this. Nothing was changed.' : 'The server refused: only server administrators can do this. Nothing was changed.' })
        setStep('form')
        return
      case 'not_configured':
        setMessage({
          tone: 'danger',
          text: (
            <>
              <strong>The penalty rules have not been set up yet, so nothing was changed.</strong> Save the Penalty settings first (an Administrator is needed for that).{' '}
              <Button variant="secondary" size="sm" onClick={onOpenPenaltySettings}>
                Open Penalty settings
              </Button>
            </>
          )
        })
        setStep('form')
        return
      case 'not_found':
        setMessage({ tone: 'danger', text: `${run.message} Nothing was changed.` })
        setStep('form')
        return
      case 'field':
        onField(run.field, run.message)
        setStep('form')
        return
      case 'lost':
        invalidatePenalties(guildId) // the overview is read again behind this dialog
        setStep('lost')
        return
      case 'refused':
        setMessage({ tone: 'danger', text: run.message })
        return
    }
  }

  if (step === 'lost') {
    return (
      <Modal key="lost" open title="No clear answer" onClose={onClose} footer={<Button data-autofocus icon={<RotateCw size={14} aria-hidden="true" />} onClick={onClose}>Close and check the overview</Button>}>
        <Notice tone="danger">
          Nexus did not get a clear answer from the server, so <strong>this action may already have been carried out</strong>. It is not sent again from here. The penalty overview behind this window was just read again: look at it before you decide anything else.
        </Notice>
      </Modal>
    )
  }

  return (
    <Modal
      key={step}
      open
      title={step === 'form' ? title : confirmTitle}
      size="lg"
      dismissible={!write.busy}
      onClose={onClose}
      footer={
        step === 'form' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={deniedMessage !== null} onClick={goReview}>
              Review
            </Button>
          </>
        ) : (
          <>
            {/* Back is the default focus: Enter never confirms a destructive action by accident. */}
            <Button variant="secondary" data-autofocus disabled={write.busy} onClick={() => setStep('form')}>
              Back
            </Button>
            <Button loading={write.busy} onClick={() => void confirm()}>
              {confirmLabel}
            </Button>
          </>
        )
      }
    >
      {deniedMessage ? <Notice tone="danger">{deniedMessage}</Notice> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {step === 'form' ? form : confirmBody}
    </Modal>
  )
}
