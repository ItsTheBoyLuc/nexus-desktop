import { describe, expect, it } from 'vitest'
import { appendLedgerEntry, findLedgerEntries, isLedgerEntry, MAX_LEDGER_ENTRIES, normaliseRaceText, sanitizeCalendarPosts, sanitizeLedger } from './f1Store'
import type { LedgerEntry } from './types'

const G = '555000000000000001'
const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({ guildId: G, season: '5', round: '3', circuit: 'Zandvoort', recordedAt: '2026-10-10T12:00:00.000Z', ...over })

describe('calendar post registry', () => {
  it('keeps one well-formed entry per server and drops everything else', () => {
    expect(
      sanitizeCalendarPosts({
        [G]: { messageId: '999000000000000001', channelId: '777000000000000001', extra: 'dropped' },
        'not-a-server': { messageId: '1', channelId: '2' },
        '555000000000000002': { messageId: 'abc', channelId: '2' },
        '555000000000000003': 'junk'
      })
    ).toEqual({ [G]: { messageId: '999000000000000001', channelId: '777000000000000001' } })
    expect(sanitizeCalendarPosts(null)).toEqual({})
    expect(sanitizeCalendarPosts([1, 2])).toEqual({})
  })
})

describe('race ledger', () => {
  it('the same race written differently is still the same race', () => {
    expect(normaliseRaceText(' Season  5 ')).toBe(normaliseRaceText('season 5'))
    expect(normaliseRaceText('03')).toBe('3')
    expect(normaliseRaceText('R3')).toBe('r3')
    expect(normaliseRaceText('3')).not.toBe(normaliseRaceText('13'))
  })

  it('finds earlier recordings of the same server + season + round only', () => {
    const ledger = [entry(), entry({ round: '4' }), entry({ season: '6' }), entry({ guildId: '555000000000000002' }), entry({ circuit: 'Spa' })]
    expect(findLedgerEntries(ledger, G, '5', '3').map((item) => item.circuit)).toEqual(['Zandvoort', 'Spa']) // the circuit does not matter
    expect(findLedgerEntries(ledger, G, '5', '9')).toEqual([])
    expect(findLedgerEntries([], G, '5', '3')).toEqual([])
  })

  it('validates entries: ids, short single-line text, a real time', () => {
    expect(isLedgerEntry(entry())).toBe(true)
    for (const bad of [
      entry({ guildId: 'x' }), entry({ season: '' }), entry({ season: 'x'.repeat(21) }), entry({ round: 'y'.repeat(11) }), entry({ circuit: 'z'.repeat(61) }),
      entry({ circuit: 'a\nb' }), entry({ recordedAt: 'later' }), null, 'text', { guildId: G }
    ]) {
      expect(isLedgerEntry(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('sanitizes a hand-edited file and keeps only the newest entries when it is too long', () => {
    expect(sanitizeLedger('nope')).toEqual([])
    expect(sanitizeLedger([entry(), { bad: true }, { ...entry(), extra: 'dropped' }])).toEqual([entry(), entry()])
    const many = Array.from({ length: MAX_LEDGER_ENTRIES + 5 }, (_, index) => entry({ round: String(index + 1).slice(0, 10) }))
    const kept = sanitizeLedger(many)
    expect(kept).toHaveLength(MAX_LEDGER_ENTRIES)
    expect(kept[kept.length - 1]?.round).toBe(String(MAX_LEDGER_ENTRIES + 5))
  })

  it('appends valid entries (trimmed) and ignores invalid ones', () => {
    const next = appendLedgerEntry([entry()], entry({ round: ' 4 ' }))
    expect(next.map((item) => item.round)).toEqual(['3', '4'])
    expect(appendLedgerEntry([entry()], entry({ guildId: 'bad' }))).toEqual([entry()])
    const full = Array.from({ length: MAX_LEDGER_ENTRIES }, () => entry())
    expect(appendLedgerEntry(full, entry({ round: '99' }))).toHaveLength(MAX_LEDGER_ENTRIES)
  })
})
