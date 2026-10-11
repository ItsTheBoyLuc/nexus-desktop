import { motion } from '../theme/tokens'

/**
 * The small pure parts of the motion layer. All movement itself is CSS (src/renderer/theme/motion.css);
 * this file only decides WHEN a mode applies and WHERE the sliding sidebar indicator goes.
 */

/** `<html data-motion="...">`: `reduced` removes every animation and transition, `full` leaves them on. */
export const MOTION_ATTRIBUTE = 'data-motion'
export type MotionMode = 'full' | 'reduced'

export const motionMode = (reduceMotion: boolean): MotionMode => (reduceMotion ? 'reduced' : 'full')

/** The part of an element the motion layer needs; the real `document.documentElement` satisfies it. */
export interface MotionRoot {
  setAttribute: (name: string, value: string) => void
}

/** Publish the saved "Reduce animations" choice to the stylesheet. (prefers-reduced-motion is handled by the stylesheet itself.) */
export function applyMotionMode(root: MotionRoot, reduceMotion: boolean): void {
  root.setAttribute(MOTION_ATTRIBUTE, motionMode(reduceMotion))
}

const ms = (value: string): number => Number.parseInt(value, 10)

/**
 * How long a list keeps the entrance class: the last staggered item starts after (cap - 1) steps and then runs for the standard
 * duration. Rows that arrive later (Load more, a changed filter) are added after this window and therefore appear instantly.
 */
export const STAGGER_WINDOW_MS = (motion.staggerCap - 1) * ms(motion.stagger) + ms(motion.standard) + 120

/** Box of an element, in viewport coordinates (the parts of a DOMRect the indicator needs). */
export interface Box {
  top: number
  left: number
  height: number
}

/** The sliding indicator is one bar of this height; it is centred on the active item. */
export const INDICATOR_HEIGHT = 20

/**
 * Where the one indicator bar goes: a translate relative to the top left corner of the (scrolling) sidebar.
 * `scrollTop` is added because the bar is positioned inside the scrolled content.
 */
export function indicatorOffset(item: Box, container: Box, scrollTop: number): { x: number; y: number } {
  return {
    x: Math.round(item.left - container.left),
    y: Math.round(item.top - container.top + scrollTop + (item.height - INDICATOR_HEIGHT) / 2)
  }
}
