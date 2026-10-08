import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  /** Leading visual, e.g. a server avatar. */
  leading?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, description, leading, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      {leading}
      <div className="page-header__text">
        <h1>{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  )
}
