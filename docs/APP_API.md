# Nexus App API (`/api/app/v1`)

Token-based API for the Nexus Windows desktop app. Implemented in `app_backend.py`, mounted on the
bot's Flask app. This file is the contract: **every registered route is listed here** (a unit test,
`DocsComplete` in `scripts/test_app_api.py`, fails if a route is added without documenting it).

**Status:** Auth + base, **M1 — Foundations, Games & tiers, Server settings, Overview**,
**M2 — F1 league core (calendar, teams and drivers, standings, points system)** and
**M3 — Reports, penalty points, bans, dirty drivers** (plus a results ledger and the points-system defaults) and
**M4 — Attendance (divisions and posts) and sign-ups (questions, panels, participants)**.
M5 (esports) is not built yet.

Contents: [Conventions](#conventions) · [Auth](#auth) · [Base](#base-endpoints) · [Pickers](#pickers) ·
[Overview](#overview) · [Server settings](#server-settings) · [Games & tiers](#games--tiers) · [F1 league](#f1-league) ·
[Reports and penalties](#reports-and-penalties-m3) · [Attendance and sign-ups](#attendance-and-sign-ups-m4) · [Sync notes](#sync-with-discord)

---

## Conventions

| | |
|---|---|
| Base URL | `https://<bot-host>/api/app/v1` (all paths below are relative to it, except the two `/app/auth/*` pages) |
| Auth | `Authorization: Bearer <access_token>` on everything except `/auth/exchange`, `/auth/refresh` and the `/app/auth/*` pages |
| Body | JSON object, `Content-Type: application/json`, max 16 KiB |
| IDs | Discord IDs (guild, channel, role, user, message) are **strings**, never numbers |
| `game_key` / `tier_key` | 1–20 characters: letters, digits, underscore (`^[A-Za-z0-9_]{1,20}$`) |
| Caching | every response is `Cache-Control: no-store`; no cookies are ever set or read; no CORS headers (call from the Electron main process) |
| Staff | Everything under `/guilds/{guild_id}/…` requires the caller to be **Administrator, or hold the `FIA` or `STAFF` role** in that server. This is re-checked against Discord on **every request** — nothing the client sends about roles is trusted. |

### Error format

Every error, on every endpoint, is exactly:

```json
{ "error": "machine_code", "message": "Human readable explanation." }
```

Branch on `error`, show `message`. Unexpected failures are `500 internal_error` with a generic message
(details are only in the server log).

| HTTP | `error` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Body missing, not a JSON object, or too large |
| 400 | `invalid_*` / `no_changes` / … | Field validation (codes listed per endpoint) |
| 400 | `invalid_guild_id` | `guild_id` is not numeric |
| 401 | `unauthorized` | Missing, malformed, unknown or expired access token (response has `WWW-Authenticate: Bearer`). Refresh and retry once. |
| 403 | `forbidden` | Caller is not staff in that server (or cannot see the target channel) |
| 403 | `admin_required` | Endpoint needs Administrator (not just staff) |
| 403 | `bot_cannot_send` | The bot lacks permission to post in that channel |
| 409 | `already_closed` / `confirmation_channel_ambiguous` / … | State conflicts (codes listed per endpoint) |
| 404 | `guild_not_found` | The bot is not in that server |
| 404 | `not_found` | Unknown endpoint |
| 405 | `method_not_allowed` | Wrong HTTP method |
| 429 | `rate_limited` | See [Rate limits](#rate-limits); honour `Retry-After` (seconds) |
| 502 | `discord_error` | Discord rejected the call (details are not forwarded) |
| 503 | `bot_unavailable` | The bot is offline / still starting |
| 504 | `bot_timeout` | The bot did not answer within 10 s |

The per-endpoint "Errors" lists below only name the endpoint-specific codes plus the standard ones that
can occur there (`401`, `403 forbidden`, `404 guild_not_found`, `429`, `503`, `504` apply to every
`/guilds/{guild_id}/…` endpoint and are not repeated).

### Rate limits

Token bucket, per user. Exceeding it returns `429 rate_limited` with a `Retry-After` header.

| Bucket | Limit | Applies to |
|---|---|---|
| Reads | 60 / minute | every authenticated request |
| Writes | 10 / minute | every `POST` / `PUT` / `PATCH` / `DELETE` under `/guilds/{guild_id}/…` |
| Member search | 30 / minute | `GET /guilds/{guild_id}/members` (on top of the read limit) |
| Auth endpoints | 10 / minute per IP | `/auth/exchange`, `/auth/refresh` |
| Login pages | 20 / minute per IP | `/app/auth/login`, `/app/auth/callback` |
| Bad tokens | 30 / minute per IP | failed bearer authentication |

### Audit log

Every successful write is appended (newest first, capped at 500) to the `data/app_activity_log.json`
store as `{ts, user_id, username, guild_id, action, detail}`. Actions: `announcement.post`,
`settings.update`, `league.game.create|enable|disable|delete`, `league.tier.create|update|delete`,
`league.panel.post|refresh`, `f1.calendar.rename|post|edit_post`, `f1.calendar.round.create|update|delete`,
`f1.team.create`, `f1.driver.add|remove`, `f1.results.record`, `f1.points_system.update`, `f1.report.decide`,
`f1.penalty_settings.update`, `f1.penalty.add|clear|ban_give|ban_remove|advance_race`, `f1.dirty_driver.report|remove_report`,
`attendance.division.update`, `attendance.post.create`, `signup.questions.update`, `signup.create`, `signup.close`, `signup.participant.remove`.

---

## Auth

Desktop login is Discord OAuth2 with PKCE and a loopback redirect. The app never sees the Discord
client secret; the server requests only the `identify` scope and discards the Discord token immediately.

1. App generates `code_verifier` (43–128 chars of `A-Za-z0-9-._~`), `code_challenge = base64url(SHA256(verifier))` (no padding),
   a random `state`, and starts a loopback listener on `http://127.0.0.1:<port>/callback` (port 1024–65535).
2. App opens the system browser at `GET /app/auth/login?...`.
3. After the user approves on Discord, the browser is redirected to `http://127.0.0.1:<port>/callback?code=<login_code>&state=<state>`.
   Check `state` equals yours.
4. App calls `POST /auth/exchange` with `code` + `code_verifier` and stores the tokens (e.g. Windows Credential Manager).
5. Access tokens last **30 minutes**, refresh tokens **30 days** and rotate on every refresh.

### GET /app/auth/login

*(Absolute path, no `/api/app/v1` prefix. Opened in the browser, not called with fetch.)*

Query: `state` (16–128 chars `A-Za-z0-9_.~-`), `code_challenge` (43 chars base64url), `redirect`
(exactly `http://127.0.0.1:<1024-65535>/callback`, no query/fragment).

Response: `302` to Discord's authorize page. On bad input: an HTML error page (`400`), `501` if login is not
configured on the server, `429` when rate limited.

### GET /app/auth/callback

*(Absolute path. Discord redirects the browser here; the app never calls it.)*

Response: `302` to your loopback `redirect` with `?code=<one-time login code>&state=<your state>`; the code is
valid for 60 seconds and single-use. Failures render an HTML page (`400` expired/invalid, `403` user declined, `502` Discord error).

### POST /auth/exchange

Request:

```json
{ "code": "<login_code>", "code_verifier": "<verifier>" }
```

Response `200`:

```json
{
  "token_type": "Bearer",
  "access_token": "…", "expires_in": 1800,
  "refresh_token": "…", "refresh_expires_in": 2592000,
  "user": { "id": "123456789012345678", "username": "luc", "avatar": "https://cdn.discordapp.com/…" }
}
```

Errors: `400 invalid_request` (missing/malformed fields), `400 invalid_grant` (wrong/expired/used code or verifier mismatch —
the code is burned either way), `429 rate_limited`.

### POST /auth/refresh

Request: `{ "refresh_token": "…" }` → Response `200`: same shape as `/auth/exchange` (a **new** access and refresh token;
the old refresh token is dead).

Errors: `400 invalid_request`, `401 invalid_grant` (invalid/expired/revoked). **Re-using an already-rotated refresh token revokes
the whole session** — always store the newest refresh token before using the new access token.

### POST /auth/logout

Auth required. Revokes the current session. Response `200`: `{ "ok": true }`.

---

## Base endpoints

### GET /me

Response `200`: `{ "id": "…", "username": "…", "avatar": "https://…" }`

### GET /guilds

Servers where the bot is present **and** the caller is staff (live check).

Response `200`: `{ "guilds": [ { "id": "…", "name": "…", "icon": "https://…" | null } ] }` sorted by name.

Errors: `503 bot_unavailable`.

### GET /guilds/{guild_id}/games

Read-only catalog view: which of the five supported games are enabled, derived from `league_games.json` (a game is enabled
when an **active** league game's key equals the slug or starts with `slug_` / `slug-`). To change games use
[`/league/games`](#get-guildsguild_idleaguegames).

Response `200`:

```json
{ "games": [ { "key": "f1", "label": "Formula 1", "enabled": true },
             { "key": "lmu", "label": "Le Mans Ultimate", "enabled": false },
             { "key": "iracing", "label": "iRacing", "enabled": false },
             { "key": "gt7", "label": "Gran Turismo 7", "enabled": false },
             { "key": "acc", "label": "Assetto Corsa Competizione", "enabled": false } ] }
```

### GET /guilds/{guild_id}/channels

Text channels the bot can post embeds in **and** the caller can see.

Response `200`: `{ "channels": [ { "id": "…", "name": "announcements" } ] }`

### POST /guilds/{guild_id}/announcement

Posts an announcement embed (underscores escaped, `:server_emoji:` converted, server embed colour and footer, no mentions allowed).

Request:

```json
{ "title": "Season 3 starts", "message": "Hello :party:", "channel_id": "777…", "image_url": "https://…" }
```

`title` 1–150 chars single line · `message` 1–1500 chars (newlines allowed) · `image_url` optional, `https` only, ≤ 500 chars.

Response `201`: `{ "ok": true, "message_id": "…", "channel_id": "…" }`

Errors: `400 invalid_title | invalid_message | invalid_channel | invalid_image_url`, `404 channel_not_found`,
`403 bot_cannot_send | forbidden`, `502 discord_error`, `504 bot_timeout`.

---

## Pickers

### GET /guilds/{guild_id}/roles

All roles except `@everyone`, highest position first. For role pickers.

Response `200`:

```json
{ "roles": [ { "id": "800…", "name": "Tier 1 Drivers", "color": "#FF8800" | null, "position": 5,
               "managed": false, "assignable": true, "privileged": false } ] }
```

* `assignable` — the bot can hand the role out (not managed, below the bot's highest role). Disable non-assignable roles in the picker.
* `privileged` — the role carries elevated permissions (administrator, manage server/roles/channels/webhooks/messages, kick, ban, timeout, @everyone mention).
  Only an Administrator may link such a role to a tier (`403 role_too_privileged`).
* `managed` — bot/integration role; cannot be used for tiers.

### GET /guilds/{guild_id}/members

Member search for pickers. Query: `q` — **1–32 chars**, case-insensitive substring of username, global name, nickname, or an exact user ID
(a leading `@` is ignored). Max **25** results, exact matches first, then prefix matches, then by display name.
Uses the bot's member cache and only asks Discord when the cache is incomplete.

Response `200`:

```json
{ "members": [ { "id": "2001", "username": "alice", "display_name": "Ally", "avatar": "https://…", "bot": false } ],
  "truncated": false }
```

`truncated: true` means more than 25 matched — refine `q`.

Errors: `400 invalid_query`, `429 rate_limited` (30/min).

---

## Overview

### GET /guilds/{guild_id}/overview

Dashboard summary, **computed on every call from real data** (nothing here is stored): the same files the commands use, plus live
Discord role membership.

Response `200`:

```json
{
  "guild": { "id": "555…", "name": "My League", "icon": "https://…" | null, "member_count": 120 },
  "season": 4,
  "counts": {
    "games": 2, "active_games": 1, "tiers": 2, "tiers_with_panel": 1,
    "tier_drivers": 3,
    "teams": 2, "team_drivers": 3,
    "calendar_rounds": 3,
    "open_signups": 1,
    "reports": 2, "pending_reports": 1
  },
  "next_event": { "round": 2, "name": "Next GP", "flag": "🇳🇱" | null, "date": "20/11/2023", "time": "20:00" | null,
                  "event_type": "Sprint Weekend", "countdown_hours": 121 } | null,
  "checklist": [ { "key": "appearance", "label": "Embed color or footer set", "done": true, "detail": null } ],
  "setup_complete": false,
  "member_cache_complete": true
}
```

* `season` — the effective season number (see [Season precedence](#season-precedence)).
* `tier_drivers` — **distinct** members holding at least one tier role (a driver in two tiers counts once).
* `next_event` — the next round dated today-or-later, picked by the same function `/f1 next-race` uses; `null` when there is no calendar
  or every round is in the past. `date` is the string as stored. `countdown_hours` is whole hours from now (UTC).
* `checklist` keys (always in this order): `appearance` (embed colour or footer set), `game` (≥ 1 active game), `tier` (≥ 1 tier),
  `tier_roles` (every tier's role still exists; `detail` = `"2/2 roles found"`), `signup_panel` (≥ 1 panel posted), `calendar`
  (≥ 1 round; `detail` = `"setup in progress"` while a `/f1 calendar` setup is unfinished), `teams` (≥ 1 team), `points`
  (custom points system saved), `penalties` (penalty-points settings saved). `setup_complete` is true when all are done.
  There is no stored "checklist" — it cannot drift from reality.
* `member_cache_complete: false` means Discord would not return the full member list, so `tier_drivers` may be an undercount.

Errors: standard only.

---

## Server settings

Same store as `/server settings` (`data/settings.json`).

### GET /guilds/{guild_id}/settings

Staff. Response `200`:

```json
{ "embed_color": "#FF3333", "footer_name": "Nexus", "season_number": null,
  "effective_season": 1, "season_source": "default", "can_edit": false }
```

* `embed_color` — `#RRGGBB` upper-case; default `#FF3333` when never set.
* `footer_name` — shown in every embed footer; default `Nexus`.
* `season_number` — the value stored in settings (`/server settings` → *Default season number*), `null` if never set.
* `can_edit` — `true` when the caller is an **Administrator** of the server, i.e. may `PUT /settings`. Evaluated live on every call; use it to show
  the form read-only up front instead of waiting for a `403 admin_required`.

#### Season precedence

`effective_season` is what every command actually uses (`_get_current_season_number`): the penalty-points setting `current_season`
**wins** if it exists, otherwise `season_number`, otherwise 1. `season_source` is `"penalty_settings"`, `"settings"` or `"default"`.
If it says `penalty_settings`, changing `season_number` here will not change the effective season.

### PUT /guilds/{guild_id}/settings

**Administrator only** (like `/server settings`); plain staff get `403 admin_required`. Partial update: send any of the three fields.

Request:

```json
{ "embed_color": "#ff6b00", "footer_name": "My League", "season_number": 4 }
```

| Field | Rule | Stored as |
|---|---|---|
| `embed_color` | `#RRGGBB`, exactly 6 hex digits | `embed_color`, upper-cased |
| `footer_name` | string, 0–50 chars, single line; empty/blank resets to `Nexus` | `bot_footer` |
| `season_number` | integer 1–99999 (not a string) | `season_number` |

Response `200`: the same object as `GET /settings` after the change (`can_edit` is always `true` here). Other keys in the guild's settings (penalty thresholds, sign-up questions, …) are never touched.

Errors: `403 admin_required`, `400 invalid_embed_color | invalid_footer_name | invalid_season_number | no_changes | invalid_request`.

---

## Games & tiers

Same data and logic as the web dashboard's `/api/league/games…` routes (`data/league_games.json`):

```json
{ "<guild_id>": { "games": { "<game_key>": {
    "label": "Formula 1", "category": "Open Wheel", "active": true,
    "tiers": { "<tier_key>": { "role_id": "800…", "signup_panel_posted": false,
                               "signup_channel_id": null, "points_system": "F1 2025" } } } } } }
```

Anything created here shows up in the dashboard and vice-versa. API responses add two **live** fields to every tier and never store them:
`driver_count` (members currently holding the tier's role, from Discord) and `role_name`. Both are `null` if the role no longer exists.

Game and tier shapes used below:

```json
// game
{ "label": "Formula 1", "category": "Open Wheel", "active": true, "tiers": { "T1": <tier> } }
// tier
{ "role_id": "800…", "signup_panel_posted": true, "signup_channel_id": "777…", "points_system": "F1 2025" | null,
  "driver_count": 12 | null, "role_name": "Tier 1 Drivers" | null }
```

Limits: 25 games per server, 50 tiers per game.

### GET /guilds/{guild_id}/league/games

Response `200`: `{ "games": { "<game_key>": <game>, … }, "member_cache_complete": true }` (empty object when none).

### POST /guilds/{guild_id}/league/games

Creates a game (always `active: true`, no tiers). To "enable" a catalog game (`f1`, `lmu`, …) that has no league game yet, create it with that slug as `game_key`.

Request: `{ "game_key": "f1_2025", "label": "Formula 1", "category": "Open Wheel" }` — `label` and `category` 1–50 chars, single line.

Response `201`: `{ "game_key": "f1_2025", "game": <game> }`

Errors: `400 invalid_game_key | invalid_label | invalid_category`, `409 game_exists | too_many_games`.

### PATCH /guilds/{guild_id}/league/games/{game_key}

Enable / disable a game (the only field the dashboard PATCH accepts too). Request: `{ "active": false }` (boolean required).

Response `200`: `{ "game_key": "…", "game": <game> }`

Errors: `400 invalid_game_key | invalid_active`, `404 game_not_found`.

### DELETE /guilds/{guild_id}/league/games/{game_key}

Deletes the game **and all its tiers**. Already-posted sign-up panels stay in Discord; their button then answers "This tier no longer exists."

Response `200`: `{ "ok": true }`. Errors: `400 invalid_game_key`, `404 game_not_found`.

### POST /guilds/{guild_id}/league/games/{game_key}/tiers

Request: `{ "tier_key": "T1", "role_id": "800…", "points_system": "F1 2025" }` — `points_system` optional (≤ 100 chars free text; `null`/empty = none).

Stored tier: `{ "role_id", "signup_panel_posted": false, "signup_channel_id": null, "points_system" }`.

Role rules (stricter than the dashboard, because the tier's *Join* button hands the role to anyone who clicks it):
the role must exist in the server (`404 role_not_found`), must not be `@everyone` or a bot/integration role (`400 invalid_role`), must be below the bot's
highest role (`403 role_not_assignable`), and a role with elevated permissions can only be linked by an Administrator (`403 role_too_privileged`).

Response `201`: `{ "game_key": "…", "tier_key": "T1", "tier": <tier> }`

Errors: `400 invalid_game_key | invalid_tier_key | invalid_role_id | invalid_points_system`, `404 game_not_found | role_not_found`,
`400 invalid_role`, `403 role_not_assignable | role_too_privileged`, `409 tier_exists | too_many_tiers`.

### PATCH /guilds/{guild_id}/league/games/{game_key}/tiers/{tier_key}

Partial edit; send at least one of `role_id` (same role rules as create), `points_system` (string or `null`), `signup_channel_id` (channel ID or `null`).
`signup_panel_posted` is not editable here — it is set by `post-panel`.

Response `200`: `{ "game_key": "…", "tier_key": "…", "tier": <tier> }`

Errors: `400 invalid_game_key | invalid_tier_key | invalid_role_id | invalid_points_system | invalid_channel | no_changes | invalid_role`,
`404 game_not_found | tier_not_found | role_not_found`, `403 role_not_assignable | role_too_privileged`.

### DELETE /guilds/{guild_id}/league/games/{game_key}/tiers/{tier_key}

Response `200`: `{ "ok": true }`. Errors: `400 invalid_game_key | invalid_tier_key`, `404 tier_not_found`.

### POST /guilds/{guild_id}/league/games/{game_key}/tiers/{tier_key}/post-panel

Posts the tier's sign-up panel — the same embed and the same **persistent "✅ Join {tier}" button** (`custom_id` `nexus:league_join:{guild}:{game}:{tier}`)
as the dashboard — registers the button with the bot (it also survives restarts), and records `signup_panel_posted = true` + `signup_channel_id`.
The channel must be one from `GET /channels`.

Request:

```json
{ "channel_id": "777…", "message_id": "999…" }
```

`message_id` is optional. **Without it** a new panel message is posted. **With it** that existing panel (it must be a message the bot posted in that
channel) is edited in place with the current embed — use it to *refresh* a panel after renaming a game, changing the embed colour/footer or relinking the role.
The panel's message ID is returned by every post; the app should remember it (the server does not store message IDs, same as the dashboard).

Response `201` (posted) or `200` (refreshed):

```json
{ "ok": true, "message_id": "999…", "channel_id": "777…", "refreshed": false, "tier": <tier> }
```

Errors: `400 invalid_game_key | invalid_tier_key | invalid_channel | invalid_message_id | not_a_bot_message`,
`404 game_not_found | tier_not_found | channel_not_found | role_not_found | message_not_found`,
`403 bot_cannot_send | forbidden`, `502 discord_error`, `504 bot_timeout`.
Nothing is recorded in storage if posting fails.

---

## F1 league

Everything under `/guilds/{guild_id}/f1/…` works on the same data as the F1 slash commands
(`f1_calendar.json`, `teams.json`, `points_system.json`) through the same helpers, so a change made in Discord shows up
here and vice versa. All endpoints need staff; two additionally need the **FIA role or Administrator**
(`403 fia_required`): *record race results* and *set the points system*, because `/f1 standings` and `/league points-setup`
require the FIA role in Discord.

Where the API is **stricter than the commands** (the commands accept free text in a Discord modal): event types must be one of
three exact values, dates must be real `DD/MM/YYYY` dates (or `TBD`), team names cannot repeat (the command silently overwrote the
team record and orphaned its role), and results are matched through the same function but ambiguous names are refused.

Optional posting: several writes accept a channel to announce in (`announce_channel_id`, or `channel_id` for race results). The embed
is **the same builder the command uses**. The data is written first; if only the post fails the response is still successful and
`announce_error` carries the code (`bot_cannot_send`, `discord_error`, …).

### Calendar

```json
// calendar
{ "name": "2026 Season", "setup_in_progress": false,
  "rounds": [ { "round": 1, "name": "Australian GP", "date": "15/03/2026", "time": "19:30", "flag": "AU", "event_type": "Normal Race" } ] }
```

* `date` is `DD/MM/YYYY` or `TBD`; `time` is `HH:MM` (24 h) or `""` (shown as TBD); `flag` is up to 8 characters (a flag emoji);
  `event_type` is `Normal Race`, `Sprint Weekend` or `Full Qualifying`.
* **Numbering:** like `/f1 calendar`, rounds are numbered 1, 2, 3 … A new round gets the highest number + 1. Removing a round
  leaves a **gap** (the others keep their numbers, as `/f1 calendar-remove-round` does). A gap can be filled by passing `round`.
* At most **25 rounds** (the command's limit).
* `setup_in_progress: true` means someone is in the middle of `/f1 calendar` in Discord; finishing that setup replaces all rounds.

### GET /guilds/{guild_id}/f1/calendar

Response `200`: the calendar above (an empty calendar is `{"name": "F1 Season Calendar", "rounds": [], "setup_in_progress": false}`).
Rounds are sorted by number. Calendars saved with the legacy `races` key are read transparently.

### PATCH /guilds/{guild_id}/f1/calendar

Rename the calendar. Request: `{ "name": "2027 Season" }` (1–100 chars, single line). Response `200`: the calendar.

Errors: `400 invalid_name | invalid_request`, `404 calendar_not_found`.

### POST /guilds/{guild_id}/f1/calendar/rounds

Add a round (creates the calendar if there is none).

```json
{ "name": "Australian GP", "date": "15/03/2026", "time": "19:30", "flag": "AU", "event_type": "Sprint Weekend",
  "round": 3, "calendar_name": "2026 Season" }
```

`name` (1–100) and `date` are required; `time`, `flag`, `event_type` (default `Normal Race`) and `round` (1–99) are optional;
`calendar_name` is used only when the calendar does not exist yet (default `F1 Season Calendar`).

Response `201`: `{ "round": <round>, "calendar": <calendar> }`.

Errors: `400 invalid_name | invalid_date | invalid_time | invalid_flag | invalid_event_type | invalid_round | invalid_request`,
`409 round_exists | too_many_rounds`.

### PATCH /guilds/{guild_id}/f1/calendar/rounds/{round_num}

Edit a round; send any of `name`, `date`, `time`, `flag`, `event_type`. `/f1 calendar-edit` changes name, date, time and flag only;
`event_type` can additionally be changed here (it is the same stored field). Response `200`: `{ "round": <round>, "calendar": <calendar> }`.

Errors: `400 invalid_name | invalid_date | invalid_time | invalid_flag | invalid_event_type | no_changes | invalid_request`,
`404 calendar_not_found | round_not_found`.

### DELETE /guilds/{guild_id}/f1/calendar/rounds/{round_num}

Response `200`: `{ "ok": true, "calendar": <calendar> }`. The other rounds keep their numbers.

Errors: `404 calendar_not_found | round_not_found`.

### POST /guilds/{guild_id}/f1/calendar/post

Posts the combined calendar embed in a channel (the embed `/f1 calendar` and `/f1 calendar-view` post: one field per 10 rounds,
only the first field titled "📅 Races" (continuation fields have a blank title), footer "Calendar set by <you> · N rounds · <server footer> · <time>"), or edits a
previous post in place.

Request: `{ "channel_id": "777…", "message_id": "999…" }` — `message_id` is optional: without it a new message is posted,
with it that message (it must be a message the bot posted in that channel) is edited. Keep the returned `message_id` to update the
calendar later; the server does not store it.

Response `201` (posted) or `200` (edited): `{ "ok": true, "message_id": "999…", "channel_id": "777…", "refreshed": false }`.

Errors: `400 invalid_channel | invalid_message_id | not_a_bot_message`, `404 calendar_not_found | channel_not_found | message_not_found`,
`403 bot_cannot_send | forbidden`, `502 discord_error`, `504 bot_timeout`.

### GET /guilds/{guild_id}/f1/next-race

What `/f1 next-race` shows: the first round dated today or later (same picker function); if every round is in the past, the **last**
round with `upcoming: false`.

```json
{ "calendar_name": "2026 Season", "race": <round>, "upcoming": true,
  "countdown_hours": 121, "countdown": { "days": 5, "hours": 1 } }
```

`countdown_hours` / `countdown` are `null` when `upcoming` is false. Errors: `404 calendar_not_found`.

### Teams and drivers

```json
// team
{ "name": "Red Racing", "abbreviation": "RED", "color": "#FF0000",
  "role_id": "910…" | null, "role_name": "Red Racing" | null, "channel_id": "930…" | null, "channel_name": "red-racing" | null,
  "points": 80,
  "drivers": [ { "user_id": "2001", "username": "alice", "display_name": "Ally", "number": 7, "points": 40, "wins": 1, "podiums": 2 } ] }
```

`points` is the sum of the team's drivers' points (constructor points are never stored). Drivers are ordered numbered-first by number,
like `/league team-info`. `role_name` / `channel_name` are `null` if the role or channel no longer exists.

Team names are used in URLs (URL-encode them); a team name is matched case-insensitively. Names created through the API cannot contain
`/` or `\`; a team created in Discord with such a character appears in the list but cannot be fetched by name.

### GET /guilds/{guild_id}/f1/teams

Response `200`: `{ "teams": [ <team> ] }`.

### GET /guilds/{guild_id}/f1/teams/{team_name}

Response `200`: `{ "team": <team> }` (`/league team-info`). Errors: `404 team_not_found`.

### POST /guilds/{guild_id}/f1/teams

Creates a team exactly like `/league create-team`: a Discord **role** in the team colour, a **private text channel** in the "Teams"
category (created if missing; hidden from @everyone, visible to the team role and to the `FIA` / `STAFF` roles), and the `teams.json`
entry. If the channel cannot be created the role is removed again.

Request: `{ "name": "Red Racing", "color": "#FF0000", "abbreviation": "RED", "announce_channel_id": "777…" }`

* `name` 1–50 characters, single line, no `/` or `\`; `color` exactly `#RRGGBB`; `abbreviation` 1–6 letters/digits (stored upper-case);
  `announce_channel_id` optional: also posts the "Team Created" embed there.

Response `201`: `{ "team": <team>, "announce_error": null }`.

The bot needs **Manage Roles** and **Manage Channels** in the server, otherwise nothing is created.

Errors: `400 invalid_name | invalid_color | invalid_abbreviation | invalid_channel | invalid_request`, `404 channel_not_found`,
`409 team_exists`, `403 bot_missing_manage_roles | bot_missing_manage_channels | bot_cannot_send | forbidden`, `502 discord_error`, `504 bot_timeout`.

### POST /guilds/{guild_id}/f1/teams/{team_name}/drivers

Adds a driver like `/league add-driver`: assigns the team role, adds the roster entry (replacing an existing entry of the same user in
that team) and creates/refreshes the driver's stats entry (existing points are kept).

Request — identify the driver by **exactly one** of:

* `user_id` — a Discord user ID (use the member search; preferred), or
* `username` — resolved like the command does: exact username, global name, nickname or ID, in the member cache and then through Discord.

Optional: `number` (0–999 or `null`), `announce_channel_id` (posts the "Driver Added" embed).

Response `201`: `{ "team": <team>, "user_id": "2001", "announce_error": null }`.

The role is assigned **before** any data is written, so a refusal by Discord leaves the data unchanged. A team role with admin-level
permissions can only be handed out by an Administrator.

Errors: `400 invalid_driver | invalid_user_id | invalid_username | invalid_number | invalid_channel | invalid_request`,
`404 team_not_found | member_not_found | role_not_found | channel_not_found`,
`403 bot_missing_manage_roles | bot_cannot_assign_role | role_not_assignable | role_too_privileged | forbidden`, `504 bot_timeout`.

### DELETE /guilds/{guild_id}/f1/teams/{team_name}/drivers/{user_id}

Removes a driver like `/league remove-driver`: the team role is removed, the roster entry is dropped, and the driver's stats are kept
with their team set to `"—"`. Optional JSON body `{ "announce_channel_id": "777…" }` posts the "Driver Removed" embed.

Response `200`: `{ "team": <team>, "role_removed": true, "member_in_server": true, "announce_error": null }`. If the member has left the
server, the roster entry is still removed (`role_removed: false`, `member_in_server: false`) — the command cannot do that.

Errors: `400 invalid_user_id | invalid_channel`, `404 team_not_found | driver_not_found | channel_not_found`,
`403 bot_missing_manage_roles | bot_cannot_assign_role | forbidden`, `504 bot_timeout`.

### GET /guilds/{guild_id}/f1/drivers/{user_id}

What `/league driver-stats` shows, by user ID. Response `200`:

```json
{ "user_id": "2001", "username": "alice", "display_name": "Ally", "team": "Red Racing", "points": 40, "wins": 1, "podiums": 2, "number": 7 }
```

`team` is `"—"` for a driver who is on no team; `number` is `null` if they have none. Errors: `400 invalid_user_id`, `404 driver_not_found`.

### Standings

### GET /guilds/{guild_id}/f1/standings

The World Drivers' and Constructors' Championships, computed by the same functions as `/f1 wdc` and `/f1 wcc` (most points first, ties keep
their stored order, `gap` = points behind the leader).

```json
{ "drivers":      [ { "position": 1, "user_id": "2001", "username": "alice", "team": "Red Racing", "points": 40, "wins": 1, "podiums": 2, "gap": 0 } ],
  "constructors": [ { "position": 1, "team": "Red Racing", "points": 80, "drivers": 2, "gap": 0 } ] }
```

### POST /guilds/{guild_id}/f1/standings/results

Records one race like `/f1 standings` (**FIA role or Administrator**): the points of each position (from the points system, below),
+ the fastest-lap bonus (not for the winner) and the pole bonus are added to the drivers' running totals, wins and podiums are counted.
Constructor points follow automatically (they are the sum of their drivers).

```json
{ "season": 5, "round": 3, "circuit": "Zandvoort",
  "results": ["alice", { "user_id": "2002" }, "carol_x"],
  "fastest_lap": "carol_x", "pole": { "user_id": "2001" },
  "channel_id": "777…", "confirm_duplicate": false }
```

* `season` (≤ 20 chars), `round` (≤ 10), `circuit` (≤ 60): text or numbers; they only form the title "Season 5 Round 3 — Zandvoort".
* `results`: 1–20 drivers **in finishing order** (position = index + 1). Each is a driver name (1–100 chars) or `{ "user_id": "…" }`.
  Names are matched exactly like the command: against the driver's stored username, else a roster display name (case-insensitive).
  Drivers that are not found score nothing and are returned in `not_found`; the others are still recorded.
* `fastest_lap`, `pole`: optional, a name or `{ "user_id" }`; it must be one of the drivers in `results`. The command matches these
  names by substring; if a name would match more than one driver in `results` the request is refused (`400 ambiguous_name`).
* `channel_id`: optional; when given, the three embeds `/f1 standings` posts (results, WDC, WCC) are posted there (the same embed builders
  as the command). The channel must be a text channel the bot can post embeds in **and** you can see: `400 invalid_channel` (not a numeric ID),
  `404 channel_not_found`, `403 bot_cannot_send` (the bot lacks View Channel / Send Messages / Embed Links there), `403 forbidden` (you cannot
  see it). These are checked **before** anything is recorded. If only the post fails afterwards (`discord_error`, `bot_timeout`, …) the points
  stay recorded and the code is returned as `announce_error`.
* `confirm_duplicate`: optional boolean, see the ledger below.

Response `200`:

```json
{ "race_title": "Season 5 Round 3 — Zandvoort",
  "results": [ { "position": 1, "name": "alice", "points": 25, "matched": true } ],
  "not_found": [],
  "standings": { "drivers": [ … ], "constructors": [ … ] },
  "posted": { "channel_id": "777…", "message_ids": ["…", "…", "…"] } | null,
  "announce_error": null,
  "ledger": { "recorded": true, "entry": { "season": "5", "round": "3", "circuit": "Zandvoort", "recorded_by": "boss", "timestamp": "2026-…Z" }, "duplicate": false } }
```

**Duplicate guard.** The standings data stores only running totals, so it cannot tell that a race was already recorded. The API therefore
keeps its **own ledger** (`data/app_results_ledger.json`, `{ guild: [ { season, round, circuit, recorded_by, timestamp } ] }`), appended with the
locked atomic helper **only after the results were applied** (a failed request writes no entry). If an entry with the same `season` and `round`
(compared as trimmed, case-insensitive text) already exists and the body does not say `"confirm_duplicate": true`, the request is refused with

```json
// 409
{ "error": "results_already_recorded", "message": "…", "existing": { "season": "5", "round": "3", "circuit": "Zandvoort", "recorded_by": "boss", "timestamp": "…" } }
```

and **nothing is changed** (no points, no ledger entry, nothing posted). With `"confirm_duplicate": true` the points **are added again**
(exactly like running the command twice) and another ledger entry is appended; `ledger.duplicate` is then `true`. If only the ledger write
fails the response is still `200` with `ledger.recorded: false` (the points are applied; retrying would double them).

> **Races recorded with the Discord command `/f1 standings` are not in this ledger** (the command is untouched), and neither are races recorded
> before this feature existed. The guard only protects against repeating a race **through the app**.

Errors: `403 fia_required | forbidden`, `400 invalid_season | invalid_round | invalid_circuit | invalid_results | invalid_fastest_lap |
invalid_pole | fastest_lap_not_in_results | pole_not_in_results | ambiguous_name | invalid_channel | invalid_confirm_duplicate | invalid_request`,
`404 channel_not_found`, `403 bot_cannot_send`, `409 results_already_recorded`, `502 discord_error`, `504 bot_timeout`. (A failed post never undoes
the recorded points: see `announce_error`.)

### GET /guilds/{guild_id}/f1/standings/results-ledger

The races recorded **through the app** (see above), newest first. Optional query `season` and `round` (exact, case-insensitive text).
`{ "entries": [ { "season", "round", "circuit", "recorded_by", "timestamp" } ] }`. Races recorded with `/f1 standings` in Discord are not listed.
Errors: `400 invalid_season | invalid_round`.

### GET /guilds/{guild_id}/f1/points-system

```json
{ "points": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "pole": 0, "fastest_lap": 1, "is_default": true,
  "defaults": { "points": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "pole": 0, "fastest_lap": 1 } }
```

Always 20 entries (P1 first). `is_default: true` means nothing has been saved and the built-in defaults apply (what the commands use).
`defaults` is that built-in table (read from the constant the commands fall back to, `_DEFAULT_POINTS_SYSTEM`), always returned — also after a
custom system was saved — so the app can offer "reset to defaults". The PUT response carries it too.

### PUT /guilds/{guild_id}/f1/points-system

Sets the points system like `/league points-setup` (**FIA role or Administrator**).

Request: `{ "points": [25, 18, 15], "pole": 1, "fastest_lap": 2, "announce_channel_id": "777…" }`

* `points`: 1–20 whole numbers 0–1000 (P1 first; the rest are filled with 0). `pole` and `fastest_lap`: whole numbers 0–1000; when
  omitted they default to `0` and `1` like the command. `announce_channel_id` optional: posts the "Points System Updated" embed.

Response `200`: the same object as the GET plus `announce_error`.

Errors: `403 fia_required | forbidden`, `400 invalid_points | invalid_pole | invalid_fastest_lap | invalid_channel | invalid_request`,
`404 channel_not_found`, `403 bot_cannot_send`.

---

## Reports and penalties (M3)

Everything here works on the same files as the report buttons and the `/league` penalty commands — `reports.json`,
`penalty_settings.json`, `penalty_points.json`, `dirty_drivers.json` — through helpers `bot.py` shares with the commands, so Discord and
the app always agree. **`penalty_settings` and `penalty_points` are two separate files with two separate writers**: no settings write
touches a driver's points, and no points write (adding, clearing, bans, advancing the race counter, deciding a report) touches the
settings. (Tests assert both directions.)

Roles — the same as the command or button each endpoint mirrors:

| Needs | Endpoints |
|---|---|
| Staff (`FIA`, `STAFF` or Administrator) | everything that reads; deciding a report; adding manual penalty points; the dirty-drivers list |
| **FIA or Administrator** (`403 fia_required`) | clear penalty points, give/remove a ban, advance the race counter |
| **Administrator** (`403 admin_required`) | `PUT /f1/penalties/settings` |

Destructive actions (**clear points, give/remove a ban, advance the race counter**) need `"confirm": true` in the body, otherwise
`400 confirm_required` and nothing is changed. Driver names are free text exactly as in Discord: a driver is looked up by their name
(trimmed, case-insensitive), not by a Discord ID. Send them as `driver` in the body, or as the `driver` query parameter on `GET`/`DELETE`.
`season` is optional everywhere and defaults to the **current season** (the penalty settings' `current_season`, else the server
settings' `season_number`, else 1).

### Reports

A report is created by a driver in Discord (`/f1 report` opens a private thread with the **Penalty Issued / No Further Action** buttons);
**the API cannot create reports** — the thread flow (private thread, adding the reporter and staff) cannot be mirrored safely.

```json
{ "id": "9f1c…", "number": 1, "round_key": "S5R3", "season": "5", "round": "3", "circuit": "Zandvoort",
  "reporter": "alice", "reporter_id": "2001", "drivers_involved": "alice, bob", "lap": "4", "description": "…",
  "evidence_url": "https://…" | null, "evidence_img": "https://….png" | null,
  "status": "pending", "status_label": "⏳ Awaiting Review", "decided": false,
  "penalty": null, "decision": null,
  "thread_name": "Report #1 - S5R3 - Zandvoort", "message_id": "1234…" | null, "timestamp": "2026-01-01T00:00:00Z" }
```

* `status` is `pending`, `under_investigation` (legacy button), `penalty_issued` or `no_further_action`; `status_label` is the text
  `/f1 report-overview` shows. `decided` is true for the last two, and then `decision` is `{ "type": "penalty_issued", "penalty": "5s…" }`.
* `number` is the "Report #n" of `/f1 report-overview` (position inside its round). `season` and `round` are the text the reporter typed.
* The "No Further Action" explanation and the penalty points awarded are **not stored in `reports.json`** (the buttons only put them in the
  Discord embed; the points are in the driver's penalty history), so they cannot be returned here.

### GET /guilds/{guild_id}/f1/reports

Newest first. Query: `season`, `round` (text, as stored), `status` (`pending|under_investigation|penalty_issued|no_further_action`),
`driver` (substring of "drivers involved", case-insensitive), `limit` (1–100, default 50), `offset`.

Response `200`: `{ "total": 12, "limit": 50, "offset": 0, "reports": [ <report>, … ] }`.
Errors: `400 invalid_season | invalid_round | invalid_status | invalid_driver | invalid_limit | invalid_offset`.

### GET /guilds/{guild_id}/f1/reports/overview

`/f1 report-overview`. With **both** `season` and `round`: `{ "season", "round", "round_key", "circuit", "count", "reports": [ <report>, … ] }`
(an empty round is `count: 0`, not an error). With neither: one row per round that has reports —
`{ "rounds": [ { "season", "round", "round_key", "circuit", "total", "pending", "under_investigation", "penalty_issued", "no_further_action" } ] }`.
Errors: `400 invalid_season | invalid_round` (also when only one of the two is given).

### GET /guilds/{guild_id}/f1/reports/{report_id}

Response `200`: one report (above). Errors: `400 invalid_report_id`, `404 report_not_found`.

### POST /guilds/{guild_id}/f1/reports/{report_id}/decision

Decides a report with **the effect of the Discord buttons** (staff — the buttons' own check).

```json
// no further action
{ "decision": "no_further_action", "explanation": "No infringement found." }
// penalty issued
{ "decision": "penalty_issued", "description": "5 second time penalty", "driver": "alice", "penalty_points": 3, "season": 5 }
```

* `explanation` (1–500) is required for no further action; `description` (1–500) for a penalty. `driver` (1–100, the driver who receives
  points; required when `penalty_points` > 0), `penalty_points` (0–999, default 0) and `season` (1–99999) are optional; without `season`
  the season in the report's own title ("🚨 Season 5 Round 3 — …") is used, like the button, then the current season.

What happens, in this order (and what the button does at each step):

1. Nothing is changed until the bot has found the report's Discord message and checked it can post the ban notice in its thread.
2. The report is **claimed atomically** in `reports.json` (status `Penalty Issued` / `No Further Action`, plus the penalty text). Of two
   decisions racing for the same report exactly one gets past this point; the other gets `409 already_decided`.
3. The report embed is edited (status field, "Penalty Details" / "Explanation", colour, "Reviewed by … · Nexus F1 Stewards" footer)
   and its **buttons are removed**. If this edit fails the claim is rolled back and the error returned: nothing was applied.
4. If `penalty_points` > 0: the points are saved under the right season in `penalty_points.json` (history entry, expiry =
   round from the title + `expiry_races`), the **ban thresholds are checked** (`quali_ban_threshold`, `race_ban_threshold`) in the same locked
   write, the report embed gets its "🔴 Penalty Points" field, and — if a threshold is crossed — the **"🚨 Automatic Ban Notice"
   embed is posted in the report's own thread**, exactly where the button posts it.

Response `200`:

```json
{ "decision": "penalty_issued", "report": { …updated report… },
  "points": { "applied": true, "driver": "alice", "added": 3, "season": 5, "total": 9, "quali_banned": true, "race_banned": false,
             "ban_notice": "⚠️ **QUALI BAN** — …", "ban_notice_posted": true },
  "warnings": [] }
```

`warnings` lists steps that failed **after** the decision was applied (`points_field_failed:<code>`, `ban_notice_failed:<code>`); the
decision and the points are saved regardless. If no points were given, `points.applied` is `false`.

A report that is already decided (in Discord or through the API) is refused with **`409 already_decided`** and nothing is changed: points
are never applied twice. (A report in the legacy "Under Investigation" state can still be decided.)

Errors: `400 invalid_report_id | invalid_decision | invalid_explanation | invalid_description | invalid_driver | invalid_penalty_points |
driver_required | invalid_season | invalid_request`, `404 report_not_found | report_message_not_found`,
`409 already_decided | penalty_not_configured | report_message_not_found | report_embed_missing`, `400 not_a_bot_message`,
`403 bot_cannot_send`, `500 penalty_points_failed`, `502 discord_error`, `504 bot_timeout`.

* `penalty_points_failed` (500): the storage failed **after** the report was decided and its embed edited. The report stays decided (a retry gets
  `409 already_decided`, so nothing can be doubled); add the points with `POST /f1/penalties/points`.
* `penalty_not_configured` (409): points were requested but `/league penalty-setup` has not been done. The button would decide the report
  and skip the points with a warning; the API refuses **before changing anything** so the report is not left decided without its points
  (set the settings first, then decide).
* `report_message_not_found`: the report's message is not tracked, or was deleted, or its thread is not visible to the bot (reports.json
  stores the thread **name**, not its channel id, so the bot looks in active threads with that name, then in `#reports`, then in archived
  threads of `#reports`). An archived thread is reopened before the edit, as Discord refuses edits inside archived threads.

### Penalty settings

### GET /guilds/{guild_id}/f1/penalties/settings

```json
{ "configured": true, "current_season": 5, "expiry_races": 15, "quali_ban_threshold": 8, "race_ban_threshold": 13,
  "setup_by": "boss", "setup_at": "2026-01-01T00:00:00Z",
  "defaults": { "current_season": 1, "expiry_races": 15, "quali_ban_threshold": 8, "race_ban_threshold": 13 } }
```

Not configured: `configured: false` and `null` values (`current_season` is still the effective season). `defaults` are the values
`/league penalty-setup` falls back to for an unreadable field.

### PUT /guilds/{guild_id}/f1/penalties/settings

`/league penalty-setup` (**Administrator**). All four fields are required: `{ "current_season": 5, "expiry_races": 15,
"quali_ban_threshold": 8, "race_ban_threshold": 13 }` — whole numbers, `current_season` 1–99999, the others 1–999. Stores exactly what the
command stores (`setup_by` / `setup_at` included) in `penalty_settings.json` **only**. Existing penalty points and ban flags are not
recalculated (as in Discord). Response `200`: the same object as the GET.

Errors: `403 admin_required`, `400 invalid_current_season | invalid_expiry_races | invalid_quali_ban_threshold | invalid_race_ban_threshold | invalid_request`.

### Penalty points

Points live in `penalty_points.json` as `{ guild: { "season_N": { driver_key: { display_name, total_points, history[], quali_banned, race_banned } } } }`;
`driver_key` is the lower-cased trimmed name. Old servers may still have the flat pre-season layout; it is read as season 1.

### GET /guilds/{guild_id}/f1/penalties/overview

`/league penalty-overview`. Query: `season` (1–99999; default current). Highest total first.

```json
{ "season": 5, "current_season": 5, "is_current": true,
  "settings": { "expiry_races": 15, "quali_ban_threshold": 8, "race_ban_threshold": 13 },
  "drivers": [ { "position": 1, "key": "max_v", "display_name": "Max_V", "total_points": 14, "incidents": 2,
                 "ban": "race", "quali_banned": true, "race_banned": true, "reported_count": 2 } ] }
```

`ban` is `race`, `quali` or `none` (a race ban wins). `incidents` counts history items that added points. `reported_count` is the "⚠️ Reported (N)"
flag: how many dirty-driver reports (below) are on file for that driver (matched by the same driver key).
Errors: `400 invalid_season`, `404 penalty_not_configured`.

### GET /guilds/{guild_id}/f1/penalties/history

`/league penalty-history`. Query: `driver` (required), `season` (default current). The driver's **whole** history, oldest first (the command
shows the last 10).

```json
{ "season": 5, "key": "bob", "display_name": "bob", "total_points": 3, "incidents": 1, "ban": "none", "quali_banned": false, "race_banned": false,
  "history": [ { "index": 1, "points": 3, "reason": "…", "race": "Season 5 Round 1 — Spa", "expires_after_race": 16, "timestamp": "2026-01-02T03:04:05Z" } ] }
```

`points` is negative for an admin removal (`expires_after_race: null`). Errors: `400 invalid_driver | invalid_season`, `404 driver_not_found`.

### POST /guilds/{guild_id}/f1/penalties/points

`/f1 penalty` (staff): add penalty points to a driver. Request:

```json
{ "driver": "Max_V", "penalty_type": "Drive-Through", "points": 3, "reason": "Contact at T1", "season": 5, "channel_id": "777…" }
```

`driver` (1–100), `penalty_type` (1–100), `reason` (1–300), `points` (0–999), `season` optional, `channel_id` optional. The points are
added (history entry "Season N — Manual Penalty", expiry = `expiry_races` from round 0, like the command) and the ban thresholds are checked
in the same locked write. With `channel_id` the public **"⚖️ Stewards Decision — PENALTY ISSUED"** embed is posted there (the command posts
it in the channel it was used in); without it nothing is posted. The ban text is **returned, not posted** — the command shows it only to the person
who issued the penalty. `points: 0` records nothing and needs `channel_id` (it only posts the embed).
The data is written first; a failed post never undoes the points (`announce_error`).

Response `201`:

```json
{ "driver": "Max_V", "season": 5, "saved": true, "points_added": 3, "total_points": 11, "quali_banned": true, "race_banned": false,
  "ban_notice": "⚠️ **QUALI BAN** — **Max\\_V** has reached **11** penalty points …" | null,
  "posted": { "channel_id": "777…", "message_id": "…" } | null, "announce_error": null }
```

Errors: `400 invalid_driver | invalid_penalty_type | invalid_reason | invalid_points | invalid_season | invalid_channel | nothing_to_do | invalid_request`,
`404 channel_not_found`, `403 bot_cannot_send`, `409 penalty_not_configured` (the command would post the embed and silently not record the points).

### POST /guilds/{guild_id}/f1/penalties/clear

`/league clear-penalty` (**FIA or Administrator**, needs `"confirm": true`). Request: `{ "driver": "alice", "points": 3, "reason": "Appeal upheld",
"season": 5, "confirm": true }`. Without `points` **all** of the driver's points and history for that season are cleared and both bans lifted;
with `points` (1–99999) that many are removed (never below 0), the history is kept with an "Admin removed N pts" entry, and the ban flags are
recalculated against the settings. `reason` is required (1–300). Writes `penalty_points.json` only — the season settings are untouched.

Response `200`: `{ "driver", "season", "mode": "all" | "partial", "points_removed", "remaining" }`.
Errors: `403 fia_required`, `400 invalid_driver | invalid_reason | invalid_points | invalid_season | confirm_required`, `404 driver_not_found`.

### POST /guilds/{guild_id}/f1/penalties/bans

`/league ban-manage` (**FIA or Administrator**, needs `"confirm": true`). Request: `{ "driver": "alice", "ban_type": "quali" | "race",
"action": "give" | "remove", "season": 5, "reason": "…", "confirm": true }`. `give` sets the flag (creating the driver's record for that
season if they have none); `remove` clears it and keeps the points. `reason` is optional (≤ 300), not stored (Discord shows it only in its reply);
it is in the audit log. A driver record created by `give` is exactly the record the command creates (including an empty `history` list).

Response `200`: `{ "driver", "season", "action", "ban_type", "quali_banned", "race_banned", "total_points" }`.
Errors: `403 fia_required`, `400 invalid_driver | invalid_action | invalid_ban_type | invalid_reason | invalid_season | confirm_required`, `404 driver_not_found` (remove only).

### POST /guilds/{guild_id}/f1/penalties/advance-race

`/league advance-race` (**FIA or Administrator**, needs `"confirm": true`). Request: `{ "race_number": 6, "confirm": true }` (0–9999). Removes, for the
**current season**, every history item whose `expires_after_race` ≤ `race_number` (admin removals never expire), lowers the totals and
recalculates the ban flags. Requires the penalty settings. Nothing is posted to Discord.

Response `200`: `{ "race_number", "season", "expired": [ { "key", "display_name", "points", "race" } ], "updated": [ { "key", "display_name", "old_total", "new_total" } ] }`.
Errors: `403 fia_required`, `400 invalid_race_number | confirm_required`, `409 penalty_not_configured`.

> `/league advance-race` uses the same shared helper and now saves its result too (before, it reported expiry but never saved it, and
> crashed on a partial clear in a driver's history).

### Dirty drivers

Staff-only misconduct reports (`/league report-driver`, `dirty-drivers`, `driver-history`, `remove-report`) in `dirty_drivers.json`:
`{ guild: { driver_key: { display_name, reports: [ { reason, evidence, reported_by, related_incident, timestamp } ] } } }`.

### GET /guilds/{guild_id}/f1/dirty-drivers

Drivers that have reports, most recently reported first:
`{ "drivers": [ { "key": "max_v", "display_name": "Max_V", "report_count": 2, "latest": { "reason", "evidence", "reported_by", "related_incident", "timestamp" } } ] }`.

### GET /guilds/{guild_id}/f1/dirty-drivers/history

Query: `driver` (required). `{ "key", "display_name", "total", "reports": [ { "index": 1, "reason", "evidence", "reported_by", "related_incident", "timestamp" } ] }` —
`index` is the number `remove-report` takes. Errors: `400 invalid_driver`, `404 driver_not_found`.

### POST /guilds/{guild_id}/f1/dirty-drivers/reports

`/league report-driver`. Request: `{ "driver": "Bob_B", "reason": "Rammed him on purpose", "evidence_url": "https://…", "related_incident": "Race 5 — Silverstone" }`.
`driver` 1–100, `reason` 1–1000, `evidence_url` 1–300 and starting with `http://` or `https://` (no spaces), `related_incident` optional ≤ 200.
`reported_by` is the staff member's Discord name, set by the server. Response `201`: `{ "display_name", "total_reports", "report": { "index", … } }`.
Errors: `400 invalid_driver | invalid_reason | invalid_evidence_url | invalid_related_incident | invalid_request`.

### DELETE /guilds/{guild_id}/f1/dirty-drivers/reports/{index}

`/league remove-report`. Query: `driver` (required). Removes report number `index` (1-based, as in the history); removing a driver's last report
removes the driver from the list. Response `200`: `{ "ok": true, "display_name", "removed_index", "driver_removed", "removed": { … } }`.
Errors: `400 invalid_driver`, `404 report_not_found`.

---

## Attendance and sign-ups (M4)

The app and the Discord commands, buttons and modals share the **same data, builders and locks**; nothing here has its own schema.

| Area | Mirrors | Data (`file_key`) | Lock the commands, buttons and API all take |
|---|---|---|---|
| Divisions | `/f1 attendance-setup` | `data/attendance_config.json` | `_att_cfg_lock` (also used by the legacy `"Main"` migration) |
| Attendance posts | `/f1 attendance` + the Present / Absent / Reserve buttons | `data/attendance.json` | `_f1_lock` |
| Sign-up questions | `/server settings` → Sign-up Questions | `data/settings.json` (`signup_questions`) | `_settings_lock` |
| Sign-ups | `/league signup`, `signup-close`, `signup-list`, `signup-remove` + the Start Sign-up flow | `data/signups.json`, held in the bot's in-memory `signups_data` | `_signups_lock` |

Every one of these roles is the same as the command it mirrors: **STAFF, FIA or Administrator** (the standard staff check), except the sign-up questions
write, which needs **Administrator** like `/server settings`. Drivers toggle their own attendance and submit their own sign-up in Discord only (see
[what cannot be done](#things-that-cannot-be-done-through-the-api-m4)).

Posts are made on the bot's event loop with a 10 s timeout. The bot's permissions are checked **before** posting and answered with a clear code
(`bot_cannot_send`, `bot_cannot_post_confirmations`, `bot_missing_manage_channels`, …) rather than a generic error. Member IDs are validated against the server.

### Attendance divisions

`attendance_config.json`: `{ guild: { "divisions": { "<name>": { "regular_drivers": [user_id], "reserve_drivers": [user_id] } } } }`. **Regular drivers** are marked Present
when a post is created; **reserve drivers** cannot use the regular Present button, only Reserve. A server set up before multi-division support
has `regular_drivers` / `reserve_drivers` at the top level instead; reading divisions (here or in Discord) copies them once into a division called `Main`
(the old keys are kept, because old posts without a division still read them).

### GET /guilds/{guild_id}/f1/attendance/divisions

```json
{ "divisions": [ { "name": "Elite",
                   "regular_drivers": [ { "user_id": "2001", "name": "Ally", "in_server": true } ],
                   "reserve_drivers": [ { "user_id": "2003", "name": "carol_x", "in_server": true } ] } ],
  "legacy": null }
```

Sorted by name. `name` is the member's current display name, or `null` (`in_server: false`) for someone who left. `legacy` is `{ "regular_drivers": […], "reserve_drivers": […] }`
(same row shape) only on a server that still has the pre-division top-level lists.

### PUT /guilds/{guild_id}/f1/attendance/divisions

Creates a division, or replaces one or both of its lists — what `/f1 attendance-setup` does with its "Update regular / Update reserve / Replace both" choices.

Request: `{ "name": "Elite", "regular_drivers": ["2001"], "reserve_drivers": ["2003"] }`.
`name` 1–50 characters, single line (case-sensitive, exactly what the command stores; `Elite`, `Gold`, `Pro-Am 2`, … all work). Each list is optional:
**a list you leave out keeps its current value** (a new division starts with empty lists); `[]` clears it. At most **25** user IDs per list (the command's select limit),
all strings, all members of the server, duplicates are collapsed.

Response `201` (created) or `200` (updated): `{ "division": { …as in the list… }, "created": true, "overlap": [] }`.
`overlap` lists user IDs that are in **both** lists. The command has no rule against that and neither does the API (it stores what you send), but such a driver is
auto-marked Present at creation and then cannot use the Present button — worth warning the user.

Errors: `400 invalid_name | invalid_regular_drivers | invalid_reserve_drivers | member_not_found | no_changes | invalid_request`.
`no_changes` = the division exists and the body has neither list.

### Attendance posts

`attendance.json`: `{ guild: { "<message_id>": { season, round, circuit, division, description, guild_id, attendance: { present, absent, reserve: [ { id, name } ] } } } }`.
The post's buttons are the bot's global persistent view, so a post created through the API **keeps working after a bot restart** exactly like one made with `/f1 attendance`.

### GET /guilds/{guild_id}/f1/attendance/posts

Newest first. Query: `division` (exact), `season` (exact text), `limit` (1–100, default 25), `offset`.

```json
{ "posts": [ { "message_id": "700…", "season": "16", "round": "5", "circuit": "Zandvoort", "division": "Elite",
               "description": "Sprint weekend", "counts": { "present": 1, "absent": 1, "reserve": 0 } } ],
  "total": 2, "limit": 25, "offset": 0 }
```

Errors: `400 invalid_division | invalid_season | invalid_limit | invalid_offset`.

### GET /guilds/{guild_id}/f1/attendance/posts/{message_id}

The same fields plus `"attendance": { "present": […], "absent": […], "reserve": […] }`, every entry `{ "user_id", "name", "in_server" }` where `name` is the member's
**current** display name (falling back to the name stored when they clicked). Errors: `400 invalid_message_id`, `404 post_not_found`.

### POST /guilds/{guild_id}/f1/attendance/posts

Posts the same embed and the same persistent Present / Absent / Reserve buttons as `/f1 attendance`, with the division's regular drivers marked Present, and stores the post.
The embed is built by the command's own builder, so it is identical (and the buttons re-render it identically).

Request: `{ "channel_id": "777…", "division": "Elite", "season": "16", "round": "5", "circuit": "Zandvoort", "description": "Sprint weekend" }`.
`channel_id` must be a text channel from `GET /channels`. `season` and `round` are 1–10 characters (a number is accepted and stored as text, like the modal),
`circuit` 1–100, `description` optional ≤ 200, `division` must already exist (create it with `PUT /f1/attendance/divisions`).
Regular drivers who are no longer in the server are skipped, like the command.

Response `201`: `{ "post": { …as in the single read… }, "channel_id": "777…" }`. The message ID in `post.message_id` is the only handle to the post: the channel is not stored.

Errors: `400 invalid_channel | invalid_division | invalid_season | invalid_round | invalid_circuit | invalid_description`,
`404 division_not_found | channel_not_found`, `403 bot_cannot_send | forbidden`, `502 discord_error`, `504 bot_timeout`.
If the post cannot be stored after it was sent, the message is deleted again.

### Sign-up questions

`settings.json[guild].signup_questions`: a list of up to 2 custom question labels used by every sign-up form that has no questions of its own.
Empty (`[]`) means the **default questions** are used.

### GET /guilds/{guild_id}/league/signup-questions

```json
{ "questions": ["What is your team?"], "using_defaults": false,
  "default_questions": [ { "label": "What is your first name?", "placeholder": null, "required": true }, … 6 in total ],
  "effective_questions": [ { "label": "What is your team?", "placeholder": null, "required": true } ],
  "max_questions": 2, "max_question_length": 45, "can_edit": true }
```

`effective_questions` is what the sign-up form really asks (the custom questions if any, otherwise the defaults). Any staff member may read; `can_edit` is true for an Administrator.

### PUT /guilds/{guild_id}/league/signup-questions

**Administrator only** (like `/server settings`). Request: `{ "questions": ["What is your team?", "Referred by"] }` — replaces the list; `[]` restores the defaults.
At most **2** questions (what the settings flow keeps), each 1–45 characters (a Discord form label is cut at 45, and the label is also the key of the answer),
single line, **no commas** (the settings modal splits on commas, so a stored question never has one) and unique. Response `200`: the same body as the GET.
Errors: `403 admin_required`, `400 invalid_questions | invalid_request`.

### Sign-ups

`signups.json`: `{ guild: { "<panel_message_id>": { title, description, fields, confirmation_channel, panel_channel_id, status, close_date, created_by, created_at, participants } } }`
where `participants` is `{ "<user_id>": { username, platform, platform_name, platform_emoji, platform_username, fields: { "<question>": "<answer>" }, timestamp } }`.
The `signup_id` used below is the panel message's ID. The bot keeps this data in memory (the panel buttons hold references into it), so the API changes that very
dictionary under the same lock and saves it; a sign-up submitted in Discord and an app write at the same moment cannot overwrite each other.

**Everything a driver typed is untrusted** and is returned as plain data (never escaped or rewritten): escape it yourself when you render it.

### GET /guilds/{guild_id}/league/signups

Newest first. Query: `status` = `open` | `closed`.

```json
{ "signups": [ { "signup_id": "810…", "title": "Season 16 Sign-up", "description": "Rules", "status": "open", "close_date": "2026-06-01",
                 "fields": [], "panel_channel_id": "777…", "confirmation_channel": "signup-confirmations",
                 "created_by": "1001", "created_at": "2026-01-01T00:00:00Z", "participant_count": 2 } ] }
```

`fields` is the list of per-sign-up custom questions (only `/league signup`'s "custom questions" box sets it; empty means the server's questions or the defaults).
`confirmation_channel` is a channel **name** (see create). Errors: `400 invalid_status`.

### GET /guilds/{guild_id}/league/signups/{signup_id}

`{ "signup": { …one entry of the list… } }`. Errors: `400 invalid_signup_id`, `404 signup_not_found`.

### GET /guilds/{guild_id}/league/signups/{signup_id}/participants

Everyone who signed up, in sign-up order, with all answers (`/league signup-list` shows 10 per page and only 3 answers; this returns everything). Query: `limit` (1–100, default 25), `offset`.

```json
{ "signup": { … }, "total": 2, "limit": 25, "offset": 0,
  "participants": [ { "user_id": "2001", "username": "alice", "display_name": "Ally", "in_server": true,
                      "platform": "steam", "platform_name": "Steam", "platform_emoji": "🖥️", "platform_username": "Racer1",
                      "answers": [ { "question": "What is your first name?", "answer": "alice" } ],
                      "timestamp": "2026-01-02T00:00:00Z" } ] }
```

`answers` is an ordered **list** (the question order of the form; an object would be re-sorted by JSON consumers when a question looks like a number).
`display_name` is `null` when the member left. Errors: `400 invalid_signup_id | invalid_limit | invalid_offset`, `404 signup_not_found`.

### POST /guilds/{guild_id}/league/signups

Posts the same sign-up panel as `/league signup` — the same embed and the same persistent **"✅ Start Sign-up"** button (`nexus:signup_start`) — and registers the sign-up.

Request: `{ "title": "Season 16 Sign-up", "description": "Rules…", "channel_id": "777…", "confirmation_channel_id": "777…", "close_date": "2026-06-01" }`.
`title` 1–150 (single line), `description` optional ≤ 1000, `close_date` optional free text ≤ 50 (shown in the panel footer, like the command; nothing closes automatically),
`channel_id` a text channel from `GET /channels` where the panel is posted. The "Info Requested" list on the panel shows the server's custom questions, or the defaults.

**How the confirmation channel works (same as the command).** Every time a driver finishes a sign-up the bot posts a confirmation embed to the channel
*named* `confirmation_channel`, found by a forgiving name match (emoji and case ignored), and **creates `📋<name>` if nothing matches**. The sign-up stores that **name**, not an ID.
So the API: with `confirmation_channel_id` stores that channel's name and checks the bot can post there (`bot_cannot_post_confirmations`) and that the name resolves back to
**that** channel (`409 confirmation_channel_ambiguous` otherwise); without it uses the command's default `signup-confirmations` and checks that the bot can post
in the existing channel with that name, or — when there is none yet — has **Manage Channels** to create it (`bot_missing_manage_channels`). The API itself never creates a channel.

Response `201`: `{ "signup": { …as in the list… }, "channel_id": "777…" }`.
Errors: `400 invalid_title | invalid_description | invalid_close_date | invalid_channel | invalid_confirmation_channel`,
`404 channel_not_found | confirmation_channel_not_found`, `403 bot_cannot_send | forbidden | bot_cannot_post_confirmations | bot_missing_manage_channels`,
`409 confirmation_channel_ambiguous`, `502 discord_error`, `504 bot_timeout`. If the sign-up cannot be stored after the panel was sent, the panel is deleted again.

### POST /guilds/{guild_id}/league/signups/{signup_id}/close

`/league signup-close`: sets the status to `closed` (saved first, like the command), then greys out the panel embed (footer "⛔ Sign-ups are now closed · {server}") and disables its button
(label "🔒 Sign-ups Closed"). No body.

Response `200`: `{ "ok": true, "signup": { … }, "panel_updated": true, "panel_error": null }`. If the sign-up was closed but the panel could not be edited
(the command only logs this), `panel_updated` is `false` and `panel_error` is one of `panel_channel_unknown | panel_channel_not_found | panel_message_not_found | bot_cannot_edit_panel | discord_error | bot_unavailable | bot_timeout`.
Errors: `400 invalid_signup_id`, `404 signup_not_found`, `409 already_closed`.

### DELETE /guilds/{guild_id}/league/signups/{signup_id}/participants/{user_id}

`/league signup-remove` as staff: removes anyone's entry — also from a closed sign-up and also for someone who has left the server (the command needs a current member). No body.
Response `200`: `{ "ok": true, "removed": { "user_id": "2001", "username": "alice" }, "participant_count": 1 }`.
Errors: `400 invalid_signup_id | invalid_user_id`, `404 signup_not_found | participant_not_found`.

### Things that cannot be done through the API (M4)

* **Setting, toggling or removing someone else's attendance.** Drivers do that themselves with the buttons; no command does it for them. (The API only reads.)
* **Editing or deleting an attendance post**, and **deleting a division** — no command does either, so there is no endpoint (`PUT` a list to change a division, or empty it).
* **Finding an attendance post's channel or a jump link** — `attendance.json` stores no channel ID and the schema was not extended.
* **Signing someone up, or editing/replacing their answers.** Drivers sign up in Discord (platform select → forms). Staff can only remove an entry.
* **Reopening, editing or deleting a sign-up** — there is no command for it.
* **Per-sign-up custom questions** (the "custom questions" box of `/league signup`): the API creates sign-ups that use the server's questions (`PUT /league/signup-questions`) or the defaults.
* **Creating the confirmation channel** — the bot does that itself, lazily, when the first driver signs up (the API only verifies it can).
* **Emoji conversion and underscore escaping of the panel title / description / circuit.** The commands do neither for these fields (only member names are escaped, by the shared embed builder), and an
  attendance post is re-rendered from its stored data on every click, so the API deliberately posts exactly what the command would: the same input gives the same message.
* **Bot statistics and the dashboard activity feed** (`stats["f1_attendances"]`, `push_log`) that `/f1 attendance` bumps are not touched (same as M3).

### Command quirks found during M4 (not changed)

* **`/f1 attendance-setup` has no overlap rule**: a driver can be in both lists. They are then auto-marked Present and refused by the Present button. (`overlap` in the PUT response lets the app warn.)
* **Editing the `Main` division does not touch the legacy top-level lists**, which posts created before multi-division support (no `division`) keep reading.
* **The "Regular drivers marked as present automatically" note on an attendance embed** looks at the *legacy* guild-wide list, so it never shows on a server that only uses divisions.
* **`/league signup-remove`** needs the target to be a current member (the API does not), and **`/league signup-list`** puts a sign-up's answers into an embed unescaped (the confirmation embed escapes them).
* **Sign-up confirmations fail silently**: if the bot cannot post to / create the confirmation channel the driver still sees "signed up" and only the log says otherwise. The channel is re-resolved by a fuzzy name on every submission, so renaming or adding a similarly named channel can redirect it.
* **`_find_signup(title)`** returns the *first* sign-up whose title contains the text (not the newest), so a reused title can hit an old sign-up.
* **The settings modal** keeps 2 questions silently, cannot store a comma, and two questions sharing their first 45 characters would overwrite each other's answer.
* **`/league signup`, `signup-close` and `signup-remove` change the in-memory sign-ups without holding `_signups_lock`** (only the save is locked) — a concurrent save can in theory iterate a dictionary that is being changed.
  The participant write (`_finalize_signup`), the API and the create modal now hold the lock for the whole change.
* **`_toggle`, the attendance post and the setup / migration code used an unlocked load → modify → save** (two simultaneous clicks, or a click and an app write, could drop one). They now use the locked update helpers; behaviour is otherwise identical (proven by `scripts/test_bot_extractions_m4.py`).

---

## Sync with Discord

* The app writes the **same files and JSON shapes** as the slash commands / dashboard, through the same locked read-modify-write helpers.
  A change made in Discord is visible to the next API call and the other way round; there is no app-side cache to invalidate.
* `/server settings` and the app share `data/settings.json`; embeds the bot builds afterwards (calendar, panels, announcements, …) use the new colour and footer at once.
  Already-posted messages are not rewritten (use panel refresh).
* Posts happen on the bot's own event loop with a 10 s timeout; if Discord rejects a post the stored data is left unchanged.

### Things that cannot be done through the API (M1)

* **Creating the Discord role** for a tier — pick an existing role (`GET /roles`); creating roles is not part of the league commands.
* **Editing a game's label/category** — the dashboard cannot either (only `active`); delete and re-create.
* **Finding a panel message you did not post through the app** — the data store has no message IDs, so *refresh* needs the `message_id` returned when the panel was posted.

### Things that cannot be done through the API (M2)

* **No per-race results are stored in the standings**, so a recorded race cannot be reversed, and the duplicate guard only knows the races
  recorded through the app (the results ledger). Recording twice (with `confirm_duplicate`) adds twice, like the command.
* **`/league update-points`** (the older command with a hard-coded points table that ignores the configured points system) is not
  exposed: `POST /f1/standings/results` is the `/f1 standings` flow, which uses the points system. Both write the same `driver_points`.
* **Deleting a team** — there is no slash command for it, so there is no endpoint.
* **Editing a team's name, colour or abbreviation** — no slash command either.
* **The in-progress `/f1 calendar` wizard** (calendar name + number of rounds, then one round at a time) is a Discord conversation;
  the API adds, edits and removes rounds directly instead. `setup_in_progress` tells you when a wizard is open.

### Things that cannot be done through the API (M3)

* **Creating a report.** Reports are filed by drivers with `/f1 report`; the private-thread flow (create the thread, add the reporter, the
  named drivers and all staff, post the buttons) cannot be mirrored safely, and the app has no "reporter" to attribute it to.
* **Returning the "No Further Action" explanation or the awarded points for a decided report** — they exist only in the Discord embed (and, for
  points, in the driver's penalty history); `reports.json` does not store them and the schema was not extended.
* **Announcing a ban in a channel when points are added manually.** `/f1 penalty` only tells the issuer; the API returns `ban_notice` and posts nothing.
  (A ban reached through a **report decision** is announced in the report thread, exactly like the button.)
* **Posting the advance-race summary.** `/league advance-race` replies publicly in its channel; the API returns the same data as JSON instead.
* **Bot statistics and the dashboard activity feed** (`stats[...]`, `push_log`) that the commands bump are not touched by the API; every app write goes to
  the app's own audit log instead (`data/app_activity_log.json`).
* **Locating a report message whose thread was deleted** — the decision is refused (`report_message_not_found`) rather than guessed.

### Command bugs found during M3

* **`/league advance-race`** (fixed): it used to compute the expiry on one copy of the data and save another, so the totals never changed,
  and it raised `TypeError` for a driver whose history holds a partial-clear entry. It now shares the API's helper: the result is saved and
  items without an expiry (admin removals) are skipped.
* **`/league ban-manage give`** (fixed): it used to create a driver record without a `history` list (it had a `penalties` list instead), so the next
  command or button that added points to that driver raised `KeyError`. New records now carry an empty `history`, and the shared add-points helper
  repairs older records without one (for the commands, the report button and the API alike). Overviews and histories never needed it.
* **The "No Further Action" explanation** (fixed): it used to go into the report embed unescaped (underscores could turn into italics). It is now
  escaped like every other user text, in the Discord button and in the API alike.
* **The report buttons can still be clicked while the API is deciding the same report** (a Discord modal already open) — the second decision then
  edits the embed again; the API's own atomic claim only protects API-vs-API and API-vs-already-decided.
