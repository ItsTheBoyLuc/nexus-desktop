# Nexus (desktop)

Windows desktop app for Discord league owners and staff. Electron + React + TypeScript, packaged
with electron-builder. It talks to the Nexus bot's token API (`/api/app/v1`); all Discord access
goes through that backend, so this app holds **no secrets**.

Scope so far: Discord login, server list, game picker with **Enable game**, and the server-level screens
**Overview**, **Games & Tiers** (tiers with live driver counts, sign-up panels), **Settings** (embed colour,
footer, season; read-only up front for non-administrators) and **Announcement** (milestone 1), plus the
Formula 1 league screens **Calendar**, **Teams** and **Standings** (milestone 2) and **Reports**, **Penalties**
and **Dirty drivers** (milestone 3), **Attendance** and **Sign-ups** (milestone 4) and the **Esports team** of the
five `/racing` games (milestone 5), all described below.
Every call follows `docs/APP_API.md`, the contract copied from the backend repo.

### Formula 1 league (milestone 2)

| Screen | What it does |
| --- | --- |
| Calendar | Rounds with date, time, flag and event type (Normal Race, Sprint Weekend, Full Qualifying), TBD states, search/sort/filter. Add, edit and delete a round (validated like the backend; numbers are shown as returned, a deleted round leaves a gap). "Next race" card. **Post to Discord** with a searchable channel picker; **Update posted calendar** is offered only while this app remembers the message id, and falls back to *Post new* when Discord says the message is gone. |
| Teams | Team list (colour swatch, abbreviation) and detail with roster, driver numbers and driver stats. Create a team (Discord role + private channel), add a driver with a member search (no IDs), remove a driver (the confirm dialog names the team role and says the points remain). Teams cannot be edited or deleted: the API has no endpoint. |
| Standings | WDC and WCC tables as the API returns them, **Enter race results** (with an optional results channel), and the **points system** editor (P1 to P20, pole, fastest lap, **Reset to defaults**). No season selector: the API has no season parameter for the standings. |

Rules worth knowing:

- **Recording a race adds its points every time**, and since milestone 3 the **server** keeps the duplicate
  guard: before saving, the form reads `GET standings/results-ledger`; if the same season and round is on it
  (compared as trimmed, case-insensitive text), or the POST answers `409 results_already_recorded`, a warning
  dialog opens (*Cancel* is the default focus) and only after confirming is the request sent again with
  `confirm_duplicate: true`. The app's own local ledger is only the **fallback** when the server's ledger cannot
  be read. **Races recorded with the Discord command `/f1 standings` are in neither ledger** (the form says so
  permanently).
- **Optional results channel.** "Post results to a channel" is a searchable picker; the default is no channel.
  `invalid_channel`, `channel_not_found`, `bot_cannot_send` and `forbidden` are answered before anything is
  recorded and are shown under the picker, naming what is wrong. If only the post fails afterwards, the points
  stay recorded and the result screen says so (`announce_error`).
- **Reset to defaults** fills the points form from the server's built-in table (`defaults` of
  `GET points-system`); nothing is saved until Save is pressed.
- After a timeout or a lost answer on the results request the form locks and only **Refresh standings** is
  offered: the results may already be recorded and are never offered for sending again.
- Recording results and saving the points system need the FIA role or Administrator (`403 fia_required`);
  after a refusal both actions are disabled until *Check again*, the tables stay readable.
- Bot permission errors (`bot_missing_manage_roles`, `bot_missing_manage_channels`, `bot_cannot_send`) name
  the missing permission; nothing is created in that case.
- Not offered, because the API does not expose them: team edit/delete, `/league update-points`, the
  in-progress `/f1 calendar` wizard, listing or reversing recorded races.

### Reports, penalties and dirty drivers (milestone 3)

| Screen | What it does |
| --- | --- |
| Reports | Table with server-side filters (season, round, status, driver), search and sort on the loaded reports, "Load more" for long lists, a **By season and round** overview, and a detail view with every field the API returns, the evidence link and the evidence image. **Decide this report**: *Penalty issued* (description, penalty points, driver, season) or *No further action* (explanation), then a confirm step that names the report and says what happens in Discord. There is no "create report": drivers file them in Discord with `/f1 report`. |
| Penalties | **Overview** per season (current by default) with points, incidents, ban status and the *Reported (N)* flag; a **driver history** with every entry. Actions: add manual points, clear points (some or all), give or remove a qualifying or race ban, advance race. **Settings** tab: season, expiry and ban thresholds (Administrator). |
| Dirty drivers | Private list of misconduct reports with search and sort, a driver view, **Add a report** (reason, evidence link, optional related incident) and **Remove** by report number. Marked as private to the server's staff. |

Rules worth knowing:

- **Roles.** Staff can read, decide reports, add manual points and use the dirty-driver screens. Clearing points,
  bans and advance race need FIA or Administrator (`403 fia_required`); the penalty settings need Administrator
  (`403 admin_required`; `GET /settings` `can_edit` makes that form read-only up front). On a refusal the action is
  switched off, the data stays readable, and the message names the role.
- **A decision is sent once.** `409 already_decided` (decided meanwhile, maybe in Discord) refreshes the report;
  `409 penalty_not_configured` is a blocking message with a button to the Penalty settings (nothing changed);
  `report_message_not_found` means the bot cannot find the report's message or thread (nothing changed);
  `500 penalty_points_failed` means the report **is** decided but the points are not saved: a warning with
  **Add the points now** opens the manual points dialog prefilled with driver, points and season, and the
  decision is never resent. After a lost answer (timeout, dropped connection, 5xx) the report may be decided: only
  **Refresh the report** is offered and deciding stays off until it was read again.
- **What the API does not return**: the explanation of a *No further action* decision and the points a decision
  awarded. The app shows the status and the penalty text it gets and says the full decision text is in the Discord
  report message. A Discord decision window that was already open can still be submitted after the app decided a
  report (the helper text beside the button says so).
- **Manual points never announce a ban.** When a threshold is reached the server returns the ban text; the app shows
  "A ban threshold was reached. Nothing has been announced in Discord." with **Copy** and an optional **Post as
  announcement** (channel picker and the usual confirm, through the server-level announcement endpoint).
- **Clear, bans and advance race** each have a confirm dialog that names the driver, the season and the effect and
  sends `confirm: true`; the API client refuses to send these three without it. Advance race says that expired
  points are removed permanently.
- **Dirty-driver removal goes by number**, and the numbers move up after a removal. So the app reads the driver's
  history again first and only removes the report if it is still the one you confirmed, and a removal whose answer
  was lost is never repeated.
- **Untrusted text.** Reasons, descriptions, explanations and driver names are rendered as plain text, never as
  HTML. Evidence links open only if they are https links on the external-link allowlist (otherwise the app says so
  and offers **Copy**); an evidence image is rendered only when it is https **and** on Discord's CDN (the
  content-security policy allows no other image host), otherwise it is offered as a link.

### Attendance and sign-ups (milestone 4)

| Screen | What it does |
| --- | --- |
| Attendance | **Divisions**: regular and reserve drivers by name (a driver who left is marked), create or edit in a dialog with two member pickers (never an ID), an overlap badge. **Posts**: a table (filter by division and season, search, sort, "Load more"), a detail view with the present, absent and reserve lists by name and a Refresh button, and **Create attendance post** (division, season, round, circuit, optional description, channel). The result dialog shows only what the API returned (message id, channel) and the app stores nothing. |
| Sign-ups | **Sign-ups**: a table (status, title, participants, close date) with search, filter and sort, **Create a sign-up** (title, optional description, panel channel, confirmation channel, optional close date), a detail view with **Close this sign-up** and the participants. **Settings**: the sign-up questions editor. |

Rules worth knowing:

- **A division is saved partially.** The API keeps a list that is left out of the request, so the app sends only the
  list(s) you actually edited (the regular list can never be changed by editing the reserve list). After saving, an
  `overlap` in the answer is shown by name: such a driver is marked Present when a post is created and is then refused
  by the Present button in Discord (the command has no rule against it; it is stored as you set it).
- **Only reading is possible for attendance itself**: the app cannot set, toggle or remove anyone's attendance, edit or
  delete a post, delete a division, find a post's channel or link to a post later. (The result of *creating* a post does
  contain the channel, so the dialog offers a link from that answer only.) Drivers use the buttons in Discord.
- **Post text is posted as typed**: season, round, circuit and description are not escaped, so Discord formatting characters
  render there (the form says so).
- **Creating a post or a sign-up is sent once.** After a lost answer (timeout, dropped connection, 5xx) the form locks,
  says the message may already be in Discord, never offers the same data again and offers a refresh of the list.
- **Questions editor.** Saving needs the Administrator permission (`can_edit` or `403 admin_required` make the form
  read-only with an explanation). The limits come from the server (2 questions of 45 characters): no comma, unique, no
  two questions that start with the same 45 characters (the question is the key of the answer). *Reset to defaults*
  empties the list (that is how the server restores its 6 defaults) and saves nothing until Save.
- **Creating a sign-up** explains the confirmation channel: it is stored by *name*, found (ignoring emoji and capitals) or
  created by the bot when the first driver signs up. `bot_cannot_post_confirmations`, `bot_missing_manage_channels` and
  `confirmation_channel_ambiguous` each say what to fix and that nothing was posted.
- **Closing a sign-up** has a confirm dialog: the panel is disabled, new sign-ups are refused, and there is no reopen,
  edit or delete. Removing a participant names the person and says it cannot be undone (staff can also remove someone
  who left the server). The list is read again afterwards; no row number is relied on.
- **Not offered, because the API has no endpoint**: signing someone up, editing their answers, per-sign-up custom
  questions, reopening, editing or deleting a sign-up.

**Privacy of participants.** Their answers (first name, nationality, age ...) are personal data. They exist only in the
renderer's memory: never written to the settings file, a log, a cache or browser storage, cleared when the screen is left
or the server is switched, rendered as plain text, and the app has no export. `src/main/privacy.test.ts` guards this: only
the settings and token stores may write files, the renderer may not use browser storage, and nothing that handles
participants may log. The mock's participants are obviously fake (*Fake Driver 007*, *Testland*, age 99).

### Esports team (milestone 5)

The sidebar group **Esports team** exists for each of the five games `lmu`, `iracing`, `gt7`, `acc` and `f1` (Formula 1
Esports, which is **not** the League and never shares data with it). It works whether or not the game is enabled in
Games & Tiers. Each game has its own teams, events, results and attendance: every call carries the selected `{game}`, an
unknown game is refused (`unknown_game`) before any request, and a change of game or server rebuilds the screen from
scratch (lists, forms, open posts and pending dialogs are gone).

| Screen | What it does |
| --- | --- |
| Teams | Team list (search, filter, sort), create a team (name, colour, optional free-text class; the bot also creates a Discord role), a roster per team with add and remove (members picked by name, never by ID) and a driver profile. |
| Events | Upcoming events (paged, search, sort), add an event with a date picker: the date is sent as `YYYY-MM-DD` only and shown back as "Interpreted as ...". |
| Results | The **append-only archive** (oldest first, paged as the API pages it, "Load more"), **team stats** (the same list narrowed to one team, with the total the server reports), search and sort of the loaded rows, and **Log a result** (team, event name, result text, drivers involved, optional notes). |
| Attendance | Posts of the game (newest first, paged, search, filter, sort), a post detail with the **Available** and **Not available** lists by name and a Refresh button, and **Create attendance post** (channel, name, date, optional description). The result dialog shows what the API returned and builds **Open in Discord** only from the channel and message ids in that answer. |
| Announcement | The announcement of this game's team (not the server-level one): channel, title, message, optional **https** image, a review dialog and a success panel with the same kind of link. |

Rules worth knowing:

- **The results archive cannot be corrected.** There is no edit and no delete (no command does it), and logging the same
  result twice creates two entries. The form says so, and a review step repeats it before anything is sent.
- **Creating a post, an announcement or a result is sent once.** After a lost answer (timeout, dropped connection, 5xx) the
  form locks, says the message or entry may already exist, and never offers the same data again: results and attendance
  offer only **Refresh results** / **Refresh posts**; the announcement has nothing to refresh (the API cannot read
  announcements back), so it says to look at the channel in Discord and offers only to discard the draft.
- **Permissions are explained, not guessed.** Every read needs the staff check. Logging a result (like creating a team, a
  roster change and an event) needs Manage Server or Administrator (`manage_server_required`); creating an attendance
  post or an announcement needs Manage Server, Administrator, or being a Manager or Coach of a team **of this game**
  (`manager_required`, remembered per server **and game**, so a refusal for iRacing does not disable GT7). The app cannot
  know this in advance: on a 403 the action is disabled, the data stays readable and the rule is explained, with a
  **Check again** button.
- **Drivers set their own attendance in Discord.** The app cannot set, toggle or remove anyone's status, edit or delete a
  post, or find a post's channel later; the screens say so.
- **Announcement text is posted as typed**: formatting characters render in Discord, `:name:` server emoji are converted,
  only an `https` image link is accepted (`http` is refused before any request) and the footer reads
  "Posted via Nexus App by <your name>" followed by the footer text of the server.
- **User text is plain text.** Team, driver, event, result and note text is never rendered as HTML.

**Privacy of rosters, drivers and results.** They exist only in the renderer's memory: never written to the settings
file, a log, a cache or browser storage, cleared when the screen is left or the server or game is switched.
`src/main/privacy.test.ts` guards this for every esports screen, and `src/main/esportsScreens.test.ts` guards that each
screen is keyed by server and game and sends the game with every call. The mock's names are obviously fake (*Fake Team
Alpha*, *Fake Driver 007*).

### Role pings on esports posts (milestone 6, part 1)

The **Attendance** create dialog and the **Announcement** screen of the Esports team can ping up to 3 roles with the
post. The channel stays required on both (there is no on/off switch); only the "Ping roles" section is optional.
Teams, Events and Results follow in part 2.

- **Picker.** A searchable list of the server's roles with their member count ("12 members", "about 12 members" while the
  bot's member cache is incomplete). `@everyone` and `@here` are never offered (and refused again in the main process and
  the API client), bot-managed roles are not selectable, and a role that is not mentionable is offered with a warning.
  **All {game} team roles** fills in the roles of the teams of that game (`GET /racing/{game}/team-roles`); with more
  than 3 it stays off and says why instead of choosing for you.
- **Confirmation before every post.** Names the channel and the roles with their counts, says *Pings notify members
  immediately and cannot be undone.*, and has Cancel as the default focus. A role with more than 50 members (or a count
  that may be higher, or unknown) keeps the confirm button off until a checkbox is ticked.
- **Result dialog.** The channel, the message id and the roles the server says it pinged (`pinged_roles`), plus "Open in
  Discord", built only from the ids of the answer.
- **Errors in plain words**: `invalid_ping_roles`, `too_many_ping_roles`, `role_not_found`, `role_not_pingable`,
  `bot_cannot_mention_role` (make the role mentionable, or give the bot Mention Everyone), the channel errors,
  `manager_required` and `429` (5 pinging posts per minute per user and server: wait a minute). Part 1 has no
  `post_error`: a failed post stored nothing.
- **Never replayed.** A post is sent once. After a lost answer (timeout, dropped connection, 5xx) the form locks, the text says
  the message may already be in Discord **and may already have pinged people**, and the only way forward is to check the
  channel first. For an attendance post it adds: if the record could not be saved after a pinging message was sent, the message
  is deleted, but members who were already pinged keep the notification.
- **Remembered:** only the **last chosen channel id per server and game** (`postChannels` in the settings file, written by
  the main process only). Never role ids, member data or message text. Chosen roles, the draft and every dialog are reset
  when the server or the game changes (each screen is keyed by both).
- **Mock.** `npm run dev:mock` has a role with 60 members, one that is not mentionable (pingable in
  `#mention-everyone-ok`), one with an approximate count and one that is "gone" when posted; the scenarios `manyteamroles`,
  `norolelist`, `invalidping`, `toomanyping`, `pingrefused`, `pinglimit` (and `lostracing`, `nomanager`, the `#timeout`,
  `#bot-locked` and `#staff-only-hidden` channels, and *fail* in a name or title) cover each error and the lost answer. The
  mock has a real 5-per-minute limiter. See the header of `src/renderer/mock/pingMock.ts`.


### Cards of teams, events and results (milestone 6, part 2)

Teams, Events and Results use the same pieces as part 1 (channel picker, role picker with member counts, confirmation, result
dialog) in two places:

- **"Post in a channel" on the create forms.** A switch, **off by default**. While it is off nothing about a channel or a role is
  sent, and the request is exactly the one of before. On, the form asks for a channel and up to 3 roles; the button becomes
  *Review and ...* and opens the confirmation (channel, roles with counts, *Pings notify members immediately and cannot be undone.*,
  the checkbox for roles above 50 members, Cancel as default focus). The server checks the whole post before it creates anything, so a
  refused channel or role means **nothing was created or posted**.
- **"Post to Discord" on an existing item**: the team page, each event row and each result row. It uses the dedicated endpoints
  (`POST /racing/{game}/teams/post`, `/events/post`, `/results/post`), changes no stored data, and needs Manage Server. A team is
  identified by its name, an event or result by its `id`.
- **`post_error`** (the item was saved, the post failed): the dialog says so clearly, gives the reason in plain words and offers
  **Post again**. That only reopens the form with the same channel and roles: the user has to review and confirm, and it calls the
  dedicated endpoint, never the create. Nothing is ever posted again automatically.
- **A lost answer** (timeout, dropped connection, 5xx) on a create or a card: the form locks and says the item and the card may already
  exist and may already have pinged people. There is no retry with the same data: check the channel first. Writes are never replayed.
- **Mock.** On top of the part 1 scenarios: `posterror` (every create with a channel saves, then its card fails), the names
  *postfail* / *postslow* (post_error `discord_error` / `bot_timeout`), *fail* in an item name (502 when posted with "Post to
  Discord"), and `lostracing` or the `#timeout` channel for the lost answer. Role pings share one 5-per-minute limiter.

## Motion

A small motion layer, pure CSS plus a tiny React helper, no animation library. All of it is in `src/renderer/theme/motion.css`, with the durations (150 / 220 / 320 ms, 40 ms stagger) and the easing as tokens in `theme/tokens.ts`. Only transform, opacity and stroke-dashoffset move (hover colour and shadow transitions aside; the one exception is the open and close of the sidebar groups).

- **Reduce animations**: the Preferences popover in the sidebar footer. It is stored as `reduceMotion` in the settings file, the only thing the motion layer stores. The operating system setting (prefers-reduced-motion) is always honoured too. Either one removes every animation and transition, so state changes are instant.
- A success check mark is only drawn by success states and success toasts, never after an error or a lost answer.
- `src/main/motionCss.test.ts` checks the rules on the stylesheets (what may move, tokens, reduced motion, no glow on destructive buttons).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Electron + hot reload (electron-vite dev) |
| `npm run dev:mock` | Renderer only, in a normal browser (the port is printed, usually http://localhost:5174) with a **fake, stateful** bridge (no Discord login). Query `?scenario=signedout\|denied\|expired\|empty\|error\|slow\|nogames\|notadmin\|norounds\|nobotperms\|nofia\|lostresults` shows other states: `nogames` = no game enabled, `notadmin` = staff but not Administrator (settings are read-only, admin-level roles return `role_too_privileged`), `norounds` = no calendar yet, `nobotperms` = the bot lacks permissions, `nofia` = no FIA role (`fia_required`), `lostresults` = every results request loses its answer, `noledger` = the server's results ledger cannot be read (the local fallback is used), and for milestone 3 `noreports`, `nopenaltyconfig` (penalty rules never set up: `penalty_not_configured`), `nostaff` (every report, penalty and dirty-driver call answers 403), `lostdecisions` (every decision is applied, then its answer is lost) and `nodirty`, and for milestone 4 `nodivisions`, `nosignups`, `noconfirmperms` (`bot_cannot_post_confirmations`), `nomanagechannels` (`bot_missing_manage_channels`), `ambiguousconfirm` (`confirmation_channel_ambiguous`) and `lostcreates` (creating a post or a sign-up is applied, then its answer is lost; `notadmin` makes the questions read-only), and for milestone 5 `noracingteams`, `nomanage` (`manage_server_required`: no team, roster, event or result can be written), `nomanageroles` (`bot_missing_manage_roles`), `noresults` (every archive is empty), `noattendance` (no post anywhere), `nomanager` (`manager_required` for every game's attendance post and announcement) or `nomanager-gt7` (the same for ONE game: the rule is per game; use any of `lmu`, `iracing`, `gt7`, `acc`, `f1`) and `manyteamroles`, `norolelist`, `invalidping`, `toomanyping`, `pingrefused` and `pinglimit` (role pings) and `posterror` (a card that fails after the item was saved), see milestone 6, and `lostracing` (creating a team, adding an event, logging a result, creating an attendance post and posting an announcement are applied, then the answer is lost). Besides the scenario, a team, event, result event, post name or announcement title containing *timeout*, or the channel `#timeout`, loses its answer, and an announcement title containing *fail* is refused with `discord_error` (nothing posted). The sample data of "Apex Racing League" has 52 to 120 results in every game, a post with 24 drivers (one who left the server), 120+ posts in iRacing and 30 upcoming iRacing events; the unknown-game answer (`unknown_game`) is only reachable in the tests, because the app refuses an unknown game before it asks. The headers of `src/renderer/mock/installMock.ts`, `f1Mock.ts`, `stewardMock.ts`, `attendanceMock.ts` and `racingMock.ts` list the sample data and the hooks (60 reports in Midnight GT, a report decided in Discord meanwhile, a report whose thread is gone, a description containing *points-fail* or *timeout*, a driver one point below a ban threshold, the channels `#bot-locked` and `#staff-only-hidden`, a circuit named *late-duplicate*, ...). |
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
/g/:guild/:game/:page          League pages (Formula 1 only): the game must be enabled
/g/:guild/:game/esports/:page  Esports team of lmu, iracing, gt7, acc, f1 (teams, events, results, attendance, announcement)
```

### What the app remembers (the settings file)

`userData/settings.json` holds the last server and game and three things the API cannot tell the app:

- the **message id of every sign-up panel** it posted (`panels`),
- the **message id of the calendar** it posted, per server (`calendarPosts`),
- a **ledger of recorded races** (`ledger`: server, season, round, circuit, time), now only the fallback of the
  server's own results ledger,
- the **last channel id chosen for the esports posts**, per server and game (`postChannels`): a channel id and nothing else.

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
  The only clipboard access is a main-process `copyText` (plain text, at most 4000 characters, write only).
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
