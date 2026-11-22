import { balance, MS_PER_MINUTE } from './balance.js';
import { emit, schedule, type Ctx } from './ctx.js';
import { buildingLevel } from './production.js';
import type { Carrier, District } from './types.js';
import type { System } from './systems.js';

/**
 * Carrier wear and the Garage (task 75; sim-spec, "Watchtower and Garage (M2)").
 *
 * A carrier picks up a little wear on every haul it finishes and more when an ambush strikes it.
 * Past `slowFrom` it runs slower (never more than `slowPercentAtMax`). It heals by itself while it
 * is parked, and a Garage of its owner's there heals it faster and cheapens Runners.
 * The Garage is a bonus on top of a baseline that already works, so skipping it never traps anyone.
 */

export function wearOf(carrier: Pick<Carrier, 'wear'>): number {
  return carrier.wear ?? 0;
}

/** Percent slower at a wear level: 0 up to `slowFrom`, then a straight line to the maximum. */
export function slowPercentAt(wear: number): number {
  const w = balance.wear;
  if (wear <= w.slowFrom) return 0;
  return Math.floor(
    ((Math.min(wear, w.max) - w.slowFrom) * w.slowPercentAtMax) / (w.max - w.slowFrom),
  );
}

/** Travel time stretched for wear, in whole milliseconds. Unchanged below the threshold. */
export function wornMs(baseMs: number, wear: number): number {
  const slow = slowPercentAt(wear);
  return slow === 0 ? baseMs : Math.ceil((baseMs * 100) / (100 - slow));
}

function garageLevelAt(district: District | undefined): number {
  return district && district.kind !== 'hub' ? buildingLevel(district, 'garage') : 0;
}

/** Milliseconds to heal one wear point for a carrier standing at `district` (or on the road). */
function repairMs(carrier: Carrier, district: District | undefined): number {
  const w = balance.wear;
  const here = district && district.owner === carrier.owner ? district : undefined;
  const level = Math.min(garageLevelAt(here), w.garageRepairMinutes.length);
  const minutes = level > 0 ? (w.garageRepairMinutes[level - 1] as number) : w.repairMinutes;
  return minutes * MS_PER_MINUTE;
}

function scheduleRepair(ctx: Ctx, carrier: Carrier): void {
  if (wearOf(carrier) <= 0) return;
  if (ctx.state.queue.some((e) => e.kind === 'carrier.repair' && e.carrierId === carrier.id))
    return;
  const at = 'at' in carrier.loc ? ctx.state.districts[carrier.loc.at] : undefined;
  schedule(ctx, ctx.state.nowMs + repairMs(carrier, at), {
    kind: 'carrier.repair',
    carrierId: carrier.id,
  });
}

/** Adds wear (capped) and tells the owner when the carrier first becomes slower. */
export function wearCarrier(ctx: Ctx, carrier: Carrier | undefined, points: number): void {
  if (!carrier || points <= 0) return;
  const w = balance.wear;
  const before = wearOf(carrier);
  const after = Math.min(w.max, before + points);
  carrier.wear = after;
  if (before <= w.slowFrom && after > w.slowFrom) {
    emit(ctx, 'carrier.worn', [carrier.owner], [], {
      carrierId: carrier.id,
      wear: after,
      slowPercent: slowPercentAt(after),
    });
  }
  scheduleRepair(ctx, carrier);
}

/** Runner price at a district: the Garage there takes a slice off per level. */
export function runnerPrice(district: District): number {
  const off = Math.min(100, balance.wear.garageRunnerDiscountPercent * garageLevelAt(district));
  return Math.floor((balance.runner.credits * (100 - off)) / 100);
}

export const wearSystem: System = {
  name: 'wear',
  handlers: {
    'carrier.repair': (ctx, ev) => {
      const carrier = ctx.state.carriers[ev.carrierId];
      if (!carrier) return;
      const wear = wearOf(carrier);
      if (wear <= 0) return;
      const district = 'at' in carrier.loc ? ctx.state.districts[carrier.loc.at] : undefined;
      // Only a parked carrier heals (at a hub too, just slower than at a Garage); on the road it is checked again later.
      if (district) {
        const next = wear - 1;
        if (next <= 0) Reflect.deleteProperty(carrier, 'wear');
        else carrier.wear = next;
        if (wear > balance.wear.slowFrom && next <= balance.wear.slowFrom) {
          emit(ctx, 'carrier.repaired', [carrier.owner], [district.id], {
            carrierId: carrier.id,
            wear: Math.max(0, next),
          });
        }
      }
      scheduleRepair(ctx, carrier);
    },
  },
};
