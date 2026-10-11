import { createElement, useEffect, useState } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { STAGGER_WINDOW_MS } from '../lib/motion'

type StaggerTag = 'div' | 'ul' | 'ol' | 'tbody'

interface StaggerProps extends HTMLAttributes<HTMLElement> {
  /** The element to render; a table body or a list keeps its meaning for assistive technology. */
  as?: StaggerTag
  children: ReactNode
}

/**
 * A container whose first eight children fade up one after the other (40ms apart) when it appears. The entrance class is dropped
 * once the entrance is over, so rows added later ("Load more", a changed filter) simply appear, with no stagger. The movement
 * itself is CSS (`.stagger` in theme/motion.css); the reduced-motion switch removes it there.
 */
export function Stagger({ as = 'div', className, children, ...rest }: StaggerProps) {
  const [entering, setEntering] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => setEntering(false), STAGGER_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [])
  return createElement(as, { ...rest, className: [entering ? 'stagger' : '', className ?? ''].filter(Boolean).join(' ') || undefined }, children)
}
