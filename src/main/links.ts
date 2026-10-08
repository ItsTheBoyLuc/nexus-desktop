/**
 * External-link allowlist. The renderer can ask the main process to open a URL in the
 * system browser, but only https URLs on these exact hosts are ever passed to
 * shell.openExternal. Everything else (http, file:, custom protocols, other hosts,
 * userinfo tricks, non-default ports) is refused.
 */
export const STATIC_ALLOWED_HOSTS: readonly string[] = ['discord.com', 'nexus-b67.pages.dev']

/** Returns the normalized URL if it may be opened externally, otherwise null. */
export function parseAllowedExternalUrl(raw: unknown, extraHosts: readonly string[] = []): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.port !== '' && url.port !== '443') return null

  const host = url.hostname.toLowerCase()
  const allowed = [...STATIC_ALLOWED_HOSTS, ...extraHosts].map((h) => h.toLowerCase())
  if (!allowed.includes(host)) return null

  // Hand back the parsed form, never the raw string, so what is opened is exactly what was checked.
  return url.href
}

export function isAllowedExternalUrl(raw: unknown, extraHosts: readonly string[] = []): boolean {
  return parseAllowedExternalUrl(raw, extraHosts) !== null
}
