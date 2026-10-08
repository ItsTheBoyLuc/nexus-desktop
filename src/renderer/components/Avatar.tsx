import { useState } from 'react'

interface AvatarProps {
  src?: string | null
  /** Used for the initials fallback and the accessible name when `decorative` is false. */
  name: string
  size?: number
  shape?: 'circle' | 'rounded'
  /** True when the name is already printed next to the avatar. */
  decorative?: boolean
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0]!.charAt(0) + parts[1]!.charAt(0) : (parts[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

export function Avatar({ src, name, size = 32, shape = 'circle', decorative = true }: AvatarProps) {
  // Remember which URL failed so a new src gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && src !== failedSrc

  return (
    <span
      className={`avatar avatar--${shape}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
    >
      {showImage ? <img src={src ?? undefined} alt="" draggable={false} onError={() => setFailedSrc(src ?? null)} /> : initialsOf(name)}
    </span>
  )
}
