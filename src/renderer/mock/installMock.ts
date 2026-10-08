/**
 * FAKE bridge for `npm run dev:mock` (renderer only, normal browser, no Discord login).
 *
 * This file must never end up in an Electron build:
 *  - it is only reachable through `if (__NEXUS_MOCK__)` in main.tsx, a compile-time constant
 *    that electron.vite.config.ts hard-codes to false (dead-code elimination removes it),
 *  - it refuses to run when a real bridge (the preload's window.nexus) already exists,
 *  - `npm run build` fails if the marker string below shows up anywhere in out/.
 *
 * Scenarios (query string): ?scenario=signedout | denied | expired | empty | error | slow
 */
import type { NexusBridge, Unsubscribe } from '../../shared/bridge'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { AnnouncementResult, ApiErrorInfo, ApiStatus, AuthState, Channel, Game, Guild, IpcResult, Settings, UserInfo } from '../../shared/types'

/** Marker searched for by scripts/check-no-mock.mjs. Do not rename without updating it. */
export const MOCK_MARKER = 'NEXUS_MOCK_BRIDGE_ACTIVE'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Decorative icon: a coloured rounded square with initials, as a data: URI (allowed by the CSP too). */
function iconFor(name: string, hue: number): string {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${hue} 55% 28%)"/><text x="48" y="60" font-family="sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="#fff">${initials}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const USER: UserInfo = { id: '100000000000000001', username: 'DemoStaff', avatar: iconFor('Demo Staff', 0) }

const GUILDS: Guild[] = [
  { id: '555000000000000001', name: 'Apex Racing League', icon: iconFor('Apex Racing', 355) },
  { id: '555000000000000002', name: 'Nightfall Sim Series', icon: iconFor('Nightfall Sim', 230) },
  { id: '555000000000000003', name: 'Turbo Club EU', icon: null },
  { id: '555000000000000004', name: 'Midnight GT Championship With A Very Long Name', icon: iconFor('Midnight GT', 140) }
]

const ENABLED_GAMES: Record<string, string[]> = {
  '555000000000000001': ['f1', 'acc'],
  '555000000000000002': ['lmu', 'iracing', 'gt7'],
  '555000000000000003': [],
  '555000000000000004': ['f1', 'lmu', 'iracing', 'gt7', 'acc']
}

const GAME_LABELS: Record<string, string> = {
  f1: 'Formula 1',
  lmu: 'Le Mans Ultimate',
  iracing: 'iRacing',
  gt7: 'Gran Turismo 7',
  acc: 'Assetto Corsa Competizione'
}

const CHANNELS: Channel[] = [
  { id: '777000000000000001', name: 'announcements' },
  { id: '777000000000000002', name: 'race-results' },
  { id: '777000000000000003', name: 'league-news' },
  { id: '777000000000000004', name: 'stewards-decisions' }
]

function failure(kind: ApiErrorInfo['kind'], code: string, message: string, status?: number): IpcResult<never> {
  return { ok: false, error: { kind, code, message, ...(status ? { status } : {}) } }
}

export function installMockBridge(): void {
  // Typed as always-present on Window, so look at it through a loose type to keep the check meaningful.
  if ((window as { nexus?: unknown }).nexus !== undefined) throw new Error('Mock bridge refused: a real bridge is already installed.')

  const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'normal'
  console.info(`[${MOCK_MARKER}] fake bridge installed, scenario "${scenario}". No real data, no Discord.`)

  const latency = scenario === 'slow' ? 2500 : 350
  const authListeners = new Set<(state: AuthState) => void>()
  const statusListeners = new Set<(status: ApiStatus) => void>()
  let settings: Settings = { ...DEFAULT_SETTINGS }
  let loginTimer: number | undefined

  let authState: AuthState =
    scenario === 'signedout'
      ? { status: 'signed-out' }
      : scenario === 'denied'
        ? { status: 'signed-out', reason: 'denied' }
        : scenario === 'expired'
          ? { status: 'signed-out', reason: 'expired' }
          : { status: 'signed-in', user: USER }

  const setAuth = (next: AuthState): void => {
    authState = next
    authListeners.forEach((listener) => listener(next))
  }
  let currentStatus: ApiStatus = 'online'
  const emitStatus = (status: ApiStatus): void => {
    currentStatus = status
    statusListeners.forEach((listener) => listener(status))
  }

  /** Every fake API call: simulated latency, the "server waking up" notice in the slow scenario, and the error scenario. */
  async function api<T>(produce: () => IpcResult<T>): Promise<IpcResult<T>> {
    if (scenario === 'slow') emitStatus('waking')
    await sleep(latency)
    emitStatus('online')
    if (scenario === 'error') return failure('http', 'internal_error', 'The server hit an unexpected problem.', 500)
    return produce()
  }

  const guildsFor = (): Guild[] => (scenario === 'empty' ? [] : GUILDS)

  const bridge: NexusBridge = {
    auth: {
      getState: async () => authState,
      login: async () => {
        setAuth({ status: 'signing-in' })
        loginTimer = window.setTimeout(() => setAuth({ status: 'signed-in', user: USER }), 1500)
      },
      cancelLogin: async () => {
        window.clearTimeout(loginTimer)
        setAuth({ status: 'signed-out', reason: 'cancelled' })
      },
      retrySession: async () => setAuth({ status: 'signed-in', user: USER }),
      logout: async () => {
        window.clearTimeout(loginTimer)
        setAuth({ status: 'signed-out', reason: 'logged-out' })
      },
      onStateChange: (callback): Unsubscribe => {
        authListeners.add(callback)
        return () => authListeners.delete(callback)
      }
    },

    api: {
      me: () => api(() => ({ ok: true, data: USER })),
      guilds: () => api(() => ({ ok: true, data: guildsFor() })),
      games: (guildId) =>
        api(() => {
          if (!GUILDS.some((guild) => guild.id === guildId)) return failure('http', 'guild_not_found', 'The bot is not in that server.', 404)
          const enabled = ENABLED_GAMES[guildId] ?? []
          const data: Game[] = Object.entries(GAME_LABELS).map(([key, label]) => ({ key, label, enabled: enabled.includes(key) }))
          return { ok: true, data }
        }),
      channels: (guildId) =>
        api(() => {
          if (!GUILDS.some((guild) => guild.id === guildId)) return failure('http', 'guild_not_found', 'The bot is not in that server.', 404)
          return { ok: true, data: guildId === '555000000000000003' ? [] : CHANNELS }
        }),
      postAnnouncement: (_guildId, input) =>
        api<AnnouncementResult>(() => {
          // Hooks for reviewing error states: put one of these words in the title.
          if (/\bfail\b/i.test(input.title)) return failure('http', 'bot_cannot_send', 'The bot cannot post in that channel.', 403)
          if (/\btimeout\b/i.test(input.title)) return failure('timeout', 'timeout', 'The server took too long to respond.')
          return { ok: true, data: { messageId: '888000000000000001', channelId: input.channelId } }
        }),
      getStatus: async () => currentStatus,
      onStatusChange: (callback): Unsubscribe => {
        statusListeners.add(callback)
        return () => statusListeners.delete(callback)
      }
    },

    settings: {
      get: async () => ({ ...settings }),
      set: async (patch) => {
        settings = { ...settings, ...patch }
        return { ...settings }
      }
    },

    system: {
      openExternal: async (url) => {
        console.info(`[${MOCK_MARKER}] would open in the system browser: ${url}`)
        return true
      }
    }
  }

  Object.defineProperty(window, 'nexus', { value: bridge, writable: false, configurable: false })
}
