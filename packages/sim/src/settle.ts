import { MS_PER_HOUR, balance, toAtoms } from './balance.js';
import { rushDuration } from './rush.js';
import { emit, schedule, unschedule, type Ctx } from './ctx.js';
import { ensureFrontier } from './frontier.js';
import { deposit } from './production.js';
import { nearestOwned, refreshSiege, walkHome } from './siege.js';
import type { System } from './systems.js';
import type { Crew, District, Id, Movement } from './types.js';

/**
 * Settling (task 54): a crew carries supplies to an open frontier plot. When it arrives, a
 * `balance.settle.hours` timer starts and the settlers hold the plot as its garrison. If the
 * timer ends first, the plot becomes the settler's district. The rules for contests:
 *
 * - the first settler to arrive holds the plot; a second settler who arrives later is turned
 *   back (`settle.failed`, reason `taken`), supplies refunded to their nearest district;
 *   a carrier that raiders have robbed on the way (supplies short on arrival) fails the same way
 *   with reason `raided`, and what is left of its supplies goes home;
 * - an enemy siege on the plot fights the settlers plus the neutral guard; if the bar fills
 *   first the siege wins the plot and the settlement fails (reason `captured`, handled by
 *   `siege.ts` through `failSettle`); if the timer wins, the siege simply carries on against
 *   the new district.
 */

/** Called when a settle movement arrives and was not recalled. The supplies are spent. */
export function beginSettle(ctx: Ctx, m: Movement, crews: readonly Crew[]): void {
  const { state } = ctx;
  const d = state.districts[m.to];
  if (!d) return;
  // A raided supply carrier arrives short: the settlement fails and the rest goes home.
  const raided = m.cargo.supplies < toAtoms(balance.settle.supplies);
  if (raided || d.owner !== 'neutral' || d.frontier !== 'open' || d.settling) {
    const home = nearestOwned(ctx, m.owner, d.id, d.id);
    if (home) {
      deposit(ctx, m.owner, home.id, m.cargo);
      for (const crew of crews) walkHome(ctx, crew, d.id, home.id);
    }
    emit(ctx, 'settle.failed', [m.owner], [d.id], {
      owner: m.owner,
      reason: raided ? 'raided' : 'taken',
      crewIds: m.crewIds,
    });
    return;
  }
  const completesAtMs =
    state.nowMs + rushDuration(state, m.owner, balance.settle.hours * MS_PER_HOUR);
  d.settling = {
    owner: m.owner,
    crewIds: crews.map((c) => c.id),
    startedMs: state.nowMs,
    completesAtMs,
  };
  for (const crew of crews) if (!d.garrison.includes(crew.id)) d.garrison.push(crew.id);
  schedule(ctx, completesAtMs, { kind: 'settle.done', districtId: d.id });
  emit(ctx, 'settle.started', [m.owner], [d.id], {
    owner: m.owner,
    completesAtMs,
    crewIds: m.crewIds,
  });
  refreshSiege(ctx, d.id);
}

/** Clears a settlement that did not finish. The caller deals with the crews. */
export function failSettle(ctx: Ctx, d: District, reason: string): void {
  const s = d.settling;
  if (!s) return;
  unschedule(ctx.state, (e) => e.kind === 'settle.done' && e.districtId === d.id);
  Reflect.deleteProperty(d, 'settling');
  emit(ctx, 'settle.failed', [s.owner], [d.id], { owner: s.owner, reason, crewIds: s.crewIds });
}

export const settleSystem: System = {
  name: 'settle',
  handlers: {
    'settle.done': (ctx, ev) => {
      const d = ctx.state.districts[ev.districtId];
      const s = d?.settling;
      if (!d || !s) return;
      const stayed = d.garrison.filter((id: Id) => ctx.state.crews[id]?.owner === s.owner);
      if (stayed.length === 0) {
        // Every settler walked away: the claim lapses.
        failSettle(ctx, d, 'abandoned');
        ensureFrontier(ctx);
        return;
      }
      Reflect.deleteProperty(d, 'settling');
      d.owner = s.owner;
      d.frontier = 'built';
      d.stance = 'hold';
      d.garrison = stayed;
      emit(ctx, 'settle.done', [s.owner], [d.id], { owner: s.owner });
      refreshSiege(ctx, d.id);
      ensureFrontier(ctx);
    },
  },
};
