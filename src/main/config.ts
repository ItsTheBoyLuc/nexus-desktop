/** Build-time configuration (non-secret). */
export const API_BASE_URL: string = __API_BASE_URL__
export const API_HOST: string = new URL(API_BASE_URL).hostname

export const APP_ID = 'com.nexus.leaguecontrol'

/** Normal API calls: hard per-attempt timeout. */
export const API_TIMEOUT_MS = 20_000
/** After this long without an answer the UI is told the server is probably waking up. */
export const WAKE_NOTICE_AFTER_MS = 5_000
/** Normal API calls are tried at most this many times (initial try included). */
export const API_MAX_TRIES = 3
/** Waits before try 2 and try 3. */
export const API_BACKOFF_MS: readonly number[] = [1_000, 3_000]

/** The temporary loopback login server gives up after this long. */
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export const PRIVACY_URL = 'https://nexus-b67.pages.dev/privacy'
export const TERMS_URL = 'https://nexus-b67.pages.dev/terms'
export const BOT_INVITE_URL =
  'https://discord.com/api/oauth2/authorize?client_id=1504569357169070140&permissions=268520496&scope=bot%20applications.commands'
