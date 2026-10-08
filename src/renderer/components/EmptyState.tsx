import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="state">
      {icon ? <div className="state__icon">{icon}</div> : null}
      <h2 className="state__title">{title}</h2>
      {description ? <p className="state__text">{description}</p> : null}
      {action ? <div className="state__actions">{action}</div> : null}
    </div>
  )
}
