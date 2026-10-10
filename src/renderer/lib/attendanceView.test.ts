import { describe, expect, it } from 'vitest'
import type { AttendanceDriver, DivisionResult } from '../../shared/types'
import { describeOverlap, driverLabel, OVERLAP_EXPLANATION, overlapNames } from './attendanceView'

const driver = (id: string, name: string | null): AttendanceDriver => ({ userId: id, name, inServer: name !== null })
const result = (overlap: string[], regular: AttendanceDriver[], reserve: AttendanceDriver[]): Pick<DivisionResult, 'division' | 'overlap'> => ({
  division: { name: 'Pro-Am', regularDrivers: regular, reserveDrivers: reserve },
  overlap
})

describe('the overlap warning after saving a division', () => {
  it('names every driver that is in both lists, in the order of the answer', () => {
    const answer = result(['2002', '2001'], [driver('2001', 'Ally'), driver('2002', 'Bob')], [driver('2002', 'Bob'), driver('2001', 'Ally'), driver('2003', 'Carol')])
    expect(overlapNames(answer)).toEqual(['Bob', 'Ally'])
    expect(describeOverlap(answer)).toBe('The division Pro-Am was saved, but 2 drivers are in both the regular and the reserve list: Bob, Ally.')
  })

  it('says "one driver is" for a single overlap', () => {
    expect(describeOverlap(result(['2001'], [driver('2001', 'Ally')], [driver('2001', 'Ally')]))).toMatch(/one driver is in both the regular and the reserve list: Ally\./)
  })

  it('a driver who left has no name in the answer: the screen\'s own name is used, else a plain statement', () => {
    const answer = result(['2004'], [driver('2004', null)], [driver('2004', null)])
    expect(overlapNames(answer, (id) => (id === '2004' ? 'Dave (picked just now)' : null))).toEqual(['Dave (picked just now)'])
    expect(overlapNames(answer)).toEqual(['A member who left the server'])
  })

  it('an empty overlap names nobody (the screen shows no warning then)', () => {
    expect(overlapNames(result([], [driver('2001', 'Ally')], []))).toEqual([])
  })

  it('explains what happens in Discord: marked Present at creation, then refused by the Present button', () => {
    expect(OVERLAP_EXPLANATION).toMatch(/marked Present automatically when a post is created/)
    expect(OVERLAP_EXPLANATION).toMatch(/Present button in Discord then refuses them/)
    expect(OVERLAP_EXPLANATION).toMatch(/reserve driver may only use Reserve/)
  })

  it('labels a row with a name, or says they left', () => {
    expect(driverLabel({ name: 'Ally' })).toBe('Ally')
    expect(driverLabel({ name: null })).toBe('A member who left the server')
  })
})
