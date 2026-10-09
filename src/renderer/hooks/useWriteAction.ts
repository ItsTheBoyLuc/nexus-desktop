import { useCallback, useRef, useState } from 'react'

export type WriteOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown }

/**
 * Runs one write (POST / PUT / PATCH / DELETE) at a time.
 *
 * `run` ignores calls while a write is in flight, so a double click, Enter held down or a
 * second button can never send the same write twice. The guard is a ref, so it also holds
 * within a single render pass (state would only update after it). `busy` drives the
 * loading state of the buttons. Nothing is ever retried here: a failed or timed-out write is
 * reported to the caller, which tells the user the truth about it.
 */
export function useWriteAction(): { busy: boolean; run: <T>(action: () => Promise<T>) => Promise<WriteOutcome<T> | null> } {
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<WriteOutcome<T> | null> => {
    if (inFlight.current) return null
    inFlight.current = true
    setBusy(true)
    try {
      return { ok: true, value: await action() }
    } catch (error) {
      return { ok: false, error }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [])

  return { busy, run }
}
