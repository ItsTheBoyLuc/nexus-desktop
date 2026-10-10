import { describe, expect, it } from 'vitest'
import type { ApiErrorInfo, LedgerEntry, Standings, Team } from '../../shared/types'
import { UiError } from './errors'
import { ambiguousFields, availableActions, DRIVER_STANDING_GETTERS, knownDrivers, moveItem, phaseAfterFailure, planResultsSubmit } from './resultsFlow'
import { sortRows } from './tableView'

const G = '555000000000000001'
const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({ guildId: G, season: '5', round: '3', circuit: 'Zandvoort', recordedAt: '2026-10-10T12:00:00.000Z', ...over })
const err = (info: Pick<ApiErrorInfo, 'kind' | 'code'> & Partial<ApiErrorInfo>): UiError => new UiError({ message: 'm', ...info })

describe('warning before a race is recorded a second time', () => {
  it('flags a repeat of the same server + season + round and lists the earlier recordings', () => {
    const plan = planResultsSubmit([entry(), entry({ round: '4' })], G, ' 5 ', '03')
    expect(plan.repeat).toBe(true)
    expect(plan.earlier).toHaveLength(1)
  })

  it('does not flag a new race, another server, or an empty ledger', () => {
    expect(planResultsSubmit([entry()], G, '5', '4').repeat).toBe(false)
    expect(planResultsSubmit([entry()], '555000000000000002', '5', '3').repeat).toBe(false)
    expect(planResultsSubmit([], G, '5', '3').repeat).toBe(false)
  })
})

describe('after a failed or lost results request', () => {
  it('a lost answer locks the form: the only way forward is to refresh the standings, never to record again', () => {
    for (const error of [
      err({ kind: 'timeout', code: 'timeout', mayHaveBeenSent: true }),
      err({ kind: 'network', code: 'network_error', mayHaveBeenSent: true }),
      err({ kind: 'http', code: 'bot_timeout', status: 504 }),
      err({ kind: 'http', code: 'internal_error', status: 500 }),
      err({ kind: 'invalid_response', code: 'invalid_response' })
    ]) {
      expect(phaseAfterFailure(error), error.info.code).toBe('lost')
    }
    expect(availableActions('lost')).toEqual(['refresh-standings'])
    expect(availableActions('lost')).not.toContain('record')
    expect(availableActions('lost')).not.toContain('confirm')
    expect(availableActions('lost')).not.toContain('edit')
  })

  it('a refusal that proves nothing was recorded returns to editing (the data is still valid to fix and send)', () => {
    for (const error of [
      err({ kind: 'http', code: 'fia_required', status: 403 }),
      err({ kind: 'http', code: 'ambiguous_name', status: 400 }),
      err({ kind: 'http', code: 'invalid_results', status: 400 }),
      err({ kind: 'network', code: 'network_error', mayHaveBeenSent: false }),
      err({ kind: 'rate_limited', code: 'rate_limited', status: 429 })
    ]) {
      expect(phaseAfterFailure(error), error.info.code).toBe('editing')
    }
    expect(availableActions('editing')).toContain('confirm')
  })

  it('"record" exists only while confirming, and nothing can be done while saving (no double submit)', () => {
    expect(availableActions('confirming')).toEqual(['cancel', 'record'])
    expect(availableActions('saving')).toEqual([])
    for (const phase of ['editing', 'saving', 'saved', 'lost'] as const) expect(availableActions(phase)).not.toContain('record')
  })
})

describe('ambiguous_name belongs to the fastest lap or pole field', () => {
  it('uses the field the backend names, else every field that was chosen', () => {
    expect(ambiguousFields('The fastest lap name matches two drivers', true, true)).toEqual(['fastestLap'])
    expect(ambiguousFields('The pole name is ambiguous', true, true)).toEqual(['pole'])
    expect(ambiguousFields('That name matches more than one driver', true, true)).toEqual(['fastestLap', 'pole'])
    expect(ambiguousFields('That name matches more than one driver', false, true)).toEqual(['pole'])
    expect(ambiguousFields('fastest lap', false, true)).toEqual(['pole']) // a field that was not chosen is never blamed
  })
})

describe('pickers and tables', () => {
  const team: Team = {
    name: 'Red', abbreviation: 'RED', color: '#FF0000', roleId: null, roleName: null, channelId: null, channelName: null, points: 0,
    drivers: [{ userId: '2', username: 'bob', displayName: 'Bobby', number: 1, points: 0, wins: 0, podiums: 0 }]
  }
  const standings: Standings = {
    drivers: [
      { position: 1, userId: '2', username: 'bob', team: 'Red', points: 10, wins: 0, podiums: 0, gap: 0 },
      { position: 2, userId: '1', username: 'alice', team: '—', points: 5, wins: 0, podiums: 0, gap: 5 }
    ],
    constructors: []
  }

  it('offers roster drivers (with display names) plus everyone in the standings, once each', () => {
    expect(knownDrivers([team], standings)).toEqual([
      { id: '2', displayName: 'Bobby', username: 'bob' },
      { id: '1', displayName: 'alice', username: 'alice' }
    ].sort((a, b) => a.displayName.localeCompare(b.displayName)))
    expect(knownDrivers([], null)).toEqual([])
  })

  it('moves an item without losing any, and ignores moves outside the list', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 1, 5)).toEqual(['a', 'b'])
  })

  it('standings keep the position order of the server by default; a driver without a team sorts last', () => {
    expect(sortRows(standings.drivers, { key: 'position', direction: 'asc' }, DRIVER_STANDING_GETTERS).map((row) => row.username)).toEqual(['bob', 'alice'])
    expect(sortRows(standings.drivers, { key: 'team', direction: 'asc' }, DRIVER_STANDING_GETTERS).map((row) => row.username)).toEqual(['bob', 'alice'])
    expect(sortRows(standings.drivers, { key: 'team', direction: 'desc' }, DRIVER_STANDING_GETTERS).map((row) => row.username)).toEqual(['bob', 'alice'])
  })
})
