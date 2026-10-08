import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl, parseAllowedExternalUrl } from './links'

const API_HOST = 'discord-template-bot-h60d.onrender.com'

describe('external link allowlist', () => {
  it('allows https links on the allowlisted hosts', () => {
    const allowed = [
      'https://discord.com/api/oauth2/authorize?client_id=1504569357169070140&permissions=268520496&scope=bot%20applications.commands',
      'https://nexus-b67.pages.dev/privacy',
      'https://nexus-b67.pages.dev/terms',
      'https://DISCORD.COM/channels/1/2',
      `https://${API_HOST}/app/auth/login?state=abc&code_challenge=def&redirect=http%3A%2F%2F127.0.0.1%3A50000%2Fcallback`,
      'https://discord.com:443/x'
    ]
    for (const url of allowed) expect(isAllowedExternalUrl(url, [API_HOST]), url).toBe(true)
  })

  it('allows the API host only when it is passed in', () => {
    expect(isAllowedExternalUrl(`https://${API_HOST}/x`)).toBe(false)
    expect(isAllowedExternalUrl(`https://${API_HOST}/x`, [API_HOST])).toBe(true)
  })

  it('refuses everything else', () => {
    const blocked: unknown[] = [
      'http://discord.com/',
      'http://nexus-b67.pages.dev/',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ms-msdt:/id PCWDiagnostic',
      'nexus://auth',
      'https://evil.example/',
      'https://discord.com.evil.example/',
      'https://evil.example/discord.com',
      'https://notdiscord.com/',
      'https://sub.discord.com/',
      'https://discord.com.:443/',
      'https://discord.com@evil.example/',
      'https://user:pass@discord.com/',
      'https://discord.com:8443/',
      'https://discord.com:80/',
      '//discord.com/',
      'discord.com',
      '',
      '   ',
      'https://',
      'https://discord.com/' + 'a'.repeat(3000),
      null,
      undefined,
      42,
      {},
      ['https://discord.com/']
    ]
    for (const url of blocked) expect(isAllowedExternalUrl(url, [API_HOST]), String(url).slice(0, 60)).toBe(false)
  })

  it('returns the normalized URL that was actually checked, never the raw input', () => {
    expect(parseAllowedExternalUrl('https://DISCORD.com/a b')).toBe('https://discord.com/a%20b')
    expect(parseAllowedExternalUrl('https://dis\tcord.com/x')).toBe('https://discord.com/x')
  })
})
