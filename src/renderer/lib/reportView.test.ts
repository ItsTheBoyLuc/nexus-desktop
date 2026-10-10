import { describe, expect, it } from 'vitest'
import type { Report } from '../../shared/types'
import { evidenceImage, httpsUrl, isOpen, mergeReports, REPORT_GETTERS, reportSearchFields, seasonFromReport, splitDrivers, statusLabel } from './reportView'
import { matchesQuery, sortRows } from './tableView'

const report = (over: Partial<Report> = {}): Report => ({
  id: 'r1', number: 1, roundKey: 'S5R3', season: '5', round: '3', circuit: 'Zandvoort', reporter: 'alice', reporterId: null, driversInvolved: 'alice, bob', lap: '4',
  description: 'Contact at T1', evidenceUrl: null, evidenceImg: null, status: 'pending', decided: false, penalty: null, decision: null, threadName: 't', messageId: '1', timestamp: '2026-01-01T00:00:00Z', ...over
})

describe('status', () => {
  it('has a plain label for every status (the server\'s emoji label is not used)', () => {
    expect(statusLabel('pending')).toBe('Awaiting review')
    expect(statusLabel('under_investigation')).toBe('Under investigation')
    expect(statusLabel('penalty_issued')).toBe('Penalty issued')
    expect(statusLabel('no_further_action')).toBe('No further action')
  })

  it('pending and under-investigation reports are open; decided ones are not', () => {
    expect(isOpen(report())).toBe(true)
    expect(isOpen(report({ status: 'under_investigation' }))).toBe(true)
    expect(isOpen(report({ status: 'penalty_issued', decided: true }))).toBe(false)
    expect(isOpen(report({ status: 'no_further_action', decided: true }))).toBe(false)
  })
})

describe('sorting and searching the table', () => {
  const rows = [
    report({ id: 'a', roundKey: 'S5R10', number: 1, timestamp: '2026-03-01T00:00:00Z', status: 'penalty_issued', decided: true }),
    report({ id: 'b', roundKey: 'S5R9', number: 2, timestamp: '2026-02-01T00:00:00Z' }),
    report({ id: 'c', roundKey: 'S5R9', number: 10, timestamp: 'not a date', status: 'no_further_action', decided: true }),
    report({ id: 'd', roundKey: 'S5R9', number: 1, timestamp: '2026-01-01T00:00:00Z' })
  ]
  const ids = (sorted: Report[]): string[] => sorted.map((row) => row.id)

  it('orders by round naturally (S5R9 before S5R10) and by the number inside the round', () => {
    expect(ids(sortRows(rows, { key: 'report', direction: 'asc' }, REPORT_GETTERS))).toEqual(['d', 'b', 'c', 'a'])
  })

  it('orders by status (open first) and by filing date, with unreadable dates last', () => {
    expect(ids(sortRows(rows, { key: 'status', direction: 'asc' }, REPORT_GETTERS))).toEqual(['b', 'd', 'a', 'c'])
    expect(ids(sortRows(rows, { key: 'filed', direction: 'desc' }, REPORT_GETTERS))).toEqual(['a', 'b', 'd', 'c'])
  })

  it('searches the round, the number, the circuit, the drivers, the reporter, the text and the status', () => {
    const target = report({ circuit: 'Spa-Francorchamps', driversInvolved: 'Max, Lando', reporter: 'Rita', description: 'Divebomb at Eau Rouge', status: 'no_further_action', decided: true })
    for (const query of ['s5r3', '#1', 'spa', 'lando', 'rita', 'eau rouge', 'no further', 'max divebomb']) expect(matchesQuery(reportSearchFields(target), query), query).toBe(true)
    expect(matchesQuery(reportSearchFields(target), 'monza')).toBe(false)
  })
})

describe('paging', () => {
  it('a later page never lists a report twice, even when new reports shifted the pages', () => {
    const merged = mergeReports([report({ id: 'a' }), report({ id: 'b' })], [report({ id: 'b' }), report({ id: 'c' })])
    expect(merged.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('driver names of a report', () => {
  it('splits "a, b", "a and b", "a & b" and line breaks into separate names, once each', () => {
    expect(splitDrivers('Max Verstappen, Lando Norris')).toEqual(['Max Verstappen', 'Lando Norris'])
    expect(splitDrivers('alice and bob')).toEqual(['alice', 'bob'])
    expect(splitDrivers('alice & bob; @carol\nALICE')).toEqual(['alice', 'bob', 'carol'])
    expect(splitDrivers('  ,  ')).toEqual([])
  })

  it('keeps names the form could not send out (over 100 characters) and caps the list', () => {
    expect(splitDrivers(`${'x'.repeat(101)}, bob`)).toEqual(['bob'])
    expect(splitDrivers(Array.from({ length: 30 }, (_, index) => `d${index}`).join(','))).toHaveLength(10)
  })

  it('markup in a name stays plain text', () => {
    expect(splitDrivers('<b>x</b>, <script>')).toEqual(['<b>x</b>', '<script>'])
  })
})

describe('the season of a report', () => {
  it('is a number only when the text is one from 1 to 99999', () => {
    expect(seasonFromReport({ season: ' 5 ' })).toBe(5)
    for (const text of ['', 'Spring', '0', '100000', '5a', '-1']) expect(seasonFromReport({ season: text }), text).toBeNull()
  })
})

describe('evidence links and images: https only, and only what the policy allows is rendered', () => {
  it('httpsUrl accepts plain https links and nothing else', () => {
    expect(httpsUrl('https://discord.com/channels/1/2/3')).toBe('https://discord.com/channels/1/2/3')
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', 'file:///c:/x', 'ftp://x.test', 'https://user:pw@example.com/', 'https://a b.test', '', 'not a url', null, undefined]) {
      expect(httpsUrl(bad), String(bad)).toBeNull()
    }
  })

  it('an https image on Discord\'s CDN is shown; another https host is only a link; http and junk are never rendered', () => {
    expect(evidenceImage('https://cdn.discordapp.com/attachments/1/2/a.png')).toEqual({ kind: 'inline', src: 'https://cdn.discordapp.com/attachments/1/2/a.png' })
    expect(evidenceImage('https://i.imgur.com/x.png')).toEqual({ kind: 'link-only', url: 'https://i.imgur.com/x.png' })
    expect(evidenceImage('http://cdn.discordapp.com/a.png')).toEqual({ kind: 'blocked' })
    expect(evidenceImage('javascript:alert(1)')).toEqual({ kind: 'blocked' })
    expect(evidenceImage('https://cdn.discordapp.com.evil.test/a.png')).toEqual({ kind: 'link-only', url: 'https://cdn.discordapp.com.evil.test/a.png' })
    expect(evidenceImage('https://cdn.discordapp.com@evil.test/a.png')).toEqual({ kind: 'blocked' }) // credentials trick
    expect(evidenceImage(null)).toEqual({ kind: 'none' })
    expect(evidenceImage('')).toEqual({ kind: 'none' })
  })
})
