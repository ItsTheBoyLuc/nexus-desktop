import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 64 random base64url characters (48 random bytes). RFC 7636 allows 43-128. */
export function generateVerifier(): string {
  return randomBytes(48).toString('base64url')
}

/** S256 challenge: base64url(SHA-256(verifier)), no padding. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/** Random CSRF state for the login round trip (43 base64url characters). */
export function generateState(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Constant-time string comparison. Both sides are hashed first so the comparison runs
 * over equal-length buffers regardless of what the caller supplied.
 */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(digest(a), digest(b))
}
