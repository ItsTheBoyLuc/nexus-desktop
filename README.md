# Nexus (desktop)

Windows desktop app for Discord league owners and staff. Electron + React + TypeScript, packaged
with electron-builder. It talks to the Nexus bot's token API (`/api/app/v1`); all Discord access
goes through that backend, so this app holds **no secrets**.

Scope so far (milestone 1): Discord login, server list, game picker with **Enable game**, and the
server-level screens **Overview**, **Games & Tiers** (tiers with live driver counts, sign-up panels),
**Settings** (embed colour, footer, season) and **Announcement**. The League (Formula 1 only) and
Esports team modules are visible in the sidebar and show "Coming in the next phase". Every call follows
`docs/APP_API.md`, the contract copied from the backend repo.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Electron + hot reload (electron-vite dev) |
| `npm run dev:mock` | Renderer only, in a normal browser (the port is printed, usually http://localhost:5174) with a **fake, stateful** bridge (no Discord login). Query `?scenario=signedout\|denied\|expired\|empty\|error\|slow\|nogames\|notadmin` shows other states: `nogames` = no game enabled, `notadmin` = staff but not Administrator (settings save returns 403, admin-level roles return `role_too_privileged`). The header of `src/renderer/mock/installMock.ts` lists the sample data and the "lost answer" hooks. |
| `npm run typecheck` / `npm run lint` / `npm test` | tsc (strict), ESLint, Vitest |
| `npm run build` | typecheck + bundle; fails if the mock flag is on or mock code is in `out/` |
| `npm run dist` | `build` + Windows installer (NSIS) and portable `.exe` in `dist/` |
| `npm run icon` | Regenerate `build/icon.ico` / `icon.png` from `build/icon.svg` |

Configuration: copy `.env.example` to `.env` to override `VITE_API_BASE_URL` (https origin, no secrets).

## Architecture

```
src/main      Electron main process: window + hardening, PKCE login, loopback callback server,
              API client (tokens live here), encrypted refresh-token store, settings, IPC handlers
src/preload   contextBridge: the small typed API exposed as window.nexus (no tokens, no ipcRenderer)
src/renderer  React UI (design system in theme/, components/, layout/, screens/, hooks/)
src/shared    Types, IPC channel names, CSP and the validation shared by both sides
```

### Navigation

```
/servers                       server list
/g/:guild                      game picker (Enable game)
/g/:guild/server/:page         overview, tiers (Games & Tiers), settings, announcement: a server is enough
/g/:guild/:game/:page          League pages (Formula 1 only) and Esports team: the game must be enabled
```

### Sign-up panels and the settings file

`userData/settings.json` holds the last server and game and the **message id of every sign-up panel this
app posted** (the API cannot look panels up). Only the main process writes the ids, and only after the API
confirmed the outcome (`src/main/panelService.ts`); the renderer cannot add or wipe them. "Refresh panel"
is offered only when an id is stored; a panel that was deleted in Discord is forgotten automatically.

### Writes

Every POST / PUT / PATCH / DELETE goes out once. After a timeout or an ambiguous network error it is never
replayed (it may have been applied): the UI says so and offers a refresh. Screens refetch from the server
after every write instead of patching local state.

### Security model

- `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity` on; DevTools only in dev.
- Strict CSP (`default-src 'self'`, images only from `cdn.discordapp.com`, no remote scripts/fonts,
  no network from the renderer at all). `window.open` and in-app navigation are denied; external
  links open in the system browser only for `https` URLs on an allowlist (`discord.com`,
  `nexus-b67.pages.dev`, the API host). Every web permission request is denied. Single instance.
- Login: Authorization Code + **PKCE**. A temporary server on `127.0.0.1:<random port>/callback`
  receives the redirect (constant-time state check, Host header check, single use, 5 minute timeout).
- Tokens: the access token lives in main-process memory only. Only the refresh token is stored,
  encrypted with Electron `safeStorage` (DPAPI); if encryption is unavailable nothing is persisted.
  The renderer never receives a token. Tokens are never logged.
- Refresh: one refresh at a time (single-flight). The refresh request is **never retried**, because
  the backend revokes the whole session when a used refresh token is replayed; a failed or timed-out
  refresh ends the session. Normal calls tolerate a sleeping server (notice after 5 s, up to 3 tries
  with backoff); POSTs are only replayed when the request provably never reached the app.
- The mock bridge is compiled out of every Electron build (`__NEXUS_MOCK__` is hard-coded `false`),
  refuses to override a real bridge, and `npm run build` fails if its marker appears in `out/`.

## Builds are unsigned

There is no code-signing certificate, so Windows SmartScreen shows an "unknown publisher" warning
(More info, then Run anyway). If `npm run dist` fails with a symbolic link error while extracting the
signing tools, enable Windows Developer Mode (Settings, Privacy & security, For developers) and run it again.
