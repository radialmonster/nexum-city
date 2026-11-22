import { ATOMS_PER_UNIT, balance } from './balance.js';
import { GOODS, type Good, type Goods, type District, type GameState, type Id } from './types.js';

/**
 * Cost basis (economy plan, stage 1; docs/rewrite/sim-spec.md "Cost basis").
 *
 * Every pile of goods (a district warehouse, a hub stash, a movement's cargo, a resting sell
 * order) has a parallel "value" record of the same shape. The value of a pile is the sum of
 * atoms times the price in centi-credits paid or assumed for each atom, an exact integer. The
 * average cost per unit is `value / atoms` (see `costCents`). Keeping the total rather than
 * the average makes production exact however time is sliced (a settle adds `atoms * ref` with
 * no rounding), and merging two piles is a plain sum, so there is nothing to drift. Rounding
 * happens only when a part of a pile leaves it (`take`) or when a value is shown.
 *
 * Invariant: value is a non-negative safe integer, and an empty pile of a good has value 0 once
 * `take` has emptied it. Exceeding the safe-integer range needs about 10 000 units of one good
 * in one pile; `checkInvariants` reports it.
 */

export const emptyValue = (): Goods => ({ parts: 0, power: 0, data: 0, supplies: 0 });

/** Average cost of a pile in integer centi-credits per unit; 0 for an empty pile. */
export function costCents(atoms: number, value: number): number {
  if (atoms <= 0) return 0;
  return Math.floor((value + atoms / 2) / atoms);
}

/** The value moved when `part` of `whole` atoms leave a pile worth `value` (floor, exact BigInt). */
export function share(value: number, part: number, whole: number): number {
  if (value <= 0 || part <= 0 || whole <= 0) return 0;
  if (part >= whole) return value;
  return Number((BigInt(value) * BigInt(part)) / BigInt(whole));
}

/**
 * Removes `qty` atoms of each good from a pile and returns the value that went with them. The
 * goods record is reduced too, so the two never disagree. The caller checked the stock.
 */
export function take(goods: Goods, value: Goods, qty: Goods): Goods {
  const out = emptyValue();
  for (const g of GOODS) {
    if (qty[g] <= 0) continue;
    out[g] = share(value[g], qty[g], goods[g]);
    value[g] -= out[g];
    goods[g] -= qty[g];
    if (goods[g] <= 0) value[g] = 0;
  }
  return out;
}

/** Adds goods with their value to a pile. */
export function put(goods: Goods, value: Goods, add: Goods, addValue: Goods): void {
  for (const g of GOODS) {
    goods[g] += add[g];
    value[g] += addValue[g];
  }
}

/** The value of goods bought or made at a flat price per good (centi-credits per unit). */
export function valueAt(goods: Goods, prices: Goods): Goods {
  const out = emptyValue();
  for (const g of GOODS) out[g] = goods[g] * prices[g];
  return out;
}

/** Value in whole centi-credits of a value record (what a raid loss event reports). */
export function totalCents(value: Goods): number {
  let sum = 0;
  for (const g of GOODS) sum += Math.floor(value[g] / ATOMS_PER_UNIT);
  return sum;
}

/** The hub a district is priced against: the stored street-nearest one, else the nearest on the grid. */
export function nearestHub(state: GameState, d: District): Id | null {
  if (d.nearHub && state.districts[d.nearHub]?.kind === 'hub') return d.nearHub;
  let best: Id | null = null;
  let bestD = Infinity;
  for (const id of Object.keys(state.districts).sort()) {
    const h = state.districts[id] as District;
    if (h.kind !== 'hub') continue;
    const dist = (h.pos.x - d.pos.x) ** 2 + (h.pos.y - d.pos.y) ** 2;
    if (dist < bestD) {
      best = id;
      bestD = dist;
    }
  }
  return best;
}

/** The reference price (centi-credits per unit) a district's goods are worth right now. */
export function refCentsNear(state: GameState, d: District, good: Good): number {
  const hub = nearestHub(state, d);
  return (
    (hub ? state.markets[hub]?.[good]?.refCents : undefined) ?? balance.market.baseRefCents[good]
  );
}

/** The reference price at a node (a hub's own book, or the hub nearest a district). */
export function refCentsAtNode(state: GameState, nodeId: Id, good: Good): number {
  const d = state.districts[nodeId];
  if (!d) return balance.market.baseRefCents[good];
  if (d.kind === 'hub')
    return state.markets[nodeId]?.[good]?.refCents ?? balance.market.baseRefCents[good];
  return refCentsNear(state, d, good);
}

/** Goods valued at the reference price at a node: the default when nothing better is known. */
export function valueAtNode(state: GameState, nodeId: Id, goods: Goods): Goods {
  const out = emptyValue();
  for (const g of GOODS) if (goods[g] > 0) out[g] = goods[g] * refCentsAtNode(state, nodeId, g);
  return out;
}
