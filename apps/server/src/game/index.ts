import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { backupIfDue } from './backup.js';
import { openDatabase } from './db.js';
import { Engine } from './engine.js';
import { Hub } from './hub.js';
import { RateLimiter } from './ratelimit.js';
import { Sessions } from './sessions.js';
import { Store } from './store.js';
import { BotRunner, type BotConfig } from './bots/runner.js';

export interface GameOptions {
  readonly dataDir: string;
  /** The game clock; defaults to wall time. */
  readonly now?: (() => number) | undefined;
  readonly tickMs: number;
  readonly snapshotMs: number;
  readonly seed: number;
  readonly cookieSecure: boolean;
  readonly trustProxy: boolean;
  readonly heartbeatMs?: number | undefined;
  readonly authLimit?: { readonly max: number; readonly windowMs: number } | undefined;
  readonly backupHourUtc?: number | undefined;
  readonly backupKeep?: number | undefined;
  /** Computer-run crews; off unless given. */
  readonly bots?: BotConfig | undefined;
  readonly log?: ((entry: Record<string, unknown>) => void) | undefined;
}

export interface Game {
  readonly db: DatabaseSync;
  readonly store: Store;
  readonly engine: Engine;
  readonly hub: Hub;
  /** The bot roster and scheduler; `null` when bots are disabled. */
  readonly bots: BotRunner | null;
  readonly sessions: Sessions;
  readonly now: () => number;
  readonly options: GameOptions;
  readonly authLimiter: RateLimiter;
  readonly loginFailures: RateLimiter;
  readonly orderLimiter: RateLimiter;
  /** Starts the tick loop and the housekeeping timer. Not needed in tests, which call `engine.tick()`. */
  start(): void;
  /** Stops timers, writes a final snapshot and closes the database. */
  stop(): void;
  /** Runs the nightly backup if it is due; exposed for tests. */
  backup(): string | undefined;
}

export function createGame(options: GameOptions): Game {
  const now = options.now ?? Date.now;
  const db = openDatabase(join(options.dataDir, 'nexum.db'), now);
  const store = new Store(db);
  const engine = Engine.open({
    store,
    now,
    seed: options.seed,
    snapshotMs: options.snapshotMs,
    log: options.log,
  });
  const hub = new Hub();
  engine.onTick((r) => {
    if (hub.size > 0) hub.publishTick(r.nowMs, r.events);
  });
  const botCfg = options.bots;
  const bots =
    botCfg?.enabled && botCfg.count > 0
      ? new BotRunner({ engine, store, now, seed: options.seed, config: botCfg, log: options.log })
      : null;
  const sessions = new Sessions(store, now);
  const limit = options.authLimit ?? { max: 20, windowMs: 60_000 };
  const log = options.log;

  let tickTimer: NodeJS.Timeout | undefined;
  let housekeeping: NodeJS.Timeout | undefined;
  let stopped = false;

  const backup = (): string | undefined =>
    backupIfDue({
      db,
      dir: join(options.dataDir, 'backups'),
      now,
      hourUtc: options.backupHourUtc ?? 3,
      keep: options.backupKeep ?? 7,
    });

  return {
    db,
    store,
    engine,
    hub,
    bots,
    sessions,
    now,
    options,
    authLimiter: new RateLimiter(limit.max, limit.windowMs, now),
    loginFailures: new RateLimiter(5, 15 * 60_000, now),
    orderLimiter: new RateLimiter(120, 60_000, now),
    backup,
    start() {
      tickTimer = setInterval(() => {
        try {
          engine.tick();
          bots?.run();
        } catch (err) {
          log?.({ level: 'error', msg: 'tick failed', err: String(err) });
        }
      }, options.tickMs);
      const housekeep = (): void => {
        try {
          sessions.prune();
          const file = backup();
          if (file) log?.({ level: 'info', msg: 'backup written', file });
        } catch (err) {
          log?.({ level: 'error', msg: 'housekeeping failed', err: String(err) });
        }
      };
      housekeep();
      housekeeping = setInterval(housekeep, 60 * 60_000);
      tickTimer.unref();
      housekeeping.unref();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (tickTimer) clearInterval(tickTimer);
      if (housekeeping) clearInterval(housekeeping);
      hub.closeAll();
      engine.shutdown();
      db.close();
    },
  };
}
