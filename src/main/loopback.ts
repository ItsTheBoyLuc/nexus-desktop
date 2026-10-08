import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { safeEqual } from './pkce'

/**
 * Temporary HTTP server that receives the OAuth redirect from the backend:
 *   http://127.0.0.1:<random port>/callback?code=...&state=...
 *
 * - Bound to 127.0.0.1 only, random free port (>= 1024), route /callback only.
 * - The Host header must be exactly 127.0.0.1:<port> (DNS-rebinding guard).
 * - The state is compared in constant time; a wrong state is rejected and does NOT end
 *   the login (a stray request must not be able to cancel it).
 * - The first correct callback settles the result and the server closes immediately;
 *   it also closes itself after `timeoutMs` (5 minutes in production) or on cancel.
 */
export type LoopbackOutcome =
  | { kind: 'code'; code: string }
  | { kind: 'denied' }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }

export interface LoopbackSession {
  port: number
  redirectUri: string
  address: AddressInfo
  /** Settles exactly once. */
  result: Promise<LoopbackOutcome>
  /** Cancels the login (settles as "cancelled") and closes the server. Safe to call repeatedly. */
  close: () => void
}

export interface LoopbackOptions {
  expectedState: string
  timeoutMs: number
}

const HOST = '127.0.0.1'
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,512}$/

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"

function page(title: string, message: string, ok: boolean): string {
  const accent = '#ff3333'
  const mark = ok
    ? `<polyline points="6 12 10.5 16.5 18 8" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<line x1="7" y1="7" x2="17" y2="17" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/><line x1="17" y1="7" x2="7" y2="17" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Nexus</title>
<style>
  html,body{height:100%;margin:0;background:#0a0a0a;color:#fff;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  body{display:grid;place-items:center;padding:24px}
  .card{max-width:420px;width:100%;text-align:center;background:#111;border:1px solid #222;border-top:3px solid ${accent};border-radius:12px;padding:32px 28px}
  .brand{letter-spacing:.2em;font-weight:700;font-size:13px;color:${accent};margin-bottom:16px}
  .icon{width:48px;height:48px;margin:0 auto 12px}
  h1{font-size:20px;margin:0 0 8px}
  p{margin:0;color:#9a9a9a}
</style></head>
<body><main class="card">
<div class="brand">NEXUS</div>
<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="#222" stroke-width="1.5"/>${mark}</svg>
<h1>${title}</h1>
<p>${message}</p>
</main></body></html>`
}

const SUCCESS_PAGE = page('Signed in', 'You can close this tab and return to Nexus.', true)
const DENIED_PAGE = page('Sign-in was not completed', 'You can close this tab and return to Nexus to try again.', false)
const INVALID_PAGE = page('Invalid sign-in link', 'This link is not valid. Please start the sign-in again from Nexus.', false)

function send(res: ServerResponse, status: number, body: string, done?: () => void): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': PAGE_CSP,
    Connection: 'close'
  })
  res.end(body, done)
}

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    // port 0 = the OS picks a free ephemeral port; exclusive so nobody can share it.
    server.listen({ host: HOST, port: 0, exclusive: true }, () => {
      server.off('error', reject)
      resolve(server.address() as AddressInfo)
    })
  })
}

export async function startLoopbackServer(options: LoopbackOptions): Promise<LoopbackSession> {
  const { expectedState, timeoutMs } = options

  let settled = false
  let closed = false
  const timers: { timeout?: NodeJS.Timeout } = {}
  let resolveResult!: (outcome: LoopbackOutcome) => void
  const result = new Promise<LoopbackOutcome>((resolve) => {
    resolveResult = resolve
  })

  const server = createServer()
  let port = 0

  const shutdown = (): void => {
    if (closed) return
    closed = true
    if (timers.timeout) clearTimeout(timers.timeout)
    server.close() // stops accepting new connections immediately
    // Responses carry "Connection: close", so sockets normally end by themselves; this is a
    // backstop for stragglers. The short delay lets the last page finish flushing first.
    setTimeout(() => server.closeAllConnections(), 100).unref()
  }
  const settle = (outcome: LoopbackOutcome): boolean => {
    if (settled) return false
    settled = true
    resolveResult(outcome)
    return true
  }

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    // Anything but GET /callback on the exact loopback host:port is refused.
    if (req.headers.host !== `${HOST}:${port}`) return send(res, 400, INVALID_PAGE)

    let url: URL
    try {
      url = new URL(req.url ?? '', `http://${HOST}:${port}`)
    } catch {
      return send(res, 400, INVALID_PAGE)
    }
    if (req.method !== 'GET' || url.pathname !== '/callback') return send(res, 404, INVALID_PAGE)

    const state = url.searchParams.get('state')
    if (state === null || !safeEqual(state, expectedState)) return send(res, 400, INVALID_PAGE)

    if (settled) return send(res, 410, INVALID_PAGE) // single use

    const code = url.searchParams.get('code')
    const granted = code !== null && CODE_PATTERN.test(code) && url.searchParams.get('error') === null
    settle(granted ? { kind: 'code', code } : { kind: 'denied' })
    send(res, granted ? 200 : 400, granted ? SUCCESS_PAGE : DENIED_PAGE, shutdown)
  })

  const address = await listen(server)
  port = address.port
  if (port < 1024) {
    // Cannot happen with OS-assigned ephemeral ports, but the backend refuses anything lower.
    shutdown()
    throw new Error('Loopback server was assigned a reserved port')
  }

  timers.timeout = setTimeout(() => {
    settle({ kind: 'timeout' })
    shutdown()
  }, timeoutMs)
  timers.timeout.unref()

  return {
    port,
    redirectUri: `http://${HOST}:${port}/callback`,
    address,
    result,
    close: () => {
      settle({ kind: 'cancelled' })
      shutdown()
    }
  }
}
