# game

The I/O around the pure simulation (`packages/sim`): clock, SQLite, accounts, HTTP API and live
updates. The in-memory sim state is authoritative; the database exists so a restart loses nothing.

## Persistence

SQLite via `node:sqlite` (`DatabaseSync`) at `DATA_DIR/nexum.db`, WAL mode, `synchronous=FULL`.
Numbered migrations live in `migrations.ts` and are recorded in `schema_migrations`; add a new entry,
never edit an applied one.

| Table                    | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `meta`                   | key/value (world seed, counters)                                           |
| `snapshots`              | JSON state snapshot plus the `last_seq` of the inputs it already has       |
| `inputs`                 | append-only order log `{seq, at_ms, actor_id, order_json}`                 |
| `events`, `event_actors` | sim events (unique by sim id) and the per-player index for the feed        |
| `accounts`, `sessions`   | scrypt password hashes; session tokens stored as SHA-256 hashes            |
| `bots`                   | bot roster: personality, crew name, next check-in, retired time            |
| `seasons`                | one frozen row per finished season: standings, names, stats (hall of fame) |

Boot: load the latest snapshot, replay later inputs with `step`, then catch the clock up to
`Date.now()` in one `step`. A snapshot is written every `SNAPSHOT_MS` (5 min) and on shutdown. Orders
are appended (and fsynced) before they are acknowledged. Registration adds the player and writes a
snapshot in the same transaction, because `addPlayer` is not an input and cannot be replayed.
Events are inserted with `INSERT OR IGNORE`, so replay never duplicates them.
Nightly `VACUUM INTO` backups go to `DATA_DIR/backups/`, keeping the last 7 (`BACKUP_HOUR_UTC`,
`BACKUP_KEEP`).

## API (`/api`, JSON, request and response shapes in `@nexum/contracts`)

`POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /me` (the sim's fogged `viewFor`), `GET /standings`, `POST /orders`,
`GET /eta?from=&to=&carrier=`, `GET /feed?since=&after=&limit=`, `GET /stream` (SSE: `hello`, `tick`,
`game`, `heartbeat` every 25 s; `Last-Event-ID` replays missed events; poll `/feed` as the fallback).
Errors are `{ok:false, error, ...}` with a typed code (the sim's order codes plus the API codes).

## Config

`TICK_MS` (2000), `SNAPSHOT_MS`, `WORLD_SEED`, `COOKIE_SECURE` (set true behind HTTPS),
`TRUST_PROXY` (honour `X-Forwarded-For` for rate limits), `BACKUP_HOUR_UTC`, `BACKUP_KEEP`,
`BOTS_ENABLED` (true), `BOT_COUNT` (6) and `BOT_MIN` (2); see Bots. `SEASON_DAYS` (7), `SEASON_BREAK_HOURS` (0) and
`TICK_LOG_MINUTES` (15, 0 turns the summary off); see Seasons and Ops.

## Bots (`bots/`)

Bots are real sim players with no login: a row in the `bots` table (migration 2: kind, crew name,
motto, faction role, `next_checkin_ms`, `retired_ms`) instead of an `accounts` row. `BotRunner`
runs after every tick:

- **Orders.** At a check-in a bot gets `viewFor(state, botId)`, so it sees only what a player sees.
  `bots/view.ts` turns that view into a fogged `GameState` lookalike, because the sim's `BOTS`
  functions take a `GameState`. The orders go through the contract schema and `Engine.acceptOrder`
  (the `POST /orders` path), so they are validated and written to the inputs log and survive a
  restart. The sim bots do not check affordability, so many proposals (builds, recruits) come back
  `insufficient_goods`; these are counted in `stats.rejected` and logged at debug level.
- **Schedule.** `bots/schedule.ts`: each bot visits about 5 (raider), 6 (merchant) or 8 (turtle)
  times a day, the gap seeded from the world seed, player id and visit number with a 0.6x to 1.4x
  jitter. The next visit is stored in `bots.next_checkin_ms`, so restarts keep the rhythm.
- **Personalities.** Raider, Turtle and Merchant (`bots/personalities.ts`) have cyberpunk crew
  names and mottos and a theme faction role. `BOT_COUNT` bots start (mix: raider, turtle,
  merchant, raider, merchant, turtle).
- **Retirement.** Each human account lowers the target by one, down to `BOT_MIN`. At most one bot
  retires per game hour, from the most common personality, lowest score first. A retired bot stops
  acting but keeps its districts, crews and score as a dormant crew that players can raid.
- **Known gap.** The view adapter fills only the fields the current sim bots read (districts,
  crews, carriers, movements, public books' reference price and depth, stash, graph). A new sim
  bot that reads other fields (for example other players' credits) sees empty values there.
  Standings and the district panel still show player ids, not crew names.

## Arrival events

`player.joined` (with `reason: 'new'`) and `frontier.opened` are public. `Engine.tick` and
`createPlayer` give them an audience of every player, so `event_actors` rows, the feed and the SSE
hub deliver them to everyone (the audience list itself is never sent). Joins carry `crew`,
`district` and `side` (east, west, north, south or centre) so the client can write "New crew
kestrel_9 founded Kestrel Yard on the east frontier". The sim keeps the frontier stocked on
`addPlayer`.

## Seasons (`seasons.ts`)

A season is `SEASON_DAYS` long (default 7) with a 48 h finale. Registration closes in the finale
(`world_full`) and during the break (`season_over`). When the clock passes the end the engine freezes
at `endMs` and refuses orders and joins (`season_over`). `SeasonManager.check()`, run after every tick,
then:

1. archives the final standings once into `seasons` (`INSERT OR IGNORE`, so it is idempotent),
2. after `SEASON_BREAK_HOURS` (default 0) starts the next season in one transaction: clears the world
   tables, a new seed from `seasonSeed(WORLD_SEED, n)`, every account re-added to the new world, bots
   recreated per the config, and a fresh snapshot.

Accounts, sessions and the `seasons` archive carry over. An account that finds no free plot gets a
`pending:<id>` player id and no crew. All state needed to resume is in the database, so a restart in
the middle of a break carries on. `GET /api/seasons` lists the archive (the client's "Hall of fame").

## Snapshot versions and old inputs

Two numbers are stored with every snapshot:

- `SNAPSHOT_VERSION` is the JSON shape. `upgradeSnapshot` walks the `UPGRADES` chain, so an old
  snapshot still loads. Add a step whenever `GameState` gains or changes a field.
- `RULES_VERSION` is the sim's behaviour. Bump it whenever the same inputs would play out differently. History: 1 settle and trade score, 2 raids and escorts (task 71), 3 contracts board (73a) and the Runner carrier (74; the carrier order and its evasion draw changed play but nothing was deployed, so it stayed at 3), and the newcomer rush and street jobs (77a) also stayed at 3 because nothing was deployed under 3 that must replay; the raid balance fix (crew mend, kit supplies, bot changes) stayed at 3 for the same reason, and the Watchtower and Garage (75: carrier wear, tower sight, `raid.spotted`) also stayed at 3; their only new state is an optional carrier `wear` (missing means 0), so `SNAPSHOT_VERSION` needs no upgrade step. the first-session frontier fix (plots surveyed in 5 minutes while a player is in their rush, rush kit of 30 supplies) also stayed at 3 for the same reason, with no snapshot change. `SNAPSHOT_VERSION` 3 adds the player's `rushUntilMs`, `jobs` and `jobNextMs` and `counters.job`. Bot building and the Hunter bot (76) changed only what bots order, so `RULES_VERSION` stays 3 with no snapshot change. Break it up (78: `ambush.clear`, the `clear` movement and its events) also stays at 3 with no snapshot change (a movement with an optional `clear` field; the fogged ambush strength is view-only).

Policy: **inputs are only replayed on a snapshot written under the same rules version.** If the stored
rules version differs (or is missing, as in rows from before versioning), the old state is loaded and
shape-upgraded only to archive its standings (reason `rules_change`), and a new season starts at once.
A state too old to archive is logged and skipped. We never replay old inputs under new rules.

## Ops

- `GET /api/health`: `ok`, uptime, `tickLagMs`, snapshot age, player and account counts, season
  number and phase, `tickErrors`. No secrets or names. Returns 503 if the tick lag passes
  `max(30 s, 10 ticks)`.
- Logs are one JSON object per line on stdout. A `tick summary` line every `TICK_LOG_MINUTES`; an
  `error` line (`tick failed`) for any exception in the tick loop, which carries on afterwards.
- `npm run backup` writes `DATA_DIR/backups/nexum-manual-<time>.db`. In Docker:
  `docker compose exec app node apps/server/dist/backup-cli.js`.
- Compose: `restart: unless-stopped`, a healthcheck on `/api/health`, json-file logs capped at 5 x 10 MB,
  `mem_limit: 256m` (about 22 MiB used with a small world).

### Restore

Stop the app, replace `DATA_DIR/nexum.db` with a backup file (delete `nexum.db-wal` and
`nexum.db-shm` next to it), and start the app. It boots from the latest snapshot in that file.

## Known gaps

Registration is closed during the finale and the break. A rules-version change ends the running season immediately. The first boot of this version archives and resets a legacy database.

SSE has no per-process connection cap. Start-district choice is
simply the neutral district farthest from owned ones.
