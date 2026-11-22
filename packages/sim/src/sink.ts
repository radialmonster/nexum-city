import { ATOMS_PER_UNIT, MS_PER_HOUR, balance } from './balance.js';
import { schedule } from './ctx.js';
import type { System } from './systems.js';
import type { GameState } from './types.js';

/**
 * Credit sinks (economy plan, credit sink; docs/rewrite/sim-spec.md "Credit sinks"). The ways
 * money leaves the game, both counted in `state.sink` so the books balance:
 *
 * - the hub fee: the hub keeps a small share of what a seller is paid (see `market.ts`);
 * - upkeep: once a day every player pays for the districts they hold beyond the first;
 * - the city levy: once a day a share of the credits held above a free amount (switched off,
 *   `levyPercent` 0, since the owner removed the nightly tax).
 */

/** The hub's cut of a sale, in atoms, rounded down. */
export const feeOn = (grossAtoms: number): number =>
  Math.floor((grossAtoms * balance.sink.tradeFeePercent) / 100);

/** Districts a player pays upkeep for (their first one is free, hubs never count). */
export const upkeepDistricts = (state: GameState, playerId: string): number =>
  Math.max(
    0,
    Object.values(state.districts).filter((d) => d.owner === playerId && d.kind !== 'hub').length -
      balance.sink.freeDistricts,
  );

export const sinkSystem: System = {
  name: 'sink',
  handlers: {
    'upkeep.day': (ctx, ev) => {
      const { state } = ctx;
      for (const p of Object.values(state.players).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const due = upkeepDistricts(state, p.id) * balance.sink.upkeepCreditsPerDay;
        const paid = Math.min(p.credits, due * ATOMS_PER_UNIT);
        p.credits -= paid;
        state.sink.upkeepAtoms += paid;
        // The city levy: a share of the credits held above a free amount.
        const idle = Math.max(0, p.credits - balance.sink.levyFreeCredits * ATOMS_PER_UNIT);
        const levy = Math.floor((idle * balance.sink.levyPercent) / 100);
        p.credits -= levy;
        state.sink.levyAtoms += levy;
      }
      const next = ev.at + 24 * MS_PER_HOUR;
      if (next <= state.season.endMs) schedule(ctx, next, { kind: 'upkeep.day' });
    },
  },
};
