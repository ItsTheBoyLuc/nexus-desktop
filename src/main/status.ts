import type { ApiStatus } from '../shared/types'

/**
 * Combines the two signals the UI status line needs: the outcome of the last call
 * (online/offline) and whether a call is currently stuck waiting for a sleeping server.
 */
export class ApiStatusTracker {
  private base: 'unknown' | 'online' | 'offline' = 'unknown'
  private waking = false

  constructor(private readonly emit: (status: ApiStatus) => void) {}

  current(): ApiStatus {
    return this.waking ? 'waking' : this.base
  }

  setBase(status: 'online' | 'offline'): void {
    this.base = status
    this.emit(this.current())
  }

  setWaking(active: boolean): void {
    this.waking = active
    this.emit(this.current())
  }
}
