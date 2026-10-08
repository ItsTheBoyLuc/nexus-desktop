import { describe, expect, it } from 'vitest'
import { buttonGradient, colors } from './tokens'

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

const AA = 4.5
const surfaces = { background: colors.background, surface: colors.surface, elevated: colors.elevated, 'menu hover': '#1c1c1c' }

describe('design tokens meet WCAG AA (4.5:1) for normal text', () => {
  it.each(Object.entries(surfaces))('text colours on %s', (_name, background) => {
    for (const [name, foreground] of Object.entries({ text: colors.text, muted: colors.muted, primary: colors.primary, success: colors.success, danger: colors.danger })) {
      expect(contrast(foreground, background), `${name} on ${background}`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('placeholder text on form controls', () => {
    expect(contrast('#8a8a8a', colors.elevated)).toBeGreaterThanOrEqual(AA)
  })

  it('white button labels on both ends of the primary gradient', () => {
    expect(contrast(colors.text, buttonGradient.from)).toBeGreaterThanOrEqual(AA)
    expect(contrast(colors.text, buttonGradient.to)).toBeGreaterThanOrEqual(AA)
  })

  it('documents why the gradient is not simply the primary colour (white on #ff3333 fails AA)', () => {
    expect(contrast(colors.text, colors.primary)).toBeLessThan(AA)
  })

  it('uses no yellow anywhere in the palette', () => {
    for (const hex of [...Object.values(colors), ...Object.values(buttonGradient)]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
      const yellowish = r > 180 && g > 150 && b < 100 && Math.abs(r - g) < 90
      expect(yellowish, hex).toBe(false)
    }
  })
})
