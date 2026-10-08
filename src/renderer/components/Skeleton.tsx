import type { CSSProperties, ReactNode } from 'react'

interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  className?: string
}

/** Decorative placeholder block. Wrap groups in <LoadingRegion> so assistive tech hears "Loading". */
export function Skeleton({ width = '100%', height = 16, radius, className }: SkeletonProps) {
  const style: CSSProperties = { width, height, borderRadius: radius }
  return <span className={['skeleton', className ?? ''].filter(Boolean).join(' ')} style={style} aria-hidden="true" />
}

export function LoadingRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  )
}
