import type { ReactNode } from 'react'

/**
 * Link that opens in the system browser. The main process only honours https URLs on its
 * allowlist; the href stays on the element so it is announced and focusable like any link.
 */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      className={className}
      rel="noreferrer noopener"
      onClick={(event) => {
        event.preventDefault()
        void window.nexus.system.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}
