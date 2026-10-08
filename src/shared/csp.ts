/**
 * Content-Security-Policy for the renderer.
 *
 * The renderer never talks to the network itself (every API call goes through the
 * preload bridge to the main process), so production gets `connect-src 'none'`.
 * Only the Discord CDN may serve images (guild icons, avatars); there are no remote
 * scripts or fonts (Orbitron is bundled).
 *
 * `frame-ancestors` is deliberately absent: browsers ignore it (and warn) when the
 * policy is delivered through a <meta> tag, which is how production ships it.
 */
export const DISCORD_CDN = 'https://cdn.discordapp.com'

const BASE_DIRECTIVES = [
  "default-src 'self'",
  `img-src 'self' ${DISCORD_CDN} data:`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
]

export function buildProductionCsp(): string {
  return [...BASE_DIRECTIVES, "script-src 'self'", "connect-src 'none'"].join('; ')
}

/**
 * Development only: the Vite dev server needs an inline React-refresh preamble and a
 * websocket for hot reload. Never used in a packaged build.
 */
export function buildDevCsp(): string {
  return [
    ...BASE_DIRECTIVES,
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self' ws://localhost:* http://localhost:*"
  ].join('; ')
}
