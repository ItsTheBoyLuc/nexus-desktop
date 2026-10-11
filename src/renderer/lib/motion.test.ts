import { describe, expect, it } from 'vitest'
import { motion } from '../theme/tokens'
import { applyMotionMode, INDICATOR_HEIGHT, indicatorOffset, MOTION_ATTRIBUTE, motionMode, STAGGER_WINDOW_MS } from './motion'

describe('the motion mode', () => {
  it('is reduced exactly when the Reduce animations switch is on', () => {
    expect(motionMode(true)).toBe('reduced')
    expect(motionMode(false)).toBe('full')
  })

  it('is published as data-motion on the root element, and changes back', () => {
    const attributes = new Map<string, string>()
    const root = { setAttribute: (name: string, value: string) => void attributes.set(name, value) }
    applyMotionMode(root, true)
    expect(attributes.get(MOTION_ATTRIBUTE)).toBe('reduced')
    applyMotionMode(root, false)
    expect(attributes.get(MOTION_ATTRIBUTE)).toBe('full')
    expect(MOTION_ATTRIBUTE).toBe('data-motion')
  })
})

describe('the motion tokens', () => {
  it('are the agreed durations and easing', () => {
    expect(motion.micro).toBe('150ms')
    expect(motion.standard).toBe('220ms')
    expect(motion.page).toBe('320ms')
    expect(motion.stagger).toBe('40ms')
    expect(motion.staggerCap).toBe(8)
    expect(motion.easing).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
  })
})

describe('the entrance window of a list', () => {
  it('outlasts the last staggered item, so later rows (Load more, filtering) are never animated', () => {
    const lastStart = (motion.staggerCap - 1) * 40
    expect(STAGGER_WINDOW_MS).toBeGreaterThan(lastStart + 220)
    expect(STAGGER_WINDOW_MS).toBeLessThan(1500)
  })
})

describe('the sliding sidebar indicator', () => {
  const container = { top: 10, left: 100, height: 800 }

  it('is centred on the active item, relative to the sidebar', () => {
    expect(indicatorOffset({ top: 210, left: 116, height: 40 }, container, 0)).toEqual({ x: 16, y: 210 - 10 + (40 - INDICATOR_HEIGHT) / 2 })
  })

  it('moves with the scrolled content', () => {
    const still = indicatorOffset({ top: 210, left: 116, height: 36 }, container, 0)
    const scrolled = indicatorOffset({ top: 150, left: 116, height: 36 }, container, 60)
    expect(scrolled).toEqual(still)
  })

  it('only ever produces whole pixels, so the bar stays sharp', () => {
    const { x, y } = indicatorOffset({ top: 210.4, left: 116.6, height: 37 }, container, 0.3)
    expect(Number.isInteger(x)).toBe(true)
    expect(Number.isInteger(y)).toBe(true)
  })
})
