import { standings } from '@nexum/sim';
import type { CurrentSeason, SeasonStats } from '@nexum/contracts';
import type { Engine } from './engine.js';
import { RULES_VERSION } from './snapshot.js';
import type { SeasonRow, Store } from './store.js';

export interface SeasonManagerOptions {
  readonly engine: Engine;
  readonly store: Store;
  readonly now: () => number;
  /** The configured world seed; each season's seed is derived from it and the season number. */
  readonly seed: number;
  /** Pause between a season ending and the next one starting. */
  readonly breakMs: number;
  readonly log?: ((entry: Record<string, unknown>) => void) | undefined;
  /** Called after a new season has started (the server uses it to re-staff the bots). */
  readonly onNewSeason?: (() => void) | undefined;
}

/** A different, reproducible seed for each season number. */
export function seasonSeed(base: number, number: number): number {
  return Math.imul(base ^ Math.imul(number, 2654435761), 2246822507) >>> 0;
}

/**
 * Runs the season lifecycle on top of the engine.
 *
 *   running -> over (engine freezes at `endMs`; this archives the standings once)
 *           -> after `breakMs`, a new world with a new seed and every account re-added.
 *
 * Everything it needs to resume lives in the database (the frozen world, the `seasons` archive,
 * `meta.season_number`), so a restart in the middle of a break just carries on. Archiving is
 * idempotent (`INSERT OR IGNORE` on the season number) and the reset is one transaction.
 */
export class SeasonManager {
  private readonly o: SeasonManagerOptions;

  constructor(options: SeasonManagerOptions) {
    this.o = options;
  }

  /** The number of the season in the engine (1 for a database that predates seasons). */
  number(): number {
    return Number(this.o.store.getMeta('season_number') ?? 1);
  }

  /** Call once at boot, before anything else touches the engine. */
  init(): void {
    const from = this.o.engine.rulesChangedFrom;
    if (from === undefined) {
      this.check();
      return;
    }
    // Policy (see snapshot.ts): other rules than the stored game was played under, so it ends here.
    this.o.log?.({
      level: 'warn',
      msg: 'sim rules changed; closing the season and starting a new one',
      from,
      to: RULES_VERSION,
    });
    this.archive('rules_change');
    this.startNext();
  }

  /** Call after every engine tick: archives a season that has ended and starts the next on time. */
  check(): void {
    const { engine, now } = this.o;
    if (!engine.seasonOver) return;
    this.archive('ended');
    if (now() >= engine.current.season.endMs + this.o.breakMs) this.startNext();
  }

  /** Where the season stands, for `GET /api/seasons`. */
  current(): CurrentSeason {
    const { season } = this.o.engine.current;
    const over = this.o.engine.seasonOver;
    return {
      number: this.number(),
      startMs: season.startMs,
      endMs: season.endMs,
      finaleStartMs: season.finaleStartMs,
      over,
      nextStartMs: over ? season.endMs + this.o.breakMs : null,
    };
  }

  private archive(reason: SeasonRow['reason']): void {
    const { engine, store, now } = this.o;
    const number = this.number();
    if (store.seasonArchived(number)) return;
    const state = engine.current;
    const board = standings(state);
    const all = store.crewNames();
    const names: Record<string, string> = {};
    for (const row of board) names[row.playerId] = all[row.playerId] ?? row.playerId;
    const top = [...board].sort((a, b) => b.tradeMs - a.tradeMs)[0];
    const stats: SeasonStats = {
      players: board.length,
      districtsHeld: board.reduce((n, r) => n + r.districts, 0),
      topTraderId: top && top.tradeMs > 0 ? top.playerId : null,
      topTradeScore: top?.tradeScore ?? 0,
    };
    const added = store.archiveSeason({
      number,
      startMs: state.season.startMs,
      endMs: reason === 'ended' ? state.season.endMs : state.nowMs,
      archivedMs: now(),
      reason,
      seed: Number(store.getMeta('seed') ?? this.o.seed),
      rulesVersion: engine.rulesChangedFrom ?? RULES_VERSION,
      standings: board,
      names,
      stats,
    });
    if (added) {
      // Keep the frozen final world on disk too, so a restart in the break reloads exactly it.
      if (reason === 'ended') engine.snapshot();
      this.o.log?.({
        level: 'info',
        msg: 'season archived',
        season: number,
        reason,
        players: board.length,
        winner: board[0]?.playerId ?? null,
      });
    }
  }

  private startNext(): void {
    const { engine, store, now } = this.o;
    const number = this.number() + 1;
    const result = engine.startSeason({
      number,
      seed: seasonSeed(this.o.seed, number),
      startMs: now(),
      accounts: store.allAccounts(),
    });
    this.o.log?.({
      level: 'info',
      msg: 'season started',
      season: number,
      crews: result.placed,
      unplaced: result.unplaced.length,
    });
    this.o.onNewSeason?.();
  }
}
