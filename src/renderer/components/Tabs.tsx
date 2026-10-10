import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface TabItem {
  id: string
  label: string
  /** Small count or marker after the label. */
  badge?: ReactNode
}

interface TabsProps {
  /** Accessible name of the tab list. */
  label: string
  tabs: readonly TabItem[]
  active: string
  onChange: (id: string) => void
  /** Prefix of the element ids; the panel of a tab must have id `${idPrefix}-panel-${tab.id}` (see `tabPanelProps`). */
  idPrefix: string
}

export const tabPanelProps = (idPrefix: string, id: string) => ({
  id: `${idPrefix}-panel-${id}`,
  role: 'tabpanel' as const,
  'aria-labelledby': `${idPrefix}-tab-${id}`,
  tabIndex: 0
})

/**
 * Tabs with the ARIA tabs pattern: the active tab is the only one in the tab order, Left / Right / Home / End
 * move between tabs (and select them), so the whole bar is one stop for keyboard users.
 */
export function Tabs({ label, tabs, active, onChange, idPrefix }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const select = (id: string): void => {
    onChange(id)
    refs.current[id]?.focus()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = tabs.length - 1
    const target =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : null
    if (target === null) return
    event.preventDefault()
    const next = tabs[target]
    if (next) select(next.id)
  }

  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            refs.current[tab.id] = element
          }}
          id={`${idPrefix}-tab-${tab.id}`}
          type="button"
          role="tab"
          className={`tab${tab.id === active ? ' tab--active' : ''}`}
          aria-selected={tab.id === active}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.label}
          {tab.badge !== undefined ? <span className="tab__badge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  )
}
