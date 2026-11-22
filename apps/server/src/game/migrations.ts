/**
 * Numbered SQL migrations, applied in order inside one transaction each and recorded in
 * `schema_migrations`. Never edit a migration that has shipped; append a new one.
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
      -- Key/value facts about this database: the world seed, when it was created.
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID;

      -- Whole-world JSON snapshots of the sim state. last_seq is the highest inputs.seq already
      -- applied to the state, so boot replays only inputs with a greater seq.
      CREATE TABLE snapshots (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at_ms   INTEGER NOT NULL,
        last_seq INTEGER NOT NULL,
        hash    TEXT NOT NULL,
        state   TEXT NOT NULL
      );

      -- Append-only log of every accepted order. Written before the client is acknowledged.
      CREATE TABLE inputs (
        seq      INTEGER PRIMARY KEY AUTOINCREMENT,
        at_ms    INTEGER NOT NULL,
        actor_id TEXT NOT NULL,
        order_json TEXT NOT NULL
      );

      -- Sim events for the feed. id is the sim's own event id, so replay after a crash is idempotent.
      CREATE TABLE events (
        seq   INTEGER PRIMARY KEY AUTOINCREMENT,
        id    TEXT NOT NULL UNIQUE,
        at_ms INTEGER NOT NULL,
        kind  TEXT NOT NULL,
        json  TEXT NOT NULL
      );

      -- Which players an event concerns (its actors). Feed query: player_id, then at_ms range.
      CREATE TABLE event_actors (
        player_id TEXT NOT NULL,
        at_ms     INTEGER NOT NULL,
        event_seq INTEGER NOT NULL,
        PRIMARY KEY (player_id, at_ms, event_seq)
      ) WITHOUT ROWID;
      CREATE INDEX event_actors_by_seq ON event_actors (player_id, event_seq);

      CREATE TABLE accounts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pw_hash     TEXT NOT NULL,
        player_id   TEXT NOT NULL UNIQUE,
        created_ms  INTEGER NOT NULL
      );

      -- Session tokens are stored only as a SHA-256 hash.
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        created_ms INTEGER NOT NULL,
        expires_ms INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX sessions_by_account ON sessions (account_id);
      CREATE INDEX sessions_by_expiry ON sessions (expires_ms);
    `,
  },
  {
    id: 2,
    name: 'bots',
    sql: `
      -- Bots are sim players with no login. Retired bots keep their districts but never act again.
      CREATE TABLE bots (
        player_id       TEXT PRIMARY KEY,
        kind            TEXT NOT NULL,
        name            TEXT NOT NULL,
        motto           TEXT NOT NULL,
        role            TEXT NOT NULL,
        created_ms      INTEGER NOT NULL,
        retired_ms      INTEGER,
        next_checkin_ms INTEGER NOT NULL,
        checkins        INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID;
    `,
  },
];
