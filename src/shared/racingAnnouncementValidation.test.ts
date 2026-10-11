import { describe, expect, it } from 'vitest'
import { parseRacingAnnouncementInput } from './racingInputs'
import { ANNOUNCEMENT_LIMITS, isValidImageUrl, validateAnnouncement } from './validation'

const CH = '777000000000000001'
const good = { title: 'Round 3!', message: 'Full text :emoji_name:', channelId: CH, imageUrl: '' }

describe('the image URL of an announcement is https only', () => {
  it.each(['https://example.com/fake.png', 'https://cdn.example.com/a/b.jpg?x=1', 'HTTPS://example.com/fake.png'])('accepts %s', (url) => {
    expect(isValidImageUrl(url)).toBe(true)
    expect(validateAnnouncement({ ...good, imageUrl: url }).ok).toBe(true)
  })

  it.each(['http://example.com/fake.png', 'ftp://example.com/x', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//example.com/x.png', 'https://u:p@example.com/x.png', 'https://', 'example.com/x.png', 'https://exa mple.com/x'])('refuses %s', (url) => {
    expect(isValidImageUrl(url)).toBe(false)
    expect(validateAnnouncement({ ...good, imageUrl: url })).toMatchObject({ ok: false, errors: { imageUrl: expect.stringContaining('https') } })
  })

  it('allows 500 characters and refuses 501', () => {
    const base = 'https://example.com/'
    expect(isValidImageUrl(base + 'x'.repeat(ANNOUNCEMENT_LIMITS.imageUrlMax - base.length))).toBe(true)
    expect(isValidImageUrl(base + 'x'.repeat(ANNOUNCEMENT_LIMITS.imageUrlMax - base.length + 1))).toBe(false)
  })

  it('an empty image is none and is not sent', () => {
    expect(validateAnnouncement(good)).toEqual({ ok: true, value: { title: 'Round 3!', message: 'Full text :emoji_name:', channelId: CH } })
  })
})

describe('the announcement fields', () => {
  it('apply the limits of the server: title 150 on one line, message 1500', () => {
    expect(validateAnnouncement({ ...good, title: 'x'.repeat(150) }).ok).toBe(true)
    expect(validateAnnouncement({ ...good, title: 'x'.repeat(151) }).ok).toBe(false)
    expect(validateAnnouncement({ ...good, title: 'a\nb' }).ok).toBe(false)
    expect(validateAnnouncement({ ...good, message: 'x'.repeat(1500) }).ok).toBe(true)
    expect(validateAnnouncement({ ...good, message: 'x'.repeat(1501) }).ok).toBe(false)
  })

  it('require a title, a message and a channel', () => {
    const result = validateAnnouncement({ title: '', message: ' ', channelId: '', imageUrl: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['channelId', 'message', 'title'])
  })

  it('keep the text as typed: formatting characters, emoji codes and line breaks are not touched', () => {
    expect(validateAnnouncement({ ...good, title: '**Round 3**', message: '_one_\n:flag: <b>x</b>' })).toMatchObject({ ok: true, value: { title: '**Round 3**', message: '_one_\n:flag: <b>x</b>' } })
  })
})

describe('what the main process accepts over IPC (parsed again)', () => {
  it('parseRacingAnnouncementInput applies the same rules, https only, and ignores unknown fields', () => {
    expect(parseRacingAnnouncementInput({ ...good, imageUrl: 'https://example.com/a.png', game: 'f1' })).toEqual({ ok: true, value: { title: 'Round 3!', message: 'Full text :emoji_name:', channelId: CH, imageUrl: 'https://example.com/a.png' } })
    expect(parseRacingAnnouncementInput({ ...good, imageUrl: 'http://example.com/a.png' }).ok).toBe(false)
    expect(parseRacingAnnouncementInput(null).ok).toBe(false)
    expect(parseRacingAnnouncementInput({ ...good, title: 7 }).ok).toBe(false)
  })
})
