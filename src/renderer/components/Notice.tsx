import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success'

interface NoticeProps {
  tone?: NoticeTone
  children: ReactNode
  /** Optional action, e.g. a retry button. */
  action?: ReactNode
}

const ICONS = { info: Info, warning: TriangleAlert, danger: CircleAlert, success: CircleCheck } as const

/**
 * Inline message box. Errors use role="alert" so screen readers announce them immediately.
 * `warning` is "this will not do what you might expect": red-outlined (the palette has no yellow).
 */
export function Notice({ tone = 'info', children, action }: NoticeProps) {
  const Icon = ICONS[tone]
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" className="notice__icon" />
      <div className="notice__body">{children}</div>
      {action ? <div className="notice__action">{action}</div> : null}
    </div>
  )
}
