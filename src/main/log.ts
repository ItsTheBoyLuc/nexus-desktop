/**
 * Minimal logger. Callers pass short fixed messages and (optionally) an error whose
 * name/code is logged, never request/response bodies, URLs with query strings, tokens,
 * codes or verifiers.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? `${error.name} (${code})` : error.name
  }
  return typeof error
}

export const log = {
  info(message: string): void {
    console.info(`[nexus] ${message}`)
  },
  warn(message: string, error?: unknown): void {
    console.warn(`[nexus] ${message}${error === undefined ? '' : `: ${describeError(error)}`}`)
  },
  error(message: string, error?: unknown): void {
    console.error(`[nexus] ${message}${error === undefined ? '' : `: ${describeError(error)}`}`)
  }
}
