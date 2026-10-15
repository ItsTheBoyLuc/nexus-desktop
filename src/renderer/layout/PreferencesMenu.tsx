import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { UpdateBadge, UpdatePanel } from '../components'
import { useSettings } from '../hooks/settings'

/** True when the operating system asks for reduced motion (the stylesheet honours it on its own; this only explains it to the user). */
function systemReducesMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * The small Preferences popover of the sidebar. For now it holds one switch, "Reduce animations", which is saved in the settings
 * file (the only thing the motion layer stores). Keyboard: Enter or Space opens it and puts focus on the switch, Escape closes it and
 * gives focus back to the button, and moving focus out of it closes it.
 */
export function PreferencesMenu() {
  const { settings, setReduceMotion } = useSettings()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const switchRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const hintId = useId()
  const system = systemReducesMotion()

  useEffect(() => {
    if (!open) return
    switchRef.current?.focus()
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      ref={rootRef}
      className="prefs"
      onBlur={(event) => {
        // Closes when focus moves to something outside (Tab). A click on the label text or the track moves focus to nothing for a
        // moment (relatedTarget null) before the click reaches the switch, so that case must not close it; clicks outside are handled below.
        const next = event.relatedTarget as Node | null
        if (open && next && !rootRef.current?.contains(next)) setOpen(false)
      }}
    >
      <button ref={triggerRef} type="button" className="btn btn--ghost btn--sm prefs__trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        Preferences
        <UpdateBadge />
      </button>
      {open ? (
        <div id={panelId} role="dialog" aria-label="Preferences" className="prefs__panel popover">
          <div className="switch">
            <label className="switch__control">
              <input ref={switchRef} type="checkbox" role="switch" className="switch__input" checked={settings.reduceMotion} aria-describedby={hintId} onKeyDown={onKeyDown} onChange={(event) => setReduceMotion(event.target.checked)} />
              <span className="switch__track" aria-hidden="true">
                <span className="switch__thumb" />
              </span>
              <span className="switch__label">Reduce animations</span>
            </label>
            <span id={hintId} className="switch__hint">
              Removes movement. Changes of state stay instant.
            </span>
          </div>
          {system ? <p className="prefs__note">Your system is set to reduce motion, so animations are off whatever this switch says.</p> : null}
          <UpdatePanel />
        </div>
      ) : null}
    </div>
  )
}
