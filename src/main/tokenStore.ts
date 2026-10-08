import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from './log'

/** The slice of Electron's safeStorage this module needs (injectable for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

/**
 * Persists ONLY the refresh token, encrypted with the OS-level safeStorage (DPAPI on
 * Windows). If encryption is unavailable nothing is written at all, so the session simply
 * ends when the app closes. Access tokens never touch the disk.
 */
export class RefreshTokenStore {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike
  ) {}

  canPersist(): boolean {
    try {
      return this.safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /** The stored refresh token, or null (missing, unreadable, or undecryptable files are discarded). */
  load(): string | null {
    if (!this.canPersist()) return null
    let encrypted: Buffer
    try {
      encrypted = readFileSync(this.filePath)
    } catch {
      return null
    }
    try {
      const token = this.safeStorage.decryptString(encrypted)
      return token.length > 0 ? token : null
    } catch (error) {
      log.warn('stored session could not be decrypted and was discarded', error)
      this.clear()
      return null
    }
  }

  /** Returns false when nothing was persisted (encryption unavailable or write failed). */
  save(token: string): boolean {
    if (!this.canPersist()) {
      this.clear() // never leave an older token behind that this run cannot manage
      return false
    }
    try {
      const encrypted = this.safeStorage.encryptString(token)
      mkdirSync(dirname(this.filePath), { recursive: true })
      const temp = `${this.filePath}.tmp`
      writeFileSync(temp, encrypted, { mode: 0o600 })
      renameSync(temp, this.filePath) // atomic replace: never a half-written token file
      return true
    } catch (error) {
      log.warn('could not persist the session', error)
      return false
    }
  }

  clear(): void {
    try {
      rmSync(this.filePath, { force: true })
    } catch (error) {
      log.warn('could not delete the stored session', error)
    }
  }
}
