import { describe, expect, it, vi } from 'vitest'
import type { ApiErrorInfo, DirtyDriver, DirtyHistory, DirtyRemoveResult, DirtyReport, IpcResult } from '../../shared/types'
import { describeRemoval, DIRTY_GETTERS, runRemoval, sameDirtyReport } from './dirtyView'
import { sortRows } from './tableView'

const G = '555000000000000001'
const report = (index: number, over: Partial<DirtyReport> = {}): DirtyReport => ({ index, reason: `Reason ${index}`, evidence: `https://example.com/${index}`, reportedBy: 'boss', relatedIncident: null, timestamp: `2026-01-0${index}T00:00:00Z`, ...over })
const history = (...reports: DirtyReport[]): DirtyHistory => ({ key: 'max_v', displayName: 'Max_V', total: reports.length, reports })
const removed: DirtyRemoveResult = { displayName: 'Max_V', removedIndex: 2, driverRemoved: false, removed: { reason: 'Reason 2', evidence: '', reportedBy: 'boss', relatedIncident: null, timestamp: '' } }
const ok = <T,>(data: T): IpcResult<T> => ({ ok: true, data })
const fail = (info: Pick<ApiErrorInfo, 'kind' | 'code'> & Partial<ApiErrorInfo>): IpcResult<never> => ({ ok: false, error: { message: info.code, ...info } })

describe('is it the same report?', () => {
  it('only when everything the user saw matches, not just the number', () => {
    expect(sameDirtyReport(report(2), report(2))).toBe(true)
    expect(sameDirtyReport(report(2), report(2, { reason: 'Another reason' }))).toBe(false)
    expect(sameDirtyReport(report(2), report(2, { timestamp: '2026-02-02T00:00:00Z' }))).toBe(false)
    expect(sameDirtyReport(report(2), report(3))).toBe(false)
  })
})

describe('removing a report (the numbers shift, so it is double-checked and sent once)', () => {
  it('reads the history again, sees the same report, and removes that number with one request', async () => {
    const dirtyHistory = vi.fn(async () => ok(history(report(1), report(2))))
    const removeDirtyReport = vi.fn(async () => ok(removed))
    expect(await runRemoval({ dirtyHistory, removeDirtyReport }, G, 'Max_V', report(2))).toEqual({ kind: 'removed', result: removed })
    expect(dirtyHistory).toHaveBeenCalledTimes(1)
    expect(removeDirtyReport).toHaveBeenCalledTimes(1)
    expect(removeDirtyReport).toHaveBeenCalledWith(G, 'Max_V', 2)
  })

  it('when the list changed (another report now has that number), NOTHING is removed', async () => {
    const removeDirtyReport = vi.fn(async () => ok(removed))
    const api = { dirtyHistory: async () => ok(history(report(1), report(2, { reason: 'A different report moved up' }))), removeDirtyReport }
    expect(await runRemoval(api, G, 'Max_V', report(2))).toEqual({ kind: 'changed' })
    expect(removeDirtyReport).not.toHaveBeenCalled()
  })

  it('when the report is gone, or the driver has left the list, nothing is removed either', async () => {
    const removeDirtyReport = vi.fn(async () => ok(removed))
    expect(await runRemoval({ dirtyHistory: async () => ok(history(report(1))), removeDirtyReport }, G, 'Max_V', report(2))).toEqual({ kind: 'changed' })
    expect(await runRemoval({ dirtyHistory: async () => fail({ kind: 'http', code: 'driver_not_found', status: 404 }), removeDirtyReport }, G, 'Max_V', report(2))).toEqual({ kind: 'changed' })
    expect(removeDirtyReport).not.toHaveBeenCalled()
  })

  it('when the history cannot be read, the removal is not sent blind', async () => {
    const removeDirtyReport = vi.fn(async () => ok(removed))
    const run = await runRemoval({ dirtyHistory: async () => fail({ kind: 'timeout', code: 'timeout', mayHaveBeenSent: true }), removeDirtyReport }, G, 'Max_V', report(2))
    expect(run.kind).toBe('unverified')
    expect(removeDirtyReport).not.toHaveBeenCalled()
  })

  it('a lost answer is never retried: another send could remove a different report', async () => {
    for (const info of [
      { kind: 'timeout', code: 'timeout', mayHaveBeenSent: true },
      { kind: 'network', code: 'network_error', mayHaveBeenSent: true },
      { kind: 'http', code: 'internal_error', status: 500 }
    ] as const) {
      const removeDirtyReport = vi.fn(async () => fail(info))
      expect(await runRemoval({ dirtyHistory: async () => ok(history(report(1), report(2))), removeDirtyReport }, G, 'Max_V', report(2)), info.code).toEqual({ kind: 'lost' })
      expect(removeDirtyReport, info.code).toHaveBeenCalledTimes(1)
    }
  })

  it('report_not_found at the moment of removal means it changed; other refusals keep their text', async () => {
    const stale = vi.fn(async () => fail({ kind: 'http', code: 'report_not_found', status: 404 }))
    expect(await runRemoval({ dirtyHistory: async () => ok(history(report(2))), removeDirtyReport: stale }, G, 'Max_V', report(2))).toEqual({ kind: 'changed' })
    const refused = vi.fn(async () => fail({ kind: 'http', code: 'forbidden', status: 403 }))
    expect(await runRemoval({ dirtyHistory: async () => ok(history(report(2))), removeDirtyReport: refused }, G, 'Max_V', report(2))).toMatchObject({ kind: 'refused' })
  })

  it('says what happened to the numbers', () => {
    expect(describeRemoval(removed)).toMatch(/later reports moved up by one number/)
    expect(describeRemoval({ ...removed, driverRemoved: true })).toMatch(/no longer on the list/)
  })
})

describe('the dirty-driver table', () => {
  const driver = (key: string, name: string, count: number, timestamp: string): DirtyDriver => ({ key, displayName: name, reportCount: count, latest: { reason: `${name} reason`, evidence: '', reportedBy: 'boss', relatedIncident: null, timestamp } })
  const rows = [driver('a', 'alice', 1, '2026-01-01T00:00:00Z'), driver('b', 'Bob', 3, '2026-03-01T00:00:00Z'), driver('c', 'carol', 2, 'unreadable')]
  const order = (key: keyof typeof DIRTY_GETTERS, direction: 'asc' | 'desc'): string[] => sortRows(rows, { key, direction }, DIRTY_GETTERS).map((row) => row.key)

  it('sorts by name, by number of reports and by the latest report (unreadable dates last)', () => {
    expect(order('driver', 'asc')).toEqual(['a', 'b', 'c'])
    expect(order('reports', 'desc')).toEqual(['b', 'c', 'a'])
    expect(order('when', 'desc')).toEqual(['b', 'a', 'c'])
  })
})
