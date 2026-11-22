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

Boot: load the latest snapshot, replay later inputs with `step`, then catch the clock up to
`Date.now()` in one `step`. A snapshot is written every `SNAPSHOT_MS` (5 min) and on shutdown. Orders
are appended (and fsynced) before they are acknowledged. Registration adds the player and writes a
snapshot in the same transaction, because `addPlayer` is not an input and cannot be replayed.
Events are inserted with `INSERT OR IGNORE`, so replay never duplicates them.
Nightly `VACUUM INTO` backups go to `DATA_DIR/backups/`, keeping the last 7 (`BACKUP_HOUR_UTC`,
`BACKUP_KEEP`).

## API (`/api`, JSON, request and response shapes in `@nexum/contracts`)

`POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /me`, `POST /orders`,
`GET /eta?from=&to=&carrier=`, `GET /feed?since=&after=&limit=`, `GET /stream` (SSE: `hello`, `tick`,
`game`, `heartbeat` every 25 s; `Last-Event-ID` replays missed events; poll `/feed` as the fallback).
Errors are `{ok:false, error, ...}` with a typed code (the sim's order codes plus the API codes).

## Config

`TICK_MS` (2000), `SNAPSHOT_MS`, `WORLD_SEED`, `COOKIE_SECURE` (set true behind HTTPS),
`TRUST_PROXY` (honour `X-Forwarded-For` for rate limits), `BACKUP_HOUR_UTC`, `BACKUP_KEEP`.

## Known gaps

`view.ts` is an adapter (own districts, hubs, own units); swap in `viewFor` from the sim once it
exists (fog, task 25 follow-up). SSE has no per-process connection cap. Start-district choice is
simply the neutral district farthest from owned ones.
