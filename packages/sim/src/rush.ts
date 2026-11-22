import { MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { emit, type Ctx } from './ctx.js';
import type { System } from './systems.js';
import type { GameState, Id } from './types.js';

/**
 * Newcomer rush (docs/rewrite/sim-spec.md, "Newcomer rush and street jobs"): for the first
 * `balance.rush.hours` after joining, a player's builds and settles run `balance.rush.factor`
 * times faster. Siege, travel and raid speeds never change. The timer is the player's own
 * `rushUntilMs`; it is not reset when the player relocates.
 */

export function inRush(state: GameState, owner: Id): boolean {
  const p = state.players[owner];
  return p !== undefined && state.nowMs < p.rushUntilMs;
}

/** A build or settle duration for `owner`, shortened while the rush lasts (never below 1 ms). */
export function rushDuration(state: GameState, owner: Id, ms: number): number {
  if (!inRush(state, owner)) return ms;
  return Math.max(1, Math.ceil(ms / balance.rush.factor));
}

/** When a player who joins at `nowMs` stops being rushed. */
export const rushEndsAt = (nowMs: number): number => nowMs + balance.rush.hours * MS_PER_HOUR;

export const rushSystem: System = {
  name: 'rush',
  handlers: {
    'rush.end': (ctx: Ctx, ev) => {
      const p = ctx.state.players[ev.playerId];
      if (!p || p.rushUntilMs !== ev.at) return;
      emit(ctx, 'rush.ended', [p.id], [], { untilMs: p.rushUntilMs });
    },
  },
};

/**
 * Removes the newcomer perks from every player: the rush, the reserved starter contract and
 * (with `jobs`) the street jobs. Tests use it to keep older rules plain, and the harness uses it
 * to measure the game as it was before the rush.
 */
export function stripNewcomerPerks(s: GameState, options: { jobs?: boolean } = {}): void {
  for (const p of Object.values(s.players)) {
    p.rushUntilMs = 0;
    if (options.jobs) {
      p.jobs = [];
      p.jobNextMs = 0;
    }
  }
  // The starter kit sits in each newcomer's first district; take it back out.
  for (const d of Object.values(s.districts)) {
    if (d.kind === 'hub' || d.owner === 'neutral') continue;
    d.warehouse.parts = Math.max(0, d.warehouse.parts - toAtoms(balance.rush.kit.parts));
    d.warehouse.power = Math.max(0, d.warehouse.power - toAtoms(balance.rush.kit.power));
  }
  const dropped = new Set<Id>();
  for (const id of Object.keys(s.contracts)) {
    if (s.contracts[id]?.reservedFor) {
      dropped.add(id);
      delete s.contracts[id];
    }
  }
  s.queue = s.queue.filter(
    (e) =>
      e.kind !== 'rush.end' &&
      !(e.kind === 'contract.due' && dropped.has(e.contractId)) &&
      !(options.jobs && e.kind === 'job.refill'),
  );
}
