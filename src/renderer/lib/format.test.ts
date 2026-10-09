import { describe, expect, it } from 'vitest'
import { formatCountdown, plural } from './format'

describe('formatCountdown', () => {
  it('reads naturally at every scale', () => {
    expect(formatCountdown(0)).toBe('in less than an hour')
    expect(formatCountdown(1)).toBe('in 1 hour')
    expect(formatCountdown(5)).toBe('in 5 hours')
    expect(formatCountdown(47)).toBe('in 47 hours')
    expect(formatCountdown(121)).toBe('in 5d 1h')
    expect(formatCountdown(72)).toBe('in 3 days')
  })
  it('never shows nonsense', () => {
    expect(formatCountdown(-3)).toBe('now')
    expect(formatCountdown(NaN)).toBe('now')
  })
})

describe('plural', () => {
  it('counts', () => {
    expect(plural(1, 'tier')).toBe('1 tier')
    expect(plural(0, 'tier')).toBe('0 tiers')
    expect(plural(2, 'person', 'people')).toBe('2 people')
  })
})
