import type { ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  /** Say exactly what will be removed or changed, by name. */
  children: ReactNode
  confirmLabel: string
  /** A request is running: the buttons show it and nothing can be closed or sent twice. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmation for destructive actions. The confirm button is the only way forward; Escape,
 * the overlay and Cancel all back out, and none of them work while the request is running.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      dismissible={!busy}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
