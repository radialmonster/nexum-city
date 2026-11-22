import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { backupIfDue } from './backup.js';
import { openDatabase } from './db.js';
import { Engine } from './engine.js';
import { Hub } from './hub.js';
import { RateLimiter } from './ratelimit.js';
import { SeasonManager } from './seasons.js';
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
  /** Season length in days; default 7 (the sim's own length). */
  readonly seasonDays?: number | undefined;
  /** Pause between a season ending and the next starting, in hours; default 0. */
  readonly seasonBreakHours?: number | undefined;
  /** Minutes between tick summary log lines; default 15. */
  readonly tickLogMinutes?: number | undefined;
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

/** What `/api/health` reports. Counts and timings only: nothing secret, no player names. */
export interface GameStatus {
  /** Milliseconds since the tick loop last completed a tick; null before its first tick. */
  readonly tickLagMs: number | null;
  /** Milliseconds since the last snapshot was written. */
  readonly snapshotAgeMs: number;
  readonly lastSnapshotMs: number;
  readonly players: number;
  readonly accounts: number;
  readonly season: { readonly number: number; readonly phase: 'running' | 'finale' | 'break' };
  /** Ticks that threw since boot. */
  readonly tickErrors: number;
}

export interface Game {
  readonly db: DatabaseSync;
  readonly store: Store;
  readonly engine: Engine;
  readonly hub: Hub;
  /** The bot roster and scheduler; `null` when bots are disabled. */
  readonly bots: BotRunner | null;
  /** Season lifecycle: archive at the end, new world after the break. */
  readonly seasons: SeasonManager;
  readonly sessions: Sessions;
  readonly now: () => number;
  readonly options: GameOptions;
  readonly authLimiter: RateLimiter;
  readonly loginFailures: RateLimiter;
  readonly orderLimiter: RateLimiter;
  /** Starts the tick loop and the housekeeping timer. Not needed in tests, which call `engine.tick()`. */
  start(): void;
  /**
   * One pass of the tick loop: tick, season check, bots. Never throws: an exception is logged and
   * counted, and the next pass runs as normal. Exposed for tests.
   */
  tickOnce(): void;
  /** Numbers for the health check. */
  status(): GameStatus;
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
    seasonHours: (options.seasonDays ?? 7) * 24,
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
  const seasons = new SeasonManager({
    engine,
    store,
    now,
    seed: options.seed,
    breakMs: (options.seasonBreakHours ?? 0) * 3_600_000,
    log: options.log,
    onNewSeason: () => bots?.reconcile(),
  });
  seasons.init();
  const sessions = new Sessions(store, now);
  const limit = options.authLimit ?? { max: 20, windowMs: 60_000 };
  const log = options.log;

  let tickTimer: NodeJS.Timeout | undefined;
  let housekeeping: NodeJS.Timeout | undefined;
  let stopped = false;
  let lastTickAt: number | undefined;
  let tickErrors = 0;
  // Rolling numbers for the periodic tick summary line.
  const sum = { ticks: 0, errors: 0, maxMs: 0, sinceMs: now() };
  const tickLogMs = (options.tickLogMinutes ?? 15) * 60_000;

  const tickOnce = (): void => {
    const t0 = performance.now();
    try {
      engine.tick();
      lastTickAt = now();
      seasons.check();
      if (!engine.seasonOver) bots?.run();
    } catch (err) {
      tickErrors++;
      sum.errors++;
      log?.({
        level: 'error',
        msg: 'tick failed',
        err: String(err),
        ...(err instanceof Error && err.stack ? { stack: err.stack.split('\n').slice(0, 6) } : {}),
      });
    }
    sum.ticks++;
    sum.maxMs = Math.max(sum.maxMs, performance.now() - t0);
    if (tickLogMs > 0 && now() - sum.sinceMs >= tickLogMs) {
      const s = status();
      log?.({
        level: 'info',
        msg: 'tick summary',
        ticks: sum.ticks,
        errors: sum.errors,
        maxTickMs: Math.round(sum.maxMs),
        gameMs: engine.current.nowMs,
        players: s.players,
        season: s.season.number,
        phase: s.season.phase,
        snapshotAgeS: Math.round(s.snapshotAgeMs / 1000),
      });
      sum.ticks = 0;
      sum.errors = 0;
      sum.maxMs = 0;
      sum.sinceMs = now();
    }
  };

  const status = (): GameStatus => {
    const state = engine.current;
    return {
      tickLagMs: lastTickAt === undefined ? null : Math.max(0, now() - lastTickAt),
      snapshotAgeMs: Math.max(0, now() - engine.lastSnapshotMs),
      lastSnapshotMs: engine.lastSnapshotMs,
      players: Object.keys(state.players).length,
      accounts: store.countAccounts(),
      season: {
        number: seasons.number(),
        phase: engine.seasonOver
          ? 'break'
          : state.nowMs >= state.season.finaleStartMs
            ? 'finale'
            : 'running',
      },
      tickErrors,
    };
  };

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
    seasons,
    sessions,
    now,
    options,
    authLimiter: new RateLimiter(limit.max, limit.windowMs, now),
    loginFailures: new RateLimiter(5, 15 * 60_000, now),
    orderLimiter: new RateLimiter(120, 60_000, now),
    backup,
    tickOnce,
    status,
    start() {
      tickTimer = setInterval(tickOnce, options.tickMs);
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
