import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RefreshTokenStore } from './tokenStore'
import type { SafeStorageLike } from './tokenStore'

/** Reversible fake "encryption" so the tests can prove plaintext never reaches the disk. */
function fakeSafeStorage(available: boolean): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${Buffer.from(text, 'utf8').reverse().toString('base64')}`),
    decryptString: (data) => {
      const text = data.toString()
      if (!text.startsWith('enc:')) throw new Error('not encrypted')
      return Buffer.from(text.slice(4), 'base64').reverse().toString('utf8')
    }
  }
}

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexus-test-'))
  file = join(dir, 'session.bin')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('RefreshTokenStore', () => {
  it('stores the refresh token encrypted and reads it back', () => {
    const store = new RefreshTokenStore(file, fakeSafeStorage(true))
    expect(store.save('refresh-token-ABC')).toBe(true)
    expect(readFileSync(file).toString()).not.toContain('refresh-token-ABC')
    expect(store.load()).toBe('refresh-token-ABC')
  })

  it('replaces the token on every rotation', () => {
    const store = new RefreshTokenStore(file, fakeSafeStorage(true))
    store.save('first')
    store.save('second')
    expect(store.load()).toBe('second')
  })

  it('persists NOTHING when OS encryption is unavailable (and drops any older file)', () => {
    writeFileSync(file, 'left-over')
    const store = new RefreshTokenStore(file, fakeSafeStorage(false))
    expect(store.canPersist()).toBe(false)
    expect(store.save('secret-token')).toBe(false)
    expect(existsSync(file)).toBe(false)
    expect(store.load()).toBeNull()
  })

  it('clear() deletes the file and is safe to repeat', () => {
    const store = new RefreshTokenStore(file, fakeSafeStorage(true))
    store.save('x')
    store.clear()
    store.clear()
    expect(existsSync(file)).toBe(false)
    expect(store.load()).toBeNull()
  })

  it('discards a file that cannot be decrypted', () => {
    writeFileSync(file, 'garbage')
    const store = new RefreshTokenStore(file, fakeSafeStorage(true))
    expect(store.load()).toBeNull()
    expect(existsSync(file)).toBe(false)
  })

  it('returns null when nothing was stored', () => {
    expect(new RefreshTokenStore(file, fakeSafeStorage(true)).load()).toBeNull()
  })
})
