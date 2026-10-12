import { describe, expect, it } from 'vitest'
import type { RacingTeamRole, Role } from '../../shared/types'
import { bigPingText, confirmView, memberCountText, needsBigPingCheck, pingableRoles, pingedMismatchNote, pingOptions, PING_CONFIRM_SENTENCE, resolvePingRoles, teamRoleSelection, viewOfRole } from './pingRoles'

const G = '555000000000000001'
const id = (n: number): string => `82000000000000${String(n).padStart(4, '0')}`
const role = (n: number, name: string, over: Partial<Role> = {}): Role => ({
  id: id(n), name, color: null, position: 10 - n, managed: false, assignable: true, privileged: false, mentionable: true, memberCount: 10, memberCountApproximate: false, ...over
})
const teamRole = (n: number, over: Partial<RacingTeamRole> = {}): RacingTeamRole => ({ roleId: id(n), name: `Team ${n}`, team: `Team ${n}`, mentionable: true, ...over })

const ROLES: Role[] = [
  role(1, 'Drivers'),
  role(2, 'Big Group', { memberCount: 60 }),
  role(3, 'Quiet', { mentionable: false }),
  role(4, 'Counting', { memberCount: 14, memberCountApproximate: true }),
  role(5, 'Nexus Bot', { managed: true }),
  role(6, '@everyone'),
  role(7, '@here'),
  { ...role(8, 'Server-id role'), id: G }
]

describe('member counts', () => {
  it('says "N members", "about N members" while the cache is incomplete, and handles one and unknown', () => {
    expect(memberCountText({ memberCount: 12, approximate: false })).toBe('12 members')
    expect(memberCountText({ memberCount: 12, approximate: true })).toBe('about 12 members')
    expect(memberCountText({ memberCount: 1, approximate: false })).toBe('1 member')
    expect(memberCountText({ memberCount: 1, approximate: true })).toBe('about 1 member')
    expect(memberCountText({ memberCount: 0, approximate: false })).toBe('0 members')
    expect(memberCountText({ memberCount: null, approximate: true })).toBe('member count unknown')
  })
})

describe('what the picker offers', () => {
  const options = pingOptions(ROLES, G, [])
  it('never offers @everyone, @here, the server-id role or a bot-managed role', () => {
    expect(pingableRoles(ROLES, G).map((item) => item.name)).toEqual(['Drivers', 'Big Group', 'Quiet', 'Counting'])
    expect(options.map((option) => option.label)).toEqual(['Drivers', 'Big Group', 'Quiet', 'Counting'])
    for (const banned of ['@everyone', '@here', 'Nexus Bot', 'Server-id role']) expect(options.some((option) => option.label === banned)).toBe(false)
  })
  it('shows the member count on every role, "about" when approximate', () => {
    expect(options.map((option) => option.badge)).toEqual(['10 members', '60 members', '10 members', 'about 14 members'])
  })
  it('a role that is not mentionable stays selectable but says so', () => {
    const quiet = options.find((option) => option.label === 'Quiet')
    expect(quiet?.disabled).toBeUndefined()
    expect(quiet?.description).toContain('Not mentionable')
    expect(options.find((option) => option.label === 'Drivers')?.description).toBeUndefined()
  })
  it('a role that is already chosen is shown as taken and cannot be added twice', () => {
    const taken = pingOptions(ROLES, G, [id(1)]).find((option) => option.value === id(1))
    expect(taken).toMatchObject({ disabled: true })
    expect(taken?.description).toContain('Already chosen')
  })
})

describe('resolving the chosen roles', () => {
  it('keeps the order chosen and the count and mentionable flag of each', () => {
    const views = resolvePingRoles([id(3), id(1)], ROLES)
    expect(views.map((view) => view.name)).toEqual(['Quiet', 'Drivers'])
    expect(views[0]).toMatchObject({ mentionable: false, memberCount: 10, big: false, missing: false })
  })
  it('a role that is not in the list any more stays removable, with an unknown count that counts as big', () => {
    const [gone] = resolvePingRoles([id(99)], ROLES)
    expect(gone).toMatchObject({ id: id(99), missing: true, memberCount: null, big: true, mentionable: false })
  })
})

describe('"All {game} team roles"', () => {
  it('fills in the team roles that the server lists and that may be pinged (up to 3)', () => {
    expect(teamRoleSelection([teamRole(1), teamRole(4)], ROLES, G)).toEqual({ ids: [id(1), id(4)], problem: null })
  })
  it('a duplicate role id counts once', () => {
    expect(teamRoleSelection([teamRole(1), teamRole(1, { team: 'Other' })], ROLES, G)).toEqual({ ids: [id(1)], problem: null })
  })
  it('never fills in a managed role, @everyone or @here, even if a team role endpoint listed it', () => {
    expect(teamRoleSelection([teamRole(5), teamRole(6), teamRole(7), { ...teamRole(8), roleId: G }], ROLES, G)).toEqual({ ids: [], problem: 'none' })
    expect(teamRoleSelection([teamRole(1), teamRole(5)], ROLES, G)).toEqual({ ids: [id(1)], problem: null })
  })
  it('a team role the server does not list is left out', () => {
    expect(teamRoleSelection([teamRole(1), teamRole(50)], ROLES, G).ids).toEqual([id(1)])
  })
  it('no team roles: nothing is filled in and it says why', () => {
    expect(teamRoleSelection([], ROLES, G)).toEqual({ ids: [], problem: 'none' })
  })
  it('more than 3 is not picked for the user: nothing is filled in', () => {
    const many = [1, 2, 3, 4].map((n) => teamRole(n))
    expect(teamRoleSelection(many, ROLES, G)).toEqual({ ids: [], problem: 'too-many' })
  })
})

describe('the confirmation', () => {
  const pick = (...n: number[]) => resolvePingRoles(n.map(id), ROLES)

  it('nobody pinged: no sentence, nothing to tick, the post can go', () => {
    expect(confirmView([], false)).toEqual({ sentence: null, warnNotMentionable: false, needsCheck: false, canConfirm: true })
  })

  it('with roles it always says that pings notify members immediately and cannot be undone', () => {
    expect(confirmView(pick(1), false).sentence).toBe('Pings notify members immediately and cannot be undone.')
    expect(PING_CONFIRM_SENTENCE).toBe('Pings notify members immediately and cannot be undone.')
  })

  it('a small role needs no checkbox', () => {
    expect(confirmView(pick(1), false)).toMatchObject({ needsCheck: false, canConfirm: true })
  })

  it('a role with more than 50 members blocks the confirm button until the checkbox is ticked', () => {
    expect(confirmView(pick(2), false)).toMatchObject({ needsCheck: true, canConfirm: false })
    expect(confirmView(pick(2), true)).toMatchObject({ needsCheck: true, canConfirm: true })
    expect(confirmView(pick(1, 2), false).canConfirm).toBe(false)
  })

  it('exactly 50 members is not big; an approximate 50 may be more and is', () => {
    expect(needsBigPingCheck(resolvePingRoles([id(1)], [role(1, 'Fifty', { memberCount: 50 })]))).toBe(false)
    expect(needsBigPingCheck(resolvePingRoles([id(1)], [role(1, 'Fifty', { memberCount: 50, memberCountApproximate: true })]))).toBe(true)
  })

  it('a role that is gone or has no count also needs the checkbox', () => {
    expect(confirmView(resolvePingRoles([id(99)], ROLES), false).canConfirm).toBe(false)
    expect(confirmView(resolvePingRoles([id(1)], [role(1, 'No count', { memberCount: null, memberCountApproximate: true })]), false).canConfirm).toBe(false)
  })

  it('a role that is not mentionable adds a warning, and does not need the checkbox by itself', () => {
    expect(confirmView(pick(3), false)).toMatchObject({ warnNotMentionable: true, needsCheck: false, canConfirm: true })
  })

  it('explains why a role is big in words', () => {
    expect(bigPingText(viewOfRole(ROLES[1]!))).toBe('Big Group has 60 members, more than 50.')
    expect(bigPingText(resolvePingRoles([id(99)], ROLES)[0]!)).toContain('could not be read')
  })
})

describe('what the server says was pinged', () => {
  it('no note when nobody was asked for, or when the answer agrees', () => {
    expect(pingedMismatchNote([], [])).toBeNull()
    expect(pingedMismatchNote([id(1)], [{ id: id(1), name: 'Drivers' }])).toBeNull()
  })
  it('a note when the answer lists nobody or fewer roles than were asked for', () => {
    expect(pingedMismatchNote([id(1)], [])).toContain('did not say')
    expect(pingedMismatchNote([id(1), id(2)], [{ id: id(1), name: 'Drivers' }])).toContain('fewer')
  })
})
