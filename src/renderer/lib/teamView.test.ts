import { describe, expect, it } from 'vitest'
import type { Team, TeamDriver } from '../../shared/types'
import { canManageTeam, describeRemoval, DRIVER_GETTERS, findTeam, TEAM_GETTERS } from './teamView'
import { sortRows } from './tableView'

const driver = (over: Partial<TeamDriver> = {}): TeamDriver => ({ userId: '1', username: 'alice', displayName: 'Ally', number: 7, points: 40, wins: 1, podiums: 2, ...over })
const team = (over: Partial<Team> = {}): Team => ({ name: 'Red Racing', abbreviation: 'RED', color: '#FF0000', roleId: '9', roleName: 'Red Racing', channelId: '8', channelName: 'red-racing', points: 80, drivers: [driver()], ...over })

describe('teams screen helpers', () => {
  it('finds a team by name, ignoring case', () => {
    const teams = [team(), team({ name: 'Blue' })]
    expect(findTeam(teams, 'red racing')?.name).toBe('Red Racing')
    expect(findTeam(teams, 'Green')).toBeUndefined()
    expect(findTeam(teams, null)).toBeUndefined()
  })

  it('sorts drivers by number with the unnumbered last, and teams by points', () => {
    const drivers = [driver({ userId: 'a', number: null }), driver({ userId: 'b', number: 44 }), driver({ userId: 'c', number: 3 })]
    expect(sortRows(drivers, { key: 'number', direction: 'asc' }, DRIVER_GETTERS).map((item) => item.userId)).toEqual(['c', 'b', 'a'])
    expect(sortRows(drivers, { key: 'number', direction: 'desc' }, DRIVER_GETTERS).map((item) => item.userId)).toEqual(['b', 'c', 'a'])
    const teams = [team({ name: 'A', points: 10 }), team({ name: 'B', points: 90 })]
    expect(sortRows(teams, { key: 'points', direction: 'desc' }, TEAM_GETTERS).map((item) => item.name)).toEqual(['B', 'A'])
  })

  it('a team whose name has a slash cannot be managed from the app', () => {
    expect(canManageTeam(team())).toBe(true)
    expect(canManageTeam(team({ name: 'A/B' }))).toBe(false)
    expect(canManageTeam(team({ name: 'A\\B' }))).toBe(false)
  })

  it('reports exactly what the API returned for a removal, including a driver who left the server', () => {
    expect(describeRemoval('Ally', 'Red', { roleRemoved: true, memberInServer: true })).toMatch(/lost the team role.*points remain/)
    expect(describeRemoval('Ally', 'Red', { roleRemoved: false, memberInServer: false })).toMatch(/left the server.*points remain/)
    expect(describeRemoval('Ally', 'Red', { roleRemoved: false, memberInServer: true })).toMatch(/could not be removed/)
  })
})
