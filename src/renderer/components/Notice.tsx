import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { SuccessMark } from './SuccessMark'

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success'

interface NoticeProps {
  tone?: NoticeTone
  children: ReactNode
  /** Optional action, e.g. a retry button. */
  action?: ReactNode
}

const ICONS = { info: Info, warning: TriangleAlert, danger: CircleAlert } as const

function NoticeIcon({ tone }: { tone: Exclude<NoticeTone, 'success'> }) {
  const Icon = ICONS[tone]
  return <Icon size={18} aria-hidden="true" className="notice__icon" />
}

/**
 * Inline message box. Errors use role="alert" so screen readers announce them immediately.
 * `warning` is "this will not do what you might expect": red-outlined (the palette has no yellow).
 */
export function Notice({ tone = 'info', children, action }: NoticeProps) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {tone === 'success' ? <SuccessMark size={18} className="notice__icon" /> : <NoticeIcon tone={tone} />}
      <div className="notice__body">{children}</div>
      {action ? <div className="notice__action">{action}</div> : null}
    </div>
  )
}
