import { describe, expect, it } from 'vitest'
import type { Signup, SignupParticipant } from '../../shared/types'
import { UiError } from './errors'
import { describePanelError, describeSignupCreateError, describeSignupWriteError, matchesSignupFilter, moveRow, PARTICIPANT_GETTERS, participantName, participantSearchFields, questionsChanged, resetRows, SIGNUP_GETTERS } from './signupView'
import { matchesQuery, sortRows } from './tableView'

const err = (code: string, status = 403): UiError => new UiError({ kind: 'http', code, message: `backend: ${code}`, status })
const participant = (over: Partial<SignupParticipant> = {}): SignupParticipant => ({
  userId: '4001', username: 'fake_user_001', displayName: 'Fake Driver 001', inServer: true, platform: 'steam', platformName: 'Steam', platformUsername: 'FakeRacer001',
  answers: [{ question: 'How old are you?', answer: '99' }, { question: 'What is your nationality?', answer: 'Testland' }], timestamp: '2026-01-02T00:00:00Z', ...over
})
const signup = (over: Partial<Signup> = {}): Signup => ({
  signupId: '810', title: 'Season 6', description: '', status: 'open', closeDate: null, customQuestionCount: 0, panelChannelId: null, confirmationChannel: 'signup-confirmations', createdBy: '1', createdAt: '2026-01-01T00:00:00Z', participantCount: 0, ...over
})

describe('the participant table', () => {
  it('shows the display name, or the username for someone who left', () => {
    expect(participantName(participant())).toBe('Fake Driver 001')
    expect(participantName(participant({ displayName: null, inServer: false }))).toBe('fake_user_001')
  })

  it('searches names, platform, platform username AND every answer and question', () => {
    const row = participant()
    for (const query of ['fake driver', 'fake_user', 'steam', 'racer001', 'testland', 'nationality', 'testland 99']) expect(matchesQuery(participantSearchFields(row), query), query).toBe(true)
    expect(matchesQuery(participantSearchFields(row), 'france')).toBe(false)
    expect(participantSearchFields(participant({ displayName: null }))).not.toContain(null)
  })

  it('sorts by name, platform, platform username and sign-up time (unreadable times last)', () => {
    const rows = [
      participant({ userId: '1', displayName: 'Charlie', platformName: 'Xbox', platformUsername: 'zed', timestamp: '2026-03-01T00:00:00Z' }),
      participant({ userId: '2', displayName: 'alice', platformName: 'PlayStation', platformUsername: 'Ann', timestamp: '2026-01-01T00:00:00Z' }),
      participant({ userId: '3', displayName: 'Bob', platformName: 'Steam', platformUsername: 'mid', timestamp: 'unreadable' })
    ]
    const order = (key: keyof typeof PARTICIPANT_GETTERS, direction: 'asc' | 'desc'): string[] => sortRows(rows, { key, direction }, PARTICIPANT_GETTERS).map((row) => row.userId)
    expect(order('name', 'asc')).toEqual(['2', '3', '1'])
    expect(order('platform', 'asc')).toEqual(['2', '3', '1'])
    expect(order('platformUsername', 'asc')).toEqual(['2', '3', '1'])
    expect(order('signedUp', 'asc')).toEqual(['2', '1', '3'])
    expect(order('signedUp', 'desc')).toEqual(['1', '2', '3'])
  })

  it('text with markup stays exactly as it is: nothing here builds HTML', () => {
    const row = participant({ answers: [{ question: 'Name', answer: '<img src=x onerror=alert(1)>' }] })
    expect(participantSearchFields(row)).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('the sign-up table', () => {
  const rows = [signup({ signupId: 'a', title: 'beta', participantCount: 5, closeDate: '2026-12-01', createdAt: '2026-02-01T00:00:00Z' }), signup({ signupId: 'b', title: 'Alpha', status: 'closed', participantCount: 12, createdAt: '2026-03-01T00:00:00Z' })]
  const order = (key: keyof typeof SIGNUP_GETTERS, direction: 'asc' | 'desc'): string[] => sortRows(rows, { key, direction }, SIGNUP_GETTERS).map((row) => row.signupId)

  it('sorts by title, status (open first), participants, close date (none last) and creation', () => {
    expect(order('title', 'asc')).toEqual(['b', 'a'])
    expect(order('status', 'asc')).toEqual(['a', 'b'])
    expect(order('participants', 'desc')).toEqual(['b', 'a'])
    expect(order('closes', 'asc')).toEqual(['a', 'b'])
    expect(order('closes', 'desc')).toEqual(['a', 'b'])
    expect(order('created', 'desc')).toEqual(['b', 'a'])
  })

  it('filters open and closed', () => {
    expect(rows.filter((row) => matchesSignupFilter(row, 'open')).map((row) => row.signupId)).toEqual(['a'])
    expect(rows.filter((row) => matchesSignupFilter(row, 'closed')).map((row) => row.signupId)).toEqual(['b'])
    expect(rows.filter((row) => matchesSignupFilter(row, 'all'))).toHaveLength(2)
  })
})

describe('creating a sign-up: every bot problem names what to fix, and says nothing was posted', () => {
  const names = { channel: 'sign-ups', confirmation: 'confirmations' }

  it('bot_cannot_post_confirmations: the permissions the bot needs, in the confirmation channel', () => {
    const problem = describeSignupCreateError(err('bot_cannot_post_confirmations'), names)
    expect(problem?.field).toBe('confirmationChannelId')
    expect(problem?.text).toMatch(/cannot post in #confirmations.*View Channel, Send Messages and Embed Links.*Nothing was posted/)
  })

  it('bot_cannot_post_confirmations without a chosen channel names the default one', () => {
    expect(describeSignupCreateError(err('bot_cannot_post_confirmations'), { channel: 'x', confirmation: '' })?.text).toMatch(/default confirmation channel \(signup-confirmations\)/)
  })

  it('bot_missing_manage_channels: the Manage Channels permission, or pick a channel yourself', () => {
    const problem = describeSignupCreateError(err('bot_missing_manage_channels'), names)
    expect(problem?.text).toMatch(/Manage Channels.*create a channel yourself.*Nothing was posted/)
    expect(problem?.field).toBe('confirmationChannelId')
  })

  it('confirmation_channel_ambiguous: the name also matches another channel, rename one or pick another', () => {
    const problem = describeSignupCreateError(err('confirmation_channel_ambiguous', 409), names)
    expect(problem?.text).toMatch(/#confirmations also matches another channel.*Rename one of the channels.*Nothing was posted/)
    expect(problem?.field).toBe('confirmationChannelId')
  })

  it('the confirmation channel being gone or invalid belongs to that field', () => {
    expect(describeSignupCreateError(err('confirmation_channel_not_found', 404), names)?.field).toBe('confirmationChannelId')
    expect(describeSignupCreateError(err('invalid_confirmation_channel', 400), names)?.field).toBe('confirmationChannelId')
  })

  it('problems with the panel channel belong to the channel field and are worded for a channel picker', () => {
    for (const code of ['bot_cannot_send', 'forbidden', 'channel_not_found', 'invalid_channel']) {
      const problem = describeSignupCreateError(err(code), names)
      expect(problem?.field, code).toBe('channelId')
      expect(problem?.text, code).toMatch(/Nothing was posted/)
    }
    expect(describeSignupCreateError(err('bot_cannot_send'), names)?.text).toMatch(/#sign-ups/)
  })

  it('anything else is not handled here (null): a lost answer is sorted by the caller', () => {
    expect(describeSignupCreateError(err('invalid_title', 400), names)).toBeNull()
    expect(describeSignupCreateError(new Error('x'), names)).toBeNull()
  })
})

describe('closing and removing: the words for the answers', () => {
  it('explains why the panel could not be greyed out', () => {
    expect(describePanelError('panel_message_not_found')).toMatch(/deleted in Discord/)
    expect(describePanelError('bot_cannot_edit_panel')).toMatch(/not allowed to edit/)
    expect(describePanelError('panel_channel_unknown')).toMatch(/does not know which channel/)
    expect(describePanelError('something_new')).toMatch(/could not be edited \(something_new\)/)
  })

  it('already_closed, signup_not_found and participant_not_found say that nothing was changed or what to do', () => {
    expect(describeSignupWriteError(err('already_closed', 409))).toMatch(/already closed.*Nothing was changed/)
    expect(describeSignupWriteError(err('signup_not_found', 404))).toMatch(/no longer exists/)
    expect(describeSignupWriteError(err('participant_not_found', 404))).toMatch(/not signed up any more/)
    expect(describeSignupWriteError(err('forbidden'))).toMatch(/STAFF/)
  })
})

describe('the questions editor helpers', () => {
  it('moves a question without losing any, and ignores moves outside the list', () => {
    expect(moveRow(['a', 'b'], 1, 0)).toEqual(['b', 'a'])
    expect(moveRow(['a', 'b'], 0, 1)).toEqual(['b', 'a'])
    expect(moveRow(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveRow(['a', 'b'], 1, 2)).toEqual(['a', 'b'])
  })

  it('sees a change in text, order or count (trimmed), and nothing else', () => {
    expect(questionsChanged(['a', 'b'], ['a', 'b'])).toBe(false)
    expect(questionsChanged([' a ', 'b'], ['a', 'b'])).toBe(false)
    expect(questionsChanged(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(questionsChanged(['a'], ['a', 'b'])).toBe(true)
    expect(questionsChanged([], [])).toBe(false)
  })

  it('"reset to defaults" is an empty list: that is how the server restores its defaults, and nothing is saved by it', () => {
    expect(resetRows()).toEqual([])
  })
})
