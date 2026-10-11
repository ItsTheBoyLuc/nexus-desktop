import { vi } from 'vitest'
import { ApiClient } from './apiClient'
import type { RequestOptions } from './apiClient'
import { createRacingApi } from './racingApi'

/** Helpers shared by the tests of the esports API calls (not part of the app: only the test files import it). */

/** An ApiClient whose answers are scripted; records every request so paths, methods and bodies can be checked. */
export function setup(...answers: unknown[]) {
  const calls: RequestOptions[] = []
  const queue = [...answers]
  const request = vi.fn(async (options: RequestOptions) => {
    calls.push(options)
    const next = queue.shift()
    if (next instanceof Error) throw next
    return next
  })
  return { api: createRacingApi({ request } as unknown as ApiClient), calls, request }
}

/** A client that really runs the ApiClient (timeouts, retry rules), with a scripted network. */
export function realClient(handler: (signal: AbortSignal | undefined) => Promise<Response>) {
  let calls = 0
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls++
    return handler(init?.signal ?? undefined)
  }) as typeof fetch
  const client = new ApiClient({ baseUrl: 'https://api.test', fetchImpl, timeoutMs: 30, wakeAfterMs: 1000, sleep: async () => undefined })
  client.setSession({ access_token: 'access', refresh_token: 'refresh' })
  return { api: createRacingApi(client), calls: () => calls }
}

/** The request never answers: the client's own timeout fires. */
export const hang = (signal: AbortSignal | undefined): Promise<Response> =>
  new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))

/** The connection drops after the request was sent. */
export const dropped = async (): Promise<Response> => {
  const error = new TypeError('fetch failed')
  ;(error as { cause?: unknown }).cause = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
  throw error
}

export const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
