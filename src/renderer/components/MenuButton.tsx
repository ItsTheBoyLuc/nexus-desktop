import { Check } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface MenuItem {
  id: string
  label: string
  /** Leading visual (icon or avatar). */
  leading?: ReactNode
  selected?: boolean
  danger?: boolean
  onSelect: () => void
}

interface MenuButtonProps {
  /** Accessible name of the trigger button. */
  ariaLabel: string
  /** Visible content of the trigger. */
  children: ReactNode
  items: MenuItem[]
  placement?: 'bottom' | 'top'
  disabled?: boolean
  className?: string
  /** Shown instead of items when the list is empty. */
  emptyText?: string
}

/**
 * Button that opens a menu. Keyboard: Enter/Space/ArrowDown open it, arrows/Home/End move,
 * Enter/Space select, Escape closes and returns focus, leaving the menu closes it.
 */
export function MenuButton({ ariaLabel, children, items, placement = 'bottom', disabled, className, emptyText }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const menuItems = useCallback((): HTMLElement[] => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []), [])

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const nodes = menuItems()
    const selected = nodes.find((node) => node.getAttribute('aria-current') === 'true')
    ;(selected ?? nodes[0])?.focus()

    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, menuItems])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const nodes = menuItems()
    const index = nodes.indexOf(document.activeElement as HTMLElement)
    const focusAt = (next: number): void => {
      event.preventDefault()
      nodes[(next + nodes.length) % nodes.length]?.focus()
    }
    switch (event.key) {
      case 'ArrowDown':
        return focusAt(index + 1)
      case 'ArrowUp':
        return focusAt(index - 1)
      case 'Home':
        return focusAt(0)
      case 'End':
        return focusAt(nodes.length - 1)
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        return close(true)
      case 'Tab':
        return close(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={['menu', className ?? ''].filter(Boolean).join(' ')}
      onBlur={(event) => {
        if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="menu__trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {children}
      </button>
      {open ? (
        <div id={menuId} role="menu" tabIndex={-1} aria-label={ariaLabel} className={`menu__list menu__list--${placement}`} onKeyDown={onMenuKeyDown}>
          {items.length === 0 ? <div className="menu__empty">{emptyText ?? 'Nothing to show'}</div> : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              aria-current={item.selected ? 'true' : undefined}
              className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
              onClick={() => {
                close(true)
                item.onSelect()
              }}
            >
              {item.leading}
              <span className="menu__label">{item.label}</span>
              {item.selected ? <Check size={16} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
