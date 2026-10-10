import type { ApiErrorInfo, IpcResult } from '../../shared/types'

/** Helpers shared by the fake bridge modules (dev:mock only; never part of an Electron build). */

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function failure(kind: ApiErrorInfo['kind'], code: string, message: string, status?: number, extra: Partial<ApiErrorInfo> = {}): IpcResult<never> {
  return { ok: false, error: { kind, code, message, ...(status ? { status } : {}), ...extra } }
}
export const notFound = (code: string, message: string): IpcResult<never> => failure('http', code, message, 404)
export const refused = (code: string, message: string, status = 403): IpcResult<never> => failure('http', code, message, status)
export const timeoutFailure = (): IpcResult<never> => failure('timeout', 'timeout', 'The server took too long to respond.', undefined, { mayHaveBeenSent: true })
