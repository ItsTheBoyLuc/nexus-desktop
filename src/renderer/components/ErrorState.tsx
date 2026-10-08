import { RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from './Button'

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <div className="state state--error" role="alert">
      <div className="state__icon">
        <TriangleAlert size={24} aria-hidden="true" />
      </div>
      <h2 className="state__title">{title}</h2>
      <p className="state__text">{message}</p>
      {onRetry ? (
        <div className="state__actions">
          <Button variant="secondary" icon={<RotateCw size={16} aria-hidden="true" />} onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  )
}
