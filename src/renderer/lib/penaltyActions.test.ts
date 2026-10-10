import { describe, expect, it, vi } from 'vitest'
import type { ApiErrorInfo, IpcResult, PenaltyRow } from '../../shared/types'
import { banLabel, confirmed, describeAdvanceEffect, describeAdvanceResult, describeBanEffect, describeBanResult, describeClearEffect, describeClearResult, matchesPenaltyFilter, PENALTY_GETTERS, runAction, seasonText } from './penaltyActions'
import { sortRows } from './tableView'

const fail = (info: Pick<ApiErrorInfo, 'kind' | 'code'> & Partial<ApiErrorInfo>): IpcResult<never> => ({ ok: false, error: { message: `backend: ${info.code}`, ...info } })
const row = (over: Partial<PenaltyRow> = {}): PenaltyRow => ({ position: 1, key: 'max_v', displayName: 'Max_V', totalPoints: 5, incidents: 1, ban: 'none', qualiBanned: false, raceBanned: false, reportedCount: 0, ...over })

describe('the confirm flag', () => {
  it('is added by confirmed() and nowhere else: a form value never carries it', () => {
    const value = { driver: 'alice', reason: 'Appeal' }
    expect(value).not.toHaveProperty('confirm')
    expect(confirmed(value)).toEqual({ driver: 'alice', reason: 'Appeal', confirm: true })
    expect(confirmed({ raceNumber: 6 })).toEqual({ raceNumber: 6, confirm: true })
  })
})

describe('what happens after a penalty write (runAction)', () => {
  it('a success comes back as done, from exactly one request', async () => {
    const call = vi.fn(async () => ({ ok: true, data: 42 }) as IpcResult<number>)
    expect(await runAction(call)).toEqual({ kind: 'done', value: 42 })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('a missing role switches the action off and says which role: FIA or Administrator', async () => {
    expect(await runAction(async () => fail({ kind: 'http', code: 'fia_required', status: 403 }))).toEqual({ kind: 'denied', role: 'fia' })
    expect(await runAction(async () => fail({ kind: 'http', code: 'admin_required', status: 403 }))).toEqual({ kind: 'denied', role: 'admin' })
  })

  it('penalty_not_configured (409 or 404) and driver_not_found are definite: nothing changed', async () => {
    expect(await runAction(async () => fail({ kind: 'http', code: 'penalty_not_configured', status: 409 }))).toEqual({ kind: 'not_configured' })
    expect(await runAction(async () => fail({ kind: 'http', code: 'penalty_not_configured', status: 404 }))).toEqual({ kind: 'not_configured' })
    expect(await runAction(async () => fail({ kind: 'http', code: 'driver_not_found', status: 404 }))).toMatchObject({ kind: 'not_found' })
  })

  it('a lost answer or a server failure may have happened: lost, never a second send', async () => {
    for (const info of [
      { kind: 'timeout', code: 'timeout', mayHaveBeenSent: true },
      { kind: 'network', code: 'network_error', mayHaveBeenSent: true },
      { kind: 'http', code: 'internal_error', status: 500 },
      { kind: 'http', code: 'bot_timeout', status: 504 },
      { kind: 'invalid_response', code: 'invalid_response' }
    ] as const) {
      const call = vi.fn(async () => fail(info))
      expect(await runAction(call), info.code).toEqual({ kind: 'lost' })
      expect(call, info.code).toHaveBeenCalledTimes(1)
    }
  })

  it('field errors name the field; other refusals carry their text', async () => {
    expect(await runAction(async () => fail({ kind: 'http', code: 'invalid_reason', status: 400 }))).toMatchObject({ kind: 'field', field: 'reason' })
    expect(await runAction(async () => fail({ kind: 'http', code: 'invalid_race_number', status: 400 }))).toMatchObject({ kind: 'field', field: 'raceNumber' })
    expect(await runAction(async () => fail({ kind: 'http', code: 'invalid_expiry_races', status: 400 }))).toMatchObject({ kind: 'field', field: 'expiryRaces' })
    expect(await runAction(async () => fail({ kind: 'rate_limited', code: 'rate_limited', status: 429, retryAfter: 9 }))).toMatchObject({ kind: 'refused' })
  })

  it('confirm_required (which the app should never see) is reported as a bug, not as a field problem', async () => {
    const run = await runAction(async () => fail({ kind: 'http', code: 'confirm_required', status: 400 }))
    expect(run).toMatchObject({ kind: 'refused' })
    expect(run.kind === 'refused' ? run.message : '').toMatch(/Nothing was changed/)
  })
})

describe('the confirm dialogs name the driver, the season and the effect', () => {
  it('clear all: every point and the history of that season, both bans, and nothing else', () => {
    const text = describeClearEffect({ driver: 'alice', reason: 'x', season: 4 }, 'Alice', 5, 11).join(' ')
    expect(text).toMatch(/All of Alice's penalty points \(11 points\) and their whole penalty history in season 4 are removed/)
    expect(text).toMatch(/both bans are lifted/)
    expect(text).toMatch(/Other seasons are not touched/)
  })

  it('clear a part: the amount, the kept history, the recalculated bans, and the current season when none was chosen', () => {
    const text = describeClearEffect({ driver: 'alice', reason: 'x', points: 1 }, 'Alice', 5, null).join(' ')
    expect(text).toMatch(/1 point are taken off Alice's total in season 5 \(the current season\)/)
    expect(text).toMatch(/Admin removed 1 pts/)
    expect(text).toMatch(/a ban may be lifted, none is given/)
  })

  it('bans: give or lift, which kind, that points stay, that nothing is posted', () => {
    const give = describeBanEffect({ driver: 'a', banType: 'race', action: 'give' }, 'Alice', 5).join(' ')
    expect(give).toMatch(/Alice gets a race ban in season 5/)
    expect(give).toMatch(/empty one is created/)
    expect(give).toMatch(/points are not changed/)
    const remove = describeBanEffect({ driver: 'a', banType: 'quali', action: 'remove', season: 3 }, 'Alice', 5).join(' ')
    expect(remove).toMatch(/qualifying ban of Alice in season 3 is lifted/)
    expect(remove).not.toMatch(/empty one/)
  })

  it('advance race says clearly that expired points are removed permanently, for the current season', () => {
    const text = describeAdvanceEffect(6, 5).join(' ')
    expect(text).toMatch(/at or before race 6 is removed PERMANENTLY/)
    expect(text).toMatch(/current season \(season 5\)/)
    expect(text).toMatch(/cannot be brought back/)
  })

  it('names the season in words', () => {
    expect(seasonText(undefined, 5)).toBe('season 5 (the current season)')
    expect(seasonText(2, 5)).toBe('season 2')
  })
})

describe('the success messages say what the server did', () => {
  it('clear, ban and advance results', () => {
    expect(describeClearResult({ driver: 'Alice', season: 5, mode: 'all', pointsRemoved: 7, remaining: 0 })).toMatch(/All points of Alice in season 5 were cleared \(7 points removed\)/)
    expect(describeClearResult({ driver: 'Alice', season: 5, mode: 'partial', pointsRemoved: 3, remaining: 4 })).toMatch(/3 points removed from Alice in season 5; 4 points remain/)
    expect(describeBanResult({ driver: 'Alice', season: 5, action: 'give', banType: 'race', qualiBanned: false, raceBanned: true, totalPoints: 4 })).toMatch(/Alice now has a race ban in season 5/)
    expect(describeBanResult({ driver: 'Alice', season: 5, action: 'remove', banType: 'quali', qualiBanned: false, raceBanned: false, totalPoints: 4 })).toMatch(/no longer has a qualifying ban/)
    expect(
      describeAdvanceResult({ raceNumber: 6, season: 5, expired: [{ key: 'a', displayName: 'A', points: 5, race: 'r' }, { key: 'b', displayName: 'B', points: 2, race: 'r' }], updated: [{ key: 'a', displayName: 'A', oldTotal: 9, newTotal: 4 }] })
    ).toMatch(/2 expired entries removed \(7 points\), 1 driver changed/)
  })
})

describe('the overview table', () => {
  const rows = [
    row({ key: 'a', displayName: 'Alice', totalPoints: 14, incidents: 3, ban: 'race', raceBanned: true, qualiBanned: true, reportedCount: 2 }),
    row({ key: 'b', displayName: 'bob', totalPoints: 9, ban: 'quali', qualiBanned: true }),
    row({ key: 'c', displayName: 'Carol', totalPoints: 3 })
  ]

  it('filters by ban and by the Reported flag', () => {
    const ids = (filter: Parameters<typeof matchesPenaltyFilter>[1]): string[] => rows.filter((item) => matchesPenaltyFilter(item, filter)).map((item) => item.key)
    expect(ids('all')).toEqual(['a', 'b', 'c'])
    expect(ids('banned')).toEqual(['a', 'b'])
    expect(ids('race')).toEqual(['a'])
    expect(ids('quali')).toEqual(['b'])
    expect(ids('none')).toEqual(['c'])
    expect(ids('reported')).toEqual(['a'])
  })

  it('sorts by points, by ban severity and by name (case-insensitive)', () => {
    const order = (key: keyof typeof PENALTY_GETTERS, direction: 'asc' | 'desc'): string[] => sortRows(rows, { key, direction }, PENALTY_GETTERS).map((item) => item.key)
    expect(order('points', 'desc')).toEqual(['a', 'b', 'c'])
    expect(order('ban', 'desc')).toEqual(['a', 'b', 'c'])
    expect(order('driver', 'asc')).toEqual(['a', 'b', 'c'])
    expect(order('reported', 'desc')[0]).toBe('a')
  })

  it('labels a driver with both ban flags (a race ban wins in the overview, but both are set)', () => {
    expect(banLabel(rows[0]!)).toBe('Race and qualifying ban')
    expect(banLabel(rows[1]!)).toBe('Qualifying ban')
    expect(banLabel(rows[2]!)).toBe('No ban')
  })
})
