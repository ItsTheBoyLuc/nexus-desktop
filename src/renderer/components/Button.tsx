import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean
  icon?: ReactNode
  /** Square icon button: pass an aria-label. */
  iconOnly?: boolean
  block?: boolean
  /** Removes or undoes something (delete, remove, clear, ban): it never glows or lifts on hover, so it never looks like the inviting action. */
  destructive?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconOnly = false,
  block = false,
  destructive = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size === 'sm' ? 'btn--sm' : '',
    iconOnly ? 'btn--icon' : '',
    block ? 'btn--block' : '',
    destructive ? 'btn--destructive' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button {...rest} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}
