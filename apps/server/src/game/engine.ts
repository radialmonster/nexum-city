import { addPlayerWithEvents, createWorld, hashState, step, validateOrder } from '@nexum/sim';
import type { GameState, Id, Order, OrderError, SimEvent } from '@nexum/sim';
import { Store } from './store.js';
import { RULES_VERSION } from './snapshot.js';
import type { AccountRow, StoredEvent, StoredInput } from './store.js';

export interface EngineOptions {
  readonly store: Store;
  /** The game clock. The server uses wall time; tests inject a fake. Never used inside the sim. */
  readonly now: () => number;
  /** Seed of the world created on first boot. */
  readonly seed: number;
  /** Minimum game-clock interval between periodic snapshots. */
  readonly snapshotMs: number;
  /** Season length in hours for worlds this engine creates. Default: the sim's own. */
  readonly seasonHours?: number | undefined;
  readonly log?: ((entry: Record<string, unknown>) => void) | undefined;
}

export interface TickResult {
  readonly nowMs: number;
  /** Events produced by this tick, each with its position in the event log. */
  readonly events: readonly StoredEvent[];
}

export type AcceptResult =
  { ok: true; seq: number; atMs: number } | { ok: false; error: OrderError | 'season_over' };

/** Events every player should see, not only the ones they act in. */
const isPublic = (e: SimEvent): boolean =>
  e.kind === 'frontier.opened' ||
  (e.kind === 'player.joined' && e.data['reason'] === 'new') ||
  // A big job on a board is news for everyone; a small one is only on the board itself.
  (e.kind === 'contract.posted' && e.data['notable'] === true);

/** Which edge of the city a position is on, for the arrival message. */
function sideOf(state: GameState, pos: { x: number; y: number }): string {
  const nodes = Object.values(state.graph.nodes);
  const xs = nodes.map((n) => n.pos.x);
  const ys = nodes.map((n) => n.pos.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const dx = (pos.x - cx) / Math.max(1, (Math.max(...xs) - Math.min(...xs)) / 2);
  const dy = (pos.y - cy) / Math.max(1, (Math.max(...ys) - Math.min(...ys)) / 2);
  if (Math.hypot(dx, dy) < 0.25) return 'centre';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
}

/** Adds a player and names the crew and the plot in the arrival event, so others can read it. */
function addCrew(
  state: GameState,
  playerId: Id,
  crew: string,
): { state: GameState; events: SimEvent[] } {
  // The sim picks a frontier plot for the newcomer and throws when there is none.
  const added = addPlayerWithEvents(state, { id: playerId });
  const next = added.state;
  const events = added.events.map((e): SimEvent => {
    if (e.kind !== 'player.joined') return e;
    const d = next.districts[added.districtId];
    return {
      ...e,
      data: { ...e.data, crew, ...(d ? { district: d.name, side: sideOf(next, d.pos) } : {}) },
    };
  });
  return { state: next, events };
}

export type CreatePlayerResult =
  { ok: true; playerId: Id } | { ok: false; error: 'world_full' | 'season_over' };

export interface StartSeasonOptions {
  readonly seed: number;
  /** The number the new season carries (kept in `meta.season_number`). */
  readonly number: number;
  /** Game time the new season starts at. */
  readonly startMs: number;
  /** Every account gets a crew in the new world, in this order. */
  readonly accounts: readonly AccountRow[];
}

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
  /** Set when the loaded snapshot was written under other sim rules; see `snapshot.ts`. */
  rulesChangedFrom: number | undefined;
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
      const changed = snap.rulesVersion !== RULES_VERSION;
      // Inputs logged under other rules are never replayed (the result would diverge).
      const pending = changed ? [] : store.inputsAfter(snap.lastSeq);
      engine = new Engine(opts, snap.state, snap.lastSeq, pending);
      if (changed) engine.rulesChangedFrom = snap.rulesVersion;
      opts.log?.({
        level: 'info',
        msg: 'loaded snapshot',
        snapshotAtMs: snap.atMs,
        replayInputs: pending.length,
        snapshotVersion: snap.version,
        rulesVersion: snap.rulesVersion,
        ...(changed ? { rulesChanged: true } : {}),
      });
    } else {
      const seed = Number(store.getMeta('seed') ?? opts.seed);
      store.setMeta('seed', String(seed));
      store.setMeta('created_ms', String(opts.now()));
      const world = createWorld(seed, {
        startMs: opts.now(),
        ...(opts.seasonHours === undefined ? {} : { seasonHours: opts.seasonHours }),
      });
      store.insertSnapshot(world, hashState(world), 0);
      engine = new Engine(opts, world, 0, []);
    }
    engine.lastInputAt = engine.state.nowMs;
    // Under changed rules the old state is only read (to archive it), never stepped forward.
    if (engine.rulesChangedFrom === undefined) engine.tick();
    return engine;
  }

  /** The live state. Treat as read-only; the sim never mutates it, `step` returns a new one. */
  get current(): GameState {
    return this.state;
  }

  /** True once the season clock has run out: scoring has stopped and orders are refused. */
  get seasonOver(): boolean {
    return this.state.nowMs >= this.state.season.endMs;
  }

  /** Game time of the last snapshot write. */
  get lastSnapshotMs(): number {
    return this.lastSnapshotAt;
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
    // The world freezes at the end of the season; the season manager starts the next one.
    const nowMs = Math.min(Math.max(this.opts.now(), this.state.nowMs), this.state.season.endMs);
    const due = this.pending.filter((i) => i.atMs <= nowMs);
    const result = step(this.state, due.map(Store.toInput), nowMs);
    const everyone = Object.keys(result.state.players);
    const stored = this.opts.store.transaction(() =>
      this.opts.store.insertEvents(result.events, (e) => (isPublic(e) ? everyone : undefined)),
    );
    this.state = result.state;
    if (due.length > 0) {
      this.appliedSeq = Math.max(this.appliedSeq, ...due.map((i) => i.seq));
      const dueSeqs = new Set(due.map((i) => i.seq));
      this.pending = this.pending.filter((i) => !dueSeqs.has(i.seq));
    }
    if (nowMs - this.lastSnapshotAt >= this.opts.snapshotMs) this.snapshot();
    return this.publish({ nowMs, events: stored });
  }

  private publish(tick: TickResult): TickResult {
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
    if (this.seasonOver) return { ok: false, error: 'season_over' };
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
   * Adds a new player at the current game time and runs `link` (which inserts the account or bot)
   * in the same transaction as a fresh snapshot, so both exist together or not at all. `crew` is
   * the display name put in the arrival event that every player's feed receives.
   */
  createPlayer(link: (playerId: Id) => void, crew?: string): CreatePlayerResult {
    this.tick();
    if (this.seasonOver) return { ok: false, error: 'season_over' };
    const playerId = `p${String(Object.keys(this.state.players).length + 1)}`;
    let added: ReturnType<typeof addCrew>;
    try {
      added = addCrew(this.state, playerId, crew ?? playerId);
    } catch {
      return { ok: false, error: 'world_full' };
    }
    const next = added.state;
    const events = added.events;
    const everyone = Object.keys(next.players);
    let stored: StoredEvent[] = [];
    this.opts.store.transaction(() => {
      link(playerId);
      stored = this.opts.store.insertEvents(events, (e) => (isPublic(e) ? everyone : undefined));
      this.opts.store.insertSnapshot(next, hashState(next), this.appliedSeq);
    });
    this.state = next;
    this.lastSnapshotAt = this.opts.now();
    this.publish({ nowMs: next.nowMs, events: stored });
    return { ok: true, playerId };
  }

  /**
   * Replaces the world with a fresh season in one transaction: the old world's events, inputs and
   * bots are cleared, every account is given a crew in the new world and a snapshot is written.
   * Either all of it happens or none, so a crash cannot leave accounts pointing at the old world.
   * Returns the ids of accounts that found no plot (they stay logged in without a crew).
   */
  startSeason(o: StartSeasonOptions): { placed: number; unplaced: number[] } {
    let world = createWorld(o.seed, {
      startMs: o.startMs,
      ...(this.opts.seasonHours === undefined ? {} : { seasonHours: this.opts.seasonHours }),
    });
    const links = new Map<number, string | null>();
    const events: SimEvent[] = [];
    for (const account of o.accounts) {
      const playerId = `p${String(Object.keys(world.players).length + 1)}`;
      try {
        const added = addCrew(world, playerId, account.username);
        world = added.state;
        events.push(...added.events);
        links.set(account.id, playerId);
      } catch {
        links.set(account.id, null);
      }
    }
    const everyone = Object.keys(world.players);
    let stored: StoredEvent[] = [];
    const { store } = this.opts;
    store.transaction(() => {
      store.clearWorldData();
      store.relinkAccounts(links);
      store.setMeta('seed', String(o.seed));
      store.setMeta('season_number', String(o.number));
      stored = store.insertEvents(events, (e) => (isPublic(e) ? everyone : undefined));
      store.insertSnapshot(world, hashState(world), this.appliedSeq);
    });
    this.state = world;
    this.pending = [];
    this.lastInputAt = world.nowMs;
    this.lastSnapshotAt = this.opts.now();
    this.rulesChangedFrom = undefined;
    this.publish({ nowMs: world.nowMs, events: stored });
    return {
      placed: everyone.length,
      unplaced: [...links].filter(([, p]) => p === null).map(([id]) => id),
    };
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
