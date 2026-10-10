import { describe, expect, it } from 'vitest'
import { parseRacingEventInput, parseRacingGame, parseRacingPage, parseRacingTeamInput, parseRacingTeamName, parseRosterAddInput } from './racingInputs'
import { isPastDate, isRacingGame, longDate, parseEventDate, previewEventDate, RACING_GAMES, validateRacingEventDraft, validateRacingPage, validateRacingTeamDraft, validateRosterAddDraft } from './racingValidation'
import type { RacingEventDraft } from './racingValidation'
import { GAME_KEYS, isRacingRole, RACING_ROLES } from './types'

const U1 = '200000000000000001'
const long = (length: number): string => 'x'.repeat(length)
const errorKeys = (result: { ok: boolean; errors?: Record<string, string | undefined> }): string[] => (result.ok ? [] : Object.keys(result.errors ?? {}))

describe('the five games', () => {
  it('are exactly lmu, iracing, gt7, acc and f1; anything else is not a game with an esports team', () => {
    expect([...RACING_GAMES].sort()).toEqual(['acc', 'f1', 'gt7', 'iracing', 'lmu'])
    expect(RACING_GAMES).toEqual(GAME_KEYS)
    for (const game of GAME_KEYS) expect(isRacingGame(game), game).toBe(true)
    for (const bad of ['', 'F1', 'f2', 'lmu ', 'racing', 'f1/../lmu', null, undefined, 5]) expect(isRacingGame(bad), String(bad)).toBe(false)
  })

  it('the main process refuses an unknown game before anything else', () => {
    expect(parseRacingGame('iracing')).toEqual({ ok: true, value: 'iracing' })
    expect(parseRacingGame('forza').ok).toBe(false)
  })
})

describe('the roster role dropdown', () => {
  it('offers exactly Race Driver, Reserve, Coach and Manager, in that order, and nothing free-text', () => {
    expect([...RACING_ROLES]).toEqual(['Race Driver', 'Reserve', 'Coach', 'Manager'])
  })

  it('accepts only those four, spelled exactly as the dropdown spells them', () => {
    for (const role of RACING_ROLES) expect(isRacingRole(role), role).toBe(true)
    for (const bad of ['', 'race driver', 'MANAGER', 'Captain', 'Manager ', 'Driver', 'Reserve driver', 5, null]) expect(isRacingRole(bad), String(bad)).toBe(false)
  })

  it('a roster entry needs a team, a member (by id) and one of the roles', () => {
    expect(validateRosterAddDraft({ team: ' Fake Team ', userId: U1, role: 'Manager' })).toEqual({ ok: true, value: { team: 'Fake Team', userId: U1, role: 'Manager' } })
    expect(errorKeys(validateRosterAddDraft({ team: '', userId: U1, role: 'Manager' }))).toEqual(['team'])
    expect(errorKeys(validateRosterAddDraft({ team: 'T', userId: '', role: 'Manager' }))).toEqual(['userId'])
    expect(errorKeys(validateRosterAddDraft({ team: 'T', userId: U1, role: '' }))).toEqual(['role'])
    expect(errorKeys(validateRosterAddDraft({ team: 'T', userId: U1, role: 'Captain' }))).toEqual(['role'])
  })

  it('the main process refuses a role that is not in the dropdown', () => {
    expect(parseRosterAddInput({ team: 'T', userId: U1, role: 'Coach' }).ok).toBe(true)
    expect(parseRosterAddInput({ team: 'T', userId: U1, role: 'coach' }).ok).toBe(false)
    expect(parseRosterAddInput({ team: 'T', userId: 'alice', role: 'Coach' }).ok).toBe(false)
  })
})

describe('creating a team', () => {
  const draft = { name: 'Fake Team Alpha', color: '#1e41ff', focus: '' }

  it('needs a name and a colour; the colour is upper-cased and the focus is left out when empty', () => {
    expect(validateRacingTeamDraft(draft)).toEqual({ ok: true, value: { name: 'Fake Team Alpha', color: '#1E41FF' } })
    expect(errorKeys(validateRacingTeamDraft({ ...draft, name: ' ' }))).toEqual(['name'])
    expect(errorKeys(validateRacingTeamDraft({ ...draft, name: long(51) }))).toEqual(['name'])
    expect(errorKeys(validateRacingTeamDraft({ ...draft, name: 'two\nlines' }))).toEqual(['name'])
    expect(validateRacingTeamDraft({ ...draft, name: long(50) }).ok).toBe(true)
    for (const color of ['', 'blue', '#12345', '#GGGGGG', '1E41FF']) expect(errorKeys(validateRacingTeamDraft({ ...draft, color })), color).toEqual(['color'])
  })

  it('the class or category is FREE TEXT for every game: up to 30 characters on one line, never a fixed list', () => {
    for (const focus of ['GT3', 'Hypercar', 'LMP2 Pro-Am', 'Anything I like 42', 'Öl & Vinegar', '**bold**']) {
      expect(validateRacingTeamDraft({ ...draft, focus }), focus).toEqual({ ok: true, value: { name: 'Fake Team Alpha', color: '#1E41FF', focus } })
    }
    expect(validateRacingTeamDraft({ ...draft, focus: long(30) }).ok).toBe(true)
    expect(errorKeys(validateRacingTeamDraft({ ...draft, focus: long(31) }))).toEqual(['focus'])
    expect(errorKeys(validateRacingTeamDraft({ ...draft, focus: 'a\nb' }))).toEqual(['focus'])
  })

  it('the main process re-checks it', () => {
    expect(parseRacingTeamInput({ name: 'Fake', color: '#112233', focus: 'GT3' })).toEqual({ ok: true, value: { name: 'Fake', color: '#112233', focus: 'GT3' } })
    expect(parseRacingTeamInput({ name: '', color: '#112233' }).ok).toBe(false)
    expect(parseRacingTeamName(' Fake ')).toEqual({ ok: true, value: 'Fake' })
    expect(parseRacingTeamName(long(51)).ok).toBe(false)
  })
})

describe('reading an event date exactly like the bot', () => {
  it('knows the five formats, tried in the documented order', () => {
    expect(parseEventDate('2026-09-14')).toEqual({ iso: '2026-09-14', format: 'YYYY-MM-DD', ambiguous: false })
    expect(parseEventDate('14-09-2026')).toEqual({ iso: '2026-09-14', format: 'DD-MM-YYYY', ambiguous: false })
    expect(parseEventDate('09/14/2026')).toEqual({ iso: '2026-09-14', format: 'MM/DD/YYYY', ambiguous: false })
    expect(parseEventDate('14/09/2026')).toEqual({ iso: '2026-09-14', format: 'DD/MM/YYYY', ambiguous: false })
    expect(parseEventDate('2026/09/14')).toEqual({ iso: '2026-09-14', format: 'YYYY/MM/DD', ambiguous: false })
  })

  it('03/04/2026 is March 4th (MM/DD/YYYY is tried before DD/MM/YYYY), and it is flagged as ambiguous', () => {
    expect(parseEventDate('03/04/2026')).toEqual({ iso: '2026-03-04', format: 'MM/DD/YYYY', ambiguous: true })
    expect(parseEventDate('3/4/2026')).toMatchObject({ iso: '2026-03-04', ambiguous: true })
  })

  it('a slash date with the same day and month, or only one possible reading, is not ambiguous', () => {
    expect(parseEventDate('12/12/2026')).toMatchObject({ iso: '2026-12-12', ambiguous: false })
    expect(parseEventDate('13/04/2026')).toMatchObject({ iso: '2026-04-13', format: 'DD/MM/YYYY', ambiguous: false })
    expect(parseEventDate('04/13/2026')).toMatchObject({ iso: '2026-04-13', format: 'MM/DD/YYYY', ambiguous: false })
  })

  it('refuses what the bot cannot read: not a real date, another format, or text', () => {
    for (const bad of ['', '   ', 'tomorrow', 'next friday', '2026-02-30', '2026-13-01', '31/04/2026', '31/31/2026', '1/1/26', '2026-9', '14.09.2026', '14 Sep 2026', '2026-09-14T20:00', '09/14', '０３/０４/２０２６']) {
      expect(parseEventDate(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('knows leap years', () => {
    expect(parseEventDate('2028-02-29')?.iso).toBe('2028-02-29')
    expect(parseEventDate('2026-02-29')).toBeNull()
  })

  it('writes a date out in full', () => {
    expect(longDate('2026-03-04')).toBe('Wednesday 4 March 2026')
    expect(longDate('2026-09-14')).toBe('Monday 14 September 2026')
    expect(longDate('not a date')).toBe('not a date')
  })

  it('the preview says "interpreted as" what the bot will read, or why it cannot be read', () => {
    expect(previewEventDate('2026-09-14')).toEqual({ ok: true, iso: '2026-09-14', label: 'Monday 14 September 2026', ambiguous: false })
    expect(previewEventDate('03/04/2026')).toMatchObject({ ok: true, label: 'Wednesday 4 March 2026', ambiguous: true })
    expect(previewEventDate('')).toMatchObject({ ok: false, message: 'Choose a date.' })
    const bad = previewEventDate('someday')
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.message).toMatch(/keep it forever and list the event last/)
  })

  it('spots a date in the past (it would not show in the list of upcoming events)', () => {
    expect(isPastDate('2026-01-01', '2026-10-10')).toBe(true)
    expect(isPastDate('2026-10-10', '2026-10-10')).toBe(false)
    expect(isPastDate('2027-01-01', '2026-10-10')).toBe(false)
  })
})

describe('adding an event', () => {
  const draft: RacingEventDraft = { name: 'Fake_Event', date: '2026-09-14', time: '20:00', zone: 'UTC', class: '', notes: '' }

  it('sends the date exactly as YYYY-MM-DD and the time as "HH:MM zone"; class and notes only when given', () => {
    expect(validateRacingEventDraft(draft)).toEqual({ ok: true, value: { name: 'Fake_Event', date: '2026-09-14', time: '20:00 UTC' } })
    expect(validateRacingEventDraft({ ...draft, class: ' Hypercar ', notes: ' bring snacks ' })).toEqual({
      ok: true,
      value: { name: 'Fake_Event', date: '2026-09-14', time: '20:00 UTC', class: 'Hypercar', notes: 'bring snacks' }
    })
  })

  it('refuses an unparseable or missing date, and any date that is not what the picker gives (so 03/04/2026 can never be sent)', () => {
    expect(errorKeys(validateRacingEventDraft({ ...draft, date: '' }))).toEqual(['date'])
    expect(errorKeys(validateRacingEventDraft({ ...draft, date: 'someday' }))).toEqual(['date'])
    expect(errorKeys(validateRacingEventDraft({ ...draft, date: '2026-02-30' }))).toEqual(['date'])
    for (const text of ['03/04/2026', '14/09/2026', '2026-9-14', '14-09-2026', '2026/09/14']) {
      const result = validateRacingEventDraft({ ...draft, date: text })
      expect(errorKeys(result), text).toEqual(['date'])
      expect(!result.ok && result.errors.date, text).toMatch(/date picker/)
    }
  })

  it('applies the limits: name 1-100, time HH:MM, a short zone, "time zone" at most 20 characters, class at most 30, notes at most 300', () => {
    expect(errorKeys(validateRacingEventDraft({ ...draft, name: '' }))).toEqual(['name'])
    expect(errorKeys(validateRacingEventDraft({ ...draft, name: long(101) }))).toEqual(['name'])
    expect(validateRacingEventDraft({ ...draft, name: long(100) }).ok).toBe(true)
    for (const time of ['', '25:00', '20:60', '8:00', '20-00']) expect(errorKeys(validateRacingEventDraft({ ...draft, time })), time).toEqual(['time'])
    for (const zone of ['', 'two words', long(11), 'U T C']) expect(errorKeys(validateRacingEventDraft({ ...draft, zone })), zone).toEqual(['zone'])
    expect(validateRacingEventDraft({ ...draft, zone: 'UTC+2' })).toMatchObject({ ok: true, value: { time: '20:00 UTC+2' } })
    expect(errorKeys(validateRacingEventDraft({ ...draft, class: long(31) }))).toEqual(['class'])
    expect(validateRacingEventDraft({ ...draft, class: long(30) }).ok).toBe(true)
    expect(errorKeys(validateRacingEventDraft({ ...draft, notes: long(301) }))).toEqual(['notes'])
    expect(validateRacingEventDraft({ ...draft, notes: long(300) }).ok).toBe(true)
  })

  it('text is untrusted but valid input: markup is just text', () => {
    const result = validateRacingEventDraft({ ...draft, name: '<script>alert(1)</script>', notes: '<b>x</b>' })
    expect(result).toMatchObject({ ok: true, value: { name: '<script>alert(1)</script>', notes: '<b>x</b>' } })
  })

  it('the main process re-checks it: only the picker format, a real date, and a time with a zone', () => {
    expect(parseRacingEventInput({ name: 'E', date: '2026-09-14', time: '20:00 UTC' })).toEqual({ ok: true, value: { name: 'E', date: '2026-09-14', time: '20:00 UTC' } })
    for (const bad of [{ date: '03/04/2026' }, { date: '2026-02-30' }, { time: '20:00' }, { time: '8pm UTC' }, { name: '' }]) {
      expect(parseRacingEventInput({ name: 'E', date: '2026-09-14', time: '20:00 UTC', ...bad }).ok, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('pages', () => {
  it('limit 1-100 and offset 0 or more', () => {
    expect(validateRacingPage(undefined, undefined)).toEqual({ ok: true })
    expect(validateRacingPage(100, 200)).toEqual({ ok: true, limit: 100, offset: 200 })
    for (const [limit, offset] of [[0, 0], [101, 0], [1.5, 0], [10, -1], ['10', 0]]) expect(validateRacingPage(limit, offset).ok, `${String(limit)} ${String(offset)}`).toBe(false)
    expect(parseRacingPage({ limit: 25, offset: 50 })).toEqual({ ok: true, value: { limit: 25, offset: 50 } })
    expect(parseRacingPage({ limit: 500 }).ok).toBe(false)
  })
})
