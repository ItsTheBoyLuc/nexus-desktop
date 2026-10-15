import { describe, expect, it } from 'vitest'
import { classifyUpdateError, describeUpdateError, describeUpdateErrorWithReason, isPlainVersion, MAX_NOTES_LENGTH, releaseNotesToText, updaterDisabledReason } from './updates'

describe('when the updater exists', () => {
  const installed = { isPackaged: true, isDev: false, platform: 'win32', isPortable: false }

  it('only in a packaged, installed Windows build', () => {
    expect(updaterDisabledReason(installed)).toBeNull()
  })

  it.each([
    ['development (not packaged)', { ...installed, isPackaged: false }],
    ['dev server', { ...installed, isDev: true }],
    ['dev server and not packaged', { ...installed, isPackaged: false, isDev: true }],
    ['another platform', { ...installed, platform: 'darwin' }],
    ['the portable build', { ...installed, isPortable: true }]
  ])('is off in %s, with a reason that explains it', (_name, env) => {
    const reason = updaterDisabledReason(env)
    expect(reason).not.toBeNull()
    expect(reason!.length).toBeGreaterThan(30)
  })

  it('"packaged" alone is not enough while the dev server flag is set, so a packaged app can never be switched into development', () => {
    expect(updaterDisabledReason({ ...installed, isDev: true })).not.toBeNull()
  })
})

describe('versions', () => {
  it.each(['0.2.0', '1.0.0', '12.34.56', '1.2.3-beta.1'])('%s is a plain version', (version) => expect(isPlainVersion(version)).toBe(true))
  it.each(['', 'v1.0.0', '1.0', '1.2.3.4', '1.0.0 ', '1.0.0\n', '<b>1.0.0</b>', 'https://x.example/1.0.0', '1.2.3-' + 'x'.repeat(30), 1, null, undefined, {}])('%j is not', (version) => expect(isPlainVersion(version)).toBe(false))
})

describe('release notes as plain text', () => {
  it('removes tags and scripts, turns list items into lines and decodes the common entities', () => {
    expect(releaseNotesToText('<h2>New</h2><ul><li>One &amp; two</li><li>&lt;b&gt;three&lt;/b&gt;</li></ul><script>alert(1)</script><style>x{}</style>end')).toBe('New\n\n- One & two\n- <b>three</b>\nend')
  })

  it('keeps text that looks like markup as text (it is shown as text, never interpreted)', () => {
    expect(releaseNotesToText('a &lt;script&gt;alert(1)&lt;/script&gt; b')).toBe('a <script>alert(1)</script> b')
  })

  it('takes the notes of a list of versions, ignoring entries without a note', () => {
    expect(releaseNotesToText([{ version: '1.0.0', note: 'One' }, { version: '0.9.0' }, 'x', null, { note: 5 }, { note: 'Two' }])).toBe('One\n\nTwo')
  })

  it('removes control characters and collapses blank lines', () => {
    expect(releaseNotesToText('a\u0000b\u0007c\n\n\n\n\nd   \ne')).toBe('abc\n\nd\ne')
  })

  it('is cut at its limit', () => {
    const text = releaseNotesToText('x'.repeat(MAX_NOTES_LENGTH + 500))
    expect(text).toHaveLength(MAX_NOTES_LENGTH)
    expect(text.endsWith('…')).toBe(true)
  })

  it.each([undefined, null, 5, {}, ''])('%j gives an empty text', (value) => expect(releaseNotesToText(value)).toBe(''))
})

describe('error messages', () => {
  it('are plain, say the app keeps working, and carry no detail', () => {
    for (const during of ['check', 'download'] as const) {
      const text = describeUpdateError(during)
      expect(text).toMatch(/keeps working/)
      expect(text).not.toMatch(/http|token|sha512|\//i)
    }
  })
})

describe('classifyUpdateError', () => {
  const err = (props: Record<string, unknown>, message = 'detail'): Error => Object.assign(new Error(message), props)

  it.each([
    [err({ name: 'HttpError', statusCode: 404, code: 'HTTP_ERROR_404' }), 'HTTP 404'],
    [err({ statusCode: 403 }), 'HTTP 403'],
    [err({ statusCode: 503 }), 'HTTP 503'],
    [err({ code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' }), 'No published release'],
    [err({ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }), 'HTTP 404'],
    [err({ code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }), 'HTTP 404'],
    [err({ code: 'ENOTFOUND' }), 'No network'],
    [err({ code: 'ETIMEDOUT' }), 'No network'],
    [err({ code: 'ECONNREFUSED' }), 'No network'],
    [err({}, 'net::ERR_INTERNET_DISCONNECTED'), 'No network'],
    [err({}, 'net::ERR_NAME_NOT_RESOLVED'), 'No network'],
    [err({ code: 'CERT_HAS_EXPIRED' }), 'Certificate error'],
    [err({}, 'net::ERR_CERT_AUTHORITY_INVALID'), 'Certificate error'],
    [err({ code: 'ERR_CHECKSUM_MISMATCH' }), 'Bad update file'],
    [err({ code: 'ERR_UPDATER_INVALID_RELEASE_FEED' }), 'Bad update file'],
    [err({ code: 'ERR_UPDATER_INVALID_UPDATE_INFO' }), 'Bad update file'],
    [err({ name: 'YAMLException' }), 'Bad update file'],
    [err({ code: 'SOMETHING_ELSE' }), 'Unknown error'],
    [new Error('plain'), 'Unknown error'],
    ['text', 'Unknown error'],
    [null, 'Unknown error'],
    [undefined, 'Unknown error']
  ])('%#: maps to %s', (error, reason) => expect(classifyUpdateError(error)).toBe(reason))

  it('ignores a status code that is not a real HTTP status', () => {
    expect(classifyUpdateError(err({ statusCode: 9999 }))).toBe('Unknown error')
    expect(classifyUpdateError(err({ statusCode: '404' }))).toBe('Unknown error')
  })

  it('never copies anything of the failure into the reason (no URL, token or body)', () => {
    const secret = err({ code: 'WEIRD', statusCode: undefined }, 'GET https://user:pass@api.github.com/x?token=abc123 failed {"body":"secret"}')
    expect(classifyUpdateError(secret)).toBe('Unknown error')
    const withNet = err({}, 'https://u:p@h/?token=abc123 net::ERR_NAME_NOT_RESOLVED')
    expect(classifyUpdateError(withNet)).toBe('No network')
    expect(describeUpdateErrorWithReason('check', classifyUpdateError(withNet))).not.toMatch(/abc123|token|https|u:p/)
  })

  it('puts the reason next to the generic text, and leaves the text alone without one', () => {
    expect(describeUpdateErrorWithReason('check', 'HTTP 404')).toBe(`${describeUpdateError('check')} (Reason: HTTP 404)`)
    expect(describeUpdateErrorWithReason('download', undefined)).toBe(describeUpdateError('download'))
  })
})
