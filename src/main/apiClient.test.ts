import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from './apiClient'
import type { ApiClientOptions, SessionEndReason } from './apiClient'

interface Call {
  url: string
  path: string
  method: string
  authorization: string | undefined
  body: unknown
}
type Handler = (call: Call, signal: AbortSignal | undefined) => Response | Promise<Response>

const REFRESH = '/api/app/v1/auth/refresh'
const ME = '/api/app/v1/me'

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const htmlResponse = (status: number): Response => new Response('<html>Render says hold on</html>', { status, headers: { 'content-type': 'text/html' } })
const tokenPair = (n: number): Response => jsonResponse(200, { access_token: `access-${n}`, refresh_token: `refresh-${n}` })

/** A fetch that never answers until the client aborts it (a hung / sleeping server). */
const hangUntilAborted = (signal: AbortSignal | undefined): Promise<Response> =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')))
  })

const connectionError = (code: string): TypeError => {
  const error = new TypeError('fetch failed')
  ;(error as { cause?: unknown }).cause = Object.assign(new Error(code), { code })
  return error
}

function setup(handler: Handler, overrides: Partial<ApiClientOptions> = {}) {
  const calls: Call[] = []
  const events = {
    waking: [] as boolean[],
    status: [] as string[],
    ended: [] as SessionEndReason[],
    persisted: [] as string[],
    cleared: 0,
    sleeps: [] as number[]
  }
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    const call: Call = {
      url,
      path: new URL(url).pathname,
      method: init?.method ?? 'GET',
      authorization: headers['Authorization'],
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    }
    calls.push(call)
    return handler(call, init?.signal ?? undefined)
  }) as typeof fetch

  const client = new ApiClient({
    baseUrl: 'https://api.test',
    fetchImpl,
    timeoutMs: 200,
    wakeAfterMs: 40,
    sleep: async (ms) => {
      events.sleeps.push(ms)
    },
    persistRefreshToken: (token) => events.persisted.push(token),
    clearPersistedSession: () => {
      events.cleared++
    },
    onWaking: (active) => events.waking.push(active),
    onStatus: (status) => events.status.push(status),
    onSessionEnded: (reason) => events.ended.push(reason),
    ...overrides
  })
  client.setSession({ access_token: 'access-1', refresh_token: 'refresh-1' })
  events.persisted.length = 0
  return { client, calls, events, refreshCalls: () => calls.filter((c) => c.path === REFRESH) }
}

afterEach(() => vi.restoreAllMocks())

describe('401 handling and refresh single-flight', () => {
  it('refreshes ONCE for concurrent 401s, then retries every call with the new token', async () => {
    const { client, calls, events, refreshCalls } = setup(async (call) => {
      if (call.path === REFRESH) {
        await new Promise((resolve) => setTimeout(resolve, 30)) // slow enough for all callers to pile up
        return tokenPair(2)
      }
      return call.authorization === 'Bearer access-1' ? jsonResponse(401, { error: 'unauthorized', message: 'expired' }) : jsonResponse(200, { who: call.authorization })
    })

    const results = await Promise.all([client.request({ path: ME }), client.request({ path: ME }), client.request({ path: ME })])

    expect(refreshCalls()).toHaveLength(1)
    expect(refreshCalls()[0]?.body).toEqual({ refresh_token: 'refresh-1' })
    expect(results).toEqual([{ who: 'Bearer access-2' }, { who: 'Bearer access-2' }, { who: 'Bearer access-2' }])
    expect(calls.filter((c) => c.path === ME)).toHaveLength(6) // 3 failed + 3 retried
    expect(events.persisted).toEqual(['refresh-2']) // the rotated token is stored immediately
    expect(events.ended).toEqual([])
  })

  it('does not refresh again when another call already renewed the session', async () => {
    const { client, refreshCalls } = setup(async (call) => {
      if (call.path === REFRESH) return tokenPair(2)
      return call.authorization === 'Bearer access-1' ? jsonResponse(401, { error: 'unauthorized' }) : jsonResponse(200, { ok: true })
    })
    await client.request({ path: ME })
    await client.request({ path: ME }) // already uses access-2
    expect(refreshCalls()).toHaveLength(1)
  })

  it('rotates: every refresh sends the refresh token received by the previous one', async () => {
    let generation = 1
    let validAccess = 'rejected-initially' // the server starts out rejecting access-1
    const { client, refreshCalls } = setup(async (call) => {
      if (call.path === REFRESH) {
        generation++
        validAccess = `access-${generation}`
        return tokenPair(generation)
      }
      return call.authorization === `Bearer ${validAccess}` ? jsonResponse(200, { ok: true }) : jsonResponse(401, { error: 'unauthorized' })
    })

    await client.request({ path: ME }) // 401 -> refresh with refresh-1 -> access-2
    validAccess = 'expired-again' // access-2 expires too
    await client.request({ path: ME }) // 401 -> refresh with refresh-2 -> access-3

    expect(refreshCalls().map((c) => (c.body as { refresh_token: string }).refresh_token)).toEqual(['refresh-1', 'refresh-2'])
  })

  it.each([
    ['server error (500)', () => jsonResponse(500, { error: 'internal_error' }), 'refresh-failed'],
    ['gateway error (503 page)', () => htmlResponse(503), 'refresh-failed'],
    ['rate limit (429)', () => jsonResponse(429, { error: 'rate_limited' }), 'refresh-failed'],
    ['refused token (401)', () => jsonResponse(401, { error: 'invalid_grant' }), 'expired'],
    ['malformed success body', () => jsonResponse(200, { access_token: 'only-access' }), 'refresh-failed']
  ] as const)('a failed refresh (%s) is NEVER retried and ends the session', async (_label, answer, reason) => {
    const { client, events, refreshCalls, calls } = setup(async (call) => (call.path === REFRESH ? answer() : jsonResponse(401, { error: 'unauthorized' })))

    await expect(client.request({ path: ME })).rejects.toMatchObject({ kind: 'session' })

    expect(refreshCalls()).toHaveLength(1)
    expect(events.sleeps).toEqual([]) // no backoff = no retry scheduling for the refresh
    expect(events.ended).toEqual([reason])
    expect(events.cleared).toBeGreaterThan(0) // stored token deleted
    expect(client.hasSession()).toBe(false)

    // later calls do not even try to refresh again, and do not hit the network
    const before = calls.length
    await expect(client.request({ path: ME })).rejects.toMatchObject({ kind: 'session' })
    expect(refreshCalls()).toHaveLength(1)
    expect(calls.length).toBe(before)
  })

  it('a TIMED-OUT refresh is never retried: the session ends (the server may have rotated the token)', async () => {
    const { client, events, refreshCalls } = setup(async (call, signal) => (call.path === REFRESH ? hangUntilAborted(signal) : jsonResponse(401, { error: 'unauthorized' })), {
      timeoutMs: 50
    })
    await expect(client.request({ path: ME })).rejects.toMatchObject({ kind: 'session' })
    expect(refreshCalls()).toHaveLength(1)
    expect(events.sleeps).toEqual([])
    expect(events.ended).toEqual(['refresh-failed'])
  })

  it.each(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'])('a network error (%s) on refresh is never retried either', async (code) => {
    const { client, events, refreshCalls } = setup(async (call) => {
      if (call.path === REFRESH) throw connectionError(code)
      return jsonResponse(401, { error: 'unauthorized' })
    })
    await expect(client.request({ path: ME })).rejects.toMatchObject({ kind: 'session' })
    expect(refreshCalls()).toHaveLength(1)
    expect(events.ended).toEqual(['refresh-failed'])
  })

  it('concurrent callers share one failed refresh and all get a session error', async () => {
    const { client, events, refreshCalls } = setup(async (call) => {
      if (call.path === REFRESH) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return jsonResponse(500, { error: 'internal_error' })
      }
      return jsonResponse(401, { error: 'unauthorized' })
    })
    const settled = await Promise.allSettled([client.request({ path: ME }), client.request({ path: ME }), client.request({ path: ME })])
    expect(settled.every((r) => r.status === 'rejected')).toBe(true)
    expect(refreshCalls()).toHaveLength(1)
    expect(events.ended).toHaveLength(1) // one "session ended" event, not three
  })

  it('ends the session when the call is still unauthorized right after a successful refresh', async () => {
    const { client, events, refreshCalls } = setup(async (call) => (call.path === REFRESH ? tokenPair(2) : jsonResponse(401, { error: 'unauthorized' })))
    await expect(client.request({ path: ME })).rejects.toMatchObject({ kind: 'session' })
    expect(refreshCalls()).toHaveLength(1)
    expect(events.ended).toEqual(['expired'])
  })

  it('does not attempt a refresh for unauthenticated calls', async () => {
    const { client, refreshCalls } = setup(async () => jsonResponse(401, { error: 'unauthorized' }))
    await expect(client.request({ path: ME, auth: false })).rejects.toMatchObject({ kind: 'http', status: 401 })
    expect(refreshCalls()).toHaveLength(0)
  })
})

describe('server waking up (normal calls only)', () => {
  it('emits the waking notice after the threshold, retries, and clears the notice afterwards', async () => {
    let attempts = 0
    const { client, events, calls } = setup(async (_call, signal) => {
      attempts++
      if (attempts < 3) return hangUntilAborted(signal) // first two tries time out (server still booting)
      return jsonResponse(200, { ok: true })
    }, { timeoutMs: 60, wakeAfterMs: 20 })

    await expect(client.request({ path: ME })).resolves.toEqual({ ok: true })

    expect(calls).toHaveLength(3)
    expect(events.sleeps).toEqual([1_000, 3_000]) // exponential-ish backoff between tries
    expect(events.waking).toEqual([true, false])
  })

  it('does not show the notice for fast calls', async () => {
    const { client, events } = setup(async () => jsonResponse(200, { ok: true }))
    await client.request({ path: ME })
    expect(events.waking).toEqual([])
  })

  it('gives up after 3 tries with a typed timeout error', async () => {
    const { client, calls, events } = setup((_call, signal) => hangUntilAborted(signal), { timeoutMs: 30, wakeAfterMs: 10 })
    await expect(client.request({ path: ME })).rejects.toMatchObject({ kind: 'timeout' })
    expect(calls).toHaveLength(3)
    expect(events.waking).toEqual([true, false])
    expect(events.status.at(-1)).toBe('offline')
  })

  it('retries Render gateway pages (502/503/504) for GET, but not real backend JSON errors', async () => {
    for (const status of [502, 503, 504]) {
      let n = 0
      const { client, calls } = setup(async () => (++n < 3 ? htmlResponse(status) : jsonResponse(200, { ok: true })))
      await expect(client.request({ path: ME })).resolves.toEqual({ ok: true })
      expect(calls).toHaveLength(3)
    }
    const { client, calls } = setup(async () => jsonResponse(503, { error: 'bot_unavailable', message: 'The bot is not online right now.' }))
    await expect(client.request({ path: ME })).rejects.toMatchObject({ kind: 'http', code: 'bot_unavailable', status: 503 })
    expect(calls).toHaveLength(1)
  })

  it('does NOT retry an announcement POST after a timeout (it may already be posted)', async () => {
    const { client, calls } = setup((_call, signal) => hangUntilAborted(signal), { timeoutMs: 30 })
    await expect(client.request({ method: 'POST', path: '/api/app/v1/guilds/1/announcement', body: { title: 't' } })).rejects.toMatchObject({ kind: 'timeout' })
    expect(calls).toHaveLength(1)
  })

  it('does NOT retry a POST after an ambiguous network error, but does after one that never connected', async () => {
    const ambiguous = setup(async () => {
      throw connectionError('ECONNRESET')
    })
    await expect(ambiguous.client.request({ method: 'POST', path: '/x', body: {} })).rejects.toMatchObject({ kind: 'network' })
    expect(ambiguous.calls).toHaveLength(1)

    let n = 0
    const preConnect = setup(async () => {
      if (++n < 3) throw connectionError('ECONNREFUSED')
      return jsonResponse(200, { ok: true })
    })
    await expect(preConnect.client.request({ method: 'POST', path: '/x', body: {} })).resolves.toEqual({ ok: true })
    expect(preConnect.calls).toHaveLength(3)
  })

  it('retries a POST when Render answers with its own 503 page (request never reached the app)', async () => {
    let n = 0
    const { client, calls } = setup(async () => (++n < 2 ? htmlResponse(503) : jsonResponse(201, { ok: true })))
    await expect(client.request({ method: 'POST', path: '/x', body: {} })).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('exchange-style single calls (once) are never retried and never show the notice', async () => {
    const { client, calls, events } = setup((_call, signal) => hangUntilAborted(signal), { timeoutMs: 60, wakeAfterMs: 10 })
    await expect(client.request({ method: 'POST', path: '/api/app/v1/auth/exchange', body: {}, auth: false, once: true })).rejects.toMatchObject({ kind: 'timeout' })
    expect(calls).toHaveLength(1)
    expect(events.waking).toEqual([])
  })
})

describe('warm-up before restoring a session', () => {
  it('counts a 401 from the backend as "awake" and retries while it boots', async () => {
    let n = 0
    const { client, calls } = setup(async () => (++n < 3 ? htmlResponse(503) : jsonResponse(401, { error: 'unauthorized' })))
    await expect(client.warmUp()).resolves.toBe(true)
    expect(calls.every((c) => c.authorization === undefined)).toBe(true) // never sends a token
    expect(calls).toHaveLength(3)
  })

  it('reports false (and sends nothing to /refresh) when the server never answers', async () => {
    const { client, refreshCalls } = setup((_call, signal) => hangUntilAborted(signal), { timeoutMs: 20, wakeAfterMs: 5 })
    await expect(client.warmUp()).resolves.toBe(false)
    expect(refreshCalls()).toHaveLength(0)
  })
})

describe('errors and logging', () => {
  it('maps backend errors, rate limits and unknown failures to typed errors', async () => {
    const forbidden = setup(async () => jsonResponse(403, { error: 'forbidden', message: 'Staff only.' }))
    await expect(forbidden.client.request({ path: ME })).rejects.toMatchObject({ kind: 'http', code: 'forbidden', message: 'Staff only.', status: 403 })

    const limited = setup(async () => jsonResponse(429, { error: 'rate_limited', message: 'slow down' }, { 'Retry-After': '17' }))
    await expect(limited.client.request({ path: ME })).rejects.toMatchObject({ kind: 'rate_limited', retryAfter: 17, status: 429 })

    const odd = setup(async () => new Response('teapot', { status: 418 }))
    const error = await odd.client.request({ path: ME }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'http', code: 'unexpected_response' })
  })

  it('never follows redirects with the Authorization header attached', async () => {
    let init: RequestInit | undefined
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      fetchImpl: (async (_url: string | URL | Request, i?: RequestInit) => {
        init = i
        return jsonResponse(200, {})
      }) as typeof fetch
    })
    client.setSession({ access_token: 'a', refresh_token: 'r' })
    await client.request({ path: ME })
    expect(init?.redirect).toBe('error')
  })

  it('never writes tokens to the logs, even when everything fails', async () => {
    const spies = [vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'log')]
    const { client } = setup(async (call) => {
      if (call.path === REFRESH) throw connectionError('ECONNRESET')
      return jsonResponse(401, { error: 'unauthorized' })
    })
    await client.request({ path: ME }).catch(() => undefined)
    await client.warmUp()
    const output = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n')
    expect(output).not.toMatch(/access-1|refresh-1|Bearer/)
  })
})

describe('logout', () => {
  it('calls the backend once with the access token, then forgets everything locally', async () => {
    const { client, calls, events } = setup(async () => jsonResponse(200, { ok: true }))
    await client.logout()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ path: '/api/app/v1/auth/logout', method: 'POST', authorization: 'Bearer access-1' })
    expect(client.hasSession()).toBe(false)
    expect(events.cleared).toBe(1)
    expect(events.ended).toEqual([]) // an intentional logout is not an "ended" session
  })

  it('still signs out locally when the backend cannot be reached', async () => {
    const { client, events } = setup(async () => {
      throw connectionError('ENOTFOUND')
    })
    await client.logout()
    expect(client.hasSession()).toBe(false)
    expect(events.cleared).toBe(1)
  })
})
