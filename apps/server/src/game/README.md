# game

The I/O around the pure simulation (`packages/sim`): clock, SQLite, accounts, HTTP API and live
updates. The in-memory sim state is authoritative; the database exists so a restart loses nothing.

## Persistence

SQLite via `node:sqlite` (`DatabaseSync`) at `DATA_DIR/nexum.db`, WAL mode, `synchronous=FULL`.
Numbered migrations live in `migrations.ts` and are recorded in `schema_migrations`; add a new entry,
never edit an applied one.

| Table                    | Purpose                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `meta`                   | key/value (world seed, counters)                                     |
| `snapshots`              | JSON state snapshot plus the `last_seq` of the inputs it already has |
| `inputs`                 | append-only order log `{seq, at_ms, actor_id, order_json}`           |
| `events`, `event_actors` | sim events (unique by sim id) and the per-player index for the feed  |
| `accounts`, `sessions`   | scrypt password hashes; session tokens stored as SHA-256 hashes      |
| `bots`                   | bot roster: personality, crew name, next check-in, retired time      |

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
`BOTS_ENABLED` (true), `BOT_COUNT` (6) and `BOT_MIN` (2); see Bots.

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

## Known gaps

SSE has no per-process connection cap. Start-district choice is
simply the neutral district farthest from owned ones.
