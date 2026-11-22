import { BOTS, viewFor } from '@nexum/sim';
import type { BotKind, Order } from '@nexum/sim';
import { placeOrderRequestSchema } from '@nexum/contracts';
import type { Engine } from '../engine.js';
import type { BotRow, Store } from '../store.js';
import { PERSONAS, ROLE, ROSTER, pickPersona } from './personalities.js';
import { checkinGapMs } from './schedule.js';
import { stateFromView } from './view.js';

const HOUR_MS = 3_600_000;
/** Most orders one check-in may send; a bot is a person at a phone, not a script loop. */
const MAX_ORDERS_PER_CHECKIN = 24;

export interface BotConfig {
  readonly enabled: boolean;
  /** Target number of bots while the city is empty. */
  readonly count: number;
  /** Fewest bots kept active however many humans have joined. */
  readonly min: number;
}

export interface BotStats {
  checkins: number;
  submitted: number;
  accepted: number;
  rejected: number;
}

export interface BotRunnerOptions {
  readonly engine: Engine;
  readonly store: Store;
  readonly now: () => number;
  readonly seed: number;
  readonly config: BotConfig;
  readonly log?: ((entry: Record<string, unknown>) => void) | undefined;
}

/**
 * Bots are real players in the live game: each has a sim player (made by `Engine.createPlayer`
 * like a human's) and a row in the `bots` table instead of an account. They play like async
 * humans: a few check-ins a day at seeded, jittered times, and at each one they decide from their
 * fogged `viewFor` and send orders through `Engine.acceptOrder`, the same path as `POST /orders`
 * (contract schema, `validateOrder`, the durable input log). They never act on every tick.
 *
 * Retirement (decision): when humans join, the roster shrinks toward `min` one bot per game hour.
 * A retired bot stops acting but keeps its districts, crews and score as a dormant crew that
 * players can raid; handing them to neutral would need a sim change and would erase score
 * history. Its schedule row stays, so the roster is auditable.
 */
export class BotRunner {
  readonly stats: BotStats = { checkins: 0, submitted: 0, accepted: 0, rejected: 0 };
  private lastReconcileMs: number | undefined;
  private readonly o: BotRunnerOptions;

  constructor(options: BotRunnerOptions) {
    this.o = options;
  }

  /** Active bots wanted for the current number of human accounts. */
  target(): number {
    const { count, min } = this.o.config;
    const humans = this.o.store.countAccounts();
    return Math.max(Math.min(min, count), Math.min(count, count - humans));
  }

  active(): BotRow[] {
    return this.o.store.allBots().filter((b) => b.retiredMs === null);
  }

  /**
   * Brings the roster to the target: spawns every missing bot, but retires at most one bot per
   * game hour so the city does not change under people's feet. Returns what changed.
   */
  reconcile(): { spawned: string[]; retired: string[] } {
    const { engine, store, now } = this.o;
    const spawned: string[] = [];
    const retired: string[] = [];
    const nowMs = now();
    const want = this.target();
    let active = this.active();
    const used = new Set(store.allBots().map((b) => b.name));

    while (active.length < want) {
      const kind = this.nextKind(active);
      const persona = pickPersona(kind, used);
      const index = store.allBots().length;
      const created = engine.createPlayer((playerId) => {
        store.insertBot({
          playerId,
          kind,
          name: persona.name,
          motto: persona.motto,
          role: ROLE[kind],
          createdMs: nowMs,
          nextCheckinMs: nowMs + checkinGapMs(this.o.seed, playerId, kind, 0),
        });
      }, persona.name);
      if (!created.ok) break; // the city is full or in its finale: no more bots
      used.add(persona.name);
      spawned.push(created.playerId);
      this.o.log?.({ level: 'info', msg: 'bot joined', bot: created.playerId, kind, index });
      active = this.active();
    }

    const due = this.lastReconcileMs === undefined || nowMs - this.lastReconcileMs >= HOUR_MS;
    if (active.length > want && due) {
      const victim = this.pickRetiree(active);
      if (victim) {
        store.retireBot(victim.playerId, nowMs);
        retired.push(victim.playerId);
        this.o.log?.({ level: 'info', msg: 'bot retired', bot: victim.playerId });
      }
    }
    if (spawned.length > 0 || retired.length > 0 || due) this.lastReconcileMs = nowMs;
    return { spawned, retired };
  }

  /** The personality the roster is shortest of, following `ROSTER` order on ties. */
  private nextKind(active: readonly BotRow[]): BotKind {
    const have = new Map<BotKind, number>();
    for (const b of active) have.set(b.kind, (have.get(b.kind) ?? 0) + 1);
    let best: BotKind = ROSTER[0] ?? 'raider';
    let bestN = Infinity;
    for (const kind of ROSTER) {
      const n = have.get(kind) ?? 0;
      if (n < bestN) {
        best = kind;
        bestN = n;
      }
    }
    return best;
  }

  /** Retire from the most common personality, its lowest-scoring bot. */
  private pickRetiree(active: readonly BotRow[]): BotRow | undefined {
    const counts = new Map<BotKind, number>();
    for (const b of active) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
    const top = Math.max(...counts.values());
    const players = this.o.engine.current.players;
    return active
      .filter((b) => counts.get(b.kind) === top)
      .sort(
        (a, b) =>
          (players[a.playerId]?.score ?? 0) - (players[b.playerId]?.score ?? 0) ||
          (a.playerId < b.playerId ? -1 : 1),
      )[0];
  }

  /** Reconciles the roster, then lets every bot whose check-in time has come act once. */
  run(): void {
    const { engine, store, now } = this.o;
    this.reconcile();
    const nowMs = now();
    for (const bot of this.active()) {
      if (bot.nextCheckinMs > nowMs) continue;
      try {
        this.checkIn(bot);
      } catch (err) {
        this.o.log?.({
          level: 'error',
          msg: 'bot check-in failed',
          bot: bot.playerId,
          err: String(err),
        });
      }
      // Next visit counts from the scheduled time, so the rhythm is the same however late the
      // server was; after a long outage the bot simply comes back one gap from now.
      const checkins = bot.checkins + 1;
      const gap = checkinGapMs(this.o.seed, bot.playerId, bot.kind, checkins);
      store.setBotCheckin(
        bot.playerId,
        Math.max(bot.nextCheckinMs + gap, nowMs + gap / 2),
        checkins,
      );
    }
    void engine;
  }

  /** One visit: look at the fogged view, decide, send each order the way a player would. */
  checkIn(bot: BotRow): void {
    const { engine } = this.o;
    engine.tick();
    if (!engine.current.players[bot.playerId]) return;
    const view = viewFor(engine.current, bot.playerId);
    const proposed = BOTS[bot.kind](stateFromView(view), bot.playerId).slice(
      0,
      MAX_ORDERS_PER_CHECKIN,
    );
    this.stats.checkins += 1;
    for (const order of proposed) {
      this.stats.submitted += 1;
      if (!this.submit(bot, order)) this.stats.rejected += 1;
      else this.stats.accepted += 1;
    }
  }

  private submit(bot: BotRow, order: Order): boolean {
    // Same gate as POST /orders: the contract schema first, then the engine's validateOrder.
    const parsed = placeOrderRequestSchema.safeParse({ order });
    if (!parsed.success) {
      this.o.log?.({
        level: 'warn',
        msg: 'bot order failed schema',
        bot: bot.playerId,
        type: order.type,
      });
      return false;
    }
    const result = this.o.engine.acceptOrder(bot.playerId, order);
    if (!result.ok) {
      this.o.log?.({
        level: 'debug',
        msg: 'bot order rejected',
        bot: bot.playerId,
        type: order.type,
        error: result.error,
      });
      return false;
    }
    return true;
  }
}

export { PERSONAS };
