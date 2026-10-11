import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { indicatorOffset } from '../lib/motion'

/**
 * Keeps the ONE indicator bar of the sidebar next to the active item. The bar is absolutely positioned and only ever moves with a
 * transform, so it slides between items (CSS transition) without touching the layout. It is re-measured after every navigation,
 * when something in the sidebar changes size (a group opening, a longer server name), and when the window is resized.
 * It is hidden when nothing is active or the active item sits inside a collapsed group.
 */
export function useNavIndicator(asideRef: RefObject<HTMLElement | null>, barRef: RefObject<HTMLElement | null>, routeKey: string): void {
  useLayoutEffect(() => {
    const aside = asideRef.current
    const bar = barRef.current
    if (!aside || !bar) return
    let frame = 0
    let placed = false

    const measure = (): void => {
      const item = aside.querySelector<HTMLElement>('.nav-item--active')
      if (!item || item.closest('[data-collapsed="true"]') || item.offsetParent === null) {
        bar.dataset['visible'] = 'false'
        return
      }
      const { x, y } = indicatorOffset(item.getBoundingClientRect(), aside.getBoundingClientRect(), aside.scrollTop)
      bar.style.transform = `translate(${x}px, ${y}px)`
      bar.dataset['visible'] = 'true'
      if (!placed) {
        placed = true
        // The first placement is instant; only later moves slide.
        frame = requestAnimationFrame(() => {
          bar.dataset['ready'] = 'true'
        })
      }
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const onTransitionEnd = (event: TransitionEvent): void => {
      if ((event.target as Element).closest('.nav-collapse')) schedule()
    }

    measure()
    const observer = new ResizeObserver(schedule)
    for (const child of Array.from(aside.children)) observer.observe(child)
    aside.addEventListener('transitionend', onTransitionEnd)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      aside.removeEventListener('transitionend', onTransitionEnd)
      window.removeEventListener('resize', schedule)
    }
  }, [asideRef, barRef, routeKey])
}
