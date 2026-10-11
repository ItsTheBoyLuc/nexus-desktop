import { CircleAlert, Info, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from '../theme/tokens'
import { SuccessMark } from './SuccessMark'

export type ToastTone = 'info' | 'success' | 'danger'

interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  message?: string
}

interface ToastApi {
  push: (toast: { tone?: ToastTone; title: string; message?: string }) => void
}

const ToastContext = createContext<ToastApi | null>(null)
/** Same token as the progress bar (--motion-toast), so the bar runs out exactly when the toast goes. */
const AUTO_DISMISS_MS = Number.parseInt(motion.toast, 10)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), [])
  const push = useCallback<ToastApi['push']>(({ tone = 'info', title, message }) => {
    const id = nextId.current++
    setItems((current) => [...current.slice(-3), { id, tone, title, message }])
  }, [])
  const api = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-region">
          {items.map((item) => (
            <ToastView key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [item.id, onDismiss])

  const Icon = item.tone === 'danger' ? CircleAlert : Info
  return (
    <div className={`toast toast--${item.tone}`} role={item.tone === 'danger' ? 'alert' : 'status'}>
      {item.tone === 'success' ? <SuccessMark className="toast__icon" size={18} /> : <Icon className="toast__icon" size={18} aria-hidden="true" />}
      <div className="toast__body">
        <div className="toast__title">{item.title}</div>
        {item.message ? <div className="toast__message">{item.message}</div> : null}
      </div>
      <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="Dismiss notification" onClick={() => onDismiss(item.id)}>
        <X size={16} aria-hidden="true" />
      </button>
      <span className="toast__progress" aria-hidden="true" />
    </div>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
