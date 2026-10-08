import { describe, expect, it } from 'vitest'
import { challengeFor, generateState, generateVerifier, safeEqual } from './pkce'

describe('PKCE (RFC 7636)', () => {
  it('matches the RFC 7636 appendix B test vector', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates 64-character base64url verifiers that differ every time', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const verifier = generateVerifier()
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/)
      seen.add(verifier)
    }
    expect(seen.size).toBe(50)
  })

  it('produces 43-character unpadded base64url challenges (what the backend requires)', () => {
    expect(challengeFor(generateVerifier())).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('generates a state within the backend limits (16-128 URL-safe characters)', () => {
    const state = generateState()
    expect(state).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(generateState()).not.toBe(state)
  })
})

describe('safeEqual', () => {
  it('compares equal and different strings, including different lengths, without throwing', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', 'a')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})
