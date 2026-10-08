/**
 * Design tokens: the single source of truth for the Nexus look.
 * `applyTheme()` publishes them as CSS custom properties on :root, and the stylesheets
 * only ever reference `var(--...)`. No yellow, no emoji anywhere in the UI.
 */
export const colors = {
  background: '#0a0a0a',
  surface: '#111111',
  elevated: '#161616',
  border: '#222222',
  primary: '#ff3333',
  accent: '#cc0000',
  text: '#ffffff',
  muted: '#9a9a9a',
  success: '#22c55e',
  danger: '#ff3333'
} as const

/**
 * Primary button gradient. White text on #ff3333 alone is only 3.6:1, so the gradient
 * runs from the accent to a slightly deeper red to keep white labels at AA (>= 4.5:1).
 * The brighter primary is reserved for borders, glow and text-on-dark.
 */
export const buttonGradient = { from: '#e62020', to: '#cc0000' } as const

/** 8px spacing scale (index -> px). */
export const spacing = { 0: 0, 1: 8, 2: 16, 3: 24, 4: 32, 5: 40, 6: 48, 8: 64 } as const

export const radius = { card: 12, control: 8 } as const

export const motion = { fast: '200ms', slow: '250ms', easing: 'ease' } as const

export const shadows = {
  glow: '0 0 0 1px rgba(255, 51, 51, 0.55), 0 0 24px rgba(255, 51, 51, 0.35)',
  card: '0 8px 24px rgba(0, 0, 0, 0.45)'
} as const

export const fonts = {
  heading: "'Orbitron', system-ui, sans-serif",
  body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
} as const

export const layout = { sidebarWidth: 240, topbarHeight: 64 } as const

/** Write every token to `root` as a CSS custom property. */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string): void => root.style.setProperty(name, value)

  for (const [name, value] of Object.entries(colors)) set(`--color-${name}`, value)
  set('--btn-from', buttonGradient.from)
  set('--btn-to', buttonGradient.to)

  for (const [step, px] of Object.entries(spacing)) set(`--space-${step}`, `${px}px`)
  set('--radius-card', `${radius.card}px`)
  set('--radius-control', `${radius.control}px`)

  set('--motion-fast', motion.fast)
  set('--motion-slow', motion.slow)
  set('--ease', motion.easing)

  set('--shadow-glow', shadows.glow)
  set('--shadow-card', shadows.card)

  set('--font-heading', fonts.heading)
  set('--font-body', fonts.body)

  set('--sidebar-width', `${layout.sidebarWidth}px`)
  set('--topbar-height', `${layout.topbarHeight}px`)
}
