import { useEffect, useState } from 'react'

/**
 * The value, but only after it stopped changing for `delayMs`. Used by the filters that ask the server (reads are
 * limited to 60 per minute, so a request per keystroke would use them up).
 */
export function useDebounced<T>(value: T, delayMs = 450): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return settled
}
