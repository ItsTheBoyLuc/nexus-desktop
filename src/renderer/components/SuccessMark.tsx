interface SuccessMarkProps {
  size?: number
  className?: string
}

/**
 * The check mark of a finished write. The ring and the tick draw themselves once (stroke-dashoffset, see motion.css). It is only ever
 * rendered by a success state or a success toast, which the screens reach after the server confirmed the write: never after an
 * error, and never after an answer that was lost.
 */
export function SuccessMark({ size = 18, className }: SuccessMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={['success-mark', className ?? ''].filter(Boolean).join(' ')}>
      <circle className="success-mark__ring" cx="12" cy="12" r="10" pathLength={1} />
      <path className="success-mark__tick" d="M7.5 12.5 L10.5 15.5 L16.5 9" pathLength={1} />
    </svg>
  )
}
