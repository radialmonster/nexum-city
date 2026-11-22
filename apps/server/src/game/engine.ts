import { addPlayer, createWorld, hashState, step, validateOrder } from '@nexum/sim';
import type { GameState, Id, Order, OrderError, SimEvent } from '@nexum/sim';
import { Store } from './store.js';
import type { StoredEvent, StoredInput } from './store.js';

export interface EngineOptions {
  readonly store: Store;
  /** The game clock. The server uses wall time; tests inject a fake. Never used inside the sim. */
  readonly now: () => number;
  /** Seed of the world created on first boot. */
  readonly seed: number;
  /** Minimum game-clock interval between periodic snapshots. */
  readonly snapshotMs: number;
  readonly log?: ((entry: Record<string, unknown>) => void) | undefined;
}

export interface TickResult {
  readonly nowMs: number;
  /** Events produced by this tick, each with its position in the event log. */
  readonly events: readonly StoredEvent[];
}

export type AcceptResult =
  { ok: true; seq: number; atMs: number } | { ok: false; error: OrderError };

export type CreatePlayerResult = { ok: true; playerId: Id } | { ok: false; error: 'world_full' };

/**
 * Owns the authoritative in-memory sim state and keeps it durable.
 *
 * Durability model: the state is the truth; it is snapshotted to SQLite every `snapshotMs` and on
 * shutdown. Every accepted order is appended to the `inputs` log before it is acknowledged, so a
 * crash loses nothing: boot loads the latest snapshot, replays the later inputs through `step`
 * and catches the clock up to now. `step` is exact over any split of time, so the replay hashes
 * the same as an uninterrupted run.
 */
export class Engine {
  private state: GameState;
  /** Inputs persisted but not yet applied to `state`. */
  private pending: StoredInput[] = [];
  /** Highest inputs.seq applied to `state`. */
  private appliedSeq: number;
  private lastInputAt = 0;
  private lastSnapshotAt: number;
  private readonly listeners = new Set<(r: TickResult) => void>();

  private readonly opts: EngineOptions;

  private constructor(
    opts: EngineOptions,
    state: GameState,
    appliedSeq: number,
    pending: StoredInput[],
  ) {
    this.opts = opts;
    this.state = state;
    this.appliedSeq = appliedSeq;
    this.pending = pending;
    this.lastSnapshotAt = opts.now();
  }

  /** Loads the latest snapshot (or creates the world), replays later inputs and catches up. */
  static open(opts: EngineOptions): Engine {
    const { store } = opts;
    const snap = store.latestSnapshot();
    let engine: Engine;
    if (snap) {
      const pending = store.inputsAfter(snap.lastSeq);
      engine = new Engine(opts, snap.state, snap.lastSeq, pending);
      opts.log?.({
        level: 'info',
        msg: 'loaded snapshot',
        snapshotAtMs: snap.atMs,
        replayInputs: pending.length,
      });
    } else {
      const seed = Number(store.getMeta('seed') ?? opts.seed);
      store.setMeta('seed', String(seed));
      store.setMeta('created_ms', String(opts.now()));
      const world = createWorld(seed, { startMs: opts.now() });
      store.insertSnapshot(world, hashState(world), 0);
      engine = new Engine(opts, world, 0, []);
    }
    engine.lastInputAt = engine.state.nowMs;
    engine.tick();
    return engine;
  }

  /** The live state. Treat as read-only; the sim never mutates it, `step` returns a new one. */
  get current(): GameState {
    return this.state;
  }

  hash(): string {
    return hashState(this.state);
  }

  /** Called after every tick with the events it produced. Returns an unsubscribe function. */
  onTick(fn: (r: TickResult) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Steps the sim to the game clock, applying queued inputs. Safe to call at any time. */
  tick(): TickResult {
    const nowMs = Math.max(this.opts.now(), this.state.nowMs);
    const due = this.pending.filter((i) => i.atMs <= nowMs);
    const result = step(this.state, due.map(Store.toInput), nowMs);
    const stored = this.opts.store.transaction(() => this.opts.store.insertEvents(result.events));
    this.state = result.state;
    if (due.length > 0) {
      this.appliedSeq = Math.max(this.appliedSeq, ...due.map((i) => i.seq));
      const dueSeqs = new Set(due.map((i) => i.seq));
      this.pending = this.pending.filter((i) => !dueSeqs.has(i.seq));
    }
    if (nowMs - this.lastSnapshotAt >= this.opts.snapshotMs) this.snapshot();
    const tick: TickResult = { nowMs, events: stored };
    for (const fn of this.listeners) {
      try {
        fn(tick);
      } catch (err) {
        this.opts.log?.({ level: 'error', msg: 'tick listener failed', err: String(err) });
      }
    }
    return tick;
  }

  /** Validates an order against the current state, persists it, then applies it. */
  acceptOrder(playerId: Id, order: Order): AcceptResult {
    this.tick();
    const v = validateOrder(this.state, { actorId: playerId, order });
    if (!v.ok) return { ok: false, error: v.error };
    const atMs = Math.max(this.opts.now(), this.state.nowMs, this.lastInputAt);
    // Durable (fsynced) before the caller can acknowledge it.
    const seq = this.opts.store.appendInput(atMs, playerId, order);
    this.lastInputAt = atMs;
    this.pending.push({ seq, atMs, actorId: playerId, order });
    this.tick();
    return { ok: true, seq, atMs };
  }

  /**
   * Adds a new player at the current game time and runs `link` (which inserts the account) in the
   * same transaction as a fresh snapshot, so account and player exist together or not at all.
   */
  createPlayer(link: (playerId: Id) => void): CreatePlayerResult {
    this.tick();
    const playerId = `p${Object.keys(this.state.players).length + 1}`;
    let next: GameState;
    try {
      // The sim picks a frontier plot for the newcomer.
      next = addPlayer(this.state, { id: playerId });
    } catch {
      return { ok: false, error: 'world_full' };
    }
    this.opts.store.transaction(() => {
      link(playerId);
      this.opts.store.insertSnapshot(next, hashState(next), this.appliedSeq);
    });
    this.state = next;
    this.lastSnapshotAt = this.opts.now();
    return { ok: true, playerId };
  }

  /** Writes a snapshot of the current state. */
  snapshot(): void {
    this.opts.store.insertSnapshot(this.state, hashState(this.state), this.appliedSeq);
    this.lastSnapshotAt = this.opts.now();
  }

  /** Final tick and snapshot. The caller closes the database afterwards. */
  shutdown(): void {
    this.tick();
    this.snapshot();
    this.listeners.clear();
  }

  /** Used by crash-recovery tests: forget everything in memory without writing anything. */
  abandon(): void {
    this.listeners.clear();
  }
}

export type { SimEvent };
