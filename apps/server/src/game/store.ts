import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { BotKind, GameState, Input, Order, SimEvent } from '@nexum/sim';
import { transaction } from './db.js';

export interface StoredInput {
  readonly seq: number;
  readonly atMs: number;
  readonly actorId: string;
  readonly order: Order;
}

export interface StoredSnapshot {
  readonly id: number;
  readonly atMs: number;
  readonly lastSeq: number;
  readonly hash: string;
  readonly state: GameState;
}

export interface StoredEvent {
  readonly seq: number;
  readonly event: SimEvent;
  /** Everyone who should see it: the actors plus, for public events, every player. */
  readonly audience?: readonly string[];
}

export interface BotRow {
  readonly playerId: string;
  readonly kind: BotKind;
  readonly name: string;
  readonly motto: string;
  /** Faction colour role in the theme. */
  readonly role: string;
  readonly createdMs: number;
  readonly retiredMs: number | null;
  readonly nextCheckinMs: number;
  readonly checkins: number;
}

export interface AccountRow {
  readonly id: number;
  readonly username: string;
  readonly pwHash: string;
  readonly playerId: string;
  readonly createdMs: number;
}

export interface FeedQuery {
  readonly playerId: string;
  readonly sinceMs?: number | undefined;
  readonly afterSeq?: number | undefined;
  readonly limit: number;
}

type Row = Record<string, unknown>;

/** Typed access to the game tables. Statements are prepared once. */
export class Store {
  private readonly stmts = new Map<string, StatementSync>();

  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private q(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  transaction<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  // ---- meta

  getMeta(key: string): string | undefined {
    const r = this.q('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return r ? String(r['value']) : undefined;
  }

  setMeta(key: string, value: string): void {
    this.q(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
  }

  // ---- snapshots

  insertSnapshot(state: GameState, hash: string, lastSeq: number, keep = 3): number {
    const r = this.q(
      'INSERT INTO snapshots (at_ms, last_seq, hash, state) VALUES (?, ?, ?, ?)',
    ).run(state.nowMs, lastSeq, hash, JSON.stringify(state));
    const id = Number(r.lastInsertRowid);
    this.q('DELETE FROM snapshots WHERE id <= ?').run(id - keep);
    return id;
  }

  latestSnapshot(): StoredSnapshot | undefined {
    const r = this.q('SELECT * FROM snapshots ORDER BY id DESC LIMIT 1').get() as Row | undefined;
    if (!r) return undefined;
    return {
      id: Number(r['id']),
      atMs: Number(r['at_ms']),
      lastSeq: Number(r['last_seq']),
      hash: String(r['hash']),
      state: JSON.parse(String(r['state'])) as GameState,
    };
  }

  // ---- inputs

  appendInput(atMs: number, actorId: string, order: Order): number {
    const r = this.q('INSERT INTO inputs (at_ms, actor_id, order_json) VALUES (?, ?, ?)').run(
      atMs,
      actorId,
      JSON.stringify(order),
    );
    return Number(r.lastInsertRowid);
  }

  inputsAfter(seq: number): StoredInput[] {
    const rows = this.q('SELECT * FROM inputs WHERE seq > ? ORDER BY seq').all(seq) as Row[];
    return rows.map((r) => ({
      seq: Number(r['seq']),
      atMs: Number(r['at_ms']),
      actorId: String(r['actor_id']),
      order: JSON.parse(String(r['order_json'])) as Order,
    }));
  }

  static toInput(i: StoredInput): Input {
    return { actorId: i.actorId, order: i.order, atMs: i.atMs };
  }

  // ---- events

  /** Stores events (ignoring ones already stored, so replay is idempotent); returns each with its seq. */
  insertEvents(
    events: readonly SimEvent[],
    audienceOf?: (e: SimEvent) => readonly string[] | undefined,
  ): StoredEvent[] {
    const out: StoredEvent[] = [];
    for (const e of events) {
      this.q('INSERT OR IGNORE INTO events (id, at_ms, kind, json) VALUES (?, ?, ?, ?)').run(
        e.id,
        e.at,
        e.kind,
        JSON.stringify(e),
      );
      const row = this.q('SELECT seq FROM events WHERE id = ?').get(e.id) as Row;
      const seq = Number(row['seq']);
      const audience = audienceOf?.(e);
      const everyone = audience ? [...new Set([...e.actors, ...audience])] : undefined;
      for (const actor of new Set(everyone ?? e.actors)) {
        this.q(
          'INSERT OR IGNORE INTO event_actors (player_id, at_ms, event_seq) VALUES (?, ?, ?)',
        ).run(actor, e.at, seq);
      }
      out.push(everyone ? { seq, event: e, audience: everyone } : { seq, event: e });
    }
    return out;
  }

  /** Events concerning a player, oldest first; fetches one extra row to report `hasMore`. */
  feed(q: FeedQuery): { items: StoredEvent[]; hasMore: boolean } {
    const rows = this.q(
      `SELECT e.seq AS seq, e.json AS json
         FROM event_actors a JOIN events e ON e.seq = a.event_seq
        WHERE a.player_id = ? AND a.at_ms > ? AND a.event_seq > ?
        ORDER BY a.event_seq
        LIMIT ?`,
    ).all(q.playerId, q.sinceMs ?? -1, q.afterSeq ?? 0, q.limit + 1) as Row[];
    const items = rows.slice(0, q.limit).map((r) => ({
      seq: Number(r['seq']),
      event: JSON.parse(String(r['json'])) as SimEvent,
    }));
    return { items, hasMore: rows.length > q.limit };
  }

  // ---- bots

  private static bot(r: Row): BotRow {
    return {
      playerId: String(r['player_id']),
      kind: String(r['kind']) as BotKind,
      name: String(r['name']),
      motto: String(r['motto']),
      role: String(r['role']),
      createdMs: Number(r['created_ms']),
      retiredMs: r['retired_ms'] === null ? null : Number(r['retired_ms']),
      nextCheckinMs: Number(r['next_checkin_ms']),
      checkins: Number(r['checkins']),
    };
  }

  insertBot(b: Omit<BotRow, 'retiredMs' | 'checkins'>): void {
    this.q(
      'INSERT INTO bots (player_id, kind, name, motto, role, created_ms, next_checkin_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(b.playerId, b.kind, b.name, b.motto, b.role, b.createdMs, b.nextCheckinMs);
  }

  /** All bots, retired included, in creation order. */
  allBots(): BotRow[] {
    return (this.q('SELECT * FROM bots ORDER BY created_ms, player_id').all() as Row[]).map(
      Store.bot,
    );
  }

  setBotCheckin(playerId: string, nextCheckinMs: number, checkins: number): void {
    this.q('UPDATE bots SET next_checkin_ms = ?, checkins = ? WHERE player_id = ?').run(
      nextCheckinMs,
      checkins,
      playerId,
    );
  }

  retireBot(playerId: string, nowMs: number): void {
    this.q('UPDATE bots SET retired_ms = ? WHERE player_id = ?').run(nowMs, playerId);
  }

  /** Public crew names by player id: usernames, overridden by bot crew names. */
  crewNames(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.q('SELECT player_id, username FROM accounts').all() as Row[]) {
      out[String(r['player_id'])] = String(r['username']);
    }
    for (const b of this.allBots()) out[b.playerId] = b.name;
    return out;
  }

  countAccounts(): number {
    return Number((this.q('SELECT COUNT(*) AS n FROM accounts').get() as Row)['n']);
  }

  // ---- accounts and sessions

  private static account(r: Row): AccountRow {
    return {
      id: Number(r['id']),
      username: String(r['username']),
      pwHash: String(r['pw_hash']),
      playerId: String(r['player_id']),
      createdMs: Number(r['created_ms']),
    };
  }

  insertAccount(username: string, pwHash: string, playerId: string, nowMs: number): AccountRow {
    const r = this.q(
      'INSERT INTO accounts (username, pw_hash, player_id, created_ms) VALUES (?, ?, ?, ?)',
    ).run(username, pwHash, playerId, nowMs);
    return { id: Number(r.lastInsertRowid), username, pwHash, playerId, createdMs: nowMs };
  }

  accountByUsername(username: string): AccountRow | undefined {
    const r = this.q('SELECT * FROM accounts WHERE username = ?').get(username) as Row | undefined;
    return r && Store.account(r);
  }

  accountById(id: number): AccountRow | undefined {
    const r = this.q('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
    return r && Store.account(r);
  }

  insertSession(tokenHash: string, accountId: number, createdMs: number, expiresMs: number): void {
    this.q(
      'INSERT INTO sessions (token_hash, account_id, created_ms, expires_ms) VALUES (?, ?, ?, ?)',
    ).run(tokenHash, accountId, createdMs, expiresMs);
  }

  accountForSession(tokenHash: string, nowMs: number): AccountRow | undefined {
    const r = this.q(
      `SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = ? AND s.expires_ms > ?`,
    ).get(tokenHash, nowMs) as Row | undefined;
    return r && Store.account(r);
  }

  deleteSession(tokenHash: string): void {
    this.q('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  pruneSessions(nowMs: number): void {
    this.q('DELETE FROM sessions WHERE expires_ms <= ?').run(nowMs);
  }
}
