import { DISCORD_CDN } from '../shared/csp'
import { ApiError } from './apiClient'

/** Small helpers shared by the API modules: responses are validated, never trusted blindly. */

export function invalid(what: string): ApiError {
  return new ApiError({
    kind: 'invalid_response',
    code: 'invalid_response',
    message: `The server sent an unexpected ${what} response. Please try again later.`,
    mayHaveBeenSent: true
  })
}

export function clientError(code: string, message: string): ApiError {
  return new ApiError({ kind: 'validation', code, message, mayHaveBeenSent: false })
}

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const isText = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
export const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000_000

/** Only Discord CDN images may be shown (the renderer CSP enforces the same). */
export function cdnImage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === DISCORD_CDN ? url.href : null
  } catch {
    return null
  }
}

export function list(json: unknown, key: string, what: string): unknown[] {
  if (!isRecord(json) || !Array.isArray(json[key])) throw invalid(what)
  return json[key] as unknown[]
}
