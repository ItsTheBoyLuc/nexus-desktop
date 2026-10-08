import { describe, expect, it } from 'vitest'
import { codePointLength, isValidImageUrl, isValidSnowflake, validateAnnouncement } from './validation'
import type { AnnouncementDraft } from './validation'

const valid: AnnouncementDraft = { title: 'Season 3 starts', message: 'Lights out at 20:00.', channelId: '777000000000000001', imageUrl: '' }

describe('announcement validation (mirrors the backend limits)', () => {
  it('accepts a normal announcement and trims whitespace like the backend', () => {
    const result = validateAnnouncement({ ...valid, title: '  Season 3 starts  ', message: '\n Lights out. \n', imageUrl: '  ' })
    expect(result).toEqual({ ok: true, value: { title: 'Season 3 starts', message: 'Lights out.', channelId: valid.channelId } })
  })

  it('includes the image URL only when one was given', () => {
    const result = validateAnnouncement({ ...valid, imageUrl: 'https://cdn.example.com/a.png' })
    expect(result).toMatchObject({ ok: true, value: { imageUrl: 'https://cdn.example.com/a.png' } })
  })

  it('title: required, at most 150 characters, single line, no control characters', () => {
    expect(validateAnnouncement({ ...valid, title: '   ' })).toMatchObject({ ok: false, errors: { title: expect.any(String) } })
    expect(validateAnnouncement({ ...valid, title: 'x'.repeat(150) }).ok).toBe(true)
    expect(validateAnnouncement({ ...valid, title: 'x'.repeat(151) })).toMatchObject({ ok: false, errors: { title: expect.any(String) } })
    expect(validateAnnouncement({ ...valid, title: 'two\nlines' })).toMatchObject({ ok: false, errors: { title: expect.any(String) } })
    expect(validateAnnouncement({ ...valid, title: 'bad\u0000char' })).toMatchObject({ ok: false, errors: { title: expect.any(String) } })
  })

  it('message: required, at most 1500 characters, newlines and tabs allowed, other control characters not', () => {
    expect(validateAnnouncement({ ...valid, message: '' })).toMatchObject({ ok: false, errors: { message: expect.any(String) } })
    expect(validateAnnouncement({ ...valid, message: 'x'.repeat(1500) }).ok).toBe(true)
    expect(validateAnnouncement({ ...valid, message: 'x'.repeat(1501) })).toMatchObject({ ok: false, errors: { message: expect.any(String) } })
    expect(validateAnnouncement({ ...valid, message: 'line one\n\tline two' }).ok).toBe(true)
    expect(validateAnnouncement({ ...valid, message: 'bad\u0007bell' })).toMatchObject({ ok: false, errors: { message: expect.any(String) } })
  })

  it('counts characters like the backend (code points), so astral characters are not double counted', () => {
    expect(codePointLength('a\u{1F3CE}b')).toBe(3) // JS .length would say 4
    expect(validateAnnouncement({ ...valid, title: '\u{1F3CE}'.repeat(150) }).ok).toBe(true)
    expect(validateAnnouncement({ ...valid, title: '\u{1F3CE}'.repeat(151) }).ok).toBe(false)
  })

  it('channel: must be a numeric Discord ID', () => {
    for (const bad of ['', 'abc', '12 34', '1'.repeat(21), '-1', '1.5']) {
      expect(validateAnnouncement({ ...valid, channelId: bad }), bad).toMatchObject({ ok: false, errors: { channelId: expect.any(String) } })
    }
    expect(isValidSnowflake('123')).toBe(true)
    expect(isValidSnowflake(123)).toBe(false)
  })

  it('image URL: optional, https only, no spaces or credentials, at most 500 characters', () => {
    const bad = [
      'http://insecure.example/a.png',
      'javascript:alert(1)',
      'ftp://x.example/a.png',
      'https://user:pass@cdn.example/a.png',
      'https://cdn.example/a b.png',
      'not a url',
      'https://',
      `https://cdn.example/${'a'.repeat(500)}`
    ]
    for (const imageUrl of bad) {
      expect(validateAnnouncement({ ...valid, imageUrl }), imageUrl).toMatchObject({ ok: false, errors: { imageUrl: expect.any(String) } })
    }
    expect(isValidImageUrl('https://cdn.discordapp.com/attachments/1/2/a.png?ex=1')).toBe(true)
  })

  it('reports every problem at once', () => {
    const result = validateAnnouncement({ title: '', message: '', channelId: '', imageUrl: 'nope' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['channelId', 'imageUrl', 'message', 'title'])
  })
})
