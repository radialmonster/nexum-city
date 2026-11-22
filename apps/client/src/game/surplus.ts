import type { PlayerView } from '@nexum/contracts';
import { balance, toUnits } from '@nexum/sim';
import {
  GOOD_KEYS,
  KIND_GOOD,
  carriersAt,
  productionPerHour,
  warehouseCapacity,
  type OwnDistrict,
} from './derive';
import type { OrderDraft } from './store';

/** Hours until a warehouse that is filling hits its cap, or null when it is full, or nothing is made. */
export function fullInMs(d: OwnDistrict): number | null {
  const rate = productionPerHour(d);
  if (rate <= 0 || d.overflowing) return null;
  const held = GOOD_KEYS.reduce((n, g) => n + toUnits(d.warehouse[g]), 0);
  const room = warehouseCapacity(d) - held;
  if (room <= 0) return null;
  return Math.ceil((room / rate) * 3_600_000);
}

/** The hub nearest to `d` on the map, or null when none is known. */
export function nearestHub(view: PlayerView, d: OwnDistrict) {
  return (
    Object.values(view.districts)
      .filter((h) => h.kind === 'hub')
      .map((h) => ({ h, dist: Math.hypot(h.pos.x - d.pos.x, h.pos.y - d.pos.y) }))
      .sort((a, b) => a.dist - b.dist)[0]?.h ?? null
  );
}

/**
 * A haul order prefilled to sell a full warehouse's surplus at the nearest hub: the good the plot
 * makes (or its biggest stock), as much as its best carrier here can take.
 */
export function surplusHaulDraft(view: PlayerView, d: OwnDistrict): OrderDraft | null {
  const hub = nearestHub(view, d);
  if (!hub) return null;
  const made = KIND_GOOD[d.kind];
  const stock = (g: (typeof GOOD_KEYS)[number]) => Math.floor(toUnits(d.warehouse[g]));
  const good =
    made && stock(made) > 0
      ? made
      : [...GOOD_KEYS].sort((a, b) => stock(b) - stock(a)).find((g) => stock(g) > 0);
  if (!good) return null;
  const room = Math.max(
    balance.carriers.foot.cargo,
    ...carriersAt(view, d.id).map((c) => balance.carriers[c.kind].cargo),
  );
  return {
    kind: 'haul',
    districtId: hub.id,
    from: d.id,
    cargo: { [good]: Math.min(stock(good), room) },
  };
}
