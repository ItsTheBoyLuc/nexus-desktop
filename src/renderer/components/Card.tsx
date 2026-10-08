import type { ButtonHTMLAttributes, HTMLAttributes, Ref } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean
}

export function Card({ elevated = false, className, ...rest }: CardProps) {
  return <div {...rest} className={['card', elevated ? 'card--elevated' : '', className ?? ''].filter(Boolean).join(' ')} />
}

interface CardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>
}

/**
 * A whole card that is one button (server tiles, game tiles). Uses aria-disabled rather
 * than `disabled` for unavailable items so they stay focusable and can explain themselves.
 */
export function CardButton({ className, onClick, 'aria-disabled': ariaDisabled, type = 'button', ...rest }: CardButtonProps) {
  const unavailable = ariaDisabled === true || ariaDisabled === 'true'
  return (
    <button
      {...rest}
      type={type}
      aria-disabled={unavailable || undefined}
      onClick={unavailable ? undefined : onClick}
      className={['card', unavailable ? 'card--disabled' : 'card--interactive', className ?? ''].filter(Boolean).join(' ')}
    />
  )
}
