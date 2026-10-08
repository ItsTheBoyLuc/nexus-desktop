import { request } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startLoopbackServer } from './loopback'
import type { LoopbackSession } from './loopback'

const STATE = 'state-value-that-is-long-enough-1234567890'
const open: LoopbackSession[] = []

async function start(timeoutMs = 60_000): Promise<LoopbackSession> {
  const session = await startLoopbackServer({ expectedState: STATE, timeoutMs })
  open.push(session)
  return session
}

interface Reply {
  status: number
  body: string
  headers: Record<string, string | string[] | undefined>
}

function get(port: number, path: string, hostHeader?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: hostHeader ? { Host: hostHeader } : {}, agent: false }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

function refused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(true))
  })
}

const settleTick = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  for (const session of open.splice(0)) session.close()
})

describe('loopback callback server', () => {
  it('listens on 127.0.0.1 only, on a random port >= 1024', async () => {
    const session = await start()
    expect(session.address.address).toBe('127.0.0.1')
    expect(session.address.family).toBe('IPv4')
    expect(session.port).toBeGreaterThanOrEqual(1024)
    expect(session.redirectUri).toBe(`http://127.0.0.1:${session.port}/callback`)

    const other = await start()
    expect(other.port).not.toBe(session.port)
  })

  it('accepts a correct state exactly once, shows the branded page and closes immediately', async () => {
    const session = await start()
    const reply = await get(session.port, `/callback?code=abc_DEF-123&state=${STATE}`)

    expect(reply.status).toBe(200)
    expect(reply.body).toContain('You can close this tab and return to Nexus')
    expect(reply.body).toContain('#0a0a0a') // dark background
    expect(reply.body).toContain('#ff3333') // red accent
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(reply.headers['referrer-policy']).toBe('no-referrer')
    await expect(session.result).resolves.toEqual({ kind: 'code', code: 'abc_DEF-123' })

    await settleTick()
    expect(await refused(session.port)).toBe(true) // server is gone: a second use is impossible
  })

  it('rejects a wrong state and keeps waiting for the real callback', async () => {
    const session = await start()
    let settled = false
    void session.result.then(() => (settled = true))

    for (const bad of ['wrong', STATE.slice(0, -1), `${STATE}x`, '']) {
      const reply = await get(session.port, `/callback?code=stolen&state=${encodeURIComponent(bad)}`)
      expect(reply.status).toBe(400)
      expect(reply.body).not.toContain('stolen')
    }
    expect((await get(session.port, '/callback?code=stolen')).status).toBe(400) // no state at all
    await settleTick()
    expect(settled).toBe(false)

    const ok = await get(session.port, `/callback?code=real&state=${STATE}`)
    expect(ok.status).toBe(200)
    await expect(session.result).resolves.toEqual({ kind: 'code', code: 'real' })
  })

  it('serves /callback only: other paths and methods get 404', async () => {
    const session = await start()
    for (const path of ['/', '/other', '/callback/', '/callback/x', `/%63allback?state=${STATE}&code=a`]) {
      expect((await get(session.port, path)).status).toBe(404)
    }
    const post = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: session.port, path: `/callback?code=a&state=${STATE}`, method: 'POST', agent: false }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(post).toBe(404)
  })

  it('refuses requests whose Host header is not exactly 127.0.0.1:<port> (DNS rebinding)', async () => {
    const session = await start()
    for (const host of ['evil.example', 'localhost', `localhost:${session.port}`, `127.0.0.1:${session.port + 1}`, '127.0.0.1']) {
      const reply = await get(session.port, `/callback?code=a&state=${STATE}`, host)
      expect(reply.status).toBe(400)
    }
    // none of that counted as a login attempt
    expect((await get(session.port, `/callback?code=ok&state=${STATE}`)).status).toBe(200)
  })

  it('treats a callback without a usable code (access denied) as "denied" and closes', async () => {
    for (const query of [`state=${STATE}`, `error=access_denied&state=${STATE}`, `code=&state=${STATE}`, `code=bad%20code&state=${STATE}`]) {
      const session = await start()
      const reply = await get(session.port, `/callback?${query}`)
      expect(reply.status).toBe(400)
      expect(reply.body).toContain('not completed')
      await expect(session.result).resolves.toEqual({ kind: 'denied' })
      await settleTick()
      expect(await refused(session.port)).toBe(true)
    }
  })

  it('closes itself when nothing arrives before the timeout', async () => {
    const session = await start(60)
    await expect(session.result).resolves.toEqual({ kind: 'timeout' })
    await settleTick()
    expect(await refused(session.port)).toBe(true)
  })

  it('can be cancelled, which closes the port and is idempotent', async () => {
    const session = await start()
    session.close()
    session.close()
    await expect(session.result).resolves.toEqual({ kind: 'cancelled' })
    await settleTick()
    expect(await refused(session.port)).toBe(true)
  })

  it('settles only once even if cancelled after success', async () => {
    const session = await start()
    await get(session.port, `/callback?code=first&state=${STATE}`)
    session.close()
    await expect(session.result).resolves.toEqual({ kind: 'code', code: 'first' })
  })
})
