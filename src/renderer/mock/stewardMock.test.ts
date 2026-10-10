import { describe, expect, it } from 'vitest'
import type { IpcResult, Report } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { createF1Mock } from './f1Mock'
import { createStewardMock } from './stewardMock'

/**
 * The fake reports / penalties / dirty-drivers backend is what every M3 screen is reviewed against in
 * `npm run dev:mock`, so the cases it promises (see its header) are pinned here: no reports, many reports, a report
 * that was already decided, a ban threshold with its ban text, wrong roles, penalty_not_configured,
 * report_message_not_found, penalty_points_failed, a lost answer, an empty dirty list and a channel the bot cannot post in.
 */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const CH_OK = '777000000000000001'
const CH_LOCKED = '777000000000000008'
const CHANNELS = [
  { id: CH_OK, name: 'announcements' },
  { id: '777000000000000007', name: 'timeout-test' },
  { id: CH_LOCKED, name: 'bot-locked' }
]

function setup(scenario = 'normal', isAdmin = true) {
  let next = 888000000000000600n
  const ctx = {
    scenario,
    isAdmin,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id: string) => id === APEX || id === MIDNIGHT,
    channels: CHANNELS,
    timeoutChannel: '777000000000000007',
    lockedChannel: CH_LOCKED,
    hiddenChannel: '777000000000000009',
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    setSettings: () => undefined,
    liveMessages: new Set<string>(),
    newMessageId: () => String(next++),
    apex: APEX,
    midnight: MIDNIGHT
  }
  void createF1Mock // the F1 mock is not needed here: this one is independent of it
  return createStewardMock(ctx)
}

const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}
const code = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.code)

async function findReport(api: ReturnType<typeof setup>['api'], match: (report: Report) => boolean, guild = APEX): Promise<Report> {
  const page = ok(await api.reports(guild, { limit: 100 }))
  const found = page.reports.find(match)
  if (!found) throw new Error('report not found in the sample data')
  return found
}

describe('report cases', () => {
  it('Apex has 11 reports in every state; Midnight has 60 (many reports), served in pages of at most 100', async () => {
    const { api } = setup()
    const apex = ok(await api.reports(APEX, { limit: 100 }))
    expect(apex.total).toBe(11)
    for (const status of ['pending', 'under_investigation', 'penalty_issued', 'no_further_action'] as const) expect(apex.reports.some((report) => report.status === status), status).toBe(true)
    const midnight = ok(await api.reports(MIDNIGHT))
    expect(midnight).toMatchObject({ total: 60, limit: 50, offset: 0 })
    expect(midnight.reports).toHaveLength(50)
    expect(ok(await api.reports(MIDNIGHT, { offset: 50 })).reports).toHaveLength(10)
    expect(ok(await api.reports(MIDNIGHT, { limit: 100 })).reports).toHaveLength(60)
  })

  it('noreports: nothing anywhere (the empty state)', async () => {
    const { api } = setup('noreports')
    expect(ok(await api.reports(APEX))).toMatchObject({ total: 0, reports: [] })
    expect(ok(await api.reportRounds(MIDNIGHT))).toEqual([])
  })

  it('filters by season, round, status and driver text; the round overview groups by round', async () => {
    const { api } = setup()
    expect(ok(await api.reports(APEX, { round: '4' })).total).toBe(4)
    expect(ok(await api.reports(APEX, { status: 'penalty_issued' })).total).toBe(2)
    expect(ok(await api.reports(APEX, { driver: 'ALICE' })).total).toBe(1)
    expect(ok(await api.reports(APEX, { season: '99' })).total).toBe(0)
    const rounds = ok(await api.reportRounds(APEX))
    expect(rounds.map((row) => row.roundKey)).toEqual(['S5R1', 'S5R2', 'S5R3', 'S5R4'])
    expect(rounds.find((row) => row.roundKey === 'S5R3')).toMatchObject({ total: 3, pending: 1, penaltyIssued: 1, noFurtherAction: 1 })
    expect(ok(await api.reportRound(APEX, '5', '3')).count).toBe(3)
    expect(ok(await api.reportRound(APEX, '5', '9')).count).toBe(0) // an empty round is not an error
  })

  it('the sample texts include markup on purpose: it is returned as plain text, untouched', async () => {
    const { api } = setup()
    const report = await findReport(api, (item) => item.description.includes('<script>'))
    expect(report.description).toContain('<b>and took me out</b>')
  })

  it('a decided report keeps no explanation or points: only the status and the penalty text', async () => {
    const { api } = setup()
    const decided = await findReport(api, (item) => item.status === 'no_further_action')
    expect(decided).toMatchObject({ decided: true, decision: { type: 'no_further_action' } })
    expect(decided).not.toHaveProperty('explanation')
    expect(decided).not.toHaveProperty('points')
  })
})

describe('deciding a report', () => {
  it('no further action decides it once; a second decision answers 409 already_decided and changes nothing', async () => {
    const { api } = setup()
    const target = await findReport(api, (item) => item.id !== '' && item.status === 'pending' && item.number === 1 && item.roundKey === 'S5R3')
    const result = ok(await api.decideReport(APEX, target.id, { decision: 'no_further_action', explanation: 'No infringement.' }))
    expect(result.report).toMatchObject({ status: 'no_further_action', decided: true })
    expect(result.points.applied).toBe(false)
    expect(code(await api.decideReport(APEX, target.id, { decision: 'penalty_issued', description: 'x', driver: 'alice', penaltyPoints: 5 }))).toBe('already_decided')
    expect(ok(await api.report(APEX, target.id)).status).toBe('no_further_action')
    expect(ok(await api.penaltyHistory(APEX, 'alice', 5).then((r) => r.ok ? { ok: true as const, data: r.data } : { ok: true as const, data: null }))).toBeNull() // no points were added by the refused decision
  })

  it('a penalty with points is saved under the right season and returns the new total', async () => {
    const { api } = setup()
    const target = await findReport(api, (item) => item.status === 'pending' && item.roundKey === 'S5R3')
    const result = ok(await api.decideReport(APEX, target.id, { decision: 'penalty_issued', description: '5 second time penalty', driver: 'Bobby_R', penaltyPoints: 2 }))
    expect(result.points).toMatchObject({ applied: true, driver: 'Bobby_R', added: 2, season: 5, total: 4, qualiBanned: false, banNotice: null })
    expect(ok(await api.report(APEX, target.id))).toMatchObject({ status: 'penalty_issued', penalty: '5 second time penalty' })
  })

  it('a report decided in Discord at the same moment (race-condition): 409 already_decided, and it is decided afterwards', async () => {
    const { api } = setup()
    const target = await findReport(api, (item) => item.description.includes('race-condition'))
    expect(target.status).toBe('pending')
    expect(code(await api.decideReport(APEX, target.id, { decision: 'no_further_action', explanation: 'Racing incident.' }))).toBe('already_decided')
    expect(ok(await api.report(APEX, target.id)).decided).toBe(true)
  })

  it('a report whose message or thread is gone (or untracked): report_message_not_found, nothing changes', async () => {
    const { api } = setup()
    for (const match of [(item: Report) => item.threadName.includes('deleted-thread'), (item: Report) => item.messageId === null]) {
      const target = await findReport(api, match)
      expect(code(await api.decideReport(APEX, target.id, { decision: 'no_further_action', explanation: 'x' }))).toBe('report_message_not_found')
      expect(ok(await api.report(APEX, target.id)).decided).toBe(false)
    }
  })

  it('points-fail: the report IS decided, the points are NOT saved (500 penalty_points_failed)', async () => {
    const { api } = setup()
    const target = await findReport(api, (item) => item.status === 'pending' && item.roundKey === 'S5R3')
    const before = ok(await api.penaltyOverview(APEX)).drivers.find((row) => row.key === 'bobby_r')?.totalPoints
    expect(code(await api.decideReport(APEX, target.id, { decision: 'penalty_issued', description: 'points-fail', driver: 'Bobby_R', penaltyPoints: 3 }))).toBe('penalty_points_failed')
    expect(ok(await api.report(APEX, target.id)).decided).toBe(true)
    expect(ok(await api.penaltyOverview(APEX)).drivers.find((row) => row.key === 'bobby_r')?.totalPoints).toBe(before)
    // a retry is refused, so nothing can be doubled: the fix is the manual points dialog
    expect(code(await api.decideReport(APEX, target.id, { decision: 'penalty_issued', description: 'again', driver: 'Bobby_R', penaltyPoints: 3 }))).toBe('already_decided')
  })

  it('a lost answer (timeout): the decision IS applied, the answer is a timeout; every decision in the lostdecisions scenario', async () => {
    const { api } = setup()
    const target = await findReport(api, (item) => item.status === 'pending' && item.roundKey === 'S5R3')
    const lost = await api.decideReport(APEX, target.id, { decision: 'no_further_action', explanation: 'timeout' })
    expect(lost.ok ? 'ok' : lost.error.kind).toBe('timeout')
    expect(ok(await api.report(APEX, target.id)).decided).toBe(true)

    const all = setup('lostdecisions').api
    const other = await findReport(all, (item) => item.status === 'pending' && item.roundKey === 'S5R3')
    expect((await all.decideReport(APEX, other.id, { decision: 'no_further_action', explanation: 'fine' })).ok).toBe(false)
    expect(ok(await all.report(APEX, other.id)).decided).toBe(true)
  })

  it('nopenaltyconfig: a penalty WITH points answers 409 penalty_not_configured and changes nothing; no further action still works', async () => {
    const { api } = setup('nopenaltyconfig')
    const target = await findReport(api, (item) => item.status === 'pending' && item.roundKey === 'S5R3')
    expect(code(await api.decideReport(APEX, target.id, { decision: 'penalty_issued', description: '5s', driver: 'alice', penaltyPoints: 3 }))).toBe('penalty_not_configured')
    expect(ok(await api.report(APEX, target.id)).decided).toBe(false) // nothing was changed
    expect(code(await api.decideReport(APEX, target.id, { decision: 'penalty_issued', description: 'Reprimand', penaltyPoints: 0 }))).toBe('ok')
  })

  it('a penalty with points but without a driver is refused (driver_required)', async () => {
    const { api } = setup()
    const target = await findReport(api, (item) => item.status === 'pending' && item.roundKey === 'S5R3')
    expect(code(await api.decideReport(APEX, target.id, { decision: 'penalty_issued', description: '5s', penaltyPoints: 3 }))).toBe('driver_required')
    expect(ok(await api.report(APEX, target.id)).decided).toBe(false)
  })
})

describe('penalty cases', () => {
  it('Apex season 5: Max_V has both bans and a Reported (2) flag; the settings carry their defaults', async () => {
    const { api } = setup()
    const overview = ok(await api.penaltyOverview(APEX))
    expect(overview).toMatchObject({ season: 5, currentSeason: 5, isCurrent: true, settings: { qualiBanThreshold: 8, raceBanThreshold: 13, expiryRaces: 15 } })
    expect(overview.drivers[0]).toMatchObject({ key: 'max_v', totalPoints: 14, ban: 'race', reportedCount: 2 })
    expect(ok(await api.penaltyOverview(APEX, 4)).isCurrent).toBe(false)
    expect(ok(await api.penaltySettings(APEX)).defaults).toEqual({ currentSeason: 1, expiryRaces: 15, qualiBanThreshold: 8, raceBanThreshold: 13 })
  })

  it('a ban threshold reached by manual points returns the ban text and posts nothing', async () => {
    const { api } = setup()
    const result = ok(await api.addPenaltyPoints(APEX, { driver: 'Lando_N', penaltyType: 'Drive-Through', points: 1, reason: 'Contact' }))
    expect(result).toMatchObject({ saved: true, totalPoints: 8, qualiBanned: true, raceBanned: false, posted: null })
    expect(result.banNotice).toContain('QUALI BAN')
    // below the threshold: no text
    const small = ok(await api.addPenaltyPoints(APEX, { driver: 'Bobby_R', penaltyType: 'x', points: 1, reason: 'y' }))
    expect(small.banNotice).toBeNull()
  })

  it('a channel the bot cannot post in: bot_cannot_send before anything is recorded; points 0 without a channel is nothing_to_do', async () => {
    const { api } = setup()
    expect(code(await api.addPenaltyPoints(APEX, { driver: 'Bobby_R', penaltyType: 'x', points: 2, reason: 'y', channelId: CH_LOCKED }))).toBe('bot_cannot_send')
    expect(ok(await api.penaltyHistory(APEX, 'Bobby_R', 5)).totalPoints).toBe(2) // unchanged
    expect(code(await api.addPenaltyPoints(APEX, { driver: 'Bobby_R', penaltyType: 'x', points: 0, reason: 'y' }))).toBe('nothing_to_do')
    expect(ok(await api.addPenaltyPoints(APEX, { driver: 'Bobby_R', penaltyType: 'x', points: 1, reason: 'y', channelId: CH_OK })).posted).not.toBeNull()
  })

  it('nopenaltyconfig: the overview is 404, manual points and advance race are 409 penalty_not_configured', async () => {
    const { api } = setup('nopenaltyconfig')
    expect(code(await api.penaltyOverview(APEX))).toBe('penalty_not_configured')
    expect(code(await api.addPenaltyPoints(APEX, { driver: 'a', penaltyType: 'b', points: 1, reason: 'c' }))).toBe('penalty_not_configured')
    expect(code(await api.advanceRace(APEX, { raceNumber: 6, confirm: true }))).toBe('penalty_not_configured')
    expect(ok(await api.penaltySettings(APEX))).toMatchObject({ configured: false, expiryRaces: null })
  })

  it('wrong roles: nofia refuses clear, bans and advance (reading and manual points still work); notadmin refuses the settings; nostaff refuses everything', async () => {
    const nofia = setup('nofia').api
    expect(code(await nofia.clearPenaltyPoints(APEX, { driver: 'Max_V', reason: 'x', confirm: true }))).toBe('fia_required')
    expect(code(await nofia.setBan(APEX, { driver: 'Max_V', banType: 'race', action: 'remove', confirm: true }))).toBe('fia_required')
    expect(code(await nofia.advanceRace(APEX, { raceNumber: 6, confirm: true }))).toBe('fia_required')
    expect(code(await nofia.penaltyOverview(APEX))).toBe('ok')
    expect(code(await nofia.addPenaltyPoints(APEX, { driver: 'Bobby_R', penaltyType: 'x', points: 1, reason: 'y' }))).toBe('ok')

    const notAdmin = setup('notadmin', false).api
    expect(code(await notAdmin.savePenaltySettings(APEX, { currentSeason: 5, expiryRaces: 15, qualiBanThreshold: 8, raceBanThreshold: 13 }))).toBe('admin_required')

    const nostaff = setup('nostaff').api
    for (const result of [await nostaff.reports(APEX), await nostaff.penaltyOverview(APEX), await nostaff.dirtyDrivers(APEX), await nostaff.addPenaltyPoints(APEX, { driver: 'a', penaltyType: 'b', points: 1, reason: 'c' })]) {
      expect(code(result)).toBe('forbidden')
    }
  })

  it('clearing: all points and the history, or a part (the history is kept with an admin removal and the bans are recalculated)', async () => {
    const { api } = setup()
    const partial = ok(await api.clearPenaltyPoints(APEX, { driver: 'Max_V', points: 7, reason: 'Appeal upheld', confirm: true }))
    expect(partial).toMatchObject({ mode: 'partial', pointsRemoved: 7, remaining: 7 })
    const history = ok(await api.penaltyHistory(APEX, 'Max_V'))
    expect(history).toMatchObject({ totalPoints: 7, raceBanned: false, qualiBanned: false })
    expect(history.history.at(-1)).toMatchObject({ points: -7, expiresAfterRace: null })
    const all = ok(await api.clearPenaltyPoints(APEX, { driver: 'Max_V', reason: 'Reset', confirm: true }))
    expect(all).toMatchObject({ mode: 'all', remaining: 0 })
    expect(ok(await api.penaltyHistory(APEX, 'Max_V')).history).toEqual([])
    expect(code(await api.clearPenaltyPoints(APEX, { driver: 'Nobody', reason: 'x', confirm: true }))).toBe('driver_not_found')
  })

  it('bans: give creates the record when needed, remove needs one (driver_not_found), points are kept', async () => {
    const { api } = setup()
    expect(ok(await api.setBan(APEX, { driver: 'New_Driver', banType: 'quali', action: 'give', confirm: true }))).toMatchObject({ qualiBanned: true, totalPoints: 0 })
    expect(code(await api.setBan(APEX, { driver: 'Ghost', banType: 'quali', action: 'remove', confirm: true }))).toBe('driver_not_found')
    expect(ok(await api.setBan(APEX, { driver: 'Max_V', banType: 'race', action: 'remove', confirm: true }))).toMatchObject({ raceBanned: false, totalPoints: 14 })
  })

  it('advance race removes the expired points of the current season only', async () => {
    const { api } = setup()
    const result = ok(await api.advanceRace(APEX, { raceNumber: 17, confirm: true }))
    expect(result.season).toBe(5)
    expect(result.expired.length).toBeGreaterThan(0)
    expect(result.updated.every((row) => row.newTotal < row.oldTotal)).toBe(true)
    expect(ok(await api.penaltyOverview(APEX, 4)).drivers[0]?.totalPoints).toBe(4) // another season is untouched
  })

  it('settings and points are separate: saving the settings leaves the points alone, and points writes leave the settings alone', async () => {
    const { api } = setup()
    const before = ok(await api.penaltyOverview(APEX)).drivers.map((row) => [row.key, row.totalPoints, row.ban])
    ok(await api.savePenaltySettings(APEX, { currentSeason: 5, expiryRaces: 20, qualiBanThreshold: 5, raceBanThreshold: 9 }))
    expect(ok(await api.penaltyOverview(APEX)).drivers.map((row) => [row.key, row.totalPoints, row.ban])).toEqual(before) // not recalculated
    const settings = ok(await api.penaltySettings(APEX))
    ok(await api.addPenaltyPoints(APEX, { driver: 'Bobby_R', penaltyType: 'x', points: 1, reason: 'y' }))
    expect(ok(await api.penaltySettings(APEX))).toEqual(settings)
  })

  it('manual points with a lost answer are applied (timeout in the reason), so the UI must offer a refresh and never repeat', async () => {
    const { api } = setup()
    const lost = await api.addPenaltyPoints(APEX, { driver: 'Bobby_R', penaltyType: 'x', points: 1, reason: 'timeout' })
    expect(lost.ok ? 'ok' : lost.error.kind).toBe('timeout')
    expect(ok(await api.penaltyHistory(APEX, 'Bobby_R', 5)).totalPoints).toBe(3)
  })
})

describe('dirty-driver cases', () => {
  it('Apex has three dirty drivers, Midnight none (the empty list), and nodirty empties Apex too', async () => {
    const { api } = setup()
    expect(ok(await api.dirtyDrivers(APEX))).toHaveLength(3)
    expect(ok(await api.dirtyDrivers(MIDNIGHT))).toEqual([])
    expect(ok(await setup('nodirty').api.dirtyDrivers(APEX))).toEqual([])
  })

  it('adding a report counts it on the list and in the penalty overview (Reported flag); removing the last one removes the driver', async () => {
    const { api } = setup()
    const added = ok(await api.addDirtyReport(APEX, { driver: 'Bobby_R', reason: 'Again', evidenceUrl: 'https://example.com/x' }))
    expect(added).toMatchObject({ displayName: 'Bobby_R', totalReports: 2, report: { index: 2, reportedBy: 'DemoStaff' } })
    expect(ok(await api.penaltyOverview(APEX)).drivers.find((row) => row.key === 'bobby_r')?.reportedCount).toBe(2)
    expect(ok(await api.removeDirtyReport(APEX, 'Bobby_R', 2))).toMatchObject({ driverRemoved: false })
    expect(ok(await api.removeDirtyReport(APEX, 'Bobby_R', 1))).toMatchObject({ driverRemoved: true })
    expect(code(await api.dirtyHistory(APEX, 'Bobby_R'))).toBe('driver_not_found')
  })

  it('removing a report makes the later ones move up: the numbers shift', async () => {
    const { api } = setup()
    const before = ok(await api.dirtyHistory(APEX, 'Max_V')).reports
    expect(before.map((report) => report.index)).toEqual([1, 2])
    ok(await api.removeDirtyReport(APEX, 'Max_V', 1))
    const after = ok(await api.dirtyHistory(APEX, 'Max_V')).reports
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ index: 1, reason: before[1]?.reason }) // what was number 2 is now number 1
    expect(code(await api.removeDirtyReport(APEX, 'Max_V', 2))).toBe('report_not_found')
  })
})
