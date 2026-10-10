import { describe, expect, it } from 'vitest'
import { findLedgerEntries } from '../../shared/f1Store'
import type { IpcResult, Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { createF1Mock } from './f1Mock'

/**
 * The fake F1 backend is what every F1 screen is reviewed against in `npm run dev:mock`, so the cases it promises
 * (see its header) are pinned here: no rounds, many rounds, a deleted calendar message, a team without drivers,
 * missing bot permissions, fia_required, ambiguous_name, a round already in the ledger and a lost answer.
 */
const APEX = '555000000000000001'
const MIDNIGHT = '555000000000000004'
const CHANNELS = [
  { id: '777000000000000001', name: 'announcements' },
  { id: '777000000000000002', name: 'race-results' },
  { id: '777000000000000003', name: 'league-news' },
  { id: '777000000000000099', name: 'timeout-test' }
]
const LOCKED = '777000000000000098'
const HIDDEN = '777000000000000097'
const TIMEOUT = '777000000000000099'
const mid = (n: number): string => `20000000000${String(n).padStart(7, '0')}`

function setup(scenario = 'normal') {
  let settings: Settings = { ...DEFAULT_SETTINGS, panels: {}, calendarPosts: {}, ledger: [] }
  const liveMessages = new Set<string>()
  let next = 888000000000000400n
  const f1 = createF1Mock({
    scenario,
    isAdmin: true,
    api: async <T,>(produce: () => IpcResult<T>) => produce(),
    known: (id) => id === APEX || id === MIDNIGHT,
    channels: CHANNELS,
    timeoutChannel: '777000000000000099',
    lockedChannel: '777000000000000098',
    hiddenChannel: '777000000000000097',
    getSettings: () => settings,
    setSettings: (value) => {
      settings = value
    },
    liveMessages,
    newMessageId: () => String(next++),
    apex: APEX,
    midnight: MIDNIGHT
  })
  settings = f1.seedSettings(settings)
  return { f1, api: f1.api, settings: () => settings, liveMessages }
}

const ok = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.data
}
const code = (result: IpcResult<unknown>): string => (result.ok ? 'ok' : result.error.code)

describe('calendar cases', () => {
  it('has 8 rounds in Apex (one TBD) and 24 in Midnight (the wizard is open)', async () => {
    const { api } = setup()
    const apex = ok(await api.calendar(APEX))
    expect(apex.rounds).toHaveLength(8)
    expect(apex.rounds.some((round) => round.date === 'TBD')).toBe(true)
    const midnight = ok(await api.calendar(MIDNIGHT))
    expect(midnight.rounds).toHaveLength(24)
    expect(midnight.setupInProgress).toBe(true)
  })

  it('norounds: an empty calendar, no next race, nothing to post', async () => {
    const { api } = setup('norounds')
    expect(ok(await api.calendar(APEX)).rounds).toEqual([])
    expect(code(await api.nextRace(APEX))).toBe('calendar_not_found')
    expect(code(await api.postCalendar(APEX, { channelId: CHANNELS[0]!.id }))).toBe('calendar_not_found')
  })

  it('deleting a round leaves a gap, and a new round takes the next number after the highest', async () => {
    const { api } = setup()
    ok(await api.deleteRound(APEX, 3))
    expect(ok(await api.calendar(APEX)).rounds.map((round) => round.round)).toEqual([1, 2, 4, 5, 6, 7, 8])
    const created = ok(await api.createRound(APEX, { name: 'Gap filler', date: 'TBD', time: '', flag: '', eventType: 'Normal Race', round: 3 }))
    expect(created.round.round).toBe(3)
    expect(code(await api.createRound(APEX, { name: 'Dup', date: 'TBD', time: '', flag: '', eventType: 'Normal Race', round: 3 }))).toBe('round_exists')
  })

  it('stops at 25 rounds', async () => {
    const { api } = setup()
    ok(await api.createRound(MIDNIGHT, { name: 'Last', date: 'TBD', time: '', flag: '', eventType: 'Normal Race' }))
    expect(code(await api.createRound(MIDNIGHT, { name: 'One too many', date: 'TBD', time: '', flag: '', eventType: 'Normal Race' }))).toBe('too_many_rounds')
  })

  it('Apex has a stored calendar message that was deleted in Discord: updating it says message_not_found and the id is forgotten', async () => {
    const { api, settings } = setup()
    const stored = settings().calendarPosts[APEX]
    expect(stored).toBeDefined()
    expect(code(await api.postCalendar(APEX, { channelId: stored!.channelId, messageId: stored!.messageId }))).toBe('message_not_found')
    expect(settings().calendarPosts[APEX]).toBeUndefined()
    const fresh = ok(await api.postCalendar(APEX, { channelId: CHANNELS[0]!.id }))
    expect(settings().calendarPosts[APEX]).toEqual({ messageId: fresh.messageId, channelId: CHANNELS[0]!.id })
    expect(ok(await api.postCalendar(APEX, { channelId: CHANNELS[0]!.id, messageId: fresh.messageId })).refreshed).toBe(true)
  })

  it('Midnight has a live calendar message that can be updated in place', async () => {
    const { api, settings } = setup()
    const stored = settings().calendarPosts[MIDNIGHT]!
    expect(ok(await api.postCalendar(MIDNIGHT, { channelId: stored.channelId, messageId: stored.messageId })).refreshed).toBe(true)
  })

  it('nobotperms: posting the calendar is refused with bot_cannot_send and nothing is remembered', async () => {
    const { api, settings } = setup('nobotperms')
    const before = settings().calendarPosts
    expect(code(await api.postCalendar(MIDNIGHT, { channelId: CHANNELS[0]!.id }))).toBe('bot_cannot_send')
    expect(settings().calendarPosts).toEqual(before)
  })
})

describe('team cases', () => {
  it('Apex has a team without drivers and a driver who has left the server; Midnight a team with a very long name', async () => {
    const { api } = setup()
    const teams = ok(await api.teams(APEX))
    expect(teams.find((team) => team.drivers.length === 0)?.name).toBe('Reserve Squad')
    expect(teams.find((team) => team.name === 'Red Racing')?.drivers.map((driver) => driver.number)).toEqual([1, 4, 16])
    expect(ok(await api.teams(MIDNIGHT)).some((team) => team.name.length > 40)).toBe(true)
  })

  it('creating a team: a duplicate name (any case) is refused with team_exists, a bot without Manage Roles creates nothing', async () => {
    const { api } = setup()
    expect(code(await api.createTeam(APEX, { name: 'red racing', color: '#FF0000', abbreviation: 'RED' }))).toBe('team_exists')
    ok(await api.createTeam(APEX, { name: 'Green Team', color: '#00FF00', abbreviation: 'GRN' }))
    const bot = setup('nobotperms')
    const count = ok(await bot.api.teams(APEX)).length
    expect(code(await bot.api.createTeam(APEX, { name: 'Nope', color: '#00FF00', abbreviation: 'NOP' }))).toBe('bot_missing_manage_roles')
    expect(ok(await bot.api.teams(APEX))).toHaveLength(count)
  })

  it('adds a driver found by the member search, and removing keeps the points; a driver who left the server can still be removed', async () => {
    const { api } = setup()
    const found = ok(await api.members(APEX, 'oscar'))
    expect(found.members.map((member) => member.displayName)).toEqual(['Oscar Piastri'])
    expect(ok(await api.members(APEX, 'charles')).members).toEqual([]) // left the server
    expect(code(await api.addDriver(APEX, 'Reserve Squad', { userId: mid(999), number: 5 }))).toBe('member_not_found')
    const added = ok(await api.addDriver(APEX, 'Reserve Squad', { userId: mid(11), number: 5 }))
    expect(added.team.drivers).toHaveLength(1)
    const before = ok(await api.driver(APEX, mid(11)))
    const removed = ok(await api.removeDriver(APEX, 'Reserve Squad', mid(11)))
    expect(removed).toMatchObject({ roleRemoved: true, memberInServer: true })
    expect(ok(await api.driver(APEX, mid(11)))).toMatchObject({ points: before.points, team: '—' })
    const left = ok(await api.removeDriver(APEX, 'Red Racing', mid(3)))
    expect(left).toMatchObject({ roleRemoved: false, memberInServer: false })
    expect(code(await api.removeDriver(APEX, 'Red Racing', mid(3)))).toBe('driver_not_found')
  })
})

describe('race result cases', () => {
  const race = (over: Record<string, unknown> = {}) => ({ season: '6', round: '1', circuit: 'Spa', results: [mid(2), mid(1), mid(4)], ...over })

  it('the server awards the points; recording adds them (and a confirmed second recording adds them again)', async () => {
    const { api, settings } = setup()
    const before = ok(await api.standings(APEX)).drivers.find((row) => row.userId === mid(2))!.points
    const outcome = ok(await api.recordResults(APEX, race({ fastestLap: mid(1), pole: mid(2) })))
    expect(outcome.results.map((line) => line.points)).toEqual([25, 19, 15]) // P1 25, P2 18 + fastest lap 1, P3 15
    expect(ok(await api.standings(APEX)).drivers.find((row) => row.userId === mid(2))!.points).toBe(before + 25)
    // The server's ledger now knows the race: without the confirmation the second recording is refused and changes nothing.
    expect(code(await api.recordResults(APEX, race()))).toBe('results_already_recorded')
    expect(ok(await api.standings(APEX)).drivers.find((row) => row.userId === mid(2))!.points).toBe(before + 25)
    expect(ok(await api.recordResults(APEX, race({ confirmDuplicate: true }))).ledger).toEqual({ recorded: true, duplicate: true })
    expect(ok(await api.standings(APEX)).drivers.find((row) => row.userId === mid(2))!.points).toBe(before + 50)
    expect(findLedgerEntries(settings().ledger, APEX, '6', '1')).toHaveLength(2)
  })

  it('Apex starts with Season 5 round 3 in both ledgers: the one on the server and the one of this app', async () => {
    const { api, settings } = setup()
    expect(findLedgerEntries(settings().ledger, APEX, '5', '3')).toHaveLength(1)
    expect(ok(await api.resultsLedger(APEX, { season: '5', round: '3' }))).toEqual([expect.objectContaining({ season: '5', round: '3', circuit: 'Zandvoort', recordedBy: 'DemoStaff' })])
    expect(ok(await api.resultsLedger(APEX, { season: ' S5 ' }))).toEqual([])
    expect(ok(await api.resultsLedger(MIDNIGHT))).toEqual([])
  })

  it('results_already_recorded: season and round are compared as trimmed, case-insensitive text; the answer changes nothing', async () => {
    const { api, settings } = setup()
    const before = ok(await api.standings(APEX))
    expect(code(await api.recordResults(APEX, race({ season: ' 5 ', round: '3' })))).toBe('results_already_recorded')
    expect(ok(await api.standings(APEX))).toEqual(before)
    expect(findLedgerEntries(settings().ledger, APEX, '5', '3')).toHaveLength(1) // no new local entry either
    expect(code(await api.recordResults(APEX, race({ season: '5', round: '03' })))).toBe('ok') // "03" is not "3" for the server
  })

  it('a circuit containing "late-duplicate": the ledger read shows nothing, the POST still answers 409 until confirm_duplicate is sent', async () => {
    const { api } = setup()
    expect(ok(await api.resultsLedger(APEX, { season: '6', round: '1' }))).toEqual([])
    expect(code(await api.recordResults(APEX, race({ circuit: 'late-duplicate' })))).toBe('results_already_recorded')
    expect(ok(await api.recordResults(APEX, race({ circuit: 'late-duplicate', confirmDuplicate: true }))).ledger?.duplicate).toBe(true)
  })

  it('noledger: the ledger endpoint fails (the form falls back to its local record)', async () => {
    const { api } = setup('noledger')
    expect(code(await api.resultsLedger(APEX, { season: '5', round: '3' }))).toBe('internal_error')
    expect(code(await api.recordResults(APEX, race({ season: '9' })))).toBe('ok') // recording itself works
  })

  it('the results channel is checked before anything is recorded: bot_cannot_send, forbidden and channel_not_found record nothing', async () => {
    const { api, settings } = setup()
    const before = ok(await api.standings(APEX))
    expect(code(await api.recordResults(APEX, race({ channelId: LOCKED })))).toBe('bot_cannot_send')
    expect(code(await api.recordResults(APEX, race({ channelId: HIDDEN })))).toBe('forbidden')
    expect(code(await api.recordResults(APEX, race({ channelId: '777000000000000555' })))).toBe('channel_not_found')
    expect(ok(await api.standings(APEX))).toEqual(before)
    expect(ok(await api.resultsLedger(APEX, { season: '6', round: '1' }))).toEqual([])
    expect(findLedgerEntries(settings().ledger, APEX, '6', '1')).toHaveLength(0)
  })

  it('a channel that works gets the three embeds; a post that fails afterwards leaves the points recorded and says so (announce_error)', async () => {
    const { api } = setup()
    const posted = ok(await api.recordResults(APEX, race({ channelId: CHANNELS[1]!.id })))
    expect(posted.posted?.messageIds).toHaveLength(3)
    expect(posted.announceError).toBeNull()
    const failed = ok(await api.recordResults(APEX, race({ round: '2', channelId: TIMEOUT })))
    expect(failed).toMatchObject({ posted: null, announceError: 'discord_error' })
    expect(failed.results.length).toBeGreaterThan(0) // recorded
  })

  it('a driver the server does not know scores nothing and is listed as not found', async () => {
    const { api } = setup()
    const outcome = ok(await api.recordResults(APEX, race({ results: [mid(2), mid(30)] })))
    expect(outcome.notFound).toEqual(['marshal_sam'])
    expect(outcome.results[1]).toMatchObject({ matched: false, points: 0 })
  })

  it('nofia: recording and saving the points system are refused with fia_required, standings stay readable', async () => {
    const { api, settings } = setup('nofia')
    expect(code(await api.recordResults(APEX, race()))).toBe('fia_required')
    expect(code(await api.savePointsSystem(APEX, { points: Array(20).fill(1) as number[], pole: 0, fastestLap: 1 }))).toBe('fia_required')
    expect(ok(await api.standings(APEX)).drivers.length).toBeGreaterThan(0)
    expect(findLedgerEntries(settings().ledger, APEX, '6', '1')).toHaveLength(0)
  })

  it('a circuit containing "ambiguous" answers 400 ambiguous_name when a fastest lap or pole is chosen, and records nothing', async () => {
    const { api, settings } = setup()
    const before = ok(await api.standings(APEX))
    expect(code(await api.recordResults(APEX, race({ circuit: 'ambiguous test', fastestLap: mid(1) })))).toBe('ambiguous_name')
    expect(ok(await api.standings(APEX))).toEqual(before)
    expect(findLedgerEntries(settings().ledger, APEX, '6', '1')).toHaveLength(0)
  })

  it('a lost answer (circuit "timeout", or the lostresults scenario): the race IS recorded, the answer is a timeout, and the ledger stays untouched', async () => {
    for (const [scenario, circuit] of [['normal', 'Spa timeout'], ['lostresults', 'Spa']] as const) {
      const { api, settings } = setup(scenario)
      const before = ok(await api.standings(APEX)).drivers.find((row) => row.userId === mid(2))!.points
      const result = await api.recordResults(APEX, race({ circuit }))
      expect(result.ok ? 'ok' : result.error.kind, scenario).toBe('timeout')
      expect(ok(await api.standings(APEX)).drivers.find((row) => row.userId === mid(2))!.points, scenario).toBe(before + 25)
      expect(findLedgerEntries(settings().ledger, APEX, '6', '1'), scenario).toHaveLength(0)
    }
  })

  it('the points system starts as the defaults in Apex, custom in Midnight; saving it makes it custom', async () => {
    const { api } = setup()
    expect(ok(await api.pointsSystem(APEX)).isDefault).toBe(true)
    expect(ok(await api.pointsSystem(MIDNIGHT)).isDefault).toBe(false)
    const saved = ok(await api.savePointsSystem(APEX, { points: [10, 9, 8, ...Array(17).fill(0)] as number[], pole: 2, fastestLap: 3 }))
    expect(saved).toMatchObject({ isDefault: false, pole: 2, fastestLap: 3 })
    expect(saved.points).toHaveLength(20)
    // The built-in table comes with every answer, also after a custom system was saved ("Reset to defaults").
    expect(saved.defaults).toMatchObject({ pole: 0, fastestLap: 1 })
    expect(saved.defaults?.points.slice(0, 3)).toEqual([25, 18, 15])
    expect(ok(await api.pointsSystem(MIDNIGHT)).defaults?.points[0]).toBe(25)
  })
})
