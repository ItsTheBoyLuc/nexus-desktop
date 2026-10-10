# Nexus (desktop)

Windows desktop app for Discord league owners and staff. Electron + React + TypeScript, packaged
with electron-builder. It talks to the Nexus bot's token API (`/api/app/v1`); all Discord access
goes through that backend, so this app holds **no secrets**.

Scope so far: Discord login, server list, game picker with **Enable game**, and the server-level screens
**Overview**, **Games & Tiers** (tiers with live driver counts, sign-up panels), **Settings** (embed colour,
footer, season; read-only up front for non-administrators) and **Announcement** (milestone 1), plus the
Formula 1 league screens **Calendar**, **Teams** and **Standings** (milestone 2, described below). Reports,
Penalties, Dirty drivers, Attendance, Sign-ups and the Esports team pages show "Coming in the next phase".
Every call follows `docs/APP_API.md`, the contract copied from the backend repo.

### Formula 1 league (milestone 2)

| Screen | What it does |
| --- | --- |
| Calendar | Rounds with date, time, flag and event type (Normal Race, Sprint Weekend, Full Qualifying), TBD states, search/sort/filter. Add, edit and delete a round (validated like the backend; numbers are shown as returned, a deleted round leaves a gap). "Next race" card. **Post to Discord** with a searchable channel picker; **Update posted calendar** is offered only while this app remembers the message id, and falls back to *Post new* when Discord says the message is gone. |
| Teams | Team list (colour swatch, abbreviation) and detail with roster, driver numbers and driver stats. Create a team (Discord role + private channel), add a driver with a member search (no IDs), remove a driver (the confirm dialog names the team role and says the points remain). Teams cannot be edited or deleted: the API has no endpoint. |
| Standings | WDC and WCC tables as the API returns them, **Enter race results**, and the **points system** editor (P1 to P20, pole, fastest lap). No season selector and no "reset to defaults": the API offers neither a season parameter nor a documented defaults list. |

Rules worth knowing:

- **Recording a race adds its points every time.** The server keeps running totals only and cannot detect a
  repeat. The app keeps a local ledger (server, season, round, circuit, time) and warns, with *Cancel* as the
  default focus, before the same server + season + round is recorded again. The ledger only knows races
  recorded **in this app on this computer**; results entered through Discord commands or on another device
  are unknown to it (the form says so permanently).
- After a timeout or a lost answer on the results request the form locks and only **Refresh standings** is
  offered: the results may already be recorded and are never offered for sending again.
- Recording results and saving the points system need the FIA role or Administrator (`403 fia_required`);
  after a refusal both actions are disabled until *Check again*, the tables stay readable.
- Bot permission errors (`bot_missing_manage_roles`, `bot_missing_manage_channels`, `bot_cannot_send`) name
  the missing permission; nothing is created in that case.
- Not offered, because the API does not expose them: team edit/delete, `/league update-points`, the
  in-progress `/f1 calendar` wizard, listing or reversing recorded races.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Electron + hot reload (electron-vite dev) |
| `npm run dev:mock` | Renderer only, in a normal browser (the port is printed, usually http://localhost:5174) with a **fake, stateful** bridge (no Discord login). Query `?scenario=signedout\|denied\|expired\|empty\|error\|slow\|nogames\|notadmin\|norounds\|nobotperms\|nofia\|lostresults` shows other states: `nogames` = no game enabled, `notadmin` = staff but not Administrator (settings are read-only, admin-level roles return `role_too_privileged`), `norounds` = no calendar yet, `nobotperms` = the bot lacks permissions, `nofia` = no FIA role (`fia_required`), `lostresults` = every results request loses its answer. The headers of `src/renderer/mock/installMock.ts` and `f1Mock.ts` list the sample data (8 rounds, 24 rounds, a deleted calendar message, a team without drivers, a round already in the ledger, a circuit named *ambiguous* or *timeout*, ...). |
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

### What the app remembers (the settings file)

`userData/settings.json` holds the last server and game and three things the API cannot tell the app:

- the **message id of every sign-up panel** it posted (`panels`),
- the **message id of the calendar** it posted, per server (`calendarPosts`),
- a **ledger of recorded races** (`ledger`: server, season, round, circuit, time).

Only the main process writes them, and only after the API confirmed the outcome (`src/main/panelService.ts`,
`src/main/f1Service.ts`); the renderer cannot add or wipe them, and a timeout, a lost answer or a refusal
writes nothing. "Refresh panel" and "Update posted calendar" are offered only when an id is stored; a message
that was deleted in Discord is forgotten automatically.

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
