import { useId } from 'react'

interface LogoProps {
  size?: number
  /** Accessible name. Omit when the logo is purely decorative (next to a visible name). */
  label?: string
}

/** Red hexagon with a lightning bolt. Keep the geometry in sync with build/icon.svg. */
export function Logo({ size = 32, label }: LogoProps) {
  // useId() output can contain characters that are awkward inside url(#...).
  const gradientId = `nexus-logo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
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
        points="128,16 225,72 225,184 128,240 31,184 31,72"
        fill={`url(#${gradientId})`}
        stroke={`url(#${gradientId})`}
        strokeWidth="12"
        strokeLinejoin="round"
      />
      <path d="M142 48 L82 140 H118 L104 208 L174 112 H138 Z" fill="#ffffff" />
    </svg>
  )
}
