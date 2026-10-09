# Nexus App API (`/api/app/v1`)

Token-based API for the Nexus Windows desktop app. Implemented in `app_backend.py`, mounted on the
bot's Flask app. This file is the contract: **every registered route is listed here** (a unit test,
`DocsComplete` in `scripts/test_app_api.py`, fails if a route is added without documenting it).

**Status:** Auth + base (existing) and **M1 — Foundations, Games & tiers, Server settings, Overview**.
M2–M5 (calendar, teams, standings, reports, penalties, attendance, sign-ups, esports) are not built yet.

Contents: [Conventions](#conventions) · [Auth](#auth) · [Base](#base-endpoints) · [Pickers](#pickers) ·
[Overview](#overview) · [Server settings](#server-settings) · [Games & tiers](#games--tiers) · [Sync notes](#sync-with-discord)

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
store as `{ts, user_id, username, guild_id, action, detail}`. Actions in M1: `announcement.post`,
`settings.update`, `league.game.create|enable|disable|delete`, `league.tier.create|update|delete`,
`league.panel.post|refresh`.

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
  "effective_season": 1, "season_source": "default" }
```

* `embed_color` — `#RRGGBB` upper-case; default `#FF3333` when never set.
* `footer_name` — shown in every embed footer; default `Nexus`.
* `season_number` — the value stored in settings (`/server settings` → *Default season number*), `null` if never set.

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

Response `200`: the same object as `GET /settings` after the change. Other keys in the guild's settings (penalty thresholds, sign-up questions, …) are never touched.

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
