import { describe, expect, it } from 'vitest'
import { BIG_PING_MEMBERS, isBigPing, isPingable, isPostChannelKey, MAX_PING_ROLES, MAX_POST_CHANNELS, parsePingRoleIds, postChannelKey, sanitizePostChannels } from './pingRoles'
import { parseRacingAnnouncementInput, parseRacingAttendanceInput } from './racingInputs'
import { GAME_KEYS } from './types'

const G = '555000000000000001'
const CH = '777000000000000001'
const R = ['820000000000000001', '820000000000000002', '820000000000000003', '820000000000000004']

describe('parsePingRoleIds', () => {
  it('absent, null and an empty list mean nobody', () => {
    for (const value of [undefined, null, []]) expect(parsePingRoleIds(value, G)).toEqual({ ok: true, value: [] })
  })

  it('keeps numeric ids in order and counts duplicates once', () => {
    expect(parsePingRoleIds([R[1], R[0], R[1]], G)).toEqual({ ok: true, value: [R[1], R[0]] })
  })

  it(`allows ${MAX_PING_ROLES} roles and refuses more`, () => {
    expect(parsePingRoleIds(R.slice(0, 3), G).ok).toBe(true)
    expect(parsePingRoleIds(R, G)).toMatchObject({ ok: false, problem: { code: 'too_many_ping_roles' } })
  })

  it.each(['@everyone', '@here', 'everyone', 'here', '<@&820000000000000001>', '820000000000000001,820000000000000002', ' 820000000000000001', '8200000000000000a1', '', '0x1F', '-1', 820000000, null, undefined, {}, []])(
    'refuses %j: only numeric role ids pass, so no mention text can be smuggled in',
    (value) => {
      expect(parsePingRoleIds([value], G)).toMatchObject({ ok: false, problem: { code: 'invalid_ping_roles' } })
    }
  )

  it('refuses a value that is not a list', () => {
    for (const value of ['820000000000000001', 820000000, {}, true]) expect(parsePingRoleIds(value, G)).toMatchObject({ ok: false, problem: { code: 'invalid_ping_roles' } })
  })

  it('refuses the id of the server itself: that is the @everyone role', () => {
    expect(parsePingRoleIds([R[0], G], G)).toMatchObject({ ok: false, problem: { code: 'role_not_pingable' } })
    expect(parsePingRoleIds([G])).toEqual({ ok: true, value: [G] }) // without the server id it cannot know; the API client always passes it
  })
})

describe('what the picker may offer', () => {
  const role = (over: Record<string, unknown> = {}) => ({ id: R[0]!, name: 'Drivers', managed: false, ...over })
  it('offers a normal role', () => expect(isPingable(role(), G)).toBe(true))
  it('never offers a bot or integration role', () => expect(isPingable(role({ managed: true }), G)).toBe(false))
  it('never offers @everyone: not by id, not by name', () => {
    expect(isPingable(role({ id: G }), G)).toBe(false)
    expect(isPingable(role({ name: '@everyone' }), G)).toBe(false)
  })
  it('never offers @here', () => expect(isPingable(role({ name: '@here' }), G)).toBe(false))
  it('a role merely called "here" or "everyone" without the @ is an ordinary role', () => {
    expect(isPingable(role({ name: 'here' }), G)).toBe(true)
    expect(isPingable(role({ name: 'everyone' }), G)).toBe(true)
  })
})

describe(`the ${BIG_PING_MEMBERS}-member rule`, () => {
  it('exactly 50 members is not big, 51 is', () => {
    expect(isBigPing({ memberCount: 50, memberCountApproximate: false })).toBe(false)
    expect(isBigPing({ memberCount: 51, memberCountApproximate: false })).toBe(true)
  })
  it('an approximate count of 50 or more may be higher, so it is big; below 50 it is not', () => {
    expect(isBigPing({ memberCount: 50, memberCountApproximate: true })).toBe(true)
    expect(isBigPing({ memberCount: 49, memberCountApproximate: true })).toBe(false)
  })
  it('an unknown count is treated as big', () => {
    expect(isBigPing({ memberCount: null, memberCountApproximate: true })).toBe(true)
    expect(isBigPing({ memberCount: null, memberCountApproximate: false })).toBe(true)
  })
})

describe('the remembered channel keys', () => {
  it.each(GAME_KEYS)('a key for %s is valid', (game) => expect(isPostChannelKey(postChannelKey(G, game))).toBe(true))
  it.each(['', 'x', `${G}:solitaire`, `${G}:`, `:lmu`, `${G}:lmu:extra`, `../${G}:lmu`, 'abc:lmu'])('"%s" is not a key', (key) => expect(isPostChannelKey(key)).toBe(false))

  it('keeps only well-formed guild:game -> channel id entries', () => {
    expect(sanitizePostChannels({ [`${G}:lmu`]: CH, [`${G}:nope`]: CH, [`${G}:gt7`]: 'general', [`${G}:acc`]: 5, junk: CH })).toEqual({ [`${G}:lmu`]: CH })
  })
  it('never keeps anything but the channel id: objects, arrays, role ids with extra data and text are dropped', () => {
    expect(sanitizePostChannels({ [`${G}:lmu`]: { channelId: CH, roles: [R[0]] }, [`${G}:f1`]: [CH], [`${G}:acc`]: `${CH} Tuesday Practice` })).toEqual({})
    expect(sanitizePostChannels(null)).toEqual({})
    expect(sanitizePostChannels([CH])).toEqual({})
    expect(sanitizePostChannels('text')).toEqual({})
  })
  it('is bounded', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_POST_CHANNELS + 50 }, (_, index) => [`${String(index + 1).padStart(18, '5')}:lmu`, CH]))
    expect(Object.keys(sanitizePostChannels(many)).length).toBe(MAX_POST_CHANNELS)
  })
})

describe('the IPC parsers carry the roles through the same rules', () => {
  const attendance = { channelId: CH, name: 'Tuesday Practice', date: '2026-09-14' }
  const announcement = { channelId: CH, title: 'Round 3!', message: 'Full text' }

  it('no roles: the value has no pingRoleIds at all', () => {
    expect(parseRacingAttendanceInput(attendance)).toEqual({ ok: true, value: { channelId: CH, name: 'Tuesday Practice', date: '2026-09-14' } })
    expect(parseRacingAnnouncementInput({ ...announcement, pingRoleIds: [] })).toMatchObject({ ok: true })
    const parsed = parseRacingAnnouncementInput({ ...announcement, pingRoleIds: [] })
    expect(parsed.ok && 'pingRoleIds' in parsed.value).toBe(false)
  })
  it('roles are kept (distinct, in order)', () => {
    expect(parseRacingAttendanceInput({ ...attendance, pingRoleIds: [R[0], R[1], R[0]] })).toMatchObject({ ok: true, value: { pingRoleIds: [R[0], R[1]] } })
    expect(parseRacingAnnouncementInput({ ...announcement, pingRoleIds: [R[2]] })).toMatchObject({ ok: true, value: { pingRoleIds: [R[2]] } })
  })
  it('@everyone, @here, mention text and more than 3 roles are refused', () => {
    for (const pingRoleIds of [['@everyone'], ['@here'], ['<@&820000000000000001>'], R, 'not a list']) {
      expect(parseRacingAttendanceInput({ ...attendance, pingRoleIds }).ok).toBe(false)
      expect(parseRacingAnnouncementInput({ ...announcement, pingRoleIds }).ok).toBe(false)
    }
  })
  it('a channel is still required with roles', () => {
    expect(parseRacingAttendanceInput({ ...attendance, channelId: '', pingRoleIds: [R[0]] }).ok).toBe(false)
    expect(parseRacingAnnouncementInput({ ...announcement, channelId: '', pingRoleIds: [R[0]] }).ok).toBe(false)
  })
})
