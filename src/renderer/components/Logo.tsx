import { useId } from 'react'

interface LogoProps {
  size?: number
  /** Accessible name. Omit when the logo is purely decorative (next to a visible name). */
  label?: string
  /** Login screen only: the outline draws itself once, the bolt fades in, then a slow glow breathes. Static everywhere else. */
  animated?: boolean
}

/** Red hexagon with a lightning bolt. Keep the geometry in sync with build/icon.svg. */
export function Logo({ size = 32, label, animated = false }: LogoProps) {
  // useId() output can contain characters that are awkward inside url(#...).
  const gradientId = `nexus-logo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const outline = '128,16 225,72 225,184 128,240 31,184 31,72'
  const bolt = 'M142 48 L82 140 H118 L104 208 L174 112 H138 Z'
  if (animated) {
    return (
      <svg width={size} height={size} viewBox="0 0 256 256" className="logo logo--animated" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff3333" />
            <stop offset="1" stopColor="#cc0000" />
          </linearGradient>
        </defs>
        <g className="logo__halo">
          <polygon className="logo__glow" points={outline} fill={`url(#${gradientId})`} />
        </g>
        <polygon className="logo__fill" points={outline} fill={`url(#${gradientId})`} />
        <polygon className="logo__outline" points={outline} pathLength={1} fill="none" stroke={`url(#${gradientId})`} strokeWidth="12" strokeLinejoin="round" />
        <path className="logo__bolt" d={bolt} fill="#ffffff" />
      </svg>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff3333" />
          <stop offset="1" stopColor="#cc0000" />
        </linearGradient>
      </defs>
      <polygon
        points={outline}
        fill={`url(#${gradientId})`}
        stroke={`url(#${gradientId})`}
        strokeWidth="12"
        strokeLinejoin="round"
      />
      <path d={bolt} fill="#ffffff" />
    </svg>
  )
}
